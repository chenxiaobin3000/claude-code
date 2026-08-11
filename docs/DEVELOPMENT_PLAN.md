# 项目基线与开发计划

## 基线

项目当前发行版本为 `2.1.220`，官方功能对照基线固定为 Claude Code `2.1.220`。截至 `2026-08-09`，当前产品范围内的功能、差异边界、安全约束、构建和验证矩阵均已完成验收；可选后续能力不影响当前基线成立。

“功能对齐”仅表示以该官方版本为审计目标，并完成本项目适用范围的实现与验证，不表示源码、二进制或产品集合与官方发行版完全相同。明确裁剪、替代或不开发的能力继续以下文边界为准。上游功能与行为以 [Claude Code 官方文档](https://code.claude.com/docs/en/overview)和[官方 Changelog](https://code.claude.com/docs/en/changelog)为准。升级对照版本前必须先更新差异审计和对应验收矩阵，不能使用滚动的“最新版本”作为未冻结的验收目标。

本文件只维护本项目的已固化差异、明确边界和未开发任务。与官方一致的功能不在此重复列出，也不保留历史实施顺序、日期快照或阶段性验收记录。

## 已固化的项目差异

### OpenAI-compatible 运行时

- 模型来源为 `~/.claude/models.json`，每个模型拥有唯一 ID，可共享 OpenAI-compatible `baseUrl`。
- `/model` 仅从该配置切换模型；配置损坏或模型不可用时直接报错退出，不回退到 Anthropic 登录或交互式配网。
- 主模型链不支持 Anthropic 官方网络 Provider、内置 ChatGPT/Codex OAuth、旧国内云模型供应商引导、Anthropic MCP Registry 预取或内部 GitHub Webhook/KAIROS 分支；可独立删除的本地 `openai-proxy` 插件是唯一 ChatGPT/Codex 登录入口，并只以普通 OpenAI-compatible loopback 地址接入 `models.json`。
- `@anthropic-ai/sdk` 只作为本地消息、工具、流事件和 Usage 类型兼容层，禁止将其类型引用误判为网络 Provider。
- 不兼容 OpenAI Chat Completions 的端点必须清晰失败；禁止删字段重试、隐式 Provider 回退或新增供应商专用协议分支。

### 静态模型 Profile

- 以模型 ID 显式配置上下文窗口、最大输出 Token、推理参数、Prompt Cache 和价格；不进行能力探测或名称猜测。
- 未知模型加载 Qwen 派生默认 Profile，并提示补充专用 Profile。
- `models.json` 的 `profile` 可覆盖默认 Profile；覆盖与模型加载同步生效。
- 已对 OpenAI Chat Completions 的推理参数、工具选择、流事件和 Usage 字段进行边界核对；llama.cpp 的 `tool_choice` 兼容是受限的协议编码，不是 Provider 分支。

### openai-proxy 本地订阅模型代理

- `plugins/openai-proxy` 是可独立删除的 TypeScript/Bun 本地插件；主程序不新增 Provider 或代理模型类型，只把默认 `http://127.0.0.1:48481/v1` 或用户级 `openaiProxy.port` 指定的 loopback 地址作为普通 OpenAI-compatible `baseUrl`，删除插件不需要回滚主模型链。
- `setup` 已并入 `login`：首次登录在用户级 `settings.json` 自动生成并原子保存 32 字节本地网关 Token，同时固化默认端口 `48481`；端口只允许 `1024`～`65535`，已有合法配置保留，进程与持久化 Token 冲突时 fail-closed。ChatGPT Session 与本地网关 Token 继续分离保存。
- 独立 Host 提供浏览器 OAuth、device-code、PKCE/state、Token 刷新/撤销、私有原子 Session、单实例守护进程、客户端租约和 loopback Bearer 鉴权。ChatGPT 凭据只保存在 `~/.claude/openai-proxy/auth.json`，不读取 Codex 自身凭据，也不进入主进程、配置、日志或模型上下文。
- 网关把 Chat Completions 转为 Codex Responses，并把 SSE、reasoning、工具调用、Usage 和结束原因适配回现有 OpenAI 流；不支持字段、认证失败、超时、断流、代理失败和上游错误均 fail-closed，不切换模型、端点或直连路径。
- 可选 `OPENAI_PROXY_URL` 仅支持显式 HTTP/HTTPS CONNECT 代理并统一覆盖登录、刷新、撤销、模型目录和 Responses；代理认证、拒绝、超时或 TLS/DNS 失败不回退直连，诊断只显示脱敏端点。
- 上游兼容基线固定为 OpenAI Codex `rust-v0.147.0`（commit `be6e8eac029b183056b7e4402879f15d2c85f61b`），协议 `client_version` 固定为 `0.147.0`。`plugins/openai-proxy/upstream` 只保存来源、哈希、Apache-2.0 归属和语义映射；审计命令只下载固定白名单到临时目录，禁止引入 Rust、Agent 循环、Prompt、Tool、Sandbox、MCP、UI、遥测或其他白名单外职责。
- Windows 独立 Host、真实低权限账号登录、模型目录、流式模型调用、Token 轮换和退出均已验收；最终 `bun run verify --ci` 覆盖全部源码、workspace、主 EXE 与八个独立 Host/Plugin 发行物。Bun Windows `FailedToCommit` 由外层构建监督进程有限重试，不掩盖确定性构建错误。

### 工具、安全与本地文件

- Bash 与 PowerShell 权限统一采用：硬安全拒绝 > 显式 deny > 不可绕过安全审批 > 显式 ask > 精确 allow > 受约束模式/只读自动允许 > 默认 ask。
- 规则会检查整条命令、管道段、控制流、嵌套命令、包装器、别名、模块限定名、路径型可执行文件与解析失败降级；`Bash(*)` 和 `PowerShell(*)` 不覆盖硬安全结果。
- Windows Shell 实现按优先级进行可用性探测；Bash 与 PowerShell 不通过写死顺序互相替代。
- 文件写入支持分块与截断恢复。相同文件工具操作连续失败两次后，当前轮的第三次相同调用被确定性阻止，避免本地模型陷入重试循环。

### Agent 与本地后台任务

- 主会话 Bash 与 PowerShell 的 Shell 内部 `cd` 只在项目根或显式授权附加目录内跨调用保留；越界、目录失效、UNC、符号链接/Junction 和 Windows/Git Bash 路径转换均按统一策略处理。Agent 使用独立 cwd，上下文与 worktree 不继承或回写主会话的临时 `/cd`。
- Agent、Coordinator、Team、Shell、Workflow、MCP Monitor 和本地后台 Session 使用统一生命周期，区分 `queued`、`running`、`waiting_permission`、`idle`、`completed`、`failed`、`stopped` 与 `cancelled`；终态不可被迟到事件、恢复或通知附加处理覆盖。
- 普通 Agent 默认后台运行；显式前台、全局禁用后台和强制异步上下文按固定优先级决定执行方式。嵌套 Agent 默认最大深度 2、会话总数 50、并发 8、累计 Token 1,000,000，并支持通过已记录环境变量调整。
- `/fork` 创建独立 Session、Transcript 和后台进程，可执行 `status`、`attach`、`detach`、`resume` 与 `kill`；`/subtask` 是继承当前上下文、通知和预算的后台 Agent，两者不共享任务身份或所有权。
- Bash 与 PowerShell 共用后台化阈值并在迁移后保留原进程、Tool Use ID、磁盘输出、退出码和 Abort 链；MCP Monitor 使用相同任务生命周期。普通 MCP Tool 超阈值后进入同一后台任务体系，并保留进度、结果、取消和原始超时；不会在可能已经产生副作用后自动重放。
- 交互式后台 Agent 的权限请求回到主会话并显示来源，超时只拒绝当前工具调用；headless/stream-json 不创建本地审批并安全拒绝。停止、取消、失败与恢复会回收预算、进程、句柄、cleanup、worktree 和陈旧 PID。
- headless/stream-json 可按 partial messages 开关转发嵌套 Agent 文本与推理事件，事件携带稳定的父 Tool Use ID 和 Agent ID；队列反压优先丢弃可损失增量，不丢弃任务或会话生命周期事件。
- Agent 最终报告和 Shell 交互提示尾部使用 `untrusted-content` 来源标记并转义，不能伪造任务终态、权限结果或运行时控制标签；原生 MCP、网页、仓库和普通工具输出保持结构化 `tool_result`。

### Windows 原生 OS Sandbox

- Windows 上 `sandbox.enabled: true` 时，受保护的 Bash 与 PowerShell 固定在同一个 Windows Sandbox VM 中执行；首次受保护命令才启动可见 VM，取消或正常退出 CLI 会关闭整个来宾会话，绝不回退宿主执行。
- VM 只映射启动工作区（可写）、私有协议控制目录（可写）和已安装的 Bash/PowerShell 运行时（只读）；禁用网络、麦克风输入、剪贴板和 vGPU，不映射用户主目录、`.claude` 凭据或系统根目录，来宾请求环境为空。
- 请求使用结构化 argv 和协议文件传递并回传 stdout、stderr、退出码；卷根、UNC、符号链接/Junction 工作区或运行时映射均被拒绝。
- Windows Sandbox 无法精确实施域名/代理或映射目录内的文件 allow/deny 规则；遇到这些配置即 fail-closed。`failIfUnavailable`、`excludedCommands` 和 `allowUnsandboxedCommands` 保持上层语义。

### 本地产品边界

- 主题仅来自内置主题和 `~/.claude/themes/*.json`；重启读取，不提供编辑器、热更新或插件主题安装。
- 插件仅支持本地插件。Windows standalone 只扫描 `claude.exe` 同级 `plugins` 下含 `.claude-plugin/plugin.json` 的一级直接子目录，不递归、不扫描 cwd 或 `~/.claude/plugins`；目录缺失或为空时静默跳过，链接、Junction 和路径逃逸 fail-closed。源码/Bun 开发模式不自动扫描，继续使用 `--plugin-dir`。
- 稳定 Channel 可通过用户级 `~/.claude/settings.json` 或管理级 `managed-settings.json`/`managed-settings.d/*.json` 的 `channels` 对象列表随主程序启动；每项固定为 `{ "plugin": "plugin:<name>@<source>", "reply": "mcp__<server>__reply" }`，不兼容旧字符串数组。命令行 `--channels` 仍接受插件字符串，三种来源按 `plugin` 合并，并允许配置文件为命令行选择补充 `reply`；回复工具冲突时启动失败。项目 `.claude/settings.json`、`.claude/settings.local.json` 与 `--settings` 中的同名字段一律忽略，仓库不能自行启用外部消息入口；开发 Channel 仍只能通过交互式命令行参数临时启用。
- Channel 入站保持既有模型轮次和批量合并语义；最终 Assistant 文本按来源 Channel 的 `reply` 工具确定性发送，非 Channel 输入保持原流程。同一合并轮次按 MCP Server 与 `chat_id` 去重、使用最新 `message_id`，不同 Channel 分别发送；模型已对同一会话调用匹配回复工具时禁止重复发送。配置项授权被动最终回复，但显式 `ask`、`deny` 与硬安全结果优先；工具缺失、归属不匹配、参数无效或调用失败均明确失败，禁止跨 Channel 猜测或回退。
- QQ、企业微信与 Telegram Bot 统一使用账号级跨进程连接锁，锁记录 PID、进程启动时间、Host、账号别名与随机 Owner ID。Windows、Linux、macOS 均核验进程出生时间和 Host 身份，PID 复用或旧版陈旧锁可自动恢复，身份不可确认时 fail-closed；释放必须匹配完整所有权，禁止旧 Host 删除后继锁。同一账号不能被两个 Host 同时连接，不同插件或账号互不影响。
- `qq-host`、`wxwork-host`、`telegram-host` 与 `telegram-user-host` 只保存环境变量名，不保存长期凭据。后续运行优先读取进程环境变量，独立 Host 未获得 `claude.exe` 注入时按变量名回退读取用户级 `settings.json.env`；项目和管理级设置不参与该回退。
- 所有 Channel 插件的核心 `reply` MCP 工具通过 `anthropic/alwaysLoad` 始终进入模型工具列表，外部消息回复不依赖延迟工具搜索；非必要 Channel 工具继续按需加载。
- 插件优先级固定为显式 `--plugin-dir`（`@inline`）> standalone 自动发现（`@local`）> 内置（`@builtin`）。同级重名禁用歧义项，高优先级插件失败时不回退同名低优先级实现；`--bare` 禁用自动发现但保留显式插件，`/reload-plugins` 会重新扫描并裁剪已移除的全部插件组件。
- 不支持远端市场、自动下载、原生安装、CLI 自更新或插件自动更新；自动发现不会安装 Chrome 扩展、注册 Native Host 或修改注册表。
- 微信能力已从主程序内置 workspace 迁入 `plugins/weixin`：登录、轮询、媒体、二维码、配对、回复和权限转发由独立 `weixin-host` 承担。主程序不保留 `ccb weixin`、`weixin@builtin` 或微信实现依赖；生产使用 `weixin@local`，源码显式加载使用 `weixin@inline`，删除插件目录即可移除全部微信入口。
- 微信插件是腾讯官方 iLink 网络协议的独立实现，不依赖 OpenClaw Runtime；当前冻结兼容基线为 `@tencent-weixin/openclaw-weixin@2.4.6`（`cef0bfc390393f716903e16d50408118047f87e0`），本地 Manifest 与包元数据分别记录本地版本和上游兼容版本。
- 微信 iLink 基线覆盖通用请求头和 `base_info`、二维码完整状态机与 IDC 重定向、动态长轮询、业务返回码、Token 失效暂停、启停通知、游标和 `context_token` 原子持久化、CDN 完整 URL/参数回退、上传重试、引用媒体及确定性媒体优先级；网络错误保持脱敏，HTTP 200 下的业务失败不得伪装为成功。
- 微信账号使用索引和逐账号私有目录；凭据、游标、上下文 Token、允许列表、配对状态、体验配置与 Token 失效暂停互相隔离。Host 并发轮询全部账号，入站 `chat_id` 固定为 `account-id::user-id`；未限定账号且路由不唯一时 fail-closed，旧单账号状态一次性迁移为 `default`。
- 微信引用文本默认开启；远程 HTTP 媒体、脱敏 Channel 诊断和 Host 本地 `/echo` 按账号配置且默认关闭。远程媒体保持 HTTP(S) 协议和 100 MiB 限制，诊断禁止返回 Token 或消息正文。流式 Markdown 与工具进度依赖当前 MCP Channel 不提供的生成中事件，明确不支持，开启对应配置会报错退出。
- 微信协议通过 `scripts/validation/weixin-*.ts` 固定 Fixture 验证并并入 `bun run verify`，不依赖测试框架或真实账号；验证覆盖双账号并发轮询、状态/权限/回复隔离、歧义路由拒绝以及全部体验开关。
- 企业微信能力位于独立 `plugins/wxwork`，只实现“API 模式智能机器人”的 Bot WebSocket 长连接，不实现 Webhook、Agent/自建应用 XML 回调、OpenClaw Runtime、Bot→Agent 回退或自动安装/更新。当前人工同步基线为 `@wecom/wecom-openclaw-cli@1.1.0`、`@wecom/wecom-openclaw-plugin@20206.7.201`（commit `1a91ef7300de7274de8d74e4a566cf3b6e569a25`）和 `@wecom/aibot-node-sdk@1.0.7`（commit `80615b987ef69c6028ad764924609247c0725955`）；这些包只用于审计，没有安装、导入或打入产物。
- `wxwork-host` 支持多个 Bot 别名，凭据来自独立 Secret 环境变量。逐 Bot 保存配对、权限、排重与连接状态，进程级租约禁止同一 Bot 被两个 Host 同时连接。订阅认证、`req_id` 关联、心跳、踢下线、带抖动重连和连接代次隔离由独立 Host 处理，一个 Bot 故障不终止其他 Bot。
- 企业微信入站路由固定为 `bot-alias::single::userid` 或 `bot-alias::group::chatid`，覆盖文本、图片、图文混排、语音识别文本、视频和文件；仅允许绑定未过期入站请求的最终 Markdown 与媒体被动回复。媒体按官方 AES-256-CBC、512 KiB 分片及图片 10 MiB、语音 2 MiB、视频 10 MiB、文件 20 MiB 边界处理；主动发送、欢迎语、卡片和伪流式输出不提供。
- 企业微信访问默认使用配对，审批状态按 Bot、会话、发送者和 Request ID 隔离，群内其他成员不得代为批准。生产来源为 `wxwork@local`，开发显式加载为 `wxwork@inline`；固定 Fixture 覆盖协议、双 Bot/单 Bot 租约、重连/踢下线、路由、媒体、权限、依赖禁入和 standalone 分发，并统一并入 `bun run verify`。
- QQ 能力位于独立 `plugins/qq`，只实现 QQ 开放平台 Bot API v2 的 AppID/AppSecret 鉴权、WebSocket Gateway 入站和 REST 被动回复，支持 C2C 私聊与明确 `@` 机器人的群聊；不实现 Webhook、个人 QQ 登录、Guild、主动发送、Cron、OpenClaw Runtime、远程安装或自动更新。当前人工同步基线为 `@tencent-connect/openclaw-qqbot@2.0.0`（commit `47142c997bdbc9e72d92b817ff378941b3be7d4c`）、`@tencent-connect/qqbot-connector@1.2.0` 与 `@tencent-connect/qqbot-nodejs@1.0.4`（gitHead `589597a6cb5a24dce8230ba53bfba5390e13c073`）；这些包只用于审计，没有安装、导入或打入产物。
- `qq-host` 支持多个唯一 Bot 别名和 AppID，Secret 来自配置指定的环境变量。Access Token、Gateway Session/Seq、心跳、排重、配对、允许列表、权限和连接租约逐 Bot 隔离。Gateway 覆盖 HELLO、Identify、Heartbeat/ACK、Resume、失效会话重建、带抖动退避与连接代次隔离；单个 Bot 故障不会停止其他 Bot。
- QQ 入站路由固定为 `bot-alias::c2c::user-openid` 或 `bot-alias::group::group-openid`，OpenID 只作为 Bot 作用域内不透明标识；文本与媒体被动回复绑定 15 分钟内的原消息 ID，并使用确定性 `msg_seq`。远端媒体仅允许 QQ HTTPS 域名，本地文件必须位于 `QQ_ALLOWED_FILE_ROOTS`，单次上限 20 MiB；权限按 Bot、会话和发送者隔离，日志不得记录 Secret、Token、完整消息或媒体地址。
- QQ 固定 Fixture 已覆盖官方依赖禁入、双 Bot 配置与租约、Token/API、HELLO/心跳/ACK、Resume/重建、代次隔离、路由、群聊 `@`、排重、权限、媒体/SSRF、Secret 脱敏、Host EOF、standalone 分发和自动发现，并统一并入 `bun run verify`。生产来源为 `qq@local`，开发显式加载为 `qq@inline`；后续上游同步只允许人工冻结版本、审计差异并更新 Fixture。
- Telegram Bot 能力位于独立 `plugins/telegram`，使用 Telegram Bot API 10.2 与精确固定的 `grammy@1.45.1`（commit `f9f7578d82ef127507aeb6902de8537b02ac994e`）；grammY 及其依赖只进入插件和独立 Host，不进入根 CLI 或其他 Bundle。插件只使用 `getUpdates` 长轮询，不建立 Webhook，不引入 runner、session、auto-retry 或第二套数据库状态。
- `telegram-host` 支持多个唯一 Bot 别名和 Token，Token 来自配置指定的环境变量。Token、Update 排重、Chat/Topic、附件、配对、权限和连接租约逐 Bot 隔离。`bot doctor` 使用 `getMe` 与 `getWebhookInfo` 检查鉴权及互斥配置；grammY `bot.start()` 内部的 `deleteWebhook` 调用只在本地确认而不发送到网络，既有 Webhook、外部长轮询和 `409` 冲突均明确失败，不抢占外部 Bot。
- Telegram 路由固定为 `bot-alias::private::chat-id`、`bot-alias::group::chat-id` 或带 `::topic::thread-id` 的群组 Topic；群聊只接收明确 `@` Bot、回复 Bot 或带 Bot 用户名的命令。首版覆盖文本、图片、文档、音频、语音和视频，保留引用与附件元数据；`reply` 和 `send_typing` 必须绑定 15 分钟内的入站上下文，不提供主动发送。
- Telegram 文本使用纯文本并按 4096 个 Unicode 字符确定性拆分；入站与出站单文件上限 20 MiB，本地文件只能来自 `TELEGRAM_ALLOWED_FILE_ROOTS`。`429` 只按 `retry_after` 有界重试一次，网络结果不确定的发送不重放；每个出站操作生成不含敏感数据的本地操作 ID，错误区分 API、网络、冲突、权限和配置，日志不记录 Token、完整消息或含 Token 的文件 URL。
- Telegram 固定传输 Fixture 已覆盖双 Bot 配置/租约、Token/Update/Chat/Topic 隔离、`getMe`、Webhook 冲突、`409`、长轮询、群聊过滤、排重、Unicode 拆分、附件、媒体目录/上限、`429`、权限越界、Token 脱敏、Host EOF、standalone 分发与自动发现，并统一并入 `bun run verify`。生产来源为 `telegram@local`，开发显式加载为 `telegram@inline`；后续升级只允许人工冻结版本、审计差异并更新 Fixture。
- Telegram Bot 可选 `TELEGRAM_PROXY_URL` 使用 Bun 原生 HTTP/HTTPS 代理传输，统一覆盖 doctor、Bot API、长轮询、回复、typing、上传、`getFile` 和文件下载；Telegram User 可选 `TELEGRAM_USER_PROXY_URL` 使用 GramJS 原生 SOCKS5，覆盖登录、Session 恢复、DC 迁移、对话列表与历史读取。两者只从 Host 进程环境或用户级 `settings.json.env` 读取，失败不回退直连，凭据与查询参数统一脱敏。Bot SOCKS5 与 User HTTP/HTTPS 在当前 standalone 中显式拒绝；本地 HTTP/SOCKS5 Fixture、认证、拒绝、取消、失败不回退、双账号绑定和 standalone 能力检查已进入 `bun run verify`。
- Telegram User 是独立的按需历史读取插件，固定使用 GramJS `2.26.22`（commit `3aedb2e6ef216d307607f3d0f3f5b0ace6701378`，生成 MTProto Layer 198），仅使用 TypeScript/Bun 并可编译为 Windows standalone，不引入 Python、Telethon、TDLib 或额外运行时。它只注册 `telegram-user-control` MCP，提供 `list_chats`、`set_chat_access` 和 `get_chat_history`；Session、账号和 allowlist 逐别名隔离，模型通过 Session HMAC 生成的不透明 `chatRef` 访问目标，最多读取 100 条且不下载附件。
- Telegram User 不注册 Channel MCP，不监听或转换实时 Update，不向模型自动注入新消息，也不提供回复、主动发送、媒体下载或权限回传。未来若确有需要，可另行设计基于历史拉取的近实时模拟；当前没有后台轮询或补偿逻辑，该方向不列为待开发任务。
- Telegram Bot 与 Telegram User 已通过真实低权限账号和本地代理验收：Bot 的鉴权与长轮询走 HTTP CONNECT，User 的鉴权、StringSession 恢复、对话列表、allowlist 与历史读取走 SOCKS5；失败不回退直连，诊断与日志不暴露 Token、API Hash、手机号、Session、代理凭据或消息正文。固定代理 Fixture、插件边界、独立 Host、standalone 分发和统一 CI 验证继续防止回归。
- X 能力位于可独立删除的 `plugins/x`，只使用固定 `X_BEARER_TOKEN` 执行 App-only 公开数据读取；生产 API 根固定为 `https://api.x.com`。插件提供 `x_get_post`、`x_get_thread`、`x_get_user`、`x_get_user_posts`、`x_search_recent` 和 `x_get_mentions`，最多 100 条/页、2 页、512 KiB、15 秒和 2 并发，不自动重试，不提供 OAuth、用户身份写操作、Channel、Stream、Webhook 或后台轮询。
- X 可选 `X_PROXY_URL` 只支持 HTTP/HTTPS CONNECT，配置后所有请求和分页均经代理且失败不回退直连；SOCKS5 明确拒绝。错误区分鉴权、套餐、限流、服务端、DNS、TCP/代理、TLS 和超时，输出与日志不得包含 Token、Authorization、完整查询或响应正文。官方 XDK `0.6.6` 仅作为审计基线，因其私有传输不能安全注入插件代理，生产 Host 使用插件内固定 GET-only 传输且不打包 XDK。
- X 的真实服务验收标准固定为“一个低权限真实 App + 套餐拒绝 Fixture”：真实 App 必须覆盖六个只读工具、分页、Rate Limit、HTTP CONNECT 代理和代理失败不回退；`403`/套餐拒绝及多 App/Token 隔离由确定性 Fixture 覆盖，不要求为验收额外申请账号或降低真实账号套餐。standalone、自动发现、Host EOF、秘密脱敏和 XDK 禁入继续纳入统一验证。
- 本地 Plugin Manifest 使用可选 `apiVersion` SemVer 范围协商声明式扩展 API；当前版本为 `1.0.0`，缺省按旧 v1 契约兼容。显式不兼容时整插件及其组件不可达，依赖降级继续按固定点传播；MCP 与 ACP 保持各自协议协商。
- `/cd` 有意保持为本项目的临时 cwd 命令，不对齐官方的跨项目会话迁移：它只改变主会话后续工具使用的当前目录，不改变启动项目根、Session ID、Transcript/Resume 归属、权限根、Settings、CLAUDE.md、Hook、Skill、Plugin、MCP、Memory、Plan 或 Checkpoint 作用域。
- `/cd` 不改变已运行子 Agent 的 cwd；新建 Agent 从稳定的会话/工作树根启动，不继承主会话的临时 `/cd`，子 Agent 的 cwd 变化也不得回写主会话。`/clear` 和进程重启恢复到启动项目目录；无参数只报告当前 cwd，失败不得改变现有 cwd。
- 主程序本身不实现、不自动启用 Chrome 操作；`--chrome`/`--no-chrome`、`/chrome`、Chrome Settings/Onboarding/通知、隐藏 MCP/Native Host 进程入口、内置 Chrome Skill、MCP 保留名称和专用客户端渲染均已从主干入口移除。
- Chrome 能力只能由本地 `chrome` 插件提供：生产 standalone 从同级 `plugins` 一级目录自动发现，源码开发使用 `--plugin-dir` 显式加载；目标链路固定为主程序标准插件加载器 → 插件 MCP/Skill → 插件 Native Host → 插件 Chrome 扩展 → Chrome，主干禁止绕过插件直接连接。
- `plugins/chrome/chrome-extension` 已包含 Manifest V3 Chrome 扩展实现，固定扩展 ID 为 `dlpofjonbnceelbmpelkfblmnghclmkm`；标签页、导航、页面读取与交互、截图和窗口缩放等浏览器端能力已经实现。
- Chrome 工具与桥接协议的权威定义位于 `plugins/chrome/protocol`。MCP 只允许广告扩展已实现的 11 个工具，`computer.zoom`、GIF、图片上传、Console/Network 和快捷方式不进入可用工具集合；协议固定 1 MiB 消息上限、30 秒工具超时和必填 `request_id`，Native Host 必须按请求归属精确回传，不得向其他 MCP 客户端广播工具结果。
- Windows、Linux 和 macOS 的插件 Host 统一使用仅绑定 `127.0.0.1` 的动态 TCP socket，不使用 Windows 命名管道或 Unix Domain Socket。每个 Chrome 扩展实例启动独立 Host 并发布带进程号的端点记录，MCP 自动发现多个在线实例；请求必须携带端点随机令牌，日志禁止输出令牌，Host 退出或发现失效进程时清理端点记录。
- 每个 Chrome 个人资料通过扩展自己的 `chrome.storage.local` 保存永久 `profileId` 和用户别名 `profileName`，不猜测 Chrome 内部 Profile 名称。`tabs_context_mcp` 汇总在线 Profile 并为标签页附加 Profile 身份；多 Profile 下的工具调用必须显式路由，缺少目标、断线、重复 Profile ID 或跨 Profile Tab ID 冲突均 fail-closed，禁止自动选择或回退到其他账户。
- `plugins/chrome/host` 已提供与主程序解耦的 MCP/Native Messaging Host 入口、路径、注册、卸载和 doctor，实现不依赖主程序 Settings、模型调用、Anthropic 账号或内部 `USER_TYPE` 分支。Windows 可构建独立 `chrome-host.exe`；默认无参数运行 Native Host，`mcp` 运行 stdio MCP，`register`/`unregister`/`doctor` 由用户显式执行。
- MCP 引擎、TCP Socket 生命周期、多实例端点池和工具声明已经迁入 `plugins/chrome/mcp`；旧 `packages/@ant/claude-for-chrome-mcp` workspace 包和 `src/utils/claudeInChrome` 主程序兼容层已经删除，并由防回归验证阻止恢复。
- 插件 Manifest 已通过标准本地 stdio MCP 声明启动 Host，`skills/claude-in-chrome/SKILL.md` 只随插件加载；插件未加载时，主程序的系统提示、Skill 和工具列表均不宣传 Chrome 能力。
- `bun run build:chrome-host`、`bun run build:weixin-host`、`bun run build:wxwork-host`、`bun run build:qq-host` 与 `bun run build:telegram-host` 分别生成完整插件分发目录；`bun run build:production` 同时生成 `dist/claude.exe` 及五个 `dist/plugins/*` 插件目录，整个 `dist` 可作为固定路径的 Windows 生产分发单元。分发 Manifest 直接启动包含 Bun Runtime 的独立 Host，目标机器无需 Bun 或 Node.js。
- 标准 Plugin Manifest、MCP 环境展开、名称作用域、Skill 发现、自动目录约束、三层优先级、`--bare`、重载裁剪、standalone 插件移除、独立 Host EOF、分发目录生命周期和真实 Chrome 端到端矩阵均已验收。扩展固定声明 `<all_urls>`，不提供页面授权或本地站点白名单；所有 HTTP/HTTPS 页面均可操作，Chrome 内部页、扩展页、文件页和无效 Tab 继续拒绝。真实矩阵覆盖固定扩展 ID、Native Host 注册/doctor/自动重连、拒绝路径、页面刷新和错误恢复。
- 真实 Chrome 工具矩阵覆盖 11 个广告工具的连接与核心行为，包括标签页枚举/创建、导航及前进后退、页面读取、查找、表单输入、JavaScript、点击/滚动/键盘、截图、窗口缩放、Unicode URL、Chrome 内部页拒绝、非法/已失效 Tab ID 和 1 MiB 超限结果。超限结果必须返回结构化错误并保持桥接连接；点击必须保留浏览器聚焦语义。
- `chrome` 插件同时提供独立的只读 `chrome-dom` MCP，由 `chrome-host dom-mcp` 启动并复用现有 Socket、鉴权、Profile 和 Tab 路由；它只公开 `dom_inspect`、`dom_extract_table`、`dom_extract_list` 和 `dom_wait`，所有调用必须显式指定 Profile 与 Tab，不嵌套调用原有浏览器 MCP，也不改变原有 11 个工具。
- DOM Snapshot 只返回清洗后的结构、文本、限定属性、HTTP(S) 链接、Bounds、表格与列表关系，不返回原始 HTML、表单值、脚本、浏览器存储或敏感 URL 参数。节点、桥接消息和 MCP 输出分别受 5,000 节点、1 MiB 和 512 KiB 上限约束；超限、Closed Shadow、跨源 Iframe 和纯视觉内容均以结构化错误或 `partialReasons` 明确报告。
- DOM 分页 Cursor 使用 HMAC 绑定 Profile、Tab、文档和清洗内容哈希，页面变化后 fail-closed；Open Shadow Root 与同源 Iframe 可进入快照，虚拟列表必须经外部浏览器控制显式滚动后重新读取。DOM 与截图/多模态结果保留独立来源，禁止静默合并，也不得由 DOM 工具执行点击、输入、导航或交易。
- Chrome DOM 已由固定 Fixture 和真实本地 Chrome 端到端矩阵验收，覆盖跨行跨列表格、无表头、嵌套列表、Unicode、SPA 稳定等待、虚拟列表分页、Shadow DOM、Iframe、敏感字段、过期 Cursor、节点/字节超限、指定 Profile/Tab、内容变化、连接重建和插件缺失边界。扩展更新或重载后必须刷新已经打开的目标页面，使新版 Content Script 进入页面；仅重载扩展可能导致旧页面的 DOM Bridge 请求超时。

### 工程与验证

- 根包与 workspace 均遵循最小脚本约定：`typecheck`、`build`、`test` 或明确的 `test:smoke`；不适用的子包须写明原因。
- 支持 Bun bundle 与 Bun standalone EXE/Host 两类构建链；根包发布入口统一要求 Bun，standalone 目标机器不要求安装 JavaScript 运行时。
- Windows standalone 构建统一处理 Bun Runtime 临时文件的瞬时 `EBUSY`/提交占用：只对明确的临时文件错误最多重试 3 次，按 250/500/1000 ms 退避并清理当前未完成产物；依赖、类型和 Bundle 等确定性错误立即失败。
- `bun run verify` 是唯一验证入口：依赖锁定、TypeScript、Biome、构建、CLI 启动、源码轻量验证与本地模型可用时的单轮模型/工具调用均在其中执行。
- 模型请求诊断日志必须脱敏，禁止记录 API Key、OAuth Token 和完整敏感 Prompt。

### 性能与稳定性

- `CLAUDE_CODE_PERF_DIAGNOSTICS=1` 可启用版本化脱敏性能采样，覆盖内存、CPU、事件循环、Handle/Request、模型流、Usage/缓存、Agent/MCP/后台任务和 Ink/Yoga 指标；默认关闭，不记录 Prompt、工具结果、图片、路径、模型、Endpoint、Session ID 或密钥。
- 交互式文本流首 Delta 立即显示，后续 Ink 状态刷新以 33 ms 窗口合并；Tool Use/JSON 边界、终态、错误、取消和断流同步排空。`stream-json`、SDK、ACP 和 headless 仍逐事件传递，不受 UI 背压影响。
- Compact、`/clear`、`/rewind`、Resume/Fork 和组件卸载具有幂等资源清理；Compact 回调可注销并计数，Tool Result 替换状态不会跨错误会话保留，避免渲染导致长期回调增长。
- FileWrite/FileEdit 使用异步同目录临时文件、flush、版本复核和原子替换。Windows 仅对 `EBUSY`/`EPERM`/`EACCES` 共享冲突按 25/50/100/200/400 ms 加抖动重试；外部内容变化立即要求重新 Read，现有文件不会静默降级为非原子覆盖，正文最多提交一次。
- 可重建的远端 MCP 等后台基础设施使用统一 Supervisor：250 ms 起步、全抖动指数退避、10 s 封顶、连续失败 5 次熔断，并以 Generation 和 Abort 隔离迟到结果。禁用、登出、配置变化、手动重连和退出会停止恢复；Agent、Workflow、后台 Shell 及可能已有副作用的 MCP Tool 不自动重放。
- 稳定性阈值以版本化常量固化：默认压力矩阵为 5 个窗口、每窗口 1,000 个流 Delta，UI flush 比上限 0.1、Heap 增长容差 64 MiB、活动 Handle 漂移容差 2、后台重启上限 5、Windows 文件提交尝试上限 6、退避总量上限 775 ms。阈值调整必须说明原因，不能用放宽门槛掩盖回归。
- `bun run verify` 中的确定性矩阵同时覆盖模型流、模型 Profile、MCP、Agent 生命周期/权限/资源、会话 Clear/Resume/Rewind、Windows 真实持锁和后台恢复；核心 Fixture 不允许跳过，本地模型可用时再执行真实模型与工具调用。

## 明确不做

- Anthropic 官方账号、网络 Provider、原生安装器和任何 CLI 自更新能力。
- 除独立本地 `openai-proxy` 插件明确限定的 ChatGPT/Codex 订阅登录与模型转发外，不增加其他云模型供应商专用适配、自动能力探测或隐式请求字段降级。
- 官方 MCP Registry 预取、远端插件市场、远端插件下载和插件自动更新。
- Anthropic 云端浏览器桥接、已移除的 `mcp-chrome`、Artifact 工具和 VS Code 插件路线。
- 不实现 macOS `sandbox.allowAppleEvents`。Apple Events 继续按 Seatbelt 默认规则阻止，避免沙盒命令通过 `open` 或 `osascript` 启动不受文件系统和网络隔离约束的外部应用；确有需要时由用户使用精确的 `sandbox.excludedCommands`，并继续经过既有命令权限分类和审批。
- 官方大型测试体系；项目只维护独立的 `scripts/validation` 轻量验证脚本。
- 企业微信 `wxwork` 只实现 API 模式智能机器人的 Bot WebSocket 长连接；不实现 Bot Webhook、Agent/自建应用 XML 回调、公网回调服务、Bot→Agent 回退或多连接模式切换，后续官方同步也不得扩大这一边界。
- X 插件不实现 OAuth 1.0a、OAuth 2.0 Authorization Code with PKCE 或任何用户身份授权，只允许固定 `X_BEARER_TOKEN` 的 App-only 公开数据只读访问；因此不提供 Home Timeline、发布、回复、删除、点赞、转发、关注、取消关注、私信、账号修改及其他用户身份读写操作，后续官方 SDK 同步也不得隐式扩大该边界。

## 后续开发计划

### P0：移除 Node.js 运行时要求

目标是让干净环境只安装 Bun 即可完成依赖安装、开发、类型检查、Lint、构建、统一验证、发布和所有已保留能力的运行；生产 standalone 继续不要求目标机器安装 Bun 或 Node.js。本任务不改写模型、会话、工具、权限、Plugin、Channel、ACP 或 Workflow 协议，也不把 Bun 已兼容的 `node:` 标准库导入、`NodeJS.*` 类型或包名中的 `node` 误判为外部 Node.js 可执行文件依赖。

- [x] 第一阶段已建立 Node 运行时依赖清单和防回归边界。`docs/architecture/NODE_RUNTIME_BOUNDARY.md` 逐项登记根脚本、workspace、CI、Shebang、`engines`、文档工具、发布入口及子进程中的 `node`/`node.exe`/`npx` 调用，并区分外部运行时、Node 分发契约、Bun 兼容 API、类型/名称和用户工具内容；`scripts/validation/node-runtime-boundary.ts` 使用精确允许集合阻止新增依赖，并已并入唯一的 `bun run verify`。
- [x] 第二阶段已把安装与根命令切换为 Bun。根 `postinstall` 和脚本 Shebang 统一使用 Bun，继续保留 ripgrep 下载、代理、压缩包处理、原子提交和多平台行为；根脚本不再直接调用 `node` 或 `npx`。文档预览改为 `bunx --bun mintlify dev`，真实 CLI 启动检查已通过，且 Mintlify 不进入项目依赖或生产产物；Node 运行时允许集合已同步收缩。
- [x] 第三阶段已收敛发行与构建链。删除 `dist/cli-node.js`、Node Shebang、根 Vite/Rollup Node Bundle、专用后处理插件、重复完整性检查和直接 Node 启动冒烟；所有根 `bin` 与 `prepublishOnly` 统一使用并校验 Bun bundle，包管理器固定声明为 Bun。根 `vite`/`rollup` 直接依赖已删除；`remote-control-server` 自有的浏览器前端 Vite 仍由该 workspace 独立声明并通过 Bun 调用，不属于 Node CLI 分发链。项目继续支持兼容 npm registry 的 Bun 包分发及 Bun standalone EXE/Host。
- [x] 第四阶段已保留并 Bun 化 `@claude-code/workflow-engine`。包契约由 `engines.node` 改为 `engines.bun` 并固定 Bun 包管理器，构建、发布和执行继续由 Bun 驱动；Workflow Tool、脚本格式、权限、Agent Adapter、Journal、恢复与进度事件语义未改。独立 Fixture 以固定脚本和端口适配器分别执行源码、TypeScript 编译产物与 Bun standalone，核对 Agent 路由、进度序列、基于 `node:crypto` 的 Journal Key、`node:fs`/`node:path` 持久化以及恢复不重放 Agent，三种结果必须完全一致。
- [x] 第五阶段已把独立 `acp-link` 迁移到 Bun 原生服务。Proxy 和 Manager 使用 `Bun.serve`，WebSocket 使用 Bun 原生升级、帧回调、Payload 上限与 Ping/Pong，ACP Agent 改由 `Bun.spawn` 和 Bun stdin/stdout Stream 桥接；删除 `@hono/node-server`、`@hono/node-ws`、`ws` 类型、Node Server 事件接口、Node Shebang 和 `engines.node`，保留 Hono 的运行时无关路由层。独立 Fixture 已实际覆盖 `/health`、404、Token 拒绝、认证子协议、Legacy Ping、JSON-RPC 错误、Payload 超限、ACP 初始化/会话/Prompt/权限回传、断线清理、Manager 页面与实例列表及临时证书 HTTPS；RCS Relay 和 Manager 多实例进程管理继续沿用原协议与 `Bun.spawn`。主程序 `claude --acp` stdio Agent 未改。
- [ ] 第六阶段：清理 workspace 和依赖元数据。逐个移除 `engines.node`、Node Shebang、Node 专用启动脚本与已无消费者的 `@hono/node-*` 等依赖；`@types/node`、`node:` 导入以及名称中含 `node` 的 AWS/Smithy 包只有在 Bun 类型或运行兼容确实需要时才可保留，并由 Bundle/standalone 验证证明不调用外部 Node 可执行文件。
- [ ] 第七阶段：改造 CI 和统一验证。删除 `actions/setup-node`，让 Linux、Windows CI 只安装固定版本 Bun；`bun run verify -- --ci` 必须继续覆盖冻结锁文件、全部 workspace、TypeScript、Biome、Bun bundle、主 EXE、所有独立 Host、CLI `--version`/`--help`、Plugin 生命周期、ACP 和 Workflow Fixture。增加隔离 PATH 验证，发现 `node`、`node.exe`、`npm` 或 `npx` 仍可被项目必需流程调用时直接失败。
- [ ] 第八阶段：执行真实验收并更新基线。在未安装 Node 或从 PATH 明确移除 Node 的干净 Windows 与 Linux 环境完成 `bun install --frozen-lockfile`、`bun run dev`、`bun run typecheck`、`bun run lint`、`bun run build`、`bun run build:production`、`bun run verify -- --ci`，再验证单轮本地模型请求、工具调用、Workflow、`claude --acp`、`acp-link` WebSocket/RCS 和全部 Plugin Host。通过后将“两类 Bun 构建链、仅 Bun 开发依赖、standalone 零运行时依赖”并入工程基线并删除本 P0。

完成条件：开发机只安装 Bun 即可完成项目声明的全部任务，CI 和发布流程不安装或调用 Node.js/npm/npx；`claude.exe` 与所有独立 Host 仍为零外部 JavaScript 运行时依赖；Workflow 和 ACP/RCS 行为、协议、安全边界与迁移前一致；仓库不存在需要外部 `node`/`node.exe` 的脚本、入口或 workspace，同时不会为追求字面上的“无 node”而重复实现 Bun 已兼容的标准库 API。

### P1：移除休眠的 Computer Use 实现

当前 Computer Use 只由内部 `CHICAGO_MCP` Feature 控制，默认开发、CI 和生产构建均不启用，也没有进入已验收产品能力。其源码约 63 个文件、1.75 万行，Windows 截图仍依赖未进入 standalone 分发的 `bridge.py` 以及外部 Python、mss、Pillow，并缺少固定 Fixture 和真实端到端验收。本任务采用完整删除，不保留残缺的 Windows 后端或隐藏启动方式；它不涉及 Chrome 插件、Chrome DOM、Windows Sandbox、普通 MCP、模型、会话、工具权限、Agent、Workflow 或 Channel。

- [ ] 第一阶段：冻结删除边界并建立回归基准。记录默认构建中 `CHICAGO_MCP` 不可达、普通 MCP 工具发现与调用、Query/Stop Hook 生命周期、权限 UI、Chrome 插件、Windows Sandbox 和 workspace 契约的当前结果；增加防回归检查，确保清理只命中 Computer Use 专属名称、入口和状态。
- [ ] 第二阶段：移除产品与协议入口。删除 `CHICAGO_MCP` Feature 定义、`--computer-use-mcp` 隐藏入口、动态 MCP 注入、`computer-use` 保留 Server 名称、自动允许工具集合、系统提示可用性提示及 Analytics 元数据；普通 stdio/HTTP/SSE MCP 的配置、鉴权、工具包装、错误和生命周期行为不得改变。
- [ ] 第三阶段：清理核心文件中的条件接入。仅删除 `src/query.ts`、`src/query/stopHooks.ts`、`src/services/mcp/client.ts`、`src/services/mcp/config.ts`、`src/cli/modes/defaultMode.tsx` 和 `src/state/AppStateStore.ts` 中受 Computer Use Gate 保护的导入、轮次清理、状态与工具覆盖分支；不得重构相邻的通用 Query、Stop Hook、MCP 或 AppState 逻辑。
- [ ] 第四阶段：删除 Computer Use 专属 UI 与实现。删除 `src/components/permissions/ComputerUseApproval`、`src/utils/computerUse` 全目录，包括 Windows `bridge.py`/Bridge Client、PowerShell/Win32、UI Automation、COM、截图、虚拟光标、窗口消息，以及 macOS/Linux 后端、锁、渲染、权限包装和清理代码；同时删除只为该能力存在的资源、常量和样式引用。
- [ ] 第五阶段：删除三个专属 workspace 和依赖。移除 `packages/@ant/computer-use-input`、`packages/@ant/computer-use-mcp`、`packages/@ant/computer-use-swift` 及根 `package.json` 中对应 workspace 依赖，更新 `bun.lock`、workspace 数量、依赖审计、Feature Policy 和构建完整性规则；不能把通用图片处理、MCP SDK、Windows Sandbox或 Chrome 能力作为连带依赖误删。
- [ ] 第六阶段：更新文档与安全边界。明确本项目不提供操作系统桌面 Computer Use，不宣传桌面截图、全局鼠标键盘、窗口/Office 自动化或隐藏 `computer-use` MCP；同时说明 Chrome 页面操作仍由独立 `chrome` 插件提供，Windows Sandbox 仍只负责隔离 Bash/PowerShell，二者不受影响。
- [ ] 第七阶段：执行完整验收。运行冻结安装、全部 workspace TypeScript/Smoke、Biome、Bun bundle、standalone EXE、所有独立 Host、CLI 启动和 `bun run verify -- --ci`；额外验证源码与产物不存在 `CHICAGO_MCP`、`--computer-use-mcp`、`@ant/computer-use-*`、`bridge.py`、Python Bridge 或 `mcp__computer-use__*`，并实测普通 MCP、Chrome、Windows Sandbox、模型请求、文件工具、Shell 权限、Agent 和 Workflow 未回归。

完成条件：Computer Use 的 Feature、CLI/MCP 入口、UI、状态、平台后端、Python/PowerShell/Win32 实现、三个 workspace、依赖、文档和构建标记全部删除；默认产品行为和已验收能力不变；Chrome 与 Windows Sandbox 的职责边界继续成立；统一验证和适用的真实冒烟全部通过，仓库不保留无法启动或未受验收约束的 Computer Use 残余实现。

## 维护规则

- 官方发布新版本时，先核对 Changelog，再只记录本项目新增或仍存在的差异。
- 已完成任务立即从路线图移入“已固化的项目差异”或“明确不做”，不保留历史任务条目。
- 新任务从当前最高优先级开始编号；本路线图的首个待办固定为 P0。
- 任何新增网络能力、自动更新、远端下载或供应商专用适配，必须先更新本文件中的产品边界并获得明确决策。
