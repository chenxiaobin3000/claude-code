import { timingSafeEqual } from 'node:crypto'
import {
  OPENAI_PROXY_BASE_URL,
  OPENAI_PROXY_HOST,
  OPENAI_PROXY_PORT,
  resolveLocalToken,
} from './config.js'
import { OpenAIProxyModelService } from './model/service.js'
import { OpenAIProxyModelError } from './model/types.js'

export interface OpenAIProxyGateway {
  readonly url: string
  stop(): void
}

interface GatewayModelService {
  models(signal: AbortSignal): Promise<Response>
  chatCompletions(request: Request): Promise<Response>
}

interface GatewayOptions {
  token?: string
  port?: number
  modelService?: GatewayModelService
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function openAIError(message: string, code: string, status: number): Response {
  return json(
    {
      error: {
        message,
        type: 'openai_proxy_error',
        code,
      },
    },
    status,
  )
}

function isAuthorized(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(authorization.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  )
}

export function startOpenAIProxyGateway(
  version: string,
  options: GatewayOptions = {},
): OpenAIProxyGateway {
  const token = options.token ?? resolveLocalToken()
  const port = options.port ?? OPENAI_PROXY_PORT
  const modelService =
    options.modelService ?? new OpenAIProxyModelService({ version })
  const server = Bun.serve({
    hostname: OPENAI_PROXY_HOST,
    port,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({
          status: 'ok',
          service: 'openai-proxy',
          version,
          phase: 'model_forwarding',
        })
      }
      if (!isAuthorized(request, token)) {
        return openAIError(
          'A valid local openai-proxy Bearer token is required.',
          'invalid_local_token',
          401,
        )
      }
      if (request.method === 'GET' && url.pathname === '/doctor') {
        return json({
          status: 'ok',
          service: 'openai-proxy',
          version,
          bind: OPENAI_PROXY_HOST,
          forwarding: 'responses',
        })
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        try {
          return await modelService.models(request.signal)
        } catch (error) {
          return modelErrorResponse(error)
        }
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/v1/chat/completions'
      ) {
        try {
          return await modelService.chatCompletions(request)
        } catch (error) {
          return modelErrorResponse(error)
        }
      }
      return openAIError('Route not found.', 'route_not_found', 404)
    },
  })
  return {
    url: port === OPENAI_PROXY_PORT ? OPENAI_PROXY_BASE_URL : server.url.origin,
    stop: () => server.stop(true),
  }
}

function modelErrorResponse(error: unknown): Response {
  if (error instanceof OpenAIProxyModelError) {
    return openAIError(error.message, error.code, error.status)
  }
  return openAIError(
    'openai-proxy could not complete the model request.',
    'openai_proxy_failure',
    502,
  )
}
