# 项目基线与开发计划

## 基线

项目当前发行版本为 `2.1.116`。官方对照基线为 Claude Code `2.1.141`；上游功能与行为以 [Claude Code 官方文档](https://code.claude.com/docs/en/overview)和[官方 Changelog](https://code.claude.com/docs/en/changelog)为准。

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

### Windows 原生 OS Sandbox

- Windows 上 `sandbox.enabled: true` 时，受保护的 Bash 与 PowerShell 固定在同一个 Windows Sandbox VM 中执行；首次受保护命令才启动可见 VM，取消或正常退出 CLI 会关闭整个来宾会话，绝不回退宿主执行。
- VM 只映射启动工作区（可写）、私有协议控制目录（可写）和已安装的 Bash/PowerShell 运行时（只读）；禁用网络、麦克风输入、剪贴板和 vGPU，不映射用户主目录、`.claude` 凭据或系统根目录，来宾请求环境为空。
- 请求使用结构化 argv 和协议文件传递并回传 stdout、stderr、退出码；卷根、UNC、符号链接/Junction 工作区或运行时映射均被拒绝。
- Windows Sandbox 无法精确实施域名/代理或映射目录内的文件 allow/deny 规则；遇到这些配置即 fail-closed。`failIfUnavailable`、`excludedCommands` 和 `allowUnsandboxedCommands` 保持上层语义。

### 本地产品边界

- 主题仅来自内置主题和 `~/.claude/themes/*.json`；重启读取，不提供编辑器、热更新或插件主题安装。
- 插件仅支持本地已安装插件；不支持远端市场、自动下载、原生安装、CLI 自更新或插件自动更新。
- `/cd` 只改变临时 cwd，不迁移项目身份、会话、设置、Hook、插件或 MCP 作用域。
- 主程序不内置、不自动启用 Chrome 控制；`--chrome`/`--no-chrome`、`/chrome`、Chrome Settings/Onboarding/通知、隐藏 MCP/Native Host 进程入口、内置 Chrome Skill、MCP 保留名称和专用客户端渲染均已从主干入口移除。
- Chrome 能力只能由用户显式加载的本地 `claudeinchrome` 插件提供，目标链路固定为：主程序标准插件加载器 → 插件 MCP/Skill → 插件 Native Host → 插件 Chrome 扩展 → Chrome；主干禁止绕过插件直接连接。
- `plugins/claudeinchrome` 已建立标准 `.claude-plugin/plugin.json` 骨架，Chrome 扩展已归入 `plugins/claudeinchrome/chrome-extension`，固定扩展 ID 为 `dlpofjonbnceelbmpelkfblmnghclmkm`。
- MCP、Skill 与 Native Host 尚未迁移和验收，因此当前插件不声明这些组件，Chrome 自动化暂不可用且不得回退原主干实现。

### 工程与验证

- 根包与 workspace 均遵循最小脚本约定：`typecheck`、`build`、`test` 或明确的 `test:smoke`；不适用的子包须写明原因。
- 支持 Bun bundle、Vite/Rollup Node bundle、Bun standalone EXE 三条构建链，并在 CI 只验证适用产物。
- `bun run verify` 是唯一验证入口：依赖锁定、TypeScript、Biome、构建、CLI 启动、源码轻量验证与本地模型可用时的单轮模型/工具调用均在其中执行。
- 模型请求诊断日志必须脱敏，禁止记录 API Key、OAuth Token 和完整敏感 Prompt。

## 明确不做

- Anthropic 官方账号、网络 Provider、原生安装器和任何 CLI 自更新能力。
- ChatGPT/Codex OAuth、云模型供应商专用适配、自动能力探测与隐式请求字段降级。
- 官方 MCP Registry 预取、远端插件市场、远端插件下载和插件自动更新。
- Anthropic 云端浏览器桥接、已移除的 `mcp-chrome`、Artifact 工具和 VS Code 插件路线。
- 官方大型测试体系；项目只维护独立的 `scripts/validation` 轻量验证脚本。

## 未开发路线图

### P0：Agent 与后台任务模型

- [ ] 对齐官方 `/cd`：将当前会话原子迁移到目标工作目录，并保留当前对话上下文与 Prompt Cache；不再只临时改变 cwd。
- [ ] `/cd` 后重新绑定会话的项目身份、Transcript/Resume 归属、Git 状态、权限根、Settings、CLAUDE.md、Hook、Skill、Plugin 与 MCP 发现范围；失败时保持原会话与原目录完整可用。
- [ ] 对齐 Shell cwd 规则：主会话的 Bash `cd` 仅在项目根或 `--add-dir`、`/add-dir`、`additionalDirectories` 授权目录内跨命令保留；越界时复位并在工具结果中说明；子代理不继承 cwd 变更。
- [ ] 为 `/cd` 与 Bash `cd` 增加规范化路径、符号链接、Windows 盘符/UNC、工作树、会话恢复和 `CwdChanged` Hook 验证，确保变更不导致跨项目配置泄漏。
- [ ] 梳理 Agent、Coordinator、Team 与 Background Session 的状态模型，消除重复状态和相互覆盖。
- [ ] 明确前台/后台默认值、`background` 覆盖规则与等待行为。
- [ ] 定义嵌套子代理的最大深度、并发、Token 预算和取消传播。
- [ ] 对齐后台优先的子代理生命周期：前台会话可继续工作并收到完成/需输入通知；停止必须永久生效，恢复、重连或守护进程重启不得复活已停止任务。
- [ ] 支持会话级 Agent 总数上限、嵌套深度上限与可配置的安全预算；在 headless/stream-json 中可选择转发嵌套子代理文本和推理事件，并保持稳定的父 `tool_use` 关联。
- [ ] 对齐 `/fork` 与 `/subtask` 的职责：`/fork` 生成独立、可管理的后台会话，`/subtask` 保留当前会话内的委派语义；分叉、恢复和清理不得混淆 Transcript 或工作树归属。
- [ ] 对齐后台任务的 Shell 与 MCP 自动背景化阈值、状态展示和权限回传；长运行任务不能冻结主会话，也不能因后台化丢失输出或取消信号。
- [ ] 统一 attach、detach、resume、kill、status 的状态转换与错误语义。
- [ ] 让后台 Agent 的权限请求可靠回到主会话，不因无人处理而无限挂起。
- [ ] 在崩溃、取消和恢复时回收 worktree、锁、临时目录和后台服务。
- [ ] 为来自间接外部内容的提示注入建立明确的隔离和确认策略。

完成条件：状态转换和工作目录迁移可复现，取消与恢复不会遗留资源，权限与用户可见状态一致，跨目录不会泄漏配置或会话归属，并有独立轻量验证覆盖关键转换。

### P1：Hook、Plugin、Skill 与 MCP

- 当前进度（2026-07-28）：Hook 已具备 Schema、`additionalContext`、`CwdChanged`/`FileChanged`、命令/Prompt/Agent/HTTP/受控 MCP 执行和新 argv 模式；本地 Plugin/Skill 已具备目录发现、真实路径去重、嵌套命名、依赖解析与 Plugin Hook 原子热重载，以及 `SKILL.md` 元数据三种命名兼容；MCP 已具备本地 OAuth Token 缓存失效、登录/退出、请求超时、重连/重试、`roots/list`、敏感 Header/URL 脱敏与输出截断。本轮 `bun run verify --ci` 已于 2026-07-28 全部通过（159.0 秒，含 17 个 workspace、专项边界、Bun/Node Bundle 与 Windows 独立 EXE）；以下未勾选项仅保留真实缺口，不能因已有局部实现而提前关闭。
- [x] 支持 Hook 直接调用 MCP Tool（2026-07-28）：仅允许 `PreToolUse` 通过 `type:"mcp"` 调用当前会话已加载的 MCP Tool；输入先过目标 Tool Schema，再进入原始 `canUseTool` 权限审批，不接受普通内置 Tool，也不递归触发目标 Tool Hook。配置的秒级超时沿用统一 AbortSignal，认证、权限拒绝、输入错误和执行错误均作为阻断结果回传。专项验证覆盖 Schema、来源隔离去重和拒绝不可绕过。
- [x] 固化 Hook 输出契约（2026-07-28）：`continue:false` 会产生 `preventContinuation`，`systemMessage` 以可见系统消息传递，`additionalContext` 在各 Hook 结果中聚合注入；`continueOnBlock` 仍作为独立缺口保留。
- [x] Hook command 支持显式 argv（2026-07-28）：配置 `args` 时以 `command` 作为可执行文件并保留参数边界，插件变量逐参数替换；未启用 Sandbox 时直接 `spawn`，POSIX Sandbox 下安全转义后进入 Sandbox 包装，Windows Sandbox 尚不能映射任意宿主可执行文件时明确失败，禁止回退宿主执行。旧字符串命令保持兼容。
- [x] 已具备 `CwdChanged`、`FileChanged`、`InstructionsLoaded`、`ConfigChange` 生命周期 Hook（2026-07-28）：包含 Schema、运行入口与 watch path 更新；`DirectoryAdded`、`PostToolBatch`、`continueOnBlock` 及 SessionStart/分叉/恢复来源仍作为独立未完成缺口。
- [x] 对齐 Hook `if` 匹配（2026-07-28）：工具与 MCP 标识符使用精确名称或显式列表；Bash 通过权威解析结果逐子命令匹配，无法安全解析时按安全侧触发；Read/Edit/Write 路径 Glob 统一 Windows/Unix 分隔符，Windows 下按文件系统语义忽略大小写并保留目录深度约束。专项验证覆盖复合命令、环境变量前缀、无关子命令和 Windows 路径。
- [x] 收紧 Hook 事件 Matcher 的精确匹配（2026-07-28）：工具与 MCP 标识符支持精确名称、`|` 或逗号列表；保留正则兼容并在每次测试前复位 `lastIndex`，避免状态化正则造成偶发漏匹配。
- [x] Hook 权限闭环（2026-07-28）：`deny`、`ask` 与 `continue:false` 均由 PreToolUse 结果进入 `resolveHookPermissionDecision` 和原始 `canUseTool` 审批链；拒绝、自动模式与失败路径不会直连执行。`scripts/validation/hook-protocol.ts` 覆盖阻断、停止原因和权限结果解析。
- [ ] 完善本地/内置插件依赖、最低版本、裁剪与动态重新加载；继续禁止远端市场、下载和自动更新。
- [x] 支持 `disableBundledSkills`（2026-07-28）：设置中的 Skill 名称仅过滤编译内置 Skill，不影响项目、用户目录或本地 Plugin Skill；嵌套 `.claude/skills` 的命名、真实路径去重与优先级仍沿用既有本地加载器，后续与 Plugin/Skill 全局优先级一并验收。
- [ ] 对齐仅本地 Skill 的发现和调用语义：嵌套目录按 cwd 解析、同名保留可区分名称、支持连续 Slash Skill 组合；不引入 Marketplace、远端下载或自动更新。
- [x] 兼容本地 `SKILL.md` 前置元数据（2026-07-28）：`allowed-tools`、`argument-hint`、`when_to_use`、`user-invocable`、`disable-model-invocation` 均接受 kebab/snake/camel 三种等价写法，标准键优先；缺失字段保留既有安全默认，解析失败会记录带路径的诊断且继续加载正文，不静默丢失 Skill 内容。
- [x] 增加 MCP OAuth 凭据生命周期（2026-07-28）：`/mcp login <server>` 对指定 HTTP/SSE Server 启动真实 OAuth 流程、展示浏览器失败时的授权 URL，并在成功后重连；`/mcp logout <server>` 尽力执行 RFC 7009 撤销后删除本地 Token，取消待执行重连、抑制主动断开产生的 `onclose` 自动重连，并从 AppState 移除该 Server 的 Tool、Command 和 Resource，不触及应用 Provider 凭据或 Anthropic 账号。
- [ ] 完善 MCP 启动重试、审批、OAuth 凭据清理与断线重连。
- [x] 固化 MCP 输出上限为本地策略（2026-07-28）：只读取 `MAX_MCP_OUTPUT_TOKENS` 或本地默认值，不再从 GrowthBook 等远程 Feature Flag 获取 MCP 截断阈值。
- [ ] 对齐 MCP Server 的不可信配置审批、认证缺失提示、headless OAuth 无浏览器流程、临时认证失败重连，以及 `list`/`get` 的 HTTP 状态和脱敏错误输出。
- [ ] 支持 MCP `roots/list` 与工作目录变更通知；stdio Server 在恢复后获得稳定会话标识，并保证凭据、URL Secret 和环境变量不泄露到 CLI 输出或日志。
- [x] 修正 MCP `roots/list` 的项目根 URI（2026-07-28）：仅返回启动项目根，并使用 `pathToFileURL` 生成标准 URI，兼容 Windows 盘符、空格和 Unicode；cwd 变更通知与 stdio 恢复语义仍保留在上方未完成项。
- [ ] 在 MCP 工具调用超阈值时安全转入后台并保留进度、结果、取消和超时语义；配置校验失败的 Server 必须在交互与 stream-json 启动阶段可见。
- [ ] 为扩展 API 定义版本协商与向后兼容策略。

完成条件：每项能力有配置 Schema、权限边界、失败提示和至少一个不依赖测试框架的验证脚本。

### P2：性能与稳定性

- [ ] 优化流式渲染的 CPU 占用、缓存命中和长输出退化。
- [ ] 控制长会话、工具结果、图片与 MCP 内容导致的内存增长。
- [ ] 处理 Windows 网络共享、云同步目录和文件锁引起的读写竞争。
- [ ] 处理后台服务异常退出后的重启节流、会话恢复与临时文件清理。
- [ ] 建立长会话、多 Agent 与多 MCP 的压力冒烟场景。

完成条件：有可重复的压力脚本、资源阈值与异常恢复验证，且不会把环境偶发错误误报为产品成功。

### P3：可选产品能力

- [ ] 支持 macOS 专用、默认关闭的 `sandbox.allowAppleEvents`，并确保该例外不会放宽文件系统、网络或其他平台的边界。
- [ ] 将 `claude-in-chrome` MCP Server、Native Host 实现/清单安装和协议代码从主干迁入 `plugins/claudeinchrome`；插件使用标准本地 MCP 声明启动，主干不得恢复隐藏进程入口、保留 Server 名、自动注入或 in-process 特例。
- [ ] 将 Chrome Skill、Prompt 和必要的工具展示元数据迁入 `plugins/claudeinchrome`；只在插件启用且 MCP 可用时暴露，未安装插件时不得在系统提示、Skill 列表或工具列表中宣传 Chrome 能力。
- [ ] 为插件 MCP、Skill 与 Native Host 完成独立轻量验收后，才在插件清单声明对应组件；覆盖插件启用/禁用、加载失败、进程退出、消息上限、权限同步、提示注入和卸载后的能力回收。
- [ ] 在真实 Chrome 中端到端验收插件：固定扩展 ID、Native Host 安装/刷新、CLI 与 MCP 连接生命周期、Service Worker 休眠后重连、按站点授权、拒绝路径、错误可见性和失败恢复。
- [ ] 验收核心工具矩阵：标签页枚举/创建、导航、页面读取、查找、表单输入、JavaScript、点击/滚动/键盘、截图与窗口缩放；覆盖页面刷新、标签关闭、非法 Tab ID、Chrome 内部页面、Unicode URL 和超过 Native Messaging 消息上限的结果。
- [ ] 对 GIF、图片上传、Console/Network 和快捷方式等尚未实现的浏览器工具作出产品决策：补齐实现，或从本地扩展可用工具集合中移除，避免 MCP 广告能力与扩展实现不一致。

完成条件：可选能力须默认关闭或要求显式授权且不扩大既有安全边界；Chrome 能力只能来自标准本地插件，不得存在主干旁路；浏览器连接不得依赖云端账号，广告的工具集合必须与扩展实际实现一致，并通过插件级和真实 Chrome 端到端验收。

## 维护规则

- 官方发布新版本时，先核对 Changelog，再只记录本项目新增或仍存在的差异。
- 已完成任务立即从路线图移入“已固化的项目差异”或“明确不做”，不保留历史任务条目。
- 新任务从当前最高优先级开始编号；本路线图的首个待办固定为 P0。
- 任何新增网络能力、自动更新、远端下载或供应商专用适配，必须先更新本文件中的产品边界并获得明确决策。
