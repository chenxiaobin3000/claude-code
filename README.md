# Claude Code Best

这是一个面向 OpenAI-compatible API 与本地模型的 Claude Code 衍生发行版。

本 README 只记录本项目的自定义行为和与 Claude Code 官方不一致的边界。未特别说明的交互、命令和工作流，请直接参考 [Claude Code 官方文档](https://code.claude.com/docs/en/overview)。

## 版本与文档边界

- 项目发行版本：`2.1.220`
- 官方功能对照基线：Claude Code `2.1.220`，以[官方 Changelog](https://code.claude.com/docs/en/changelog)为准。
- 基线状态：截至 `2026-08-09`，当前产品范围内的功能、差异边界、安全约束、构建和验证矩阵均已验收；可选后续能力不阻塞本版本发布。
- 本项目不追踪或复述官方已有且行为一致的功能；升级官方版本时，只补充新增差异或重新评估现有差异。

这里的“对齐”表示已经以官方 `2.1.220` 为功能审计基准，并在本项目适用的产品范围内完成验收；不表示源码、二进制或产品能力与官方发行版完全相同。Anthropic 账号与云服务、官方 Provider、远端产品和其他明确裁剪项仍按下文边界处理。

## 与当前官方版本的主要差异

以下是以官方 `2.1.220` 为基线的产品差异，不应把上游功能说明误认为本项目能力。

- **模型与登录**：官方的 Anthropic 登录、官方模型、组织默认/限制模型、Claude API Provider 与相关云端模型能力不适用。主程序只从 `models.json` 加载 OpenAI-compatible 模型；可选本地 `openai-proxy` 插件可把 ChatGPT/Codex 订阅转换为同一协议的 loopback 端点，但不改变 Provider、模型选择或工具主链。
- **云端与远程产品**：官方的 Web/Desktop/Mobile、Remote Control、GitHub App、Cloud Code Review、Routines、云端 Channels、Artifacts、语音与账户/用量产品均不提供。本项目也不包含官方自动更新、安装器或远端遥测；可选的本地 `weixin`、`wxwork`、`qq` 与 `telegram` Channel 插件不依赖 Anthropic 云服务。
- **插件与浏览器**：官方插件市场、远端安装/更新和插件自动重命名不提供。主程序不实现 Chrome、Channel 或订阅代理业务；生产 standalone 自动发现同级 `plugins` 一级目录中的本地 `chrome`、`weixin`、`wxwork`、`qq`、`telegram`、`telegram-user`、`x` 与 `openai-proxy`，源码开发通过 `--plugin-dir` 加载。插件均以独立 Host 分发，删除对应目录即可移除能力。
- **Sandbox**：Windows 上启用 Sandbox 时，Shell 会在 Windows Sandbox VM 内执行，默认只映射启动工作区和只读 Shell 运行时，且固定断网、不传递用户主目录或凭据。`failIfUnavailable`、`excludedCommands` 与 `allowUnsandboxedCommands` 保持上层语义；Windows 不能精确落实域名白名单、代理和目录内文件 allow/deny 规则，配置这些规则时会 fail-closed，而不会回退宿主执行。
- **会话路径**：官方 `/cd` 可迁移会话；本项目有意保持临时 cwd 语义，只改变主会话后续工具的当前目录，不迁移项目身份、会话存储、权限根、配置或扩展作用域。
- **Agent、Hook、MCP 与 Skill**：本地 Agent、后台任务、Hook、Plugin、Skill 与 MCP 已固化为当前基线；嵌套 Skill 使用相对启动项目根的限定名，连续 inline Skill 可在同一条输入中组合。`/cd` 的临时 cwd、OpenAI-compatible Provider、本地安全增强和不提供云端 Agent 产品仍是明确差异。本地 `/mcp login`/`logout` 仅管理用户配置的 MCP OAuth 凭据。

## 运行时边界

### 网络能力边界

本项目只支持由 `models.json` 配置的 OpenAI-compatible Chat Completions 服务，包括本地 llama.cpp 和兼容该协议的远端服务。

- 不提供 Anthropic 官方网络 Provider、账号登录、OAuth、自动更新或原生安装流程。
- `@anthropic-ai/sdk` 仅保留为本地消息、工具调用、流事件和 Usage 的类型兼容层；它不是 Anthropic 网络连接的入口。
- 主程序不提供 ChatGPT/Codex OAuth；该能力仅存在于可独立删除的本地 `openai-proxy` 插件。Anthropic MCP Registry 预取、远端插件市场、远端插件下载和插件自动更新均不提供。
- 对不兼容 Chat Completions 的端点，直接给出兼容性错误；不会静默删除字段、切换 Provider 或进入供应商专用适配分支。

用户自行配置的模型端点、MCP、Hook 以及本地插件仍可访问其对应的外部服务。

Hook 可在 `PreToolUse` 中配置 `{"type":"mcp","tool":"mcp__server__tool","input":{...}}`，但只会调用当前会话已加载的 MCP Tool。该调用仍执行目标输入 Schema、现有工具权限和超时检查；拒绝、认证失败或执行失败会阻止原工具继续运行，不会借 Hook 绕过审批。

Hook command 的 `args` 会保持 argv 参数边界。启用 Sandbox 时不会回退到宿主直接执行：POSIX 进入 Sandbox 包装，Windows 上无法安全映射任意宿主可执行文件时会明确失败。

远程功能开关不参与运行行为；本地固定策略见 [`scripts/feature-policy.ts`](scripts/feature-policy.ts)，可用环境变量的完整清单见 [ENVIRONMENT_VARIABLES.md](docs/configuration/ENVIRONMENT_VARIABLES.md)。

## 模型配置

模型配置文件为 `~/.claude/models.json`。模型名必须唯一；多个模型可以共用同一个 `baseUrl`。`/model` 只在此列表中切换模型。

```json
{
  "defaultModel": "Qwen3.5-9B-Q6_K",
  "models": [
    {
      "model": "Qwen3.5-9B-Q6_K",
      "displayName": "Local Qwen",
      "baseUrl": "http://127.0.0.1:8080/v1"
    },
    {
      "model": "deepseek-v4-flash",
      "displayName": "DeepSeek Flash",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "profile": {
        "reasoning": {
          "enabledByDefault": false
        }
      }
    }
  ]
}
```

密钥优先从模型的 `apiKeyEnv` 指定环境变量读取；未设置时可使用本地初始化保存的配置密钥。密钥不会写入诊断日志。

### openai-proxy ChatGPT/Codex 订阅代理

`plugins/openai-proxy` 使用独立 Host 完成 ChatGPT 浏览器/device-code 登录，把 Codex Responses/SSE 转换为项目现有的 OpenAI-compatible Chat Completions 流。它不读取 Codex 自身凭据，也不向主程序增加 Provider 类型；删除插件目录即可完整移除。

本地地址固定为 `http://127.0.0.1:48181/v1`，访问必须使用至少 32 个随机字符的 `OPENAI_PROXY_LOCAL_TOKEN`。在 `models.json` 的 `models` 数组中增加普通 OpenAI 兼容模型条目：

```json
{
  "model": "gpt-5.4-mini",
  "displayName": "ChatGPT subscription",
  "baseUrl": "http://127.0.0.1:48181/v1",
  "apiKeyEnv": "OPENAI_PROXY_LOCAL_TOKEN"
}
```

生产分发使用 `dist/plugins/openai-proxy/openai-proxy-host.exe`；源码开发使用 `bun run plugins/openai-proxy/host/entry.ts`。两者均支持 `setup`、`login`、`login --device-code`、`status`、`doctor`、`logout`、`serve`、`stop` 和 `mcp`。Session 只保存在 `~/.claude/openai-proxy/auth.json`，退出会撤销远端 Token 并删除本地凭据。

可选 `OPENAI_PROXY_URL` 仅接受显式 HTTP/HTTPS 代理，统一覆盖 OAuth、Token 刷新/撤销、模型目录和 Responses；代理拒绝、认证、DNS、TLS 或超时失败不会回退直连。上游兼容基线固定为 OpenAI Codex `rust-v0.147.0`，协议 `client_version` 为 `0.147.0`；审计使用 `bun run audit:openai-proxy-upstream -- --tag rust-v0.147.0`，只下载固定白名单到系统临时目录，不改写生产代码。

### 静态模型 Profile

模型能力由模型 ID 的静态 Profile 决定，包括上下文窗口、最大输出 Token、推理参数、Prompt Cache、价格以及工具调用字段。项目不会通过模型名称猜测能力，也不会在运行时进行能力探测。

- 已知模型使用代码中的显式 Profile。
- 未知模型使用 Qwen 派生的默认 Profile，并提示建议补充专用配置。
- `models.json` 中的 `profile` 可覆盖默认 Profile，例如关闭 DeepSeek 的默认推理模式；未知模型完整提供 Token、推理、Chat Completions 与 Prompt Cache 能力后不再警告，`pricing` 可省略。
- llama.cpp 等端点若不接受对象形式的 `tool_choice`，会按其显式兼容配置发送字符串形式；不增加供应商专用协议分支。

模型请求失败时，诊断日志仅记录脱敏后的端点、模型、请求字段摘要、状态码和重试信息，不记录 API Key、OAuth Token 或完整 Prompt。

## 本地模型与 Windows Shell

本地 llama.cpp 的地址和模型名完全由 `models.json` 决定。上下文窗口必须同时满足模型 Profile 与 llama.cpp 实际启动时的 KV Cache 容量；服务端出现 “failed to find free space in the KV cache” 时，应降低请求上下文、输出上限或增大服务端上下文配置。

Windows 下 Bash 与 PowerShell 会按优先级探测可用实现。Bash 工具运行的是 Bash 语法，不应把 Windows `type`、`dir` 等 PowerShell/cmd 命令当作 Bash 命令使用；路径含空格、Unicode 或盘符时应使用与当前 Shell 匹配的引用和路径格式。

### Windows Sandbox

`sandbox.enabled: true` 时，受保护的 Bash 与 PowerShell 在 Windows Sandbox VM 中执行；VM 在首条受保护命令时启动，Bash 与 PowerShell 共用同一会话，取消命令或正常退出 CLI 都会关闭该会话。来宾只获得启动工作区的可写映射、私有控制目录和只读 Shell 运行时；网络、麦克风输入、剪贴板和 vGPU 均禁用，用户主目录、`.claude` 凭据和系统根目录不会映射或通过请求环境传入。

Windows Sandbox 不能精确执行域名白名单、代理或映射目录内的 `allowRead`/`denyRead`、`allowWrite`/`denyWrite` 规则。配置这些规则时 Sandbox 会拒绝启用，绝不会无提示回退到宿主命令。卷根、UNC、符号链接或 Junction 映射同样会被拒绝。

命令权限决策顺序固定为：硬安全拒绝、显式 deny、不可绕过安全审批、显式 ask、精确 allow、受约束模式/只读自动允许、默认 ask。工具级通配规则不能覆盖硬安全结果。

### macOS Sandbox

macOS 使用系统内置 Seatbelt，并继续默认阻止 Apple Events。本项目不实现 `sandbox.allowAppleEvents`，因此沙盒内的 `open`、`osascript` 或依赖 Apple Events 的浏览器启动流程可能失败；这是有意保留的安全边界，因为放开 Apple Events 后，沙盒命令可以启动不受原文件系统和网络隔离约束的外部应用。

确有需要时，在用户级配置中通过 `sandbox.excludedCommands` 精确列出对应命令，使其走沙盒外执行和既有权限审批；不要使用宽泛模式把无关命令一并排除。项目级配置不得借此获得额外自动授权。

## 会话与文件工具差异

`/cd` 只临时改变主会话后续工具使用的当前工作目录，不提供官方的跨项目会话迁移：

- 启动项目根、Session ID、Transcript/Resume、权限根、Settings、CLAUDE.md、Hook、Skill、Plugin、MCP、Memory、Plan 和 Checkpoint 作用域保持不变。
- `/cd` 不传播给子 Agent，子 Agent 的 cwd 变化也不会回写主会话。
- `/clear` 和进程重启恢复到启动项目目录。
- 无参数只显示当前 cwd；路径无效或切换失败时保留原 cwd。

Bash/PowerShell 命令中的 `cd` 属于 Shell cwd 持久化规则，不会触发项目身份或会话迁移。

### Agent 与本地后台任务

- 普通 Agent 默认后台运行；需要立即消费结果时可显式前台运行。Agent、Team、Shell、Workflow、MCP Monitor 和本地后台 Session 使用统一生命周期，等待权限、空闲、完成、失败、停止和取消可区分，终态不可被恢复或迟到事件覆盖。
- Agent cwd 与主会话隔离，worktree 使用独立目录。嵌套 Agent 默认最大深度 2、会话总数 50、并发 8、累计 Token 1,000,000；超限明确失败，取消向真实子树传播。
- `/fork` 创建拥有独立 Session、Transcript 和进程的后台会话，可通过 `status`、`attach`、`detach`、`resume` 和 `kill` 管理；`/subtask` 继承当前上下文，结果、通知与预算仍归当前会话。
- Shell 后台化会保留原进程、Tool Use ID、输出、退出码和取消链；MCP Monitor 使用同一任务契约。普通 MCP Tool 默认运行 30 秒后转入统一后台任务，保留 Task ID、进度、结果文件、取消和原始超时；不会在可能已经产生副作用后自动重放。
- 交互式后台 Agent 的权限请求返回主会话并标明来源；headless/stream-json 安全拒绝无法交互审批的请求。启用 partial messages 时，嵌套文本和推理事件携带父 Tool Use ID 与 Agent ID。
- Agent 最终报告与 Shell 交互提示中的间接内容会标记为 `untrusted-content` 并转义，不能伪造运行时控制、任务终态或权限结果。

文件工具针对本地模型的重复失败增加确定性保护：同一轮中同一文件工具、操作和规范化路径连续失败两次后，后续相同调用会被阻止并要求模型先读取错误、调整参数或改用其他操作，避免无限重试。创建后立即修改的流程会保留文件版本校验；遇到外部修改错误时应先重新读取文件。

大文件写入支持自动分块与截断恢复。恢复块有确定的大小上限；模型没有按协议分块时，工具会使用确定性方案继续，而不是无限要求模型重发完整内容。

## 主题、插件与安全边界

主题只有两类来源：内置主题，以及 `~/.claude/themes/*.json`。主题文件在启动时读取；外部修改后重启生效。不提供交互编辑、热更新或插件主题安装。

插件仅支持本地插件。Windows standalone 自动扫描 `claude.exe` 同级 `plugins` 目录下包含 `.claude-plugin/plugin.json` 的一级直接子目录，不递归、不扫描 cwd 或 `~/.claude/plugins`；链接、Junction 和路径逃逸会安全拒绝。优先级为显式 `--plugin-dir`（`@inline`）> 自动发现（`@local`）> 内置（`@builtin`）；同级重名禁用歧义项，高优先级加载失败不回退同名低优先级插件。`--bare` 禁用自动发现但保留显式插件；`/reload-plugins` 会重新扫描并裁剪已移除的活动组件。没有远端市场、下载、原生安装、CLI 自更新或插件自动更新。

### Channel 启动配置

稳定 Channel 可以在用户级 `~/.claude/settings.json` 的 `channels` 字段中持久化。每项同时声明要加载的插件和该 Channel 的回复工具；以后只需启动 `claude.exe`，不必每次传入 `--channels`：

```json
{
  "channels": [
    {
      "plugin": "plugin:weixin@local",
      "reply": "mcp__plugin_weixin_weixin__reply"
    },
    {
      "plugin": "plugin:wxwork@local",
      "reply": "mcp__plugin_wxwork_wxwork__reply"
    },
    {
      "plugin": "plugin:qq@local",
      "reply": "mcp__plugin_qq_qq__reply"
    },
    {
      "plugin": "plugin:telegram@local",
      "reply": "mcp__plugin_telegram_telegram__reply"
    }
  ]
}
```

管理员也可以在管理级 `managed-settings.json` 或 `managed-settings.d/*.json` 中配置同一字段。Windows 文件位置为 `C:\\Program Files\\ClaudeCode\\managed-settings.json`；macOS 为 `/Library/Application Support/ClaudeCode/managed-settings.json`；Linux 为 `/etc/claude-code/managed-settings.json`。

`channels` 明确不能在项目中配置：仓库内的 `.claude/settings.json`、`.claude/settings.local.json` 以及 `--settings` 指定的临时配置即使包含该字段也会被忽略，避免打开项目时由仓库自行启动外部消息入口。配置文件只接受上面的对象格式，不兼容旧字符串数组。命令行 `--channels` 仍接受插件字符串，并与用户级、管理级列表按 `plugin` 合并；同一插件可由配置文件补充 `reply`，冲突的回复工具会报错退出。`--dangerously-load-development-channels` 仍只用于当前交互式开发会话，不允许持久化。

Channel 消息进入模型后继续使用原有轮次和合并流程；轮次完成时，最终 Assistant 文本会通过来源 Channel 对应的 `reply` 工具发送。普通终端输入不触发该流程。一次合并轮次按“来源 MCP Server + `chat_id`”去重并绑定最新 `message_id`；不同 Channel 分别发送同一最终文本。若模型在本轮已经用同一个回复工具向同一 `chat_id` 发送，则不会重复回复。配置的 `reply` 是被动发送最终回复的明确授权，但显式 `ask`、`deny` 或硬安全规则仍会阻止自动发送；工具缺失、归属不匹配、参数无效或调用失败都会明确报错，不会跨 Channel 回退。

QQ、企业微信和 Telegram Bot 对每个账号使用独立的跨进程连接锁，同一账号同一时刻只能由一个 Host 持有。锁同时记录 PID、进程启动时间、Host 身份、账号别名和随机 Owner ID；Windows、Linux 与 macOS 启动时会核验完整进程身份，PID 被其他进程复用时自动回收旧锁，无法确认所有权时安全拒绝。释放操作必须匹配完整 Owner ID，旧 Host 延迟退出不能删除新 Host 的锁。

本地 Plugin Manifest 可用 `apiVersion` 声明所需的扩展 API SemVer 范围，例如 `"apiVersion": "^1.0.0"`。当前扩展 API 为 `1.0.0`，并与 CLI 产品版本独立；同一主版本只允许新增可选字段或能力，删除、改名、默认行为变化等破坏性修改必须升级主版本。旧 Manifest 缺少该字段时按 v1 契约继续加载。显式范围不兼容时会禁用整个 Plugin，并连带收回其 Hook、Skill、Agent、Command、MCP、LSP 和 Settings，避免组件半加载；依赖该 Plugin 的其他 Plugin 也会按依赖闭包安全降级。MCP 和 ACP 仍使用各自协议的原生版本协商，不复用 Plugin API 版本。

### chrome 插件与 Chrome 扩展

主程序自身不包含 Chrome 操作实现。Chrome 集成全部位于
[`plugins/chrome`](plugins/chrome)，连接链路为“主程序标准插件
加载器 → 插件 MCP/Skill → 插件 Native Host → Chrome 扩展 → Chrome”。主程序
不会自动注入 Chrome MCP，也不提供 `--chrome`、`/chrome` 或内置 Chrome Skill。

生产构建把插件放在 `dist/plugins/chrome`，与 `dist/claude.exe` 的自动
发现目录一致；复制整个 `dist` 到固定目录后可直接运行 `claude.exe`，无需再传
`--plugin-dir`。源码/Bun 开发模式不会自动扫描仓库插件，仍使用
`bun run dev -- --plugin-dir plugins/chrome`。

Manifest V3 扩展源码位于
[`plugins/chrome/chrome-extension`](plugins/chrome/chrome-extension)，
固定扩展 ID 为 `dlpofjonbnceelbmpelkfblmnghclmkm`。扩展端已经实现标签页、
导航、页面读取与交互、截图和窗口缩放等能力。插件目录已经包含标准 MCP 声明、
正式 Skill、独立 MCP/Native Messaging Host、注册命令和 doctor；旧 workspace
MCP 包及主程序兼容实现已经删除。真实 Chrome 的连接、授权、Host 重连、拒绝
路径和核心工具矩阵已经验收，且不依赖 Anthropic 账号或云端浏览器服务。

插件工具与 Native Messaging 协议的权威定义位于
[`plugins/chrome/protocol`](plugins/chrome/protocol)。MCP 只能
广告扩展已经实现的 11 个工具；GIF、图片上传、Console/Network、快捷方式和
`computer.zoom` 不属于当前能力。工具请求使用必填 `request_id` 精确匹配响应，
消息上限为 1 MiB，工具超时为 30 秒。Windows、Linux 和 macOS 的 Host 与 MCP
统一使用仅绑定 `127.0.0.1` 的动态 TCP socket；每个 Chrome 扩展实例拥有独立
Host 端点，MCP 自动发现并汇总在线实例。端点使用随机令牌认证，令牌不写入日志，
不使用 Windows 命名管道或 Unix Domain Socket。

每个 Chrome 个人资料中的扩展会在自己的 `chrome.storage.local` 生成永久
`profileId`，并允许在扩展弹窗设置 `profileName` 别名。`tabs_context_mcp` 返回在线
Profile 及每个标签页的 `profileId`；多 Profile 同时连接时，后续工具调用必须携带
明确的 `profileId`。缺少目标、Profile 已断开、Profile ID 重复或 Tab ID 在多个
Profile 冲突时都会拒绝执行，不会回退到第一个账户。

扩展固定访问所有普通 HTTP/HTTPS 页面，不提供页面授权或站点白名单；Chrome
内部页、扩展页、文件页和无效 Tab 仍拒绝。真实浏览器验收使用
`bun run chrome:verify` 检查连接和失效 Tab 拒绝；使用 `bun run chrome:fixture`
启动本地页面后，`bun run chrome:verify:tools` 覆盖页面读取、交互、截图、
前进后退、刷新、Unicode URL 与超限结果恢复。

插件还提供独立、只读的 `chrome-dom` MCP，公开 `dom_inspect`、
`dom_extract_table`、`dom_extract_list` 和 `dom_wait`。它返回清洗后的结构化 DOM，
不返回原始 HTML、表单值、脚本或浏览器存储；所有调用必须明确指定 Profile 与 Tab，
超限、跨源 Iframe、Closed Shadow Root 和纯视觉内容会明确拒绝或标记不完整。固定
Fixture 已并入 `bun run verify`，真实 Chrome Fixture 覆盖动态页面、分页、内容变化、
敏感字段和超限恢复。扩展更新或重载后必须同时刷新已有目标页面，确保新版 Content
Script 注入，否则 DOM Bridge 可能超时。

生产机器仍须显式完成浏览器侧安装，CLI 自动发现插件不会修改 Chrome 或注册表：

1. 在 `chrome://extensions` 启用开发者模式，加载
   `plugins/chrome/chrome-extension`；扩展 ID 必须为
   `dlpofjonbnceelbmpelkfblmnghclmkm`。
2. 以实际运行 Chrome 的 Windows 用户执行
   `plugins/chrome/chrome-host.exe register`，再执行 `doctor`。
3. 保持分发目录路径稳定；移动 Host 后必须重新执行 `register`。
4. 多账户使用时，在每个 Chrome 个人资料中分别加载扩展并从弹窗设置可辨识别名；
   Native Host 只需按操作系统用户注册一次，每个已打开的个人资料会建立独立端点。

### weixin 插件

微信 Channel 的登录、轮询、媒体、二维码、配对、回复和权限转发实现全部位于
[`plugins/weixin`](plugins/weixin)。主程序不再包含 `ccb weixin` 专用命令、内置
`weixin@builtin` 注册或微信 workspace 依赖。

该插件连接腾讯微信团队维护的 iLink 后端，采用与官方
[`@tencent-weixin/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin)
插件相同的扫码登录与消息协议，但客户端代码由本项目独立实现和维护，并不安装、
运行或依赖该官方 npm 包。因此，腾讯官方插件的后续协议修复与功能更新不会自动
同步到本项目，需要在这里单独跟进。扫码登录授权的是微信机器人消息通道，不是接管
手机或 PC 微信客户端；当前能力边界以私信和媒体收发为主，不代表能够读取联系人、
历史聊天或任意操作个人微信界面。

当前 iLink 协议同步基线固定为官方插件 `2.4.6`（commit
`cef0bfc390393f716903e16d50408118047f87e0`），本地插件 Manifest 与
`package.json` 分别记录本地版本和官方兼容基线。现有实现已对齐请求标识、业务返回码、
完整二维码状态机、动态长轮询、Token 失效暂停、启动/停止通知、上下文持久化、CDN
完整 URL/重试以及引用媒体；同步基线不表示依赖或运行 OpenClaw。Host 可并发运行多个
账号，入站 `chat_id` 使用 `account-id::user-id` 显式路由；凭据、游标、上下文 Token、
允许列表和配对状态逐账号隔离，路由不唯一时 fail-closed。旧单账号状态首次使用时迁移
为 `default` 账号。

源码开发使用：

```powershell
bun plugins/weixin/host/entry.ts login personal
bun plugins/weixin/host/entry.ts login work
bun plugins/weixin/host/entry.ts accounts
# 已连接账号需要重新扫码或刷新 Token 时：
bun plugins/weixin/host/entry.ts login refresh personal
bun run dev -- --plugin-dir plugins/weixin --dangerously-load-development-channels plugin:weixin@inline
```

生产分发使用：

```powershell
.\dist\plugins\weixin\weixin-host.exe login personal
.\dist\plugins\weixin\weixin-host.exe login work
.\dist\plugins\weixin\weixin-host.exe accounts
# 已连接账号需要重新扫码或刷新 Token 时：
.\dist\plugins\weixin\weixin-host.exe login refresh personal
.\dist\claude.exe --channels plugin:weixin@local
```

生产来源 `weixin@local` 是已验收的本地 Channel 边界；显式 `--plugin-dir` 加载的
`weixin@inline` 仍按开发插件处理。账号与配对状态保存在用户目录
`.claude/channels/weixin`，不随插件目录复制。

每个账号可在 `.claude/channels/weixin/accounts/<account-id>/features.json` 独立配置
引用文本、远程 HTTP 媒体、脱敏诊断和 `/echo`；后三项默认关闭。流式 Markdown 与工具
进度需要当前 MCP Channel 不提供的生成中事件，因此明确不支持，配置开启会报错退出。
完整字段与安全边界见 [`plugins/weixin/README.md`](plugins/weixin/README.md)。

### wxwork 企业微信插件

企业微信 Channel 位于 [`plugins/wxwork`](plugins/wxwork)，只连接企业微信后台创建的
“API 模式智能机器人”WebSocket 长连接，不实现 Webhook、自建应用 XML 回调、
OpenClaw Runtime 或 Bot→Agent 回退。实现独立维护；官方 CLI、OpenClaw 插件与
`@wecom/aibot-node-sdk` 只用于人工差异审计，不是运行时依赖。

Secret 始终按配置的环境变量名读取；变量可来自进程环境或用户级 `settings.json.env`。
可使用不同别名配置多个 Bot；路由、配对、排重、权限和连接租约逐 Bot 隔离，同一 Bot 被第二个 Host 启动时会
在连接前拒绝。源码配置示例：

```powershell
$env:WXWORK_PRIMARY_SECRET = "your-secret"
bun plugins/wxwork/host/entry.ts bot add primary your-bot-id WXWORK_PRIMARY_SECRET
bun plugins/wxwork/host/entry.ts bot doctor primary
bun run dev -- --plugin-dir plugins/wxwork --dangerously-load-development-channels plugin:wxwork@inline
```

生产分发使用：

```powershell
.\dist\plugins\wxwork\wxwork-host.exe bot add primary your-bot-id WXWORK_PRIMARY_SECRET
.\dist\plugins\wxwork\wxwork-host.exe bot doctor primary
.\dist\claude.exe --channels plugin:wxwork@local
```

新用户首次发消息后，由操作者运行 `wxwork-host access pair <alias> <code>` 完成配对。
插件只提供绑定入站请求的最终 Markdown 和受限媒体被动回复；主动发送、欢迎语、卡片、
企业文档/审批/打卡 API 和伪流式输出均不提供。完整协议、媒体限制和安全边界见
[`plugins/wxwork/README.md`](plugins/wxwork/README.md)。

### qq 机器人插件

QQ Channel 位于 [`plugins/qq`](plugins/qq)，独立实现 QQ 开放平台 Bot API v2 的
AppID/AppSecret 鉴权、WebSocket Gateway 入站和 REST 被动回复。当前人工同步基线为
`@tencent-connect/openclaw-qqbot@2.0.0`（commit
`47142c997bdbc9e72d92b817ff378941b3be7d4c`）、
`@tencent-connect/qqbot-connector@1.2.0` 与
`@tencent-connect/qqbot-nodejs@1.0.4`（gitHead
`589597a6cb5a24dce8230ba53bfba5390e13c073`）；这些包只用于人工协议审计，未安装、
导入或打入产物。

插件支持多个 Bot，别名和 AppID 必须唯一；Secret 始终按配置的环境变量名读取。Token、
Gateway 会话、排重、配对和权限状态逐 Bot 隔离。源码配置示例：

```powershell
$env:QQ_PRIMARY_SECRET = "your-app-secret"
bun plugins/qq/host/entry.ts bot add primary your-app-id QQ_PRIMARY_SECRET
bun plugins/qq/host/entry.ts bot doctor primary
bun run dev -- --plugin-dir plugins/qq --dangerously-load-development-channels plugin:qq@inline
```

生产分发使用：

```powershell
.\dist\plugins\qq\qq-host.exe bot add primary your-app-id QQ_PRIMARY_SECRET
.\dist\plugins\qq\qq-host.exe bot doctor primary
.\dist\claude.exe --channels plugin:qq@local
```

首版只消费 C2C 私聊和明确 `@` 机器人的群聊事件；回复必须绑定 15 分钟内的原消息，
不提供主动发送、Webhook、个人 QQ 登录、Guild、Cron、远程安装或自动更新。本地媒体
发送要求通过 `QQ_ALLOWED_FILE_ROOTS` 显式限定允许目录，单次上限 20 MiB。完整配置、
路由、媒体与安全边界见 [`plugins/qq/README.md`](plugins/qq/README.md)。

### telegram 机器人插件

Telegram Bot Channel 位于 [`plugins/telegram`](plugins/telegram)，使用固定的
`grammy@1.45.1`（commit `f9f7578d82ef127507aeb6902de8537b02ac994e`）连接
Telegram Bot API 10.2。只使用 `getUpdates` 长轮询，不建立 Webhook，也不会删除或
抢占已有 Webhook；grammY `bot.start()` 内部的删除调用会在本地确认而不发送到网络，
启动前仍通过 `getWebhookInfo` 明确拒绝冲突配置。

可选 `TELEGRAM_PROXY_URL` 支持 HTTP/HTTPS 代理，并统一覆盖 Bot API、长轮询、发送、
上传、`getFile` 和文件下载；当前 Bun standalone 不支持 SOCKS5，配置后失败会明确报错
且不回退直连。代理仅从进程环境或用户级 `settings.json.env` 读取，凭据会脱敏。

Token 始终按配置的环境变量名读取。可使用唯一别名配置多个 Bot，
Token、Update 排重、Chat/Topic 路由、媒体、配对、权限和连接租约逐 Bot 隔离：

```powershell
$env:TELEGRAM_PRIMARY_TOKEN = "123456:your-secret-token"
bun plugins/telegram/host/entry.ts bot add primary TELEGRAM_PRIMARY_TOKEN
bun plugins/telegram/host/entry.ts bot doctor primary
bun run dev -- --plugin-dir plugins/telegram --dangerously-load-development-channels plugin:telegram@inline
```

生产分发使用：

```powershell
.\dist\plugins\telegram\telegram-host.exe bot add primary TELEGRAM_PRIMARY_TOKEN
.\dist\plugins\telegram\telegram-host.exe bot doctor primary
.\dist\claude.exe --channels plugin:telegram@local
```

首版覆盖私聊、明确 `@`/回复/定向命令的群聊、Forum Topic、文本、图片、文档、音频、
语音和视频；提供绑定 15 分钟内原消息的 `reply` 与 `send_typing`，不提供主动发送、
Webhook、广播、Cron、Mini App 或 Bot 管理面板。文本按 4096 个 Unicode 字符拆分；
单文件上限 20 MiB，本地出站文件必须位于 `TELEGRAM_ALLOWED_FILE_ROOTS`。完整边界见
[`plugins/telegram/README.md`](plugins/telegram/README.md)。

### telegram 用户账号插件

Telegram User 历史读取插件位于 [`plugins/telegram-user`](plugins/telegram-user)，使用固定的
`telegram@2.26.22`（GramJS，commit
`3aedb2e6ef216d307607f3d0f3f5b0ace6701378`，生成 MTProto Layer 198）连接普通
Telegram 用户账号。它与 grammY Bot 插件完全分离，不共享配置、Session、路由或权限。
可选 `TELEGRAM_USER_PROXY_URL` 支持 GramJS SOCKS5 代理，统一覆盖登录、Session 恢复、
DC 迁移、对话列表和历史消息请求；不支持 HTTP/HTTPS 代理，失败时不回退直连。

先从 `my.telegram.org` 获取应用 API ID/API Hash。`account add` 保存 API ID、API
Hash 和 E.164 手机号对应的环境变量名。验证码与可选 2FA 密码由私有交互输入读取，
不会写入配置或日志：

```powershell
$env:TELEGRAM_API_ID = "12345678"
$env:TELEGRAM_API_HASH = "0123456789abcdef0123456789abcdef"
$env:TELEGRAM_PHONE = "+15551234567"
bun plugins/telegram-user/host/entry.ts account add personal TELEGRAM_API_ID TELEGRAM_API_HASH TELEGRAM_PHONE
bun plugins/telegram-user/host/entry.ts account login personal
bun plugins/telegram-user/host/entry.ts account groups personal
bun plugins/telegram-user/host/entry.ts access allow personal user 123456789
bun plugins/telegram-user/host/entry.ts account history personal group -1001234567890 20
```

各插件的索引只保存环境变量名，不保存长期凭据。运行时优先读取进程环境变量；独立执行
Host 的 `doctor`、`login` 或 `control-mcp` 时，缺失变量会按已保存的变量名回退读取用户级
`~/.claude/settings.json`（或 `CLAUDE_CONFIG_DIR/settings.json`）的 `env`。项目和管理级
设置不参与该回退。

所有 Channel 插件的核心 `reply` MCP 工具均始终加载；收到外部消息后模型可在同一轮直接
回复，不依赖先搜索延迟工具。`send_typing`、诊断等非必要工具仍按需加载。

生产分发把 `bun` 替换为 `dist/plugins/telegram-user/telegram-user-host.exe`。Session 是长期
登录凭据，逐账号私有保存于 `~/.claude/channels/telegram-user`。插件不注册 Channel、
不常驻监听 Update，也不提供回复或主动发送能力；需要消息时由模型显式调用历史读取工具。
未来如需近实时效果，可基于历史拉取实现轮询，但当前没有该后台模拟能力。
首次真实验收应使用低权限测试账号。
完整配置与安全边界见 [`plugins/telegram-user/README.md`](plugins/telegram-user/README.md)。

Telegram User 只注册 `telegram-user-control` MCP Server，按需提供 `list_chats`、
`set_chat_access` 和 `get_chat_history`。模型只能看到群名称、类型、allowlist 状态和由
本地 Session HMAC 生成的 `chatRef`，不会看到真实 Peer ID；历史读取仍限定于已加入无限制
Peer allowlist 的目标，最多 100 条且不下载附件。

### X 只读 MCP 插件

X 插件位于 [`plugins/x`](plugins/x)，只使用固定的 `X_BEARER_TOKEN` 执行 App-only
公开数据读取。它提供 `x_get_post`、`x_get_thread`、`x_get_user`、
`x_get_user_posts`、`x_search_recent` 和 `x_get_mentions`，不提供 OAuth 用户登录、
发布、回复、点赞、转发、关注、私信、Stream、Webhook 或后台轮询。

```powershell
$env:X_BEARER_TOKEN = "your-app-bearer-token"
bun plugins/x/host/entry.ts app add primary
bun plugins/x/host/entry.ts app doctor primary
bun run dev -- --plugin-dir plugins/x
```

多个 App 仍只使用 `X_BEARER_TOKEN` 一个固定变量，其值改为按别名索引的 JSON 对象。
可选 `X_PROXY_URL` 使用 Bun standalone 原生 HTTP/HTTPS CONNECT 代理；配置代理后失败
不会回退直连。当前 Bun standalone 不支持 SOCKS5，因此会明确拒绝。官方 XDK
`0.6.6` 已完成兼容审计，但其模块级私有 HTTP 传输无法安全注入插件代理，生产 Host
采用插件内固定 GET-only 传输且不打包 XDK。完整边界见
[`plugins/x/README.md`](plugins/x/README.md)。

真实服务验收只要求一个低权限 App 覆盖六个只读工具、分页、Rate Limit、HTTP CONNECT
代理和代理失败不回退；`403`/套餐拒绝及多 App/Token 隔离使用确定性 Fixture 验证，不要求
为了验收额外申请账号或降低真实账号套餐。

## 构建与验证

```powershell
bun install
bun run typecheck
bun run lint
bun run build
bun run build:vite
bun run build:exe
bun run build:chrome-host
bun run build:weixin-host
bun run build:wxwork-host
bun run build:qq-host
bun run build:telegram-host
bun run build:telegram-user-host
bun run build:x-host
bun run build:production
bun run verify
```

支持三条构建链：

- Bun bundle：开发和 Bun 运行时产物。
- Vite/Rollup Node bundle：Node 兼容分发产物。
- Bun standalone EXE：Windows standalone EXE 单文件 `claude.exe`；内置 ripgrep 首次启动时按 SHA-256 校验并提取到用户配置缓存，不依赖系统 `rg` 或 EXE 同级文件。
- chrome Plugin：`dist/plugins/chrome` 是完整分发目录，其中
  Host 为独立 Native Messaging/MCP 单文件，目标机器无需 Bun 或 Node.js。
- weixin Plugin：`dist/plugins/weixin` 是完整分发目录，其中 Host 为独立 Channel
  MCP 单文件，目标机器无需 Bun 或 Node.js。
- wxwork Plugin：`dist/plugins/wxwork` 是完整分发目录，其中 Host 为独立企业微信
  Channel MCP 单文件，目标机器无需 Bun 或 Node.js。
- qq Plugin：`dist/plugins/qq` 是完整分发目录，其中 Host 为独立 QQ Channel MCP
  单文件，目标机器无需 Bun 或 Node.js。
- telegram Plugin：`dist/plugins/telegram` 是完整分发目录，其中 grammY 与独立
  Telegram Channel MCP Host 已打入 standalone，目标机器无需 Bun 或 Node.js。
- telegram-user Plugin：`dist/plugins/telegram-user` 是完整分发目录，其中 GramJS、
  MTProto 客户端与独立 Telegram User 历史读取 MCP Host 已打入 standalone，目标机器无需 Bun 或 Node.js。
- x Plugin：`dist/plugins/x` 是完整分发目录，其中只读 X API MCP Host 已打入
  standalone，目标机器无需 Bun 或 Node.js。

`bun run build:production` 一次生成 `dist/claude.exe` 和
`dist/plugins/chrome`、`dist/plugins/weixin`、`dist/plugins/wxwork`、`dist/plugins/qq`、`dist/plugins/telegram`、`dist/plugins/telegram-user`、`dist/plugins/x`。整个 `dist` 是 Windows 生产分发单元：standalone
启动时只自动加载同级 `plugins` 下的一级插件目录；`--plugin-dir <path>` 仍可加载
临时插件或覆盖同名自动插件。自动发现不会安装 Chrome 扩展、注册 Native Host、
下载插件或更新任何产物。

项目保持 TypeScript + Bun 实现，不以 Rust 或其他平台原生语言重写 CLI。`claude.exe` 是包含 Bun Runtime 的 standalone 产物；它的目标是免安装运行时分发，而不是追随官方的原生二进制实现或安装/自更新机制。

`bun run verify` 是唯一的项目验证入口，覆盖依赖锁定、类型、Biome、适用构建、CLI `--version`/启动冒烟、源码级轻量验证，以及可用本地模型的单轮模型和工具调用。standalone 矩阵还验证本地 Markdown 配置发现、内置 ripgrep 的提取/校验/真实搜索、自动插件发现、`--bare` 隔离、显式覆盖和插件目录移除后的不可达性。它不依赖付费云模型，也不引入第二套测试框架。

### 性能与稳定性

性能采样默认关闭；启用 `CLAUDE_CODE_PERF_DIAGNOSTICS=1` 后记录版本化数值指标，但不记录 Prompt、工具结果、路径、模型、Endpoint、Session ID 或凭据。

交互式流文本首 Delta 立即显示，后续 Ink 刷新按 33 ms 窗口合并；这不改变 `stream-json`、SDK、ACP 或 headless 的逐事件契约。Compact、Clear、Rewind、Resume/Fork 与组件卸载会回收会话级回调和 Tool Result 替换状态。

FileWrite/FileEdit 使用异步临时文件、flush、版本复核和原子替换；Windows 共享锁采用 25/50/100/200/400 ms 有界退避，外部内容变化仍要求重新 Read，正文不会因清理或重试被提交两次。远端 MCP 等可重建基础设施使用 250 ms 起步、10 秒封顶、5 次熔断的 Supervisor；Agent、Workflow、Shell 和可能已有副作用的 MCP Tool 不会自动重放。

`bun run verify` 固定执行五窗口、5,000 Delta 的稳定性矩阵，UI flush 比上限为 0.1；当前验收实测为 0.0020。矩阵同时覆盖资源回落、Windows 真实文件锁、后台熔断、Agent/MCP/模型协议和会话生命周期，本地模型可用时再补充真实模型与工具调用。详细阈值和平台边界见 [开发计划与差异基线](docs/DEVELOPMENT_PLAN.md)。

## 项目文档

- [开发计划与差异基线](docs/DEVELOPMENT_PLAN.md)
- [环境变量](docs/configuration/ENVIRONMENT_VARIABLES.md)
- [Feature Flag 策略](docs/configuration/FEATURE_FLAGS.md)
- [依赖审计](docs/architecture/DEPENDENCY_AUDIT.md)
- [Anthropic SDK 类型兼容边界](docs/architecture/ANTHROPIC_SDK_COMPATIBILITY.md)
