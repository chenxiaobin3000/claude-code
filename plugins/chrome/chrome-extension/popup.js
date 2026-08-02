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
      : 'chrome 插件的 Native Host 尚未连接'
  if (status?.profileName) {
    document.querySelector('#profile-name').value = status.profileName
  }
  document.querySelector('#profile-id').textContent = status?.profileId
    ? `Profile ID: ${status.profileId}`
    : '正在初始化 Profile ID…'
}

document.querySelector('#save-profile').addEventListener('click', async () => {
  const profileName = document.querySelector('#profile-name').value.trim()
  const response = await chrome.runtime.sendMessage({
    type: 'set_profile_name',
    profileName,
  })
  document.querySelector('#message').textContent = response?.ok
    ? '个人资料别名已保存。'
    : response?.error || '保存失败。'
  if (response?.ok) await refreshStatus()
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

refreshStatus()
