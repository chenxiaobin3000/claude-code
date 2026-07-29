const NATIVE_HOST = 'com.anthropic.claude_code_browser_extension'
const DEFAULT_SETTINGS = { allowAllSites: false, allowedOrigins: [] }

let nativePort = null
let reconnectTimer = null
let reconnectDelay = 1000
let nativeConnected = false
let mcpConnected = false
let nativeHostVersion = null
let requestQueue = Promise.resolve()

function textContent(value) {
  return [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value),
    },
  ]
}

function success(value) {
  return { result: { content: textContent(value) } }
}

function failure(message) {
  return { error: { content: textContent(message) } }
}

function broadcastStatus() {
  chrome.runtime
    .sendMessage({
      type: 'bridge_status',
      status: { nativeConnected, mcpConnected, nativeHostVersion },
    })
    .catch(() => {})
}

function connectNative() {
  if (nativePort) return
  clearTimeout(reconnectTimer)
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST)
    nativePort = port
    nativeConnected = true
    reconnectDelay = 1000
    port.onMessage.addListener(handleNativeMessage)
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message
      nativePort = null
      nativeConnected = false
      mcpConnected = false
      nativeHostVersion = null
      broadcastStatus()
      console.warn('Native host disconnected:', error || 'unknown reason')
      reconnectTimer = setTimeout(connectNative, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    })
    port.postMessage({ type: 'get_status' })
    broadcastStatus()
  } catch (error) {
    nativePort = null
    nativeConnected = false
    broadcastStatus()
    reconnectTimer = setTimeout(connectNative, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  }
}

function handleNativeMessage(message) {
  switch (message?.type) {
    case 'status_response':
      nativeHostVersion = message.native_host_version || null
      nativeConnected = true
      broadcastStatus()
      break
    case 'mcp_connected':
      mcpConnected = true
      broadcastStatus()
      break
    case 'mcp_disconnected':
      mcpConnected = false
      broadcastStatus()
      break
    case 'tool_request':
      requestQueue = requestQueue
        .then(() => executeToolRequest(message))
        .catch(error => sendToolResponse(failure(errorMessage(error))))
      break
    case 'error':
      console.error('Native host error:', message.error)
      break
  }
}

function sendToolResponse(response) {
  if (!nativePort) return
  nativePort.postMessage({ type: 'tool_response', ...response })
}

async function executeToolRequest(message) {
  if (message.method !== 'execute_tool') {
    sendToolResponse(
      failure(`Unsupported native request method: ${message.method}`),
    )
    return
  }
  const tool = message.params?.tool
  const args = message.params?.args || {}
  try {
    const result = await executeTool(tool, args)
    sendToolResponse(result)
  } catch (error) {
    sendToolResponse(failure(errorMessage(error)))
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function getSettings() {
  return {
    ...DEFAULT_SETTINGS,
    ...(await chrome.storage.local.get(DEFAULT_SETTINGS)),
  }
}

function originForUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.origin
      : null
  } catch {
    return null
  }
}

async function assertTabAllowed(tabId) {
  const tab = await chrome.tabs.get(Number(tabId))
  const origin = originForUrl(tab.url)
  if (!origin) {
    throw new Error(`Tab ${tabId} is not an accessible HTTP(S) page.`)
  }
  const settings = await getSettings()
  if (!settings.allowAllSites && !settings.allowedOrigins.includes(origin)) {
    throw new Error(
      `Site access is not granted for ${origin}. Open the extension popup on that site and enable access.`,
    )
  }
  return tab
}

async function sendPageMessage(tabId, action, args = {}) {
  await assertTabAllowed(tabId)
  try {
    const response = await chrome.tabs.sendMessage(Number(tabId), {
      type: 'page_tool',
      action,
      args,
    })
    if (!response?.ok) {
      throw new Error(response?.error || `Page action "${action}" failed.`)
    }
    return response.result
  } catch (error) {
    throw new Error(
      `Cannot access tab ${tabId}. Reload the page after installing the extension. ${errorMessage(error)}`,
    )
  }
}

