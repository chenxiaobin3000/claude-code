#!/usr/bin/env bun

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { IMPLEMENTED_CHROME_TOOL_NAMES } from '../../plugins/chrome/protocol/index.js'

const root = resolve(import.meta.dir, '../..')
const hostPath =
  process.env.CLAUDEINCHROME_HOST?.trim() ||
  join(
    root,
    'dist',
    'plugins',
    'chrome',
    process.platform === 'win32'
      ? 'chrome-host.exe'
      : 'chrome-host',
  )
const fixturePort = Number.parseInt(
  process.env.CLAUDEINCHROME_FIXTURE_PORT ?? '17381',
  10,
)
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`

interface TextBlock {
  type: 'text'
  text: string
}

interface ImageBlock {
  type: 'image'
  data: string
  mimeType: string
}

interface ToolResult {
  content?: Array<TextBlock | ImageBlock | Record<string, unknown>>
  isError?: boolean
}

function fail(message: string): never {
  throw new Error(`[claudeinchrome-browser-e2e] ${message}`)
}

function progress(message: string): void {
  const line = `[claudeinchrome-browser-e2e] ${message}`
  console.log(line)
  const logPath = process.env.CLAUDEINCHROME_E2E_LOG?.trim()
  if (logPath) appendFileSync(logPath, `${line}\n`, 'utf8')
}

function textFrom(result: ToolResult): string {
  return (result.content ?? [])
    .filter((item): item is TextBlock => item.type === 'text')
    .map(item => item.text)
    .join('\n')
}

function assertSuccessful(name: string, result: ToolResult): string {
  const text = textFrom(result)
  if (
    result.isError ||
    text.includes('Chrome extension is not connected') ||
    text.includes('Error calling tool')
  ) {
    fail(`${name} failed: ${text || JSON.stringify(result)}`)
  }
  return text
}

function assertRejected(name: string, result: ToolResult): string {
  const text = textFrom(result)
  if (!result.isError) fail(`${name} unexpectedly succeeded: ${text}`)
  return text
}

function parseJsonText<T>(name: string, result: ToolResult): T {
  const combinedText = assertSuccessful(name, result)
  for (const item of result.content ?? []) {
    if (item.type !== 'text') continue
    try {
      return JSON.parse(item.text) as T
    } catch {
      // Tool results may include a second human-readable context block.
    }
  }
  fail(`${name} did not return a JSON text block: ${combinedText}`)
}

function fixtureHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>claudeinchrome E2E fixture</title>
    <style>
      body { font-family: sans-serif; min-height: 1600px; margin: 24px; }
      label, button, a { display: block; margin: 16px 0; }
      #result { font-weight: bold; }
    </style>
  </head>
  <body>
    <main>
      <h1>claudeinchrome E2E fixture</h1>
      <p id="fixture-marker">CHROME_E2E_FIXTURE_READY</p>
      <label>Fixture input <input aria-label="Fixture input" value=""></label>
      <button id="fixture-button" type="button">Fixture action</button>
      <p id="result">not-clicked</p>
      <a href="#fixture-target">Fixture target</a>
      <div id="fixture-target" style="margin-top: 900px">CHROME_E2E_TARGET</div>
    </main>
    <script>
      document.querySelector('#fixture-button').addEventListener('click', () => {
        document.querySelector('#result').textContent = 'CHROME_E2E_CLICKED'
      })
    </script>
  </body>
</html>`
}

async function serveFixture(): Promise<void> {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: fixturePort,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/health') {
        return new Response('ok', {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }
      return new Response(fixtureHtml(), {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/html; charset=utf-8',
        },
      })
    },
  })
  console.log(`[claudeinchrome-browser-e2e] fixture: ${server.url}`)
  console.log(
    '[claudeinchrome-browser-e2e] keep this process running while executing --matrix',
  )
  await new Promise<void>(resolve => {
    const close = () => {
      server.stop(true)
      resolve()
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
  })
}

async function withClient(
  action: (client: Client) => Promise<void>,
): Promise<void> {
  const transport = new StdioClientTransport({
    command: hostPath,
    args: ['mcp'],
    stderr: 'ignore',
  })
  const client = new Client({
    name: 'claudeinchrome-browser-e2e',
    version: '1.0.0',
  })
  try {
    await client.connect(transport)
    await action(client)
  } catch (error) {
    progress(`ERROR ${error instanceof Error ? error.message : String(error)}`)
    throw error
  } finally {
    progress('CLOSE MCP client')
    await client.close()
    progress('CLOSED MCP client')
  }
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  progress(`RUN ${name}`)
  const result = (await client.callTool({
    name,
    arguments: args,
  })) as ToolResult
  progress(`DONE ${name}`)
  return result
}

