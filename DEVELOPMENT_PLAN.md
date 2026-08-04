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
- 插件优先级固定为显式 `--plugin-dir`（`@inline`）> standalone 自动发现（`@local`）> 内置（`@builtin`）。同级重名禁用歧义项，高优先级插件失败时不回退同名低优先级实现；`--bare` 禁用自动发现但保留显式插件，`/reload-plugins` 会重新扫描并裁剪已移除的全部插件组件。
- 不支持远端市场、自动下载、原生安装、CLI 自更新或插件自动更新；自动发现不会安装 Chrome 扩展、注册 Native Host 或修改注册表。
- 微信能力已从主程序内置 workspace 迁入 `plugins/weixin`：登录、轮询、媒体、二维码、配对、回复和权限转发由独立 `weixin-host` 承担。主程序不保留 `ccb weixin`、`weixin@builtin` 或微信实现依赖；生产使用 `weixin@local`，源码显式加载使用 `weixin@inline`，删除插件目录即可移除全部微信入口。
- 微信插件是腾讯官方 iLink 网络协议的独立实现，不依赖 OpenClaw Runtime；当前冻结兼容基线为 `@tencent-weixin/openclaw-weixin@2.4.6`（`cef0bfc390393f716903e16d50408118047f87e0`），本地 Manifest 与包元数据分别记录本地版本和上游兼容版本。
- 微信 iLink 基线覆盖通用请求头和 `base_info`、二维码完整状态机与 IDC 重定向、动态长轮询、业务返回码、Token 失效暂停、启停通知、游标和 `context_token` 原子持久化、CDN 完整 URL/参数回退、上传重试、引用媒体及确定性媒体优先级；网络错误保持脱敏，HTTP 200 下的业务失败不得伪装为成功。
- 微信账号使用索引和逐账号私有目录；凭据、游标、上下文 Token、允许列表、配对状态、体验配置与 Token 失效暂停互相隔离。Host 并发轮询全部账号，入站 `chat_id` 固定为 `account-id::user-id`；未限定账号且路由不唯一时 fail-closed，旧单账号状态一次性迁移为 `default`。
- 微信引用文本默认开启；远程 HTTP 媒体、脱敏 Channel 诊断和 Host 本地 `/echo` 按账号配置且默认关闭。远程媒体保持 HTTP(S) 协议和 100 MiB 限制，诊断禁止返回 Token 或消息正文。流式 Markdown 与工具进度依赖当前 MCP Channel 不提供的生成中事件，明确不支持，开启对应配置会报错退出。
- 微信协议通过 `scripts/validation/weixin-*.ts` 固定 Fixture 验证并并入 `bun run verify`，不依赖测试框架或真实账号；验证覆盖双账号并发轮询、状态/权限/回复隔离、歧义路由拒绝以及全部体验开关。
- 企业微信能力位于独立 `plugins/wxwork`，只实现“API 模式智能机器人”的 Bot WebSocket 长连接，不实现 Webhook、Agent/自建应用 XML 回调、OpenClaw Runtime、Bot→Agent 回退或自动安装/更新。当前人工同步基线为 `@wecom/wecom-openclaw-cli@1.1.0`、`@wecom/wecom-openclaw-plugin@20206.7.201`（commit `1a91ef7300de7274de8d74e4a566cf3b6e569a25`）和 `@wecom/aibot-node-sdk@1.0.7`（commit `80615b987ef69c6028ad764924609247c0725955`）；这些包只用于审计，没有安装、导入或打入产物。
- `wxwork-host` 支持多个 Bot 别名和独立 Secret 环境变量，逐 Bot 保存私有配对、权限、排重与连接状态；进程级租约禁止同一 Bot 被两个 Host 同时连接。订阅认证、`req_id` 关联、心跳、踢下线、带抖动重连和连接代次隔离由独立 Host 处理，一个 Bot 故障不终止其他 Bot。
- 企业微信入站路由固定为 `bot-alias::single::userid` 或 `bot-alias::group::chatid`，覆盖文本、图片、图文混排、语音识别文本、视频和文件；仅允许绑定未过期入站请求的最终 Markdown 与媒体被动回复。媒体按官方 AES-256-CBC、512 KiB 分片及图片 10 MiB、语音 2 MiB、视频 10 MiB、文件 20 MiB 边界处理；主动发送、欢迎语、卡片和伪流式输出不提供。
- 企业微信访问默认使用配对，审批状态按 Bot、会话、发送者和 Request ID 隔离，群内其他成员不得代为批准。生产来源为 `wxwork@local`，开发显式加载为 `wxwork@inline`；固定 Fixture 覆盖协议、双 Bot/单 Bot 租约、重连/踢下线、路由、媒体、权限、依赖禁入和 standalone 分发，并统一并入 `bun run verify`。
- QQ 能力位于独立 `plugins/qq`，只实现 QQ 开放平台 Bot API v2 的 AppID/AppSecret 鉴权、WebSocket Gateway 入站和 REST 被动回复，支持 C2C 私聊与明确 `@` 机器人的群聊；不实现 Webhook、个人 QQ 登录、Guild、主动发送、Cron、OpenClaw Runtime、远程安装或自动更新。当前人工同步基线为 `@tencent-connect/openclaw-qqbot@2.0.0`（commit `47142c997bdbc9e72d92b817ff378941b3be7d4c`）、`@tencent-connect/qqbot-connector@1.2.0` 与 `@tencent-connect/qqbot-nodejs@1.0.4`（gitHead `589597a6cb5a24dce8230ba53bfba5390e13c073`）；这些包只用于审计，没有安装、导入或打入产物。
- `qq-host` 支持多个唯一 Bot 别名和 AppID，Secret 只从配置指定的环境变量读取；Access Token、Gateway Session/Seq、心跳、排重、配对、允许列表、权限和连接租约逐 Bot 隔离。Gateway 覆盖 HELLO、Identify、Heartbeat/ACK、Resume、失效会话重建、带抖动退避与连接代次隔离；单个 Bot 故障不会停止其他 Bot。
- QQ 入站路由固定为 `bot-alias::c2c::user-openid` 或 `bot-alias::group::group-openid`，OpenID 只作为 Bot 作用域内不透明标识；文本与媒体被动回复绑定 15 分钟内的原消息 ID，并使用确定性 `msg_seq`。远端媒体仅允许 QQ HTTPS 域名，本地文件必须位于 `QQ_ALLOWED_FILE_ROOTS`，单次上限 20 MiB；权限按 Bot、会话和发送者隔离，日志不得记录 Secret、Token、完整消息或媒体地址。
- QQ 固定 Fixture 已覆盖官方依赖禁入、双 Bot 配置与租约、Token/API、HELLO/心跳/ACK、Resume/重建、代次隔离、路由、群聊 `@`、排重、权限、媒体/SSRF、Secret 脱敏、Host EOF、standalone 分发和自动发现，并统一并入 `bun run verify`。生产来源为 `qq@local`，开发显式加载为 `qq@inline`；后续上游同步只允许人工冻结版本、审计差异并更新 Fixture。
- Telegram Bot 能力位于独立 `plugins/telegram`，使用 Telegram Bot API 10.2 与精确固定的 `grammy@1.45.1`（commit `f9f7578d82ef127507aeb6902de8537b02ac994e`）；grammY 及其依赖只进入插件和独立 Host，不进入根 CLI 或其他 Bundle。插件只使用 `getUpdates` 长轮询，不建立 Webhook，不引入 runner、session、auto-retry 或第二套数据库状态。
- `telegram-host` 支持多个唯一 Bot 别名和 Token，配置只保存 Token 环境变量名；Token、Update 排重、Chat/Topic、附件、配对、权限和连接租约逐 Bot 隔离。`bot doctor` 使用 `getMe` 与 `getWebhookInfo` 检查鉴权及互斥配置；grammY `bot.start()` 内部的 `deleteWebhook` 调用只在本地确认而不发送到网络，既有 Webhook、外部长轮询和 `409` 冲突均明确失败，不抢占外部 Bot。
- Telegram 路由固定为 `bot-alias::private::chat-id`、`bot-alias::group::chat-id` 或带 `::topic::thread-id` 的群组 Topic；群聊只接收明确 `@` Bot、回复 Bot 或带 Bot 用户名的命令。首版覆盖文本、图片、文档、音频、语音和视频，保留引用与附件元数据；`reply` 和 `send_typing` 必须绑定 15 分钟内的入站上下文，不提供主动发送。
- Telegram 文本使用纯文本并按 4096 个 Unicode 字符确定性拆分；入站与出站单文件上限 20 MiB，本地文件只能来自 `TELEGRAM_ALLOWED_FILE_ROOTS`。`429` 只按 `retry_after` 有界重试一次，网络结果不确定的发送不重放；每个出站操作生成不含敏感数据的本地操作 ID，错误区分 API、网络、冲突、权限和配置，日志不记录 Token、完整消息或含 Token 的文件 URL。
- Telegram 固定传输 Fixture 已覆盖双 Bot 配置/租约、Token/Update/Chat/Topic 隔离、`getMe`、Webhook 冲突、`409`、长轮询、群聊过滤、排重、Unicode 拆分、附件、媒体目录/上限、`429`、权限越界、Token 脱敏、Host EOF、standalone 分发与自动发现，并统一并入 `bun run verify`。生产来源为 `telegram@local`，开发显式加载为 `telegram@inline`；后续升级只允许人工冻结版本、审计差异并更新 Fixture。
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
- ChatGPT/Codex OAuth、云模型供应商专用适配、自动能力探测与隐式请求字段降级。
- 官方 MCP Registry 预取、远端插件市场、远端插件下载和插件自动更新。
- Anthropic 云端浏览器桥接、已移除的 `mcp-chrome`、Artifact 工具和 VS Code 插件路线。
- 官方大型测试体系；项目只维护独立的 `scripts/validation` 轻量验证脚本。
- 企业微信 `wxwork` 只实现 API 模式智能机器人的 Bot WebSocket 长连接；不实现 Bot Webhook、Agent/自建应用 XML 回调、公网回调服务、Bot→Agent 回退或多连接模式切换，后续官方同步也不得扩大这一边界。

