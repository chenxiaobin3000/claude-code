const NATIVE_HOST = 'com.anthropic.claude_code_browser_extension'
const MAX_BRIDGE_MESSAGE_BYTES = 1024 * 1024
const DOM_PROTOCOL_VERSION = 1
const MAX_DOM_SNAPSHOT_NODES = 5000
const MAX_DOM_SNAPSHOT_BYTES = 512 * 1024
const PROFILE_STORAGE_KEY = 'chromeProfile'

let nativePort = null
let nativeConnecting = false
let reconnectTimer = null
let reconnectDelay = 1000
let nativeConnected = false
let mcpConnected = false
let nativeHostVersion = null
let requestQueue = Promise.resolve()
let profileIdentity = null

function validProfileName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  return name.length >= 1 &&
    name.length <= 64 &&
    ![...name].some(character => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
    ? name
    : null
}

async function getProfileIdentity() {
  if (profileIdentity) return profileIdentity
  const stored = await chrome.storage.local.get(PROFILE_STORAGE_KEY)
  const candidate = stored?.[PROFILE_STORAGE_KEY]
  const profileId =
    typeof candidate?.profileId === 'string' &&
    /^[a-f0-9-]{36}$/.test(candidate.profileId)
      ? candidate.profileId
      : crypto.randomUUID()
  const profileName =
    validProfileName(candidate?.profileName) ||
    `Profile ${profileId.slice(0, 8)}`
  profileIdentity = { profileId, profileName }
  await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: profileIdentity })
  return profileIdentity
}

function sendProfileHello() {
  if (!nativePort || !profileIdentity) return
  nativePort.postMessage({
    type: 'profile_hello',
    profile_id: profileIdentity.profileId,
    profile_name: profileIdentity.profileName,
  })
}

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
      status: {
        nativeConnected,
        mcpConnected,
        nativeHostVersion,
        profileId: profileIdentity?.profileId || null,
        profileName: profileIdentity?.profileName || null,
      },
    })
    .catch(() => {})
}

async function connectNative() {
  if (nativePort || nativeConnecting) return
  nativeConnecting = true
  clearTimeout(reconnectTimer)
  try {
    await getProfileIdentity()
    if (nativePort) return
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
      reconnectTimer = setTimeout(() => void connectNative(), reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    })
    sendProfileHello()
    port.postMessage({ type: 'get_status' })
    broadcastStatus()
  } catch (error) {
    nativePort = null
    nativeConnected = false
    broadcastStatus()
    reconnectTimer = setTimeout(() => void connectNative(), reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  } finally {
    nativeConnecting = false
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
        .catch(error =>
          sendToolResponse(message.request_id, failure(errorMessage(error))),
        )
      break
    case 'bridge_request':
      requestQueue = requestQueue
        .then(() => executeBridgeRequest(message))
        .catch(error =>
          sendBridgeResponse(message.request_id, {
            error: {
              code: 'DOM_SNAPSHOT_FAILED',
              message: errorMessage(error),
            },
          }),
        )
      break
    case 'error':
      console.error('Native host error:', message.error)
      break
  }
}

function sendToolResponse(requestId, response) {
  if (!nativePort) return
  let message = {
    type: 'tool_response',
    request_id: requestId,
    ...response,
  }
  if (
    new TextEncoder().encode(JSON.stringify(message)).byteLength >
    MAX_BRIDGE_MESSAGE_BYTES
  ) {
    message = {
      type: 'tool_response',
      request_id: requestId,
      ...failure(
        `Chrome tool result exceeds the ${MAX_BRIDGE_MESSAGE_BYTES}-byte bridge limit.`,
      ),
    }
  }
  nativePort.postMessage(message)
}