async function waitForLocation(
  client: Client,
  tabId: number,
  expected: (url: string) => boolean,
  description: string,
): Promise<string> {
  const deadline = Date.now() + 10_000
  let lastLocation = ''
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const result = await call(client, 'javascript_tool', {
        tabId,
        text: 'location.href',
      })
      if (!result.isError) {
        lastLocation = JSON.parse(
          assertSuccessful(description, result),
        ) as string
        if (expected(lastLocation)) return lastLocation
      } else {
        lastError = textFrom(result)
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(100)
  }
  fail(
    `${description} timed out; last location=${lastLocation || '<none>'}; last error=${lastError || '<none>'}`,
  )
}

async function verifyConnection(client: Client): Promise<{
  availableTabs: Array<{
    tabId: number
    title: string
    url: string
    windowId: number
  }>
}> {
  const advertised = (await client.listTools()).tools
    .map(tool => tool.name)
    .sort()
  const expected = [...IMPLEMENTED_CHROME_TOOL_NAMES].sort()
  if (JSON.stringify(advertised) !== JSON.stringify(expected)) {
    fail(
      `tool advertisement mismatch; expected ${expected.join(', ')}, received ${advertised.join(', ')}`,
    )
  }
  const context = parseJsonText<{
    availableTabs: Array<{
      tabId: number
      title: string
      url: string
      windowId: number
    }>
  }>(
    'tabs_context_mcp',
    await call(client, 'tabs_context_mcp', { createIfEmpty: false }),
  )
  if (!Array.isArray(context.availableTabs)) {
    fail('tabs_context_mcp omitted availableTabs')
  }
  console.log(
    `[claudeinchrome-browser-e2e] PASS connection (${context.availableTabs.length} visible tabs)`,
  )
  return context
}

async function verifyDeniedPaths(client: Client): Promise<void> {
  const invalidTab = await call(client, 'get_page_text', {
    tabId: 2_147_483_647,
  })
  if (!invalidTab.isError) {
    fail('invalid Tab ID was not rejected')
  }
  console.log('[claudeinchrome-browser-e2e] PASS inaccessible-page paths')
}

