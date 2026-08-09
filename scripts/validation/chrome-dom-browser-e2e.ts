#!/usr/bin/env bun

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { join, resolve } from 'node:path'

type ToolResponse = {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
}

const root = resolve(import.meta.dir, '../..')
const hostPath =
  process.env.CHROME_HOST?.trim() ||
  join(
    root,
    'dist',
    'plugins',
    'chrome',
    process.platform === 'win32' ? 'chrome-host.exe' : 'chrome-host',
  )
const profileId = process.env.CHROME_E2E_PROFILE_ID?.trim()
const tabId = Number(process.env.CHROME_E2E_TAB_ID)
const controlProbe = process.argv.includes('--control-probe')

function fail(message: string): never {
  throw new Error(`[chrome-dom-browser-e2e] ${message}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

if (!profileId || !Number.isSafeInteger(tabId) || tabId < 0) {
  fail('CHROME_E2E_PROFILE_ID and CHROME_E2E_TAB_ID are required')
}

function createClient(mode: 'mcp' | 'dom-mcp'): {
  client: Client
  transport: StdioClientTransport
} {
  const transport = new StdioClientTransport({
    command: hostPath,
    args: [mode],
    stderr: 'pipe',
  })
  transport.stderr?.on('data', chunk => process.stderr.write(chunk))
  return {
    transport,
    client: new Client({
      name: `chrome-dom-browser-e2e-${mode}`,
      version: '1.0.0',
    }),
  }
}

function text(response: ToolResponse): string {
  return (response.content ?? [])
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  console.log(`[chrome-dom-browser-e2e] RUN ${name}`)
  const response = (await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 35_000 },
  )) as ToolResponse
  console.log(
    `[chrome-dom-browser-e2e] ${response.isError ? 'ERROR' : 'PASS'} ${name}`,
  )
  return response
}

function jsonResult<T>(name: string, response: ToolResponse): T {
  const value = text(response)
  if (response.isError) fail(`${name} failed: ${value}`)
  try {
    return JSON.parse(value) as T
  } catch {
    fail(`${name} did not return JSON: ${value}`)
  }
}

function errorCode(name: string, response: ToolResponse): string {
  assert(response.isError, `${name} unexpectedly succeeded`)
  const value = JSON.parse(text(response)) as { error?: { code?: string } }
  return value.error?.code ?? ''
}

const dom = createClient('dom-mcp')
const control = controlProbe ? null : createClient('mcp')

try {
  await dom.client.connect(dom.transport)
  if (controlProbe) {
    const response = await call(dom.client, 'get_page_text', {
      profileId,
      tabId,
    })
    console.log(JSON.stringify(response))
    if (response.isError) process.exitCode = 1
  } else {
    assert(control, 'control client was not created')
    await control.client.connect(control.transport)
    const route = { profileId, tabId }

    jsonResult(
      'dom_wait',
      await call(dom.client, 'dom_wait', {
        ...route,
        selector: "#dynamic[data-state='ready']",
        condition: 'stable',
        quietMs: 500,
        timeoutMs: 5_000,
      }),
    )

    const inspect = jsonResult<{
      nodeCount: number
      partial: boolean
      partialReasons: string[]
      tags: Record<string, number>
      provenance: { pipeline: string; rawHtml: boolean; readOnly: boolean }
      visualFallback: { required: boolean; automaticMerge: boolean }
    }>(
      'dom_inspect',
      await call(dom.client, 'dom_inspect', {
        ...route,
        selector: '#acceptance-root',
        visibleOnly: false,
        maxNodes: 5_000,
      }),
    )
    for (const reason of [
      'closed_shadow_root_unavailable',
      'cross_origin_iframe_unavailable',
      'scrollable_content_requires_explicit_paging',
      'visual_content_not_included',
    ]) {
      assert(inspect.partialReasons.includes(reason), `missing ${reason}`)
    }
    assert(
      inspect.partial &&
        inspect.nodeCount > 40 &&
        inspect.tags.iframe === 2 &&
        inspect.provenance.pipeline === 'dom' &&
        inspect.provenance.rawHtml === false &&
        inspect.provenance.readOnly === true &&
        inspect.visualFallback.required === true &&
        inspect.visualFallback.automaticMerge === false,
      'inspect provenance or boundary mismatch',
    )

    const table = jsonResult<{
      table: { rows: Array<Record<string, string>> }
    }>(
      'dom_extract_table',
      await call(dom.client, 'dom_extract_table', {
        ...route,
        selector: '#markets',
        maxRows: 10,
        visibleOnly: false,
      }),
    )
    const tableText = JSON.stringify(table.table.rows)
    assert(
      tableText.includes('61234.123456789012345678') &&
        tableText.includes('3456.000000000000000001'),
      'high-precision table values changed',
    )

    const accounts = jsonResult<{
      list: { items: Array<{ text: string; depth: number }> }
    }>(
      'nested list',
      await call(dom.client, 'dom_extract_list', {
        ...route,
        selector: '#accounts',
        maxItems: 10,
        visibleOnly: false,
      }),
    )
    assert(
      accounts.list.items.some(item => item.text === '现货' && item.depth === 2) &&
        accounts.list.items.some(item => item.text === '合约' && item.depth === 2),
      'nested list depth was lost',
    )

    const firstPage = jsonResult<{
      list: { items: Array<{ fields: Record<string, string> }> }
      nextCursor?: string
      requiresExternalScroll: boolean
    }>(
      'virtual list first page',
      await call(dom.client, 'dom_extract_list', {
        ...route,
        selector: '#virtual-list',
        itemSelector: '.virtual-item',
        fields: { name: '.name' },
        maxItems: 2,
        visibleOnly: false,
      }),
    )
    assert(
      firstPage.list.items[0]?.fields.name === '订单 01' &&
        firstPage.list.items[1]?.fields.name === '订单 02' &&
        typeof firstPage.nextCursor === 'string' &&
        firstPage.requiresExternalScroll,
      'virtual list first page mismatch',
    )
    const secondPage = jsonResult<{
      list: { items: Array<{ fields: Record<string, string> }> }
    }>(
      'virtual list second page',
      await call(dom.client, 'dom_extract_list', {
        ...route,
        selector: '#virtual-list',
        itemSelector: '.virtual-item',
        fields: { name: '.name' },
        maxItems: 2,
        visibleOnly: false,
        cursor: firstPage.nextCursor,
      }),
    )
    assert(
      secondPage.list.items[0]?.fields.name === '订单 03' &&
        secondPage.list.items[1]?.fields.name === '订单 04',
      'signed cursor did not advance the list',
    )

    const shadow = JSON.stringify(
      jsonResult(
        'open shadow',
        await call(dom.client, 'dom_extract_list', {
          ...route,
          selector: '#open-shadow',
          itemSelector: '.shadow-content',
          maxItems: 10,
          visibleOnly: false,
        }),
      ),
    )
    assert(shadow.includes('Open Shadow 可见内容'), 'Open Shadow content missing')

    const iframe = JSON.stringify(
      jsonResult(
        'same-origin iframe',
        await call(dom.client, 'dom_extract_list', {
          ...route,
          selector: '#acceptance-root',
          itemSelector: '#same-origin-content',
          maxItems: 10,
          visibleOnly: false,
        }),
      ),
    )
    assert(iframe.includes('同源 Iframe 可见内容'), 'same-origin iframe missing')

    const sensitive = JSON.stringify(
      jsonResult(
        'sensitive fields',
        await call(dom.client, 'dom_extract_list', {
          ...route,
          selector: '#sensitive-form',
          itemSelector: 'input, textarea',
          maxItems: 10,
          visibleOnly: false,
        }),
      ),
    )
    for (const forbidden of [
      'password-must-not-leak',
      'token-must-not-leak',
      'secret-note-must-not-leak',
      'visible-user-value-must-not-leak',
    ]) {
      assert(!sensitive.includes(forbidden), `sensitive value leaked: ${forbidden}`)
    }

    jsonResult(
      'mutate page through separate control MCP',
      await call(control.client, 'javascript_tool', {
        ...route,
        text: `(() => {
          const list = document.querySelector('#virtual-list');
          list.scrollTop = 80;
          const item = document.createElement('li');
          item.className = 'virtual-item';
          item.innerHTML = '<span class="name">订单 09</span>';
          list.append(item);
          return true;
        })()`,
      }),
    )
    jsonResult(
      'dom_wait after mutation',
      await call(dom.client, 'dom_wait', {
        ...route,
        selector: '#virtual-list',
        condition: 'stable',
        quietMs: 300,
        timeoutMs: 5_000,
      }),
    )
    const staleCursor = await call(dom.client, 'dom_extract_list', {
      ...route,
      selector: '#virtual-list',
      itemSelector: '.virtual-item',
      fields: { name: '.name' },
      maxItems: 2,
      visibleOnly: false,
      cursor: firstPage.nextCursor,
    })
    assert(staleCursor.isError, 'cursor survived a page-version change')

    jsonResult(
      'navigate node limit fixture',
      await call(control.client, 'navigate', {
        ...route,
        url: 'http://127.0.0.1:18080/too-many.html',
      }),
    )
    const nodeLimit = await call(dom.client, 'dom_inspect', {
      ...route,
      selector: '#too-many',
      visibleOnly: false,
      maxNodes: 5_000,
    })
    assert(
      errorCode('node limit', nodeLimit) === 'DOM_SNAPSHOT_TOO_MANY_NODES',
      'node limit did not return its structured code',
    )
    jsonResult(
      'node limit recovery',
      await call(dom.client, 'dom_inspect', {
        ...route,
        selector: '#small-recovery',
        visibleOnly: false,
        maxNodes: 100,
      }),
    )

    jsonResult(
      'navigate byte limit fixture',
      await call(control.client, 'navigate', {
        ...route,
        url: 'http://127.0.0.1:18080/too-large.html',
      }),
    )
    const byteLimit = await call(dom.client, 'dom_inspect', {
      ...route,
      selector: '#too-large',
      visibleOnly: false,
      maxNodes: 5_000,
    })
    assert(
      errorCode('byte limit', byteLimit) === 'DOM_SNAPSHOT_TOO_LARGE',
      'byte limit did not return its structured code',
    )
    jsonResult(
      'byte limit recovery',
      await call(dom.client, 'dom_inspect', {
        ...route,
        selector: '#small-recovery',
        visibleOnly: false,
        maxNodes: 100,
      }),
    )

    console.log('[chrome-dom-browser-e2e] ALL CHECKS PASSED')
  }
} finally {
  await Promise.allSettled([
    dom.client.close(),
    control?.client.close() ?? Promise.resolve(),
  ])
}
