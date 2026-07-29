const DEFAULT_SETTINGS = { allowAllSites: false, allowedOrigins: [] }
let currentOrigin = null

function setState(element, connected, yesText, noText) {
  element.textContent = connected ? yesText : noText
  element.className = connected ? 'ok' : 'bad'
}

async function refreshStatus() {
  const status = await chrome.runtime
    .sendMessage({ type: 'get_bridge_status' })
    .catch(() => null)
  setState(
    document.querySelector('#native-status'),
    Boolean(status?.nativeConnected),
    '已连接',
    '未连接',
  )
  setState(
    document.querySelector('#mcp-status'),
    Boolean(status?.mcpConnected),
    '已连接',
    '未连接',
  )
  document.querySelector('#native-version').textContent =
    status?.nativeHostVersion
      ? `Native Host ${status.nativeHostVersion}`
      : 'claudeinchrome 插件的 Native Host 尚未连接'
}

async function refreshSettings() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  try {
    const url = new URL(tab?.url || '')
    currentOrigin = ['http:', 'https:'].includes(url.protocol)
      ? url.origin
      : null
  } catch {
    currentOrigin = null
  }
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(await chrome.storage.local.get(DEFAULT_SETTINGS)),
  }
  document.querySelector('#site-origin').textContent =
    currentOrigin || '当前页面不可授权'
  document.querySelector('#site-access').disabled =
    !currentOrigin || settings.allowAllSites
  document.querySelector('#site-access').checked = Boolean(
    currentOrigin && settings.allowedOrigins.includes(currentOrigin),
  )
  document.querySelector('#all-sites').checked = settings.allowAllSites
}

document
  .querySelector('#site-access')
  .addEventListener('change', async event => {
    if (!currentOrigin) return
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(await chrome.storage.local.get(DEFAULT_SETTINGS)),
    }
    const allowed = new Set(settings.allowedOrigins)
    if (event.target.checked) allowed.add(currentOrigin)
    else allowed.delete(currentOrigin)
    await chrome.storage.local.set({ allowedOrigins: [...allowed].sort() })
    document.querySelector('#message').textContent = event.target.checked
      ? '已授权当前站点'
      : '已撤销当前站点'
  })

document.querySelector('#all-sites').addEventListener('change', async event => {
  await chrome.storage.local.set({ allowAllSites: event.target.checked })
  document.querySelector('#message').textContent = event.target.checked
    ? '已允许所有网站'
    : '已恢复按站点授权'
  await refreshSettings()
})

document.querySelector('#reconnect').addEventListener('click', async () => {
  document.querySelector('#message').textContent = '正在重新连接…'
  await chrome.runtime.sendMessage({ type: 'reconnect_native' })
  setTimeout(async () => {
    await refreshStatus()
    document.querySelector('#message').textContent = ''
  }, 800)
})

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'bridge_status') refreshStatus()
})

Promise.all([refreshStatus(), refreshSettings()])