function sendBridgeResponse(
  requestId,
  response,
  outputLimit = MAX_DOM_SNAPSHOT_BYTES,
) {
  if (!nativePort) return
  const effectiveLimit = Math.min(outputLimit, MAX_DOM_SNAPSHOT_BYTES)
  let message = {
    type: 'bridge_response',
    protocol_version: DOM_PROTOCOL_VERSION,
    request_id: requestId,
    ...response,
  }
  if (
    new TextEncoder().encode(JSON.stringify(message)).byteLength >
    effectiveLimit
  ) {
    message = {
      type: 'bridge_response',
      protocol_version: DOM_PROTOCOL_VERSION,
      request_id: requestId,
      error: {
        code: 'DOM_SNAPSHOT_TOO_LARGE',
        message: `DOM snapshot exceeds the ${effectiveLimit}-byte output limit. Narrow scopeSelector or lower maxNodes.`,
        limitBytes: effectiveLimit,
      },
    }
  }
  nativePort.postMessage(message)
}

function isValidDomSnapshotParams(params) {
  const include = params?.include
  return (
    typeof params?.profileId === 'string' &&
    params.profileId.length >= 1 &&
    params.profileId.length <= 128 &&
    Number.isSafeInteger(params.tabId) &&
    params.tabId >= 0 &&
    typeof params.scopeSelector === 'string' &&
    params.scopeSelector.length >= 1 &&
    params.scopeSelector.length <= 2048 &&
    include &&
    typeof include.tables === 'boolean' &&
    typeof include.lists === 'boolean' &&
    typeof include.links === 'boolean' &&
    typeof include.forms === 'boolean' &&
    typeof params.visibleOnly === 'boolean' &&
    Number.isInteger(params.maxNodes) &&
    params.maxNodes >= 1 &&
    params.maxNodes <= MAX_DOM_SNAPSHOT_NODES &&
    Number.isInteger(params.maxBytes) &&
    params.maxBytes >= 1024 &&
    params.maxBytes <= MAX_DOM_SNAPSHOT_BYTES &&
    (params.metadataOnly === undefined ||
      typeof params.metadataOnly === 'boolean') &&
    (params.matchSelectors === undefined ||
      (typeof params.matchSelectors === 'object' &&
        params.matchSelectors !== null &&
        !Array.isArray(params.matchSelectors) &&
        Object.keys(params.matchSelectors).length <= 32 &&
        Object.entries(params.matchSelectors).every(
          ([name, selector]) =>
            /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) &&
            typeof selector === 'string' &&
            selector.length >= 1 &&
            selector.length <= 2048 &&
            !/\p{Cc}/u.test(selector) &&
            !/:has\s*\(|:host(?:-context)?\s*\(|::part\s*\(/i.test(selector),
        )))
  )
}

async function executeBridgeRequest(message) {
  if (
    typeof message.request_id !== 'string' ||
    message.request_id.length === 0
  ) {
    console.error('Native bridge request is missing request_id')
    return
  }
  if (
    message.protocol_version !== DOM_PROTOCOL_VERSION ||
    message.method !== 'dom_snapshot'
  ) {
    sendBridgeResponse(message.request_id, {
      error: {
        code: 'UNSUPPORTED_BRIDGE_METHOD',
        message: `Unsupported native bridge method or protocol version: ${message.method}`,
      },
    })
    return
  }
  if (!isValidDomSnapshotParams(message.params)) {
    sendBridgeResponse(message.request_id, {
      error: {
        code: 'INVALID_DOM_SNAPSHOT_REQUEST',
        message: 'DOM snapshot parameters failed validation.',
      },
    })
    return
  }
  if (message.params.profileId !== profileIdentity?.profileId) {
    sendBridgeResponse(message.request_id, {
      error: {
        code: 'CHROME_PROFILE_MISMATCH',
        message: 'DOM snapshot request does not match this Chrome profile.',
      },
    })
    return
  }
  try {
    const result = await sendPageMessage(
      message.params.tabId,
      'dom_snapshot',
      message.params,
    )
    sendBridgeResponse(message.request_id, { result }, message.params.maxBytes)
  } catch (error) {
    sendBridgeResponse(message.request_id, {
      error: {
        code:
          error && typeof error.code === 'string'
            ? error.code
            : 'DOM_SNAPSHOT_FAILED',
        message: errorMessage(error),
      },
    })
  }
}

async function executeToolRequest(message) {
  if (
    typeof message.request_id !== 'string' ||
    message.request_id.length === 0
  ) {
    console.error('Native tool request is missing request_id')
    return
  }
  if (message.method !== 'execute_tool') {
    sendToolResponse(
      message.request_id,
      failure(`Unsupported native request method: ${message.method}`),
    )
    return
  }
  const tool = message.params?.tool
  const args = message.params?.args || {}
  try {
    const result = await executeTool(tool, args)
    sendToolResponse(message.request_id, result)
  } catch (error) {
    sendToolResponse(message.request_id, failure(errorMessage(error)))
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
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
      const pageError = response?.error
      const error = new Error(
        typeof pageError === 'object' &&
        typeof pageError?.message === 'string'
          ? pageError.message
          : typeof pageError === 'string'
            ? pageError
            : `Page action "${action}" failed.`,
      )
      error.code =
        typeof pageError === 'object' && typeof pageError?.code === 'string'
          ? pageError.code
          : 'PAGE_ACTION_FAILED'
      throw error
    }
    return response.result
  } catch (error) {
    const wrapped = new Error(
      `Cannot access tab ${tabId}. Reload the page after installing the extension. ${errorMessage(error)}`,
    )
    if (error && typeof error.code === 'string') wrapped.code = error.code
    throw wrapped
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

async function navigateHistory(tabId, direction) {
  await assertTabAllowed(tabId)
  try {
    if (direction === 'back') await chrome.tabs.goBack(tabId)
    else await chrome.tabs.goForward(tabId)
    return
  } catch (error) {
    if (!errorMessage(error).includes('Cannot find a next page in history')) {
      throw error
    }
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: delta => {
      const pageNavigation = globalThis.navigation
      const canNavigate =
        delta < 0 ? pageNavigation?.canGoBack : pageNavigation?.canGoForward
      if (canNavigate !== true) return false
      history.go(delta)
      return true
    },
    args: [direction === 'back' ? -1 : 1],
  })
  if (results[0]?.result !== true) {
    throw new Error(
      direction === 'back'
        ? 'Cannot find a previous page in history.'
        : 'Cannot find a next page in history.',
    )
  }
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
        availableTabs: tabs.map(tab => ({
          tabId: tab.id,
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
        tabId: tab.id,
        title: tab.title || '',
        url: tab.url || '',
        windowId: tab.windowId,
      })
    }
    case 'navigate': {
      const tabId = Number(args.tabId)
      if (args.url === 'back') {
        await navigateHistory(tabId, 'back')
      } else if (args.url === 'forward') {
        await navigateHistory(tabId, 'forward')
      } else {
        let url = String(args.url || '')
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`
        const origin = originForUrl(url)
        if (!origin) {
          throw new Error(`URL ${url} is not an accessible HTTP(S) page.`)
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
      const requested = (args.domains || []).map(domain =>
        String(domain).toLowerCase(),
      )
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
    await chrome.tabs.update(tab.id, { active: true })
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
  return success(await sendPageMessage(args.tabId, 'computer', args))
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'get_bridge_status') {
    sendResponse({
      nativeConnected,
      mcpConnected,
      nativeHostVersion,
      profileId: profileIdentity?.profileId || null,
      profileName: profileIdentity?.profileName || null,
    })
    return
  }
  if (message?.type === 'reconnect_native') {
    nativePort?.disconnect()
    nativePort = null
    void connectNative()
    sendResponse({ ok: true })
    return
  }
  if (message?.type === 'set_profile_name') {
    const profileName = validProfileName(message.profileName)
    if (!profileName) {
      sendResponse({ ok: false, error: '名称必须为 1 到 64 个可见字符。' })
      return
    }
    void getProfileIdentity().then(async identity => {
      profileIdentity = { ...identity, profileName }
      await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: profileIdentity })
      sendProfileHello()
      broadcastStatus()
      sendResponse({ ok: true, ...profileIdentity })
    })
    return true
  }
})

chrome.runtime.onInstalled.addListener(() => void connectNative())
chrome.runtime.onStartup.addListener(() => void connectNative())
void connectNative()