## 可选后续路线图（不影响当前验收）

### P0：Telegram 用户账号 Channel 插件

- [x] 新增独立的 `telegram-user` 插件，使用 TypeScript 的 GramJS（npm 包 `telegram`）连接 Telegram MTProto，不使用 grammY Bot API，也不与 `telegram` Bot 插件共享代码路径、配置、凭据、Session、路由或权限状态。GramJS 是插件内正式运行时依赖，只能进入 `plugins/telegram-user` 和独立 Host，不得进入根包、主 CLI、其他插件或非 Telegram User 生产 Bundle。
- [ ] 已冻结 GramJS `2.26.22`、commit `3aedb2e6ef216d307607f3d0f3f5b0ace6701378`、生成 MTProto Layer 198、Telegram API/Auth 文档和 `2026-08-04` 审计日期；Bun 直接加载和 Windows `bun build --compile` standalone 已通过。仍需使用低权限真实账号完成 `api_id`/`api_hash`、手机号验证码、2FA、StringSession 重启恢复、私聊/群组/频道/Topic、消息与媒体收发及断线重连验收。
- [x] 在 `plugins/telegram-user` 建立标准 `telegram-user` Plugin Manifest、独立 TypeScript/Bun workspace、stdio MCP Server、`telegram-user-host` 和 standalone 分发目录。源码通过显式 `--plugin-dir plugins/telegram-user` 加载，生产通过 standalone 同级一级目录自动发现；删除插件目录即可完整移除普通 Telegram 用户账号能力。
- [x] GramJS 已可直接打入当前 Windows Bun standalone；没有引入 Python、额外 Node Runtime、Telethon、TDLib 或 C++ 动态库，技术后备分支未触发。
- [x] 登录使用应用级 `api_id`/`api_hash`、账号级手机号、一次性验证码和可选 2FA 密码；配置只保存秘密环境变量名，验证码与 2FA 仅从当前私有交互读取且不落盘。已提供 `telegram-user-host account add|login|logout|remove|list|doctor` 和 `mcp` 生命周期。
- [x] 支持唯一别名的多个 Telegram 用户账号；每个账号独立保存私有 MTProto Session、连接租约、Update 排重、允许列表和体验状态。Session 原子写入逐账号私有目录，诊断对 Session、API Hash、手机号和认证错误脱敏；单账号启动失败不终止其他账号。
- [x] 产品范围只包含显式 allowlist 的私聊、群组和频道入站，以及文本和受支持媒体的定向回复；未授权 Update 在本地立即丢弃。没有批量群发、联系人导入、自动加群、陌生人主动私聊、账号资料修改、删除消息、群/频道管理、通话、Secret Chat、账号注册或风控规避入口。
- [x] MTProto Update 转换为标准 Channel 通知，路由固定编码账号别名、Peer 类型、Peer ID 和可选 Topic ID，并保留消息 ID、发送者、引用、编辑状态和附件元数据。本账号出站、插件回复和重复 Update 均被过滤；回复使用原入站账号作用域内的 InputPeer，不解析或复用其他账号的 access hash。
- [x] MCP 首版只提供绑定 15 分钟内原入站消息的 `reply` 与受限媒体回复，不提供主动发送。权限按账号、Peer、Topic、发送者和 Request ID 隔离，审批文本明确标注“将以你的 Telegram 用户身份执行”。
- [x] 网络连接与自动重连次数有界，GramJS 隐式请求重试和 FloodWait 自动等待关闭；FloodWait、DC 迁移、Session、验证码和 2FA 错误统一分类并脱敏。发送操作不自动重放，禁止无限重连和规避平台限制。
- [x] `scripts/validation/telegram-user-*.ts` 已覆盖 GramJS/Bun 边界、可注入登录状态机、Session 安全、双账号隔离、路由/Topic、回声/Update 排重、媒体、权限、FloodWait/DC 分类、秘密脱敏、Host EOF、standalone 分发/自动发现和根 Bundle 依赖禁入，并统一并入 `bun run verify`；真实账号仍作为下一项附加验收。
- [x] 后续升级固定为人工同步：先冻结 Telegram MTProto Layer、GramJS 版本/commit 和文档基线，再审计协议、生成类型、Session、依赖、Bundle 与产品风险并更新 Fixture；禁止自动下载、覆盖插件、更新 Session 或触发 CLI 自更新。

