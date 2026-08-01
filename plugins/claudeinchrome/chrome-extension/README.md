# Claude Code Local Browser Bridge

这是 `claudeinchrome` 本地插件的 Manifest V3 Chrome 扩展，用 Native
Messaging 连接插件提供的 `claude-in-chrome` MCP。数据路径是：

`Claude Code CLI <-> 本地回环 TCP <-> Native Host <-> Chrome 扩展`

不经过 Anthropic 账号、OAuth 或云端浏览器服务。
Chrome 操作由本扩展实现，Claude Code 主程序不直接实现或连接这些浏览器能力。
三端统一使用仅绑定 `127.0.0.1` 的动态 TCP 端点；每个扩展实例对应独立 Host，
通过随机令牌认证，MCP 可自动发现多个同时在线的 Chrome 个人资料实例。

## 当前安装状态

扩展 ID 固定为 `dlpofjonbnceelbmpelkfblmnghclmkm`。标准 Plugin MCP、Skill、
独立 Host 分发和真实 Chrome 工具矩阵已经验收。主程序已经移除
`--chrome` 和内置 Native Host 入口，因此在用户显式构建并注册插件 Host 前，
扩展会显示 Native Host 未连接。

不得通过恢复主干入口绕过插件边界。

## 当前支持范围

已实现标签页枚举/创建、导航、窗口缩放、页面文本读取、元素查找、表单输入、
页面 JavaScript、常用点击/滚动/键盘动作和可见区域截图。录制 GIF、上传图片、
控制台/网络抓取、快捷方式和区域缩放未实现，不会出现在 MCP 广告工具集合中；
绕过 MCP 直接调用未知工具时仍会返回明确错误。

工具与 Native Messaging 消息契约以
[`../protocol/index.ts`](../protocol/index.ts) 为准。每个工具请求和响应都必须
携带同一个 `request_id`，以避免多个 MCP 客户端之间发生响应串线。

扩展清单固定声明 `<all_urls>`，不提供页面授权或本地站点白名单，所有普通
HTTP/HTTPS 页面均可由 MCP 操作。该权限同时满足 `captureVisibleTab` 的截图要求。
Chrome 内部页、扩展页、浏览器设置页、文件页和无效 Tab 仍不允许自动化。
