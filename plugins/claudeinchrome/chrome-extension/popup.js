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

refreshStatus()