完成条件：GramJS 在当前支持平台的 Bun 开发运行和 standalone 产物均通过真实验证；至少两个 Telegram 用户账号可以同时连接，且不会串 Session、Peer、Update、附件、权限或秘密；插件默认只处理 allowlist 会话、不会处理自身回声，也不会提供批量或账号管理型高风险操作；`typecheck:telegram-user-host`、`build:telegram-user-host`、依赖边界、分发验证和 `bun run verify -- --ci` 全部通过。随后使用专门的低权限测试账号验收登录、重启恢复、私聊、群组、频道、Topic、断线恢复及媒体收发，禁止直接使用重要主账号作为首次验收对象。

### P1：X 只读 MCP 工具插件

- [ ] 新增独立的 `x` 插件，首版使用 X 官方 TypeScript XDK（`@xdevplatform/xdk`）调用 X API，不引入 Python、Tweepy 或社区 Twitter SDK。官方 XDK 是插件内正式运行时依赖，只能进入 `plugins/x` 和独立 Host，不得进入根包、主 CLI、其他插件或非 X 生产 Bundle；删除插件目录即可完整移除 X 能力。
- [ ] 实施前冻结 X API、官方 TypeScript XDK、官方鉴权文档及计费/限流说明的精确版本、仓库 commit 和审计日期，并先验证 Bun 直接运行、App-only Bearer Token、查询与分页、`429`/Rate Limit Header、AbortSignal，以及当前支持平台的 `bun build --compile` standalone。若官方 XDK 无法稳定运行或打包，再单独决策插件内直接 `fetch` 官方 API；不得自动引入 Python/Tweepy、Node Runtime 或社区 SDK。
- [ ] 在 `plugins/x` 建立标准 `x` Plugin Manifest、独立 TypeScript/Bun workspace、stdio MCP Server、`x-host` 和 standalone 分发目录。主程序只通过现有插件发现和 MCP 生命周期接入，不增加 X SDK、静态注册、专用主 CLI 命令或业务实现；源码使用显式 `--plugin-dir plugins/x`，生产使用 standalone 同级一级目录自动发现。
- [ ] 配置以 X Developer App 别名为核心并支持多个 App，首版只读取固定的 `X_BEARER_TOKEN` App-only Bearer Token 环境变量，不兼容其他旧名称，也不允许通过配置改用其他环境变量名。提供 `x-host app add|remove|list|doctor` 和 `mcp` 生命周期；Token 不得出现在普通命令参数、Manifest、配置值或日志中。
- [ ] 首版只提供受限的公开数据读取工具：`x_get_post`、`x_get_thread`、`x_get_user`、`x_get_user_posts`、`x_search_recent` 和在当前 App 权限下可用的 `x_get_mentions`。每个工具必须固定 fields/expansions 白名单、单次结果数、自动分页页数、响应字节数、超时、并发和可接受 API 消耗上限；不得由模型无限翻页、自动扩大搜索范围或将部分结果伪装为完整结果。
- [ ] App-only Bearer Token 只代表应用，不能当作用户登录状态。P1 不提供发布、回复、删除、点赞、转发、关注、取消关注、私信、账号修改、列表管理、媒体上传或其他用户身份写操作，也不实现 OAuth 1.0a、OAuth 2.0 PKCE 用户授权；SDK 中存在对应接口不代表本项目允许暴露。权限或订阅级别不足时必须返回明确错误，不尝试其他凭据或降级到网页抓取。
- [ ] 首版是按需调用的 MCP 工具插件，不是 Channel，也不启动 Filtered Stream、Account Activity、Webhook、后台轮询或自动通知。实时监听涉及持续 API 消耗、Stream Rule、断线恢复、事件排重和自动响应循环，必须在后续获得独立产品决策后另行规划，不能随着只读查询实现隐式启用。
- [ ] 实现统一的 X API 错误与费用边界，区分 `401`、`403`、`404`、`429`、套餐/Endpoint 不可用、网络失败和服务端错误；读取并返回脱敏的 Rate Limit 摘要，按 `x-rate-limit-reset` 有界等待或明确失败。默认不自动重放可能产生额外计费的请求，不跨工具共享无限重试或分页预算；诊断不得记录 Bearer Token、Authorization Header、完整敏感查询或未截断的响应正文。
- [ ] 若后续需要代表用户发布或回复，必须作为独立增量重新规划 OAuth 2.0 PKCE 或 OAuth 1.0a User Context、Token 刷新、账号选择、写工具权限和正文预览；写能力必须默认关闭、逐次审批、禁止批量发布，并对结果不确定的发送请求禁止自动重放。该后续能力不能复用 App-only Bearer Token 冒充用户授权，也不属于当前 P1 完成条件。
- [ ] 在 `scripts/validation` 增加 X SDK/Bun 兼容、插件与依赖边界、App-only 鉴权、只读工具、字段白名单、分页/响应/费用上限、限流、错误分类、脱敏和分发验证，并统一并入 `bun run verify`。Fixture 使用可注入本地 X API 端点或固定传输，不依赖真实 Token，至少覆盖多 App 隔离、`401`/`403`/`429`、分页截断、AbortSignal、禁止写工具、禁止后台连接、Host EOF、standalone 自动发现，以及 XDK 不进入根 CLI 和其他 Bundle。
- [ ] 后续升级采用人工同步：发现 X API、计费、权限、官方 XDK 或鉴权政策变化后，先冻结版本与 commit，审计 Endpoint、类型、授权要求、依赖、Bundle 和成本变化，只移植当前只读边界需要的行为并更新 Fixture；验证通过后再更新兼容元数据，禁止自动下载、更新插件、扩大 scopes 或触发 CLI 自更新。

