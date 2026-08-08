# 项目基线与开发计划

## 基线

项目当前发行版本为 `2.1.220`，官方功能对照基线固定为 Claude Code `2.1.220`。截至 `2026-08-04`，当前产品范围内的功能、差异边界、安全约束、构建和验证矩阵均已完成验收；可选后续能力不影响当前基线成立。

“功能对齐”仅表示以该官方版本为审计目标，并完成本项目适用范围的实现与验证，不表示源码、二进制或产品集合与官方发行版完全相同。明确裁剪、替代或不开发的能力继续以下文边界为准。上游功能与行为以 [Claude Code 官方文档](https://code.claude.com/docs/en/overview)和[官方 Changelog](https://code.claude.com/docs/en/changelog)为准。升级对照版本前必须先更新差异审计和对应验收矩阵，不能使用滚动的“最新版本”作为未冻结的验收目标。

本文件只维护本项目的已固化差异、明确边界和未开发任务。与官方一致的功能不在此重复列出，也不保留历史实施顺序、日期快照或阶段性验收记录。

## 已固化的项目差异

### OpenAI-compatible 运行时

- 模型来源为 `~/.claude/models.json`，每个模型拥有唯一 ID，可共享 OpenAI-compatible `baseUrl`。
- `/model` 仅从该配置切换模型；配置损坏或模型不可用时直接报错退出，不回退到 Anthropic 登录或交互式配网。
- 不支持 Anthropic 官方网络 Provider、ChatGPT/Codex OAuth、旧国内云模型供应商引导、Anthropic MCP Registry 预取、内部 GitHub Webhook/KAIROS 分支。
- `@anthropic-ai/sdk` 只作为本地消息、工具、流事件和 Usage 类型兼容层，禁止将其类型引用误判为网络 Provider。
- 不兼容 OpenAI Chat Completions 的端点必须清晰失败；禁止删字段重试、隐式 Provider 回退或新增供应商专用协议分支。

### 静态模型 Profile

- 以模型 ID 显式配置上下文窗口、最大输出 Token、推理参数、Prompt Cache 和价格；不进行能力探测或名称猜测。
- 未知模型加载 Qwen 派生默认 Profile，并提示补充专用 Profile。
- `models.json` 的 `profile` 可覆盖默认 Profile；覆盖与模型加载同步生效。
- 已对 OpenAI Chat Completions 的推理参数、工具选择、流事件和 Usage 字段进行边界核对；llama.cpp 的 `tool_choice` 兼容是受限的协议编码，不是 Provider 分支。

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

### 工程与验证

- 根包与 workspace 均遵循最小脚本约定：`typecheck`、`build`、`test` 或明确的 `test:smoke`；不适用的子包须写明原因。
- 支持 Bun bundle、Vite/Rollup Node bundle、Bun standalone EXE 三条构建链，并在 CI 只验证适用产物。
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
- 官方大型测试体系；项目只维护独立的 `scripts/validation` 轻量验证脚本。
- 企业微信 `wxwork` 只实现 API 模式智能机器人的 Bot WebSocket 长连接；不实现 Bot Webhook、Agent/自建应用 XML 回调、公网回调服务、Bot→Agent 回退或多连接模式切换，后续官方同步也不得扩大这一边界。
- X 插件不实现 OAuth 1.0a、OAuth 2.0 Authorization Code with PKCE 或任何用户身份授权，只允许固定 `X_BEARER_TOKEN` 的 App-only 公开数据只读访问；因此不提供 Home Timeline、发布、回复、删除、点赞、转发、关注、取消关注、私信、账号修改及其他用户身份读写操作，后续官方 SDK 同步也不得隐式扩大该边界。

## 可选后续路线图（不影响当前验收）

### P0：openai-proxy ChatGPT/Codex 订阅模型代理

- [x] 第一阶段已新增独立本地插件 `plugins/openai-proxy`，服务进程命名为 `openai-proxy-host`；实现仅使用 TypeScript、Bun 和现有项目构建链，不引入 Rust、Cargo、`.rs` 文件或其他语言运行时。插件已具备本地 MCP 生命周期入口、loopback-only 鉴权网关、`serve/status/doctor`、安全的未就绪响应、独立 Host 构建及边界/网关/分发验证；本阶段不读取 Codex 凭据、不执行 OAuth、不请求 OpenAI。
- [x] 保持现有模型调用主链不变，不新增 Provider 或代理模型类型，不修改 QueryEngine、OpenAI Provider、工具循环、权限、Sandbox、Session 或 UI 的权威职责；`plugins/openai-proxy/README.md` 已记录普通 `models.json` 配置，仅将 `baseUrl` 指向 `http://127.0.0.1:48181/v1`，并通过 `OPENAI_PROXY_LOCAL_TOKEN` 提供本地访问凭据。
- [x] 已提供仅监听 `127.0.0.1` 的 OpenAI 兼容网关，实现 `POST /v1/chat/completions`、`GET /v1/models`、`GET /health` 和 `GET /doctor`；未安装、未运行、未登录或认证失败时明确报错，不回退到其他模型或外部地址。
- [x] 已使用本地 Bearer capability token 限制同机其他进程滥用订阅；Token 不写入 `models.json`、日志、模型上下文或子进程参数，上游错误正文和未知内部错误不透传到本地客户端。
- [x] 第三阶段已将现有 Chat Completions 请求转换为官方 Codex Responses 请求，并把 Responses SSE 适配回现有流事件，覆盖系统/用户/助手消息、图片、reasoning、工具定义/选择/调用/结果、并行工具、输出 Token、Usage、finish reason、401 单次刷新、403/429、超时、取消和断流；不支持的字段明确拒绝，不静默删除。固定 Fixture 已通过现有 OpenAI SDK 与 `adaptOpenAIStreamToAnthropic` 主链验证，插件不接管 Agent 循环或工具执行；真实账号验收仍按完成条件单独执行。
- [x] 第二阶段已用 TypeScript 语义重写官方开源 Codex 的必要登录能力：浏览器 OAuth、device-code、S256 PKCE、严格 state/允许的官方回调后缀、Token 交换/刷新/撤销，以及账号、workspace 和 plan 信息解析；已提供 `setup`、`login`、`login --device-code`、`status`、`doctor`、`logout`、`serve` 和 MCP 生命周期入口。`stop` 随下一阶段单实例守护进程一起实现。本阶段只通过固定 Fixture 验证协议，不使用真实账号或把测试结果冒充真实验收。
- [x] Session 固定保存到 `~/.claude/openai-proxy/auth.json`，已采用同目录原子替换、跨进程有界锁、刷新竞争串行化、符号链接拒绝和最小权限保护；POSIX 使用目录 `0700`/文件 `0600`，Windows 使用当前用户 ACL。实现不读取、导入或覆盖 Codex 自身凭据文件，OAuth Token 不暴露给主项目进程、配置、状态输出或日志。
- [ ] 复用现有本地 Plugin/MCP 生命周期能力管理单实例服务，记录 PID、锁、端点和版本，支持多 CLI 客户端安全共享、租约和空闲退出；服务异常终止后必须可诊断、可重启且不损坏 Session。
- [ ] 支持显式 `OPENAI_PROXY_URL`，配置来源仅限进程环境或用户 `settings.json.env`；沿用现有代理策略实现 HTTP、HTTPS CONNECT 和代理认证，SOCKS5 未实现时明确拒绝。
- [ ] 代理覆盖 OAuth Token 交换、device-code 轮询、刷新/撤销、模型目录、Responses/SSE 及必要的账号/额度请求；localhost 回调、本地网关和系统浏览器自身不经过该代理。
- [ ] 配置代理后采用 fail-closed：代理拒绝、超时、认证失败或 DNS 失败时不得转为直连或本地 DNS；不重放结果不确定的模型请求，日志不得泄露 Authorization、Cookie、Token、验证码或敏感查询参数。
- [ ] 建立严格上游同步边界：在 `plugins/openai-proxy/upstream/` 维护 `BASELINE.json`、`SOURCE_MAP.md` 和 `THIRD_PARTY_NOTICES.md`，固定官方 OpenAI Codex release tag、完整 commit、审计日期、来源文件及哈希，并保留 Apache-2.0 归属说明。
- [ ] 上游同步白名单仅允许登录/OAuth/device-code/PKCE/Token/Session、必要请求头和基础地址、Responses 请求与 SSE、模型/账号/限额，以及 TLS/CA/代理相关语义；禁止同步 Agent 循环、Prompt、Tool、Shell/文件、Sandbox、审批、Thread、MCP、Plugin/Skill、Cloud/Remote、遥测、更新、UI、多 Agent、Memory、Web、Image、Voice 和后台任务实现。
- [ ] 增加 `bun run audit:openai-proxy-upstream -- --tag <version>`：仅把白名单文件下载到临时目录，生成哈希与语义差异报告，不自动改写生产代码；验证脚本必须阻止 `.rs`、Cargo 文件、Rust 工具链声明和白名单外上游代码进入插件。
- [ ] 增加确定性测试：浏览器/device-code 登录、PKCE/state、回调冲突、Session 原子写入、刷新竞争、无效 refresh、logout；请求/流事件转换；取消、超时、断流、401/403/429；代理成功、认证/拒绝/超时和无直连回退；本地端点认证、守护进程多客户端/租约/EOF，以及 Windows 独立发行包运行。
- [ ] 回归验证现有 OpenAI、DeepSeek、llama.cpp、自定义 OpenAI 兼容端点、工具调用、权限与 Sandbox 行为不变；固定测试通过后，再使用低权限 ChatGPT 测试账号单独补录真实登录、模型调用、Token 刷新和退出证据，不以 Fixture 结果替代真实验收。

完成条件：删除 `plugins/openai-proxy` 即可完整移除该能力且主项目模型链无需回滚；插件不引入新语言，登录凭据和订阅 Token 不进入主进程、配置、日志或模型上下文；本地网关、Responses 适配、代理 fail-closed、生命周期、Windows 独立发行和上游审计均有确定性验证，真实低权限账号验收单独留证，且 `bun run verify --ci` 全部通过。

### P1：Chrome DOM 结构化抓取链路

- [x] 第一阶段已在现有 `plugins/chrome` 内新增第二个本地 MCP Server `chrome-dom`，由 `chrome-host dom-mcp` 启动；它与现有 `claude-in-chrome` MCP 并列，直接复用 Socket 端点发现、连接池、Token、Chrome Profile、Tab 路由和 standalone 分发能力，不进行 MCP 嵌套调用，也未改变现有 11 个 Chrome 工具的名称和行为。独立 Server 的生命周期、作用域和 standalone 分发边界已由轻量验证固化。
- [x] 第二阶段已在扩展桥接协议中增加版本化、只读的内部方法 `dom_snapshot`，使用独立的 `bridge_request`/`bridge_response` 信封，并将内部桥接方法注册表与现有 11 个公开工具注册表分开。请求强制校验 `profileId`、`tabId`、作用域 Selector、内容类型、`visibleOnly`、`maxNodes` 和 `maxBytes`；响应固定携带 `profileId`、`tabId`、URL、Title、`documentId`、抓取时间、内容哈希以及明确的 `partial`/`partialReasons`，并由第三阶段的清洗器填充规范化节点内容。
- [x] 第三阶段已让 `dom_snapshot` 返回经过清洗的规范化 DOM Snapshot，不返回整页原始 HTML。结果使用单次 Snapshot 内有效的 `node_*` Ref、`parentId`/`childIds` 和根节点列表保留层级，并包含 Tag、Role、直接可见文本、限定 ARIA、白名单 `data-*`、脱敏 HTTP(S) 链接、可见性、Bounds、表格行列及列表关系。扩展在页面隔离世界中排除 Script、Style、事件处理器、页面全局变量、Cookie、Local/Session Storage、IndexedDB、密码/隐藏/疑似凭据字段、Token、Authorization、URL 凭据和敏感查询参数；不读取表单 Value，也不增加任意 JavaScript 入口。节点或字节超限返回结构化错误，无法读取的嵌套边界和视觉内容通过 `partialReasons` 明确报告。
- [x] 第二至第四阶段已分别固定 5,000 节点、1 MiB 桥接消息和 512 KiB Snapshot/MCP 输出上限；超过上限时返回带错误码及实际/限制字节数的结构化错误，不静默截断。HMAC 分页 Cursor 已绑定 `profileId + tabId + documentId + contentHash + offset`，签名篡改、页面导航、文档重载或内容版本变化后立即失效。
- [x] 第四阶段已在 `plugins/chrome/dom` 抽出可独立验证的 Snapshot Schema/索引、文本清洗、表格解析、列表解析、Selector 约束和 HMAC 分页 Cursor 纯函数。表格解析覆盖多级表头、无表头、`rowspan`/`colspan`、空值、重复列名、列别名、行数上限和 Unicode；金融数字始终保留原始字符串，不转换为浮点数。分页 Cursor 固定绑定 `profileId + tabId + documentId + contentHash + offset`，签名篡改或页面版本变化时安全拒绝。
- [x] 第五阶段已让 `chrome-dom` 只公开四个带只读/非破坏性声明的工具：`dom_inspect` 返回页面结构摘要，`dom_extract_table` 按 Selector、列别名和最大行数返回结构化字符串行，`dom_extract_list` 通过受限的条目及命名字段 Selector 返回结构化列表，`dom_wait` 按 `exists`/`not_exists`/`stable`、静默窗口和最长 25 秒超时等待 SPA 状态。四个工具都强制显式传入 `profileId` 和 `tabId`，禁止自动回退到其他 Profile 或 Tab；Selector 只在扩展隔离世界中转为不含原始 Selector 的短期匹配标记，不读取原始 HTML 或执行页面脚本。
- [x] 第六阶段已为动态页面固化“读取—外部滚动—`dom_wait stable`—重新读取”的显式流程：`dom_extract_list` 使用绑定 Profile、Tab、文档和清洗后内容哈希的 HMAC Cursor 分页，不调用浏览器控制工具，不在内容变化后复用旧 Cursor；Snapshot 返回滚动容器指标并提示虚拟列表需要外部翻页。Open Shadow Root 会保留 `shadow-root` 树作用域，同源 Iframe 会按 Frame 深度并入清洗结果；Closed Shadow 边界和跨源 Iframe 分别标记 `closed_shadow_root_unavailable`、`cross_origin_iframe_unavailable`。Canvas、SVG、图片、视频和纯视觉布局不伪装成 DOM 数据。
- [x] 第七阶段已固化 DOM 与视觉识别的双链路边界：四个 DOM 工具统一返回只读 DOM 来源信息及视觉回退说明，绝不自动截图、滚动、点击、输入、导航、交易或跨 Profile 操作；Canvas、图片和视觉位置继续由现有截图加多模态链路处理。需要交叉核验时使用纯函数分别保留 `domValue`、`visualValue` 和 `consistent`，禁止生成静默合并值；固定 Fixture 同时验证 DOM MCP 不调用浏览器控制工具。
- [ ] 在 `scripts/validation` 增加不依赖测试框架的固定 Fixture，覆盖表格跨行跨列、无表头、嵌套列表、Unicode、SPA 稳定等待、虚拟列表分页、Shadow DOM、Iframe、敏感字段脱敏、节点/字节上限、过期 Cursor、文档变化、多 Profile 路由、畸形消息和 standalone Host EOF；同时验证现有 11 个 Chrome 工具未增加、删除或改变语义。
- [ ] 增加真实 Chrome 本地 Fixture 端到端验收，覆盖扩展连接、指定 Profile/Tab、结构化表格和列表提取、动态内容更新、超限恢复、跨源拒绝及连接重建；插件未加载时不得在主程序中宣传或暴露 `chrome-dom` 工具。

完成条件：`chrome-dom` 作为 `chrome` 插件内独立的只读 MCP Server 随插件加载和移除；不形成 MCP 嵌套调用，不扩大现有浏览器写权限；相同页面和参数产生稳定、可验证的结构化结果，所有截断、跨源、动态版本和敏感内容场景均 fail-closed；现有 Chrome 端到端矩阵与 `bun run verify --ci` 全部通过。

### P2：可选产品能力

- [ ] 支持 macOS 专用、默认关闭的 `sandbox.allowAppleEvents`，并确保该例外不会放宽文件系统、网络或其他平台的边界。

完成条件：可选能力须默认关闭或要求显式授权，且不得扩大文件系统、网络或其他平台的既有安全边界。

## 维护规则

- 官方发布新版本时，先核对 Changelog，再只记录本项目新增或仍存在的差异。
- 已完成任务立即从路线图移入“已固化的项目差异”或“明确不做”，不保留历史任务条目。
- 新任务从当前最高优先级开始编号；本路线图的首个待办固定为 P0。
- 任何新增网络能力、自动更新、远端下载或供应商专用适配，必须先更新本文件中的产品边界并获得明确决策。
