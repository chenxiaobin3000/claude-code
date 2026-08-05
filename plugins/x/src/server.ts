import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { XReadOnlyClient } from './client.js'
import { resolveXApp } from './config.js'

const CommonSchema = z.object({ app: z.string().optional() })
const PostSchema = CommonSchema.extend({ post_id: z.string().regex(/^\d+$/) })
const UserSchema = CommonSchema.extend({
  user_id: z.string().regex(/^\d+$/).optional(),
  username: z.string().min(1).max(50).optional(),
}).refine(value => Boolean(value.user_id) !== Boolean(value.username), {
  message: 'Provide exactly one of user_id or username.',
})
const PagedUserSchema = UserSchema.and(
  z.object({
    max_results: z.number().int().min(5).max(100).optional(),
    pages: z.number().int().min(1).max(2).optional(),
  }),
)
const SearchSchema = CommonSchema.extend({
  query: z.string().min(1).max(512),
  max_results: z.number().int().min(5).max(100).optional(),
  pages: z.number().int().min(1).max(2).optional(),
})

class Semaphore {
  private active = 0
  private readonly waiting: Array<() => void> = []

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 2)
      await new Promise<void>(resolve => this.waiting.push(resolve))
    this.active++
    try {
      return await operation()
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }
}

const toolDefinitions = [
  {
    name: 'x_get_post',
    description: 'Read one public X Post by numeric ID.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'string', pattern: '^\\d+$' },
        app: { type: 'string' },
      },
      required: ['post_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'x_get_thread',
    description:
      'Read a public X Post and recent-search results in its conversation. The result is explicitly marked partial because recent search is time-limited.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'string', pattern: '^\\d+$' },
        app: { type: 'string' },
      },
      required: ['post_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'x_get_user',
    description: 'Read one public X user by numeric ID or username.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', pattern: '^\\d+$' },
        username: { type: 'string', minLength: 1, maxLength: 50 },
        app: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'x_get_user_posts',
    description: 'Read a bounded number of recent public Posts by a user.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', pattern: '^\\d+$' },
        username: { type: 'string', minLength: 1, maxLength: 50 },
        max_results: { type: 'integer', minimum: 5, maximum: 100 },
        pages: { type: 'integer', minimum: 1, maximum: 2 },
        app: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'x_search_recent',
    description:
      'Search public X Posts from the recent-search window with strict page and result limits.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 512 },
        max_results: { type: 'integer', minimum: 5, maximum: 100 },
        pages: { type: 'integer', minimum: 1, maximum: 2 },
        app: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'x_get_mentions',
    description:
      'Read a bounded number of public mentions when the configured X App plan permits this endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', pattern: '^\\d+$' },
        username: { type: 'string', minLength: 1, maxLength: 50 },
        max_results: { type: 'integer', minimum: 5, maximum: 100 },
        pages: { type: 'integer', minimum: 1, maximum: 2 },
        app: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
] as const

function appClient(alias?: string): XReadOnlyClient {
  const app = resolveXApp(alias)
  if (!app)
    throw new Error('No X App configured. Run `x-host app add <alias>` first.')
  return new XReadOnlyClient(app)
}

export function createXMcpServer(version: string): Server {
  const server = new Server(
    { name: 'x', version },
    {
      capabilities: { tools: {} },
      instructions:
        'Use only the six bounded, public-data, read-only X tools. OAuth user context, writes, streams, webhooks, and background polling are unavailable.',
    },
  )
  const semaphore = new Semaphore()
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...toolDefinitions],
  }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const name = request.params.name
      const input = request.params.arguments ?? {}
      const result = await semaphore.run(async () => {
        if (name === 'x_get_post') {
          const value = PostSchema.parse(input)
          return appClient(value.app).getPost(value.post_id)
        }
        if (name === 'x_get_thread') {
          const value = PostSchema.parse(input)
          return appClient(value.app).getThread(value.post_id)
        }
        if (name === 'x_get_user') {
          const value = UserSchema.parse(input)
          return appClient(value.app).getUser({
            userId: value.user_id,
            username: value.username,
          })
        }
        if (name === 'x_get_user_posts') {
          const value = PagedUserSchema.parse(input)
          return appClient(value.app).getUserPosts({
            userId: value.user_id,
            username: value.username,
            maxResults: value.max_results,
            pages: value.pages,
          })
        }
        if (name === 'x_search_recent') {
          const value = SearchSchema.parse(input)
          return appClient(value.app).searchRecent({
            query: value.query,
            maxResults: value.max_results,
            pages: value.pages,
          })
        }
        if (name === 'x_get_mentions') {
          const value = PagedUserSchema.parse(input)
          return appClient(value.app).getMentions({
            userId: value.user_id,
            username: value.username,
            maxResults: value.max_results,
            pages: value.pages,
          })
        }
        throw new Error(`Unknown X tool ${name}.`)
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      }
    }
  })
  return server
}

export async function runXMcpServer(version: string): Promise<void> {
  const server = createXMcpServer(version)
  await server.connect(new StdioServerTransport())
}