完成条件：`x-host` 可使用至少两个独立 App-only Bearer Token 配置执行受限公开数据查询且不会串 Token、分页、限流或费用预算；首版不包含任何用户写操作、OAuth 用户登录、Channel、Stream、Webhook 或后台轮询；源码和 standalone 分发均可删除式移除，`typecheck:x-host`、`build:x-host`、依赖边界、分发验证和 `bun run verify -- --ci` 全部通过。固定 Fixture 通过后，再用低权限测试 App 对真实 X API 验收用户查询、Post 查询、近期搜索、分页、限流和套餐拒绝行为。

### P2：可选产品能力

- [ ] 支持 macOS 专用、默认关闭的 `sandbox.allowAppleEvents`，并确保该例外不会放宽文件系统、网络或其他平台的边界。

完成条件：可选能力须默认关闭或要求显式授权，且不得扩大文件系统、网络或其他平台的既有安全边界。

## 维护规则

- 官方发布新版本时，先核对 Changelog，再只记录本项目新增或仍存在的差异。
- 已完成任务立即从路线图移入“已固化的项目差异”或“明确不做”，不保留历史任务条目。
- 新任务从当前最高优先级开始编号；本路线图的首个待办固定为 P0。
- 任何新增网络能力、自动更新、远端下载或供应商专用适配，必须先更新本文件中的产品边界并获得明确决策。
