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

### 本地产品边界

- 主题仅来自内置主题和 `~/.claude/themes/*.json`；重启读取，不提供编辑器、热更新或插件主题安装。
- 插件仅支持本地已安装插件；不支持远端市场、自动下载、原生安装、CLI 自更新或插件自动更新。
- `/cd` 只改变临时 cwd，不迁移项目身份、会话、设置、Hook、插件或 MCP 作用域。
- 浏览器控制不作为项目内置能力；仅保留对已安装 `claude-in-chrome` 的验收范围。

### 工程与验证

- 根包与 workspace 均遵循最小脚本约定：`typecheck`、`build`、`test` 或明确的 `test:smoke`；不适用的子包须写明原因。
- 支持 Bun bundle、Vite/Rollup Node bundle、Bun standalone EXE 三条构建链，并在 CI 只验证适用产物。
- `bun run verify` 是唯一验证入口：依赖锁定、TypeScript、Biome、构建、CLI 启动、源码轻量验证与本地模型可用时的单轮模型/工具调用均在其中执行。
- 模型请求诊断日志必须脱敏，禁止记录 API Key、OAuth Token 和完整敏感 Prompt。

## 明确不做

- Anthropic 官方账号、网络 Provider、原生安装器和任何 CLI 自更新能力。
- ChatGPT/Codex OAuth、云模型供应商专用适配、自动能力探测与隐式请求字段降级。
- 官方 MCP Registry 预取、远端插件市场、远端插件下载和插件自动更新。
- 内置浏览器控制、已移除的 `mcp-chrome`、Artifact 工具和 VS Code 插件路线。
- 官方大型测试体系；项目只维护独立的 `scripts/validation` 轻量验证脚本。

## 未开发路线图

### P0：Windows 原生 OS Sandbox

- [ ] 为原生 Windows 实现 OS 级 Bash/PowerShell 子进程隔离，覆盖文件系统读写边界、网络域名边界、子进程继承与进程清理。
- [ ] 保持与 macOS Seatbelt、Linux/WSL2 bubblewrap Sandbox 的设置语义一致：`filesystem`、`network`、`failIfUnavailable`、`excludedCommands` 与 `allowUnsandboxedCommands`。
- [ ] 在不支持或初始化失败时遵守 `failIfUnavailable`：默认明确告警并走常规权限流，启用硬失败时拒绝启动，不产生伪沙盒状态。
- [ ] 为 Windows PowerShell 5.1、PowerShell 7、Git Bash 与路径/UNC/符号链接边界提供真实隔离验证。

完成条件：Windows 上的子进程不能越过已配置的文件与网络边界；退出、取消和异常不会遗留代理、锁或子进程；验证不得只依赖模拟或字符串判断。

### P1：Agent 与后台任务模型

- [ ] 梳理 Agent、Coordinator、Team 与 Background Session 的状态模型，消除重复状态和相互覆盖。
- [ ] 明确前台/后台默认值、`background` 覆盖规则与等待行为。
- [ ] 定义嵌套子代理的最大深度、并发、Token 预算和取消传播。
- [ ] 统一 attach、detach、resume、kill、status 的状态转换与错误语义。
- [ ] 让后台 Agent 的权限请求可靠回到主会话，不因无人处理而无限挂起。
- [ ] 在崩溃、取消和恢复时回收 worktree、锁、临时目录和后台服务。
- [ ] 为来自间接外部内容的提示注入建立明确的隔离和确认策略。

完成条件：状态转换可复现，取消与恢复不会遗留资源，权限与用户可见状态一致，并有独立轻量验证覆盖关键转换。

### P2：Hook、Plugin、Skill 与 MCP

- [ ] 支持 Hook 直接调用 MCP Tool，并定义其权限、超时和错误传播。
- [ ] 补齐 `continueOnBlock`、`MessageDisplay`、`additionalContext` 的兼容语义。
- [ ] 让 Hook command 参数使用数组传递，避免字符串拼接和 Windows 引号歧义。
- [ ] 完善本地/内置插件依赖、最低版本、裁剪与动态重新加载；继续禁止远端市场、下载和自动更新。
- [ ] 支持 `disableBundledSkills` 与嵌套 `.claude/skills` 的明确优先级。
- [ ] 增加 `claude mcp login`/`logout` 的本地凭据生命周期管理。
- [ ] 完善 MCP 启动重试、审批、OAuth 凭据清理与断线重连。
- [ ] 为扩展 API 定义版本协商与向后兼容策略。

完成条件：每项能力有配置 Schema、权限边界、失败提示和至少一个不依赖测试框架的验证脚本。

### P3：性能与稳定性

- [ ] 优化流式渲染的 CPU 占用、缓存命中和长输出退化。
- [ ] 控制长会话、工具结果、图片与 MCP 内容导致的内存增长。
- [ ] 处理 Windows 网络共享、云同步目录和文件锁引起的读写竞争。
- [ ] 处理后台服务异常退出后的重启节流、会话恢复与临时文件清理。
- [ ] 建立长会话、多 Agent 与多 MCP 的压力冒烟场景。

完成条件：有可重复的压力脚本、资源阈值与异常恢复验证，且不会把环境偶发错误误报为产品成功。

### P4：可选产品能力

- [ ] 验收已安装的 `claude-in-chrome`：连接生命周期、权限提示、错误可见性与失败恢复。

完成条件：只对外部已安装能力做集成验收；不把浏览器控制实现重新纳入本项目代码。

## 维护规则

- 官方发布新版本时，先核对 Changelog，再只记录本项目新增或仍存在的差异。
- 已完成任务立即从路线图移入“已固化的项目差异”或“明确不做”，不保留历史任务条目。
- 新任务从当前最高优先级开始编号；本路线图的首个待办固定为 P0。
- 任何新增网络能力、自动更新、远端下载或供应商专用适配，必须先更新本文件中的产品边界并获得明确决策。