async function waitForTab(tabId, timeoutMs = 15000) {
  const current = await chrome.tabs.get(tabId)
  if (current.status === 'complete') return current
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error(`Timed out waiting for tab ${tabId} to load.`))
    }, timeoutMs)
    function listener(updatedId, info, tab) {
      if (updatedId === tabId && info.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve(tab)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function executeTool(tool, args) {
  switch (tool) {
    case 'tabs_context_mcp': {
      let tabs = await chrome.tabs.query({ currentWindow: true })
      if (args.createIfEmpty && tabs.length === 0) {
        tabs = [await chrome.tabs.create({ url: 'about:blank', active: true })]
      }
      return success({
        tabGroupId: null,
        tabs: tabs.map(tab => ({
          id: tab.id,
          title: tab.title || '',
          url: tab.url || '',
          active: Boolean(tab.active),
          windowId: tab.windowId,
        })),
      })
    }
    case 'tabs_create_mcp': {
      const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
      return success({
        id: tab.id,
        title: tab.title || '',
        url: tab.url || '',
        windowId: tab.windowId,
      })
    }
    case 'navigate': {
      const tabId = Number(args.tabId)
      if (args.url === 'back') {
        await assertTabAllowed(tabId)
        await chrome.tabs.goBack(tabId)
      } else if (args.url === 'forward') {
        await assertTabAllowed(tabId)
        await chrome.tabs.goForward(tabId)
      } else {
        let url = String(args.url || '')
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`
        const origin = originForUrl(url)
        const settings = await getSettings()
        if (
          !origin ||
          (!settings.allowAllSites && !settings.allowedOrigins.includes(origin))
        ) {
          throw new Error(
            `Site access is not granted for ${origin || url}. Grant it from the extension popup first.`,
          )
        }
        await chrome.tabs.update(tabId, { url })
      }
      const tab = await waitForTab(tabId).catch(() => chrome.tabs.get(tabId))
      return success({ id: tab.id, title: tab.title || '', url: tab.url || '' })
    }
    case 'read_page':
      return success(await sendPageMessage(args.tabId, 'read_page', args))
    case 'find':
      return success(await sendPageMessage(args.tabId, 'find', args))
    case 'form_input':
      return success(await sendPageMessage(args.tabId, 'form_input', args))
    case 'get_page_text':
      return success(await sendPageMessage(args.tabId, 'get_page_text', args))
    case 'javascript_tool': {
      await assertTabAllowed(args.tabId)
      const results = await chrome.scripting.executeScript({
        target: { tabId: Number(args.tabId) },
        world: 'MAIN',
        func: code => {
          try {
            // biome-ignore lint/security/noGlobalEval: This explicit MCP tool executes user-approved JavaScript in the page's MAIN world.
            const value = globalThis.eval(code)
            return {
              ok: true,
              value: value === undefined ? 'undefined' : JSON.stringify(value),
            }
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }
          }
        },
        args: [String(args.text || '')],
      })
      const value = results[0]?.result
      if (!value?.ok)
        throw new Error(value?.error || 'JavaScript execution failed.')
      return success(value.value)
    }
    case 'resize_window': {
      const tab = await chrome.tabs.get(Number(args.tabId))
      const window = await chrome.windows.update(tab.windowId, {
        width: Math.round(Number(args.width)),
        height: Math.round(Number(args.height)),
      })
      return success({
        windowId: window.id,
        width: window.width,
        height: window.height,
      })
    }
    case 'computer':
      return await executeComputer(args)
    case 'update_plan': {
      const settings = await getSettings()
      const requested = (args.domains || []).map(domain =>
        String(domain).toLowerCase(),
      )
      const approved =
        settings.allowAllSites ||
        requested.every(domain =>
          settings.allowedOrigins.some(origin => {
            try {
              return new URL(origin).hostname === domain
            } catch {
              return false
            }
          }),
        )
      if (!approved) {
        return failure(
          'The plan includes domains that are not approved. Open each domain and grant access in the extension popup, or enable all-sites access.',
        )
      }
      return success({
        approved: true,
        domains: requested,
        approach: args.approach || [],
      })
    }
    default:
      return failure(
        `The local Chrome extension is connected, but tool "${tool}" is not implemented yet.`,
      )
  }
}

async function executeComputer(args) {
  const action = args.action
  const tab = await assertTabAllowed(args.tabId)
  if (action === 'wait') {
    await new Promise(resolve =>
      setTimeout(resolve, Math.min(Number(args.duration || 1), 30) * 1000),
    )
    return success('Wait completed.')
  }
  if (action === 'screenshot') {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 65,
    })
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1)
    return {
      result: {
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data },
          },
        ],
      },
    }
  }
  if (action === 'zoom') {
    return failure('Region zoom is not implemented. Use screenshot instead.')
  }
  return success(await sendPageMessage(args.tabId, 'computer', args))
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'get_bridge_status') {
    sendResponse({ nativeConnected, mcpConnected, nativeHostVersion })
    return
  }
  if (message?.type === 'reconnect_native') {
    nativePort?.disconnect()
    nativePort = null
    connectNative()
    sendResponse({ ok: true })
    return
  }
})

chrome.runtime.onInstalled.addListener(connectNative)
chrome.runtime.onStartup.addListener(connectNative)
connectNative()
