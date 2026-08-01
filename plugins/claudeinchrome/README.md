# claudeinchrome

`claudeinchrome` 是项目唯一的本地 Chrome 集成边界。Claude 主程序本身不实现
Chrome 操作；生产 standalone 从 `claude.exe` 同级 `plugins` 下的一级目录自动
发现本插件，源码开发则通过 `--plugin-dir plugins/claudeinchrome` 显式加载。插件
成功加载后，才能通过其 MCP 与 Skill 连接 Chrome 扩展并控制 Chrome。

目标数据路径：

`Claude 主程序 -> claudeinchrome 插件 MCP/Skill -> Native Host -> Chrome 扩展 -> Chrome`

## 当前状态

- `chrome-extension/`：Manifest V3 扩展实现已经完成并位于插件目录，固定扩展 ID
  为 `dlpofjonbnceelbmpelkfblmnghclmkm`；已实现标签页、导航、页面读取与交互、
  截图和窗口缩放等浏览器端能力。
- `.claude-plugin/plugin.json`：已声明标准本地 stdio MCP；源码目录可通过
  `--plugin-dir plugins/claudeinchrome` 开发加载；生产分发目录由 standalone 自动
  发现，无需传该参数。
- `protocol/`：已经固定扩展实际实现的 11 个工具、Native Host 名称、1 MiB
  消息上限、30 秒工具超时、必填 `request_id` 及本地 TCP 端点契约；MCP 工具广告
  与扩展分发器由轻量验证保持一致。
- `host/`：已经提供独立 Native Messaging/MCP Host、注册、卸载和 doctor；
  Windows 分发产物位于 `dist/plugins/claudeinchrome`。
- `mcp/`：MCP 引擎、11 个工具声明、TCP Socket 生命周期和多实例端点池均已归入
  插件，不依赖旧 workspace 包或主程序 Chrome 实现。
- `skills/claude-in-chrome/`：标准 Plugin Skill 已建立，仅随插件加载。

标准 Plugin MCP/Skill 生命周期、独立分发结构、真实 Chrome 连接、授权、Host
自动重连、错误恢复和核心工具矩阵已经验收；主程序不会回退到原先的内置 Chrome
控制入口。

GIF、图片上传、Console/Network、快捷方式和 `computer.zoom` 未实现，也不会由
MCP 或 Skill 对外宣传。

Windows、Linux 和 macOS 使用相同的本机传输：每个 Chrome 扩展实例启动一个只
监听 `127.0.0.1` 动态端口的 Native Host，MCP 从用户临时目录发现所有在线端点。
端点以随机令牌认证，令牌不会记录到日志；不使用 Windows 命名管道或 Unix
Domain Socket。这个结构允许多个 Chrome 个人资料分别启动 Host 并同时连接。

后续迁移及验收范围以根目录 `DEVELOPMENT_PLAN.md` 为准。

## Host 命令

```powershell
bun run build:chrome-host
.\dist\plugins\claudeinchrome\claudeinchrome-host.exe register
.\dist\plugins\claudeinchrome\claudeinchrome-host.exe doctor
.\dist\plugins\claudeinchrome\claudeinchrome-host.exe unregister
```

注册和卸载必须由用户显式执行；插件不会从主程序启动流程自动修改 Native Host
清单或 Windows 注册表。构建后的整个 `dist/plugins/claudeinchrome` 是分发单元；
其 Manifest 直接启动独立 Host，目标机器不需要 Bun 或 Node.js。

完整 Windows 生产产物可在仓库根目录执行 `bun run build:production` 生成。将整个
`dist` 复制到固定目录后直接运行 `claude.exe`；它只扫描同级 `plugins` 的一级
直接子目录。`--plugin-dir` 仍可用于显式覆盖。自动发现插件不会代替 Chrome 扩展
加载或上述 `register`/`doctor` 操作。

## 真实 Chrome 验收

真实浏览器验收不进入无状态 CI。先在 Chrome 的扩展管理页加载
`dist/plugins/claudeinchrome/chrome-extension`，再执行：

```powershell
.\dist\plugins\claudeinchrome\claudeinchrome-host.exe register
bun run chrome:verify
```

完整工具矩阵使用只监听 `127.0.0.1:17381` 的本地页面：

```powershell
bun run chrome:fixture
# 在 Chrome 打开 http://127.0.0.1:17381，并从插件弹窗授权该站点
bun run chrome:verify:tools
```

扩展固定访问所有普通 HTTP/HTTPS 页面，不提供页面授权或站点白名单。
`chrome:verify` 验证真实扩展连接、11 个工具广告和未知/失效 Tab 拒绝；
`chrome:verify:tools` 继续覆盖页面读取、查找、表单、JavaScript、点击、键盘、
滚动、截图、窗口缩放与恢复、前进后退、刷新、Unicode URL、内部页面拒绝及
1 MiB 超限结果恢复。验收不会读取浏览器 Profile、Cookie 或凭据。