async function verifyMatrix(client: Client): Promise<void> {
  await verifyConnection(client)
  assertSuccessful(
    'update_plan',
    await call(client, 'update_plan', {
      domains: ['127.0.0.1'],
      approach: ['Run the local claudeinchrome browser acceptance fixture'],
    }),
  )
  const fixtureTab = parseJsonText<{
    tabId: number
    title: string
    url: string
    windowId: number
  }>('tabs_create_mcp', await call(client, 'tabs_create_mcp'))
  assertRejected(
    'Chrome internal page',
    await call(client, 'get_page_text', { tabId: fixtureTab.tabId }),
  )
  assertSuccessful(
    'navigate fixture',
    await call(client, 'navigate', {
      tabId: fixtureTab.tabId,
      url: fixtureOrigin,
    }),
  )
  const tabId = fixtureTab.tabId

  const page = parseJsonText<{
    title: string
    url: string
    elements: Array<{ ref: string; label: string; tag: string }>
  }>(
    'read_page',
    await call(client, 'read_page', {
      tabId,
      filter: 'interactive',
    }),
  )
  if (page.title !== 'claudeinchrome E2E fixture') {
    fail(`unexpected fixture title: ${page.title}`)
  }
  const input = page.elements.find(item => item.label === 'Fixture input')
  const button = page.elements.find(item => item.label === 'Fixture action')
  const historyLink = page.elements.find(
    item => item.label === 'Fixture target',
  )
  if (!input || !button || !historyLink) {
    fail('read_page omitted fixture controls')
  }

  const found = parseJsonText<{
    matches: Array<{ ref: string; label: string }>
  }>(
    'find',
    await call(client, 'find', {
      tabId,
      query: 'Fixture input',
    }),
  )
  if (!found.matches.some(item => item.ref === input.ref)) {
    fail('find did not return the fixture input')
  }

  assertSuccessful(
    'form_input',
    await call(client, 'form_input', {
      tabId,
      ref: input.ref,
      value: 'CHROME_E2E_INPUT',
    }),
  )
  const inputValue = JSON.parse(
    assertSuccessful(
      'javascript_tool input check',
      await call(client, 'javascript_tool', {
        tabId,
        text: "document.querySelector('input').value",
      }),
    ),
  ) as string
  if (inputValue !== 'CHROME_E2E_INPUT') {
    fail(`form_input value mismatch: ${inputValue}`)
  }

  assertSuccessful(
    'computer input click',
    await call(client, 'computer', {
      tabId,
      action: 'left_click',
      ref: input.ref,
    }),
  )
  assertSuccessful(
    'computer key',
    await call(client, 'computer', {
      tabId,
      action: 'key',
      text: 'ctrl+a',
    }),
  )
  assertSuccessful(
    'computer type',
    await call(client, 'computer', {
      tabId,
      action: 'type',
      text: 'CHROME_E2E_TYPED',
    }),
  )
  const typedValue = JSON.parse(
    assertSuccessful(
      'javascript_tool typed input check',
      await call(client, 'javascript_tool', {
        tabId,
        text: "document.querySelector('input').value",
      }),
    ),
  ) as string
  if (typedValue !== 'CHROME_E2E_TYPED') {
    fail(`computer type value mismatch: ${typedValue}`)
  }

  assertSuccessful(
    'computer click',
    await call(client, 'computer', {
      tabId,
      action: 'left_click',
      ref: button.ref,
    }),
  )
  const pageText = assertSuccessful(
    'get_page_text',
    await call(client, 'get_page_text', { tabId }),
  )
  if (
    !pageText.includes('CHROME_E2E_FIXTURE_READY') ||
    !pageText.includes('CHROME_E2E_CLICKED')
  ) {
    fail('click or page text result was not observable')
  }

  const dimensions = JSON.parse(
    assertSuccessful(
      'javascript_tool dimensions',
      await call(client, 'javascript_tool', {
        tabId,
        text: '({width: window.outerWidth, height: window.outerHeight})',
      }),
    ),
  ) as { width: number; height: number }
  assertSuccessful(
    'resize_window',
    await call(client, 'resize_window', {
      tabId,
      width: Math.max(640, dimensions.width - 1),
      height: Math.max(480, dimensions.height - 1),
    }),
  )
  assertSuccessful(
    'resize_window restore',
    await call(client, 'resize_window', {
      tabId,
      width: dimensions.width,
      height: dimensions.height,
    }),
  )

  const screenshot = await call(client, 'computer', {
    tabId,
    action: 'screenshot',
  })
  assertSuccessful('computer screenshot', screenshot)
  const image = screenshot.content?.find(
    (item): item is ImageBlock => item.type === 'image',
  )
  if (!image || image.mimeType !== 'image/jpeg' || image.data.length < 100) {
    fail('computer screenshot did not return a JPEG image')
  }

  assertSuccessful(
    'computer scroll_to',
    await call(client, 'computer', {
      tabId,
      action: 'scroll_to',
      ref: historyLink.ref,
    }),
  )
  assertSuccessful(
    'computer scroll',
    await call(client, 'computer', {
      tabId,
      action: 'scroll',
      scroll_direction: 'up',
      scroll_amount: 1,
    }),
  )

  assertSuccessful(
    'computer history link',
    await call(client, 'computer', {
      tabId,
      action: 'left_click',
      ref: historyLink.ref,
    }),
  )
  await waitForLocation(
    client,
    tabId,
    url => url.endsWith('#fixture-target'),
    'history link load',
  )
  assertSuccessful(
    'navigate back',
    await call(client, 'navigate', { tabId, url: 'back' }),
  )
  await waitForLocation(
    client,
    tabId,
    url => !url.endsWith('#fixture-target'),
    'navigate back load',
  )

  assertSuccessful(
    'navigate forward',
    await call(client, 'navigate', { tabId, url: 'forward' }),
  )
  await waitForLocation(
    client,
    tabId,
    url => url.endsWith('#fixture-target'),
    'navigate forward load',
  )

  const unicodePath = '/路径/验收?值=测试'
  assertSuccessful(
    'navigate Unicode URL',
    await call(client, 'navigate', {
      tabId,
      url: `${fixtureOrigin}${unicodePath}`,
    }),
  )
  await waitForLocation(
    client,
    tabId,
    url =>
      decodeURI(url).includes('/路径/验收') &&
      decodeURI(url).includes('值=测试'),
    'Unicode URL load',
  )
  assertSuccessful(
    'javascript_tool page refresh',
    await call(client, 'javascript_tool', {
      tabId,
      text: 'location.reload(); true',
    }),
  )
  await waitForLocation(
    client,
    tabId,
    url => decodeURI(url).includes('/路径/验收'),
    'page refresh',
  )
  const refreshedText = assertSuccessful(
    'get_page_text after refresh',
    await call(client, 'get_page_text', { tabId }),
  )
  if (!refreshedText.includes('CHROME_E2E_FIXTURE_READY')) {
    fail('page tools did not recover after refresh')
  }

  const oversized = await call(client, 'javascript_tool', {
    tabId,
    text: "'x'.repeat(1100000)",
  })
  const oversizedError = assertRejected('oversized tool result', oversized)
  if (!oversizedError.toLowerCase().includes('limit')) {
    fail(`oversized tool result returned an unclear error: ${oversizedError}`)
  }
  assertSuccessful(
    'get_page_text after oversized result',
    await call(client, 'get_page_text', { tabId }),
  )

  await verifyDeniedPaths(client)
  console.log('[claudeinchrome-browser-e2e] PASS core tool matrix')
}

const mode = process.argv[2] ?? '--connection'
if (mode === '--serve-fixture') {
  await serveFixture()
} else if (mode === '--connection') {
  await withClient(async client => {
    await verifyConnection(client)
    await verifyDeniedPaths(client)
  })
} else if (mode === '--matrix') {
  await withClient(verifyMatrix)
} else {
  fail('expected --serve-fixture, --connection, or --matrix')
}
