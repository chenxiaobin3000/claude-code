# Claude Code Local Browser Bridge

这是 `claudeinchrome` 本地插件的 Manifest V3 Chrome 扩展，用 Native
Messaging 连接插件提供的 `claude-in-chrome` MCP。数据路径是：

`Claude Code CLI <-> 本地 MCP 管道 <-> Native Host <-> Chrome 扩展`

不经过 Anthropic 账号、OAuth 或云端浏览器服务。

## 当前安装状态

扩展 ID 固定为 `dlpofjonbnceelbmpelkfblmnghclmkm`，但插件的 MCP、Skill 与
Native Host 尚未迁移和验收。主程序已经移除 `--chrome` 和内置 Native Host
入口，因此当前即使在 `chrome://extensions` 加载本目录，也只会看到 Native Host
未连接。

完成开发计划中的插件迁移与验收前，不提供正式安装步骤，也不得通过恢复主干入口
绕过插件边界。

## 当前支持范围

已实现标签页枚举/创建、导航、窗口缩放、页面文本读取、元素查找、表单输入、
页面 JavaScript、常用点击/滚动/键盘动作和可见区域截图。录制 GIF、上传图片、
控制台/网络抓取与快捷方式等高级工具暂未实现，调用时会返回明确错误。

扩展清单声明 HTTP/HTTPS 页面访问能力，但默认仍由扩展自身的站点授权列表拒绝
访问。Chrome 内部页面、扩展页面及浏览器设置页不允许自动化。
