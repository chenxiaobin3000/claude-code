export const IMPLEMENTED_CHROME_DOM_TOOL_NAMES = [
  'dom_inspect',
  'dom_extract_table',
  'dom_extract_list',
  'dom_wait',
] as const

const profileId = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  description: 'Exact profileId returned by the Chrome profile context.',
}
const tabId = {
  type: 'integer',
  minimum: 0,
  description: 'Exact Chrome tab ID within the selected profile.',
}
const selector = {
  type: 'string',
  minLength: 1,
  maxLength: 2048,
  description: 'Bounded CSS selector evaluated in the selected page.',
}
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

export const CHROME_DOM_TOOLS = [
  {
    name: 'dom_inspect',
    description:
      'Read a sanitized structural summary from one explicit Chrome profile and tab. Returns node/tag counts and page-version metadata; it never returns raw HTML or form values.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId,
        tabId,
        selector: { ...selector, default: 'html' },
        visibleOnly: { type: 'boolean', default: true },
        maxNodes: { type: 'integer', minimum: 1, maximum: 5000, default: 2000 },
      },
      required: ['profileId', 'tabId'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: 'dom_extract_table',
    description:
      'Extract the first table inside a bounded selector as string-valued rows. Supports multi-level headers and row/column spans without coercing financial numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId,
        tabId,
        selector,
        columnAliases: {
          type: 'object',
          maxProperties: 64,
          additionalProperties: { type: 'string', maxLength: 128 },
        },
        maxRows: { type: 'integer', minimum: 1, maximum: 10000, default: 1000 },
        visibleOnly: { type: 'boolean', default: true },
      },
      required: ['profileId', 'tabId', 'selector'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: 'dom_extract_list',
    description:
      'Extract one read-only page of list or repeated-item content inside a bounded selector. nextCursor is bound to the exact page version. Virtual lists require an explicit browser scroll, dom_wait stable, and a fresh read; this tool never scrolls.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId,
        tabId,
        selector,
        itemSelector: selector,
        fields: {
          type: 'object',
          maxProperties: 16,
          additionalProperties: { ...selector },
        },
        maxItems: { type: 'integer', minimum: 1, maximum: 10000, default: 1000 },
        cursor: {
          type: 'string',
          minLength: 1,
          maxLength: 4096,
          description: 'Opaque signed cursor returned by the preceding read of the unchanged page.',
        },
        visibleOnly: { type: 'boolean', default: true },
      },
      required: ['profileId', 'tabId', 'selector'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: 'dom_wait',
    description:
      'Wait read-only for a selector to exist, disappear, or remain stable in one explicit Chrome profile and tab. Does not click, navigate, or execute page JavaScript.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId,
        tabId,
        selector,
        condition: {
          type: 'string',
          enum: ['exists', 'not_exists', 'stable'],
          default: 'exists',
        },
        quietMs: { type: 'integer', minimum: 100, maximum: 5000, default: 500 },
        timeoutMs: {
          type: 'integer',
          minimum: 100,
          maximum: 25000,
          default: 10000,
        },
      },
      required: ['profileId', 'tabId', 'selector'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
] as const
