# 项目基线与开发计划

## 基线

项目当前发行版本为 `2.1.220`，官方功能对照基线固定为 Claude Code `2.1.220`。截至 `2026-08-01`，当前产品范围内的功能、差异边界、安全约束、构建和验证矩阵均已完成验收；可选后续能力不影响当前基线成立。

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
- 本地 Plugin Manifest 使用可选 `apiVersion` SemVer 范围协商声明式扩展 API；当前版本为 `1.0.0`，缺省按旧 v1 契约兼容。显式不兼容时整插件及其组件不可达，依赖降级继续按固定点传播；MCP 与 ACP 保持各自协议协商。
- `/cd` 有意保持为本项目的临时 cwd 命令，不对齐官方的跨项目会话迁移：它只改变主会话后续工具使用的当前目录，不改变启动项目根、Session ID、Transcript/Resume 归属、权限根、Settings、CLAUDE.md、Hook、Skill、Plugin、MCP、Memory、Plan 或 Checkpoint 作用域。
- `/cd` 不改变已运行子 Agent 的 cwd；新建 Agent 从稳定的会话/工作树根启动，不继承主会话的临时 `/cd`，子 Agent 的 cwd 变化也不得回写主会话。`/clear` 和进程重启恢复到启动项目目录；无参数只报告当前 cwd，失败不得改变现有 cwd。
- 主程序本身不实现、不自动启用 Chrome 操作；`--chrome`/`--no-chrome`、`/chrome`、Chrome Settings/Onboarding/通知、隐藏 MCP/Native Host 进程入口、内置 Chrome Skill、MCP 保留名称和专用客户端渲染均已从主干入口移除。
- Chrome 能力只能由本地 `claudeinchrome` 插件提供：生产 standalone 从同级 `plugins` 一级目录自动发现，源码开发使用 `--plugin-dir` 显式加载；目标链路固定为主程序标准插件加载器 → 插件 MCP/Skill → 插件 Native Host → 插件 Chrome 扩展 → Chrome，主干禁止绕过插件直接连接。
- `plugins/claudeinchrome/chrome-extension` 已包含 Manifest V3 Chrome 扩展实现，固定扩展 ID 为 `dlpofjonbnceelbmpelkfblmnghclmkm`；标签页、导航、页面读取与交互、截图和窗口缩放等浏览器端能力已经实现。
- Chrome 工具与桥接协议的权威定义位于 `plugins/claudeinchrome/protocol`。MCP 只允许广告扩展已实现的 11 个工具，`computer.zoom`、GIF、图片上传、Console/Network 和快捷方式不进入可用工具集合；协议固定 1 MiB 消息上限、30 秒工具超时和必填 `request_id`，Native Host 必须按请求归属精确回传，不得向其他 MCP 客户端广播工具结果。
- Windows、Linux 和 macOS 的插件 Host 统一使用仅绑定 `127.0.0.1` 的动态 TCP socket，不使用 Windows 命名管道或 Unix Domain Socket。每个 Chrome 扩展实例启动独立 Host 并发布带进程号的端点记录，MCP 自动发现多个在线实例；请求必须携带端点随机令牌，日志禁止输出令牌，Host 退出或发现失效进程时清理端点记录。
- 每个 Chrome 个人资料通过扩展自己的 `chrome.storage.local` 保存永久 `profileId` 和用户别名 `profileName`，不猜测 Chrome 内部 Profile 名称。`tabs_context_mcp` 汇总在线 Profile 并为标签页附加 Profile 身份；多 Profile 下的工具调用必须显式路由，缺少目标、断线、重复 Profile ID 或跨 Profile Tab ID 冲突均 fail-closed，禁止自动选择或回退到其他账户。
- `plugins/claudeinchrome/host` 已提供与主程序解耦的 MCP/Native Messaging Host 入口、路径、注册、卸载和 doctor，实现不依赖主程序 Settings、模型调用、Anthropic 账号或内部 `USER_TYPE` 分支。Windows 可构建独立 `claudeinchrome-host.exe`；默认无参数运行 Native Host，`mcp` 运行 stdio MCP，`register`/`unregister`/`doctor` 由用户显式执行。
- MCP 引擎、TCP Socket 生命周期、多实例端点池和工具声明已经迁入 `plugins/claudeinchrome/mcp`；旧 `packages/@ant/claude-for-chrome-mcp` workspace 包和 `src/utils/claudeInChrome` 主程序兼容层已经删除，并由防回归验证阻止恢复。
- 插件 Manifest 已通过标准本地 stdio MCP 声明启动 Host，`skills/claude-in-chrome/SKILL.md` 只随插件加载；插件未加载时，主程序的系统提示、Skill 和工具列表均不宣传 Chrome 能力。
- `bun run build:chrome-host` 生成完整的 `dist/plugins/claudeinchrome` 分发目录；`bun run build:production` 同时生成 `dist/claude.exe`，整个 `dist` 可作为固定路径的 Windows 生产分发单元。分发 Manifest 直接启动包含 Bun Runtime 的独立 Host，目标机器无需 Bun 或 Node.js。
- 标准 Plugin Manifest、MCP 环境展开、名称作用域、Skill 发现、自动目录约束、三层优先级、`--bare`、重载裁剪、standalone 插件移除、独立 Host EOF、分发目录生命周期和真实 Chrome 端到端矩阵均已验收。扩展固定声明 `<all_urls>`，不提供页面授权或本地站点白名单；所有 HTTP/HTTPS 页面均可操作，Chrome 内部页、扩展页、文件页和无效 Tab 继续拒绝。真实矩阵覆盖固定扩展 ID、Native Host 注册/doctor/自动重连、拒绝路径、页面刷新和错误恢复。
- 真实 Chrome 工具矩阵覆盖 11 个广告工具的连接与核心行为，包括标签页枚举/创建、导航及前进后退、页面读取、查找、表单输入、JavaScript、点击/滚动/键盘、截图、窗口缩放、Unicode URL、Chrome 内部页拒绝、非法/已失效 Tab ID 和 1 MiB 超限结果。超限结果必须返回结构化错误并保持桥接连接；点击必须保留浏览器聚焦语义。

### 工程与验证

- 根包与 workspace 均遵循最小脚本约定：`typecheck`、`build`、`test` 或明确的 `test:smoke`；不适用的子包须写明原因。
- 支持 Bun bundle、Vite/Rollup Node bundle、Bun standalone EXE 三条构建链，并在 CI 只验证适用产物。
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

## 可选后续路线图（不影响当前验收）

### P0：可选产品能力

- [ ] 支持 macOS 专用、默认关闭的 `sandbox.allowAppleEvents`，并确保该例外不会放宽文件系统、网络或其他平台的边界。

完成条件：可选能力须默认关闭或要求显式授权，且不得扩大文件系统、网络或其他平台的既有安全边界。

## 维护规则

- 官方发布新版本时，先核对 Changelog，再只记录本项目新增或仍存在的差异。
- 已完成任务立即从路线图移入“已固化的项目差异”或“明确不做”，不保留历史任务条目。
- 新任务从当前最高优先级开始编号；本路线图的首个待办固定为 P0。
- 任何新增网络能力、自动更新、远端下载或供应商专用适配，必须先更新本文件中的产品边界并获得明确决策。
