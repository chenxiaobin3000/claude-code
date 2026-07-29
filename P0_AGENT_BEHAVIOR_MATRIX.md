# P0 Agent 与后台任务行为矩阵

## 验收契约

- 官方对照版本固定为 Claude Code `2.1.220`。升级该版本前，必须重新审计官方 Changelog 和相关文档，并显式更新本矩阵。
- P0 的“一致”指用户可观察的 Agent、本地后台任务、Shell cwd、权限、取消、恢复和协议行为一致，不要求内部实现、语言或进程结构一致。
- `/cd` 的临时 cwd 语义、OpenAI-compatible Provider、本地增强安全策略，以及缺少 Anthropic 云端/远程产品，属于明确差异。
- 官方 Agent View、Remote Control 和云端后台会话不在 P0 范围内；本地 Subagent、Agent Team、`/fork`、`/subtask`、Shell/MCP 后台任务在范围内。
- 本矩阵只冻结范围和验收口径，不代表未验证能力已经完成。

官方依据：

- [Run agents in parallel](https://code.claude.com/docs/en/agents)
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Orchestrate agent teams](https://code.claude.com/docs/en/agent-teams)
- [Claude Code Changelog](https://code.claude.com/docs/en/changelog)

## 行为矩阵

| ID | 范围 | 官方 `2.1.220` 行为 | 当前项目状态 | P0 目标 | 判定 | 主要源码入口 | 验证入口 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0-01 | `/cd` | 官方命令可切换项目/会话工作目录，并联动相应项目上下文。 | 只调用本地 `setCwd` 改变临时工具 cwd；项目根、Session、Transcript、配置和扩展作用域保持启动值。 | 保持本项目临时 cwd 语义；失败不改变 cwd，`/clear` 和重启恢复启动目录。 | **明确差异，不参与对齐判定。** | `src/commands/cd/cd.ts`、`src/utils/Shell.ts`、`src/commands/clear/conversation.ts` | 已有 `scripts/validation/temporary-cd.ts`；P0 只补充与 Agent 边界的交叉验证。 |
| P0-02 | Shell 内部 `cd` | 主会话 Shell 在项目根和已授权附加目录内跨工具调用保持 cwd；越界或失效时安全复位并提示。 | Bash 与 PowerShell 现在共用提交前 cwd Policy；只持久化项目根和附加授权目录，越界或目录失效会复位并产生可见结果。Git Bash 在 Windows 通过 `cygpath` 保存物理原生路径，避免 `/tmp` 等虚拟挂载误判。 | 保持统一授权根和规范化规则，覆盖相对路径、符号链接/Junction、盘符、UNC、worktree 与恢复。 | **阶段 2 已对齐，保留 P0 总验收。** | `src/utils/Shell.ts`、`src/utils/shell/bashProvider.ts`、`src/utils/permissions/permissionSetup.ts`、Bash/PowerShell Tool | `scripts/validation/agent-cwd-isolation.ts` 已加入 `bun run verify`，并复用 Shell 权限验证。 |
| P0-03 | Agent cwd 隔离 | 子 Agent 拥有独立工作目录；其 Shell `cd` 不回写主会话，也不继承主会话 Shell 的后续 cwd 状态；worktree 隔离使用独立目录。 | 新建及恢复 Agent 总是在独立 AsyncLocalStorage cwd 中运行：显式 cwd、Agent worktree、父级写隔离根、稳定会话根依次选择；子上下文 cwd 更新不会写入全局状态，子 Agent Shell `cd` 不跨调用保留。 | 普通 Agent 从规定的会话/项目 cwd 启动，运行后独立；worktree Agent 固定到工作树；任何 cwd 变化不得迁移 Settings、CLAUDE.md、Skill、Plugin、MCP、Memory 或 Transcript 归属。 | **阶段 2 已对齐；`/cd` 差异继续单独保留。** | `src/utils/cwd.ts`、`packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx`、`resumeAgent.ts`、`src/utils/sessionRestore.ts` | `agent-cwd-isolation.ts` 覆盖临时 `/cd`、并发 Agent 和子 Shell；`worktree-agent-isolation.ts` 覆盖工作树硬边界。 |
| P0-04 | 状态模型 | Subagent、后台任务、Team 和独立后台 Session 各有清晰职责；用户能区分运行、等待输入、完成、失败和停止。 | Local Agent、Shell、Workflow、Monitor、Team 和 daemon 各自维护状态，已有通知与 UI，但终态和恢复规则分散。 | 建立唯一状态转换契约，至少覆盖 `queued`、`running`、`waiting_permission`、`idle`、`completed`、`failed`、`stopped/cancelled`，迟到事件不得覆盖终态。 | **待对齐。** | `src/tasks/*`、`src/daemon/*`、`src/utils/swarm/*`、`src/components/tasks/*` | 新增 `scripts/validation/agent-state-machine.ts`。 |
| P0-05 | 前台/后台默认值 | 从官方 `2.1.198` 起 Subagent 默认后台运行；主流程必须立即使用结果时以前台运行。显式请求和禁用后台任务设置覆盖默认决策。 | Agent Tool 支持 `run_in_background` 和 Agent frontmatter `background`，但提示仍声明“前台默认”，运行逻辑主要依赖显式字段。 | 对齐官方默认与覆盖优先级；`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 保持最高优先级，前台等待和后台通知语义稳定。 | **已识别明确不一致，待修复。** | `packages/builtin-tools/src/tools/AgentTool/prompt.ts`、`AgentTool.tsx`、`src/tasks/LocalAgentTask/*` | 新增 `scripts/validation/agent-background-policy.ts`。 |
| P0-06 | 嵌套、数量与预算 | 官方允许的嵌套 Agent 按版本规则工作，并受工具集合、并发及上下文约束；取消需要向实际子树传播。 | 已有父子 AbortController、Agent 工具裁剪及部分嵌套路径，但没有一套可验证的会话总数、深度、并发和 Token 安全预算。 | 固化与官方兼容的嵌套可用性，并增加不放宽官方行为的本地安全上限；超限明确失败，禁止静默无限排队。 | **官方行为待对齐；安全上限属于允许的本地增强。** | `AgentTool.tsx`、`runAgent.ts`、`src/utils/abortController.ts`、`packages/workflow-engine/*` | `agent-state-machine.ts`、`agent-cancellation.ts`，新增预算边界样例。 |
| P0-07 | 生命周期与通知 | 后台 Agent 不阻塞主会话；完成、失败和需权限时主动通知。停止后的任务不得被恢复或重连意外复活。 | 已有后台注册、完成通知、停止和 resume 入口；永久终态、重连/守护进程重启及迟到回调尚无统一验收。 | 通知恰好关联原任务；stop/kill 形成不可逆终态；恢复只允许官方支持的可恢复状态。 | **待对齐。** | `src/tasks/LocalAgentTask/*`、`packages/builtin-tools/src/tools/AgentTool/resumeAgent.ts`、`src/utils/backgroundHousekeeping.ts` | `agent-state-machine.ts`、`agent-cancellation.ts`、`agent-resource-cleanup.ts`。 |
| P0-08 | `/fork` 与 `/subtask` | `/subtask` 是继承当前上下文的子 Agent；`/fork` 是独立、可管理的后台 Session，两者的会话和结果归属不同。 | 两个入口均已存在，`/fork` 强制异步；Transcript、resume、worktree 和清理的交叉边界未完整验收。 | 保持官方职责；不得混淆 Session ID、Transcript、Checkpoint、Memory、通知或 worktree 所有权。 | **待对齐。** | `src/commands/fork/fork.tsx`、`packages/builtin-tools/src/tools/AgentTool/forkSubagent.ts`、`src/utils/sessionStorageRuntime.ts` | 新增 `scripts/validation/agent-fork-subtask.ts`。 |
| P0-09 | Shell/MCP 后台任务 | 显式后台任务立即返回 ID，完成后通知；长任务可按官方规则后台化，输出、退出码、取消和权限不能丢失。 | Bash/PowerShell 已支持显式后台及部分阻塞预算自动迁移；MCP Monitor 和任务实现独立，统一阈值与状态语义未验收。 | Shell 与 MCP 共用可预测的任务契约；后台化不改变工具关联，不重放已经产生副作用的调用。 | **待对齐。** | Bash/PowerShell Tool、`src/tasks/LocalShellTask/*`、`src/tasks/MonitorMcpTask/*`、`src/utils/task/*` | 新增后台策略验证，并扩展 `agent-background-policy.ts`。 |
| P0-10 | attach/detach/resume/kill/status | 管理操作对不存在、运行、等待、完成和停止任务返回一致结果；attach/detach 不改变任务本身终态。 | TaskStop、任务 UI、daemon 和 resume 各有实现，错误和状态词尚未统一。 | 固化单一转换表和幂等规则；重复 stop、迟到 status、断线 attach 都有确定结果。 | **待对齐。** | `packages/builtin-tools/src/tools/TaskStopTool/*`、`src/tasks/stopTask.ts`、`src/daemon/*` | `agent-state-machine.ts`、`agent-cancellation.ts`。 |
| P0-11 | 后台权限回传 | 从官方 `2.1.186` 起后台 Subagent 的权限请求会显示在主会话并标明来源；拒绝单次调用不必终止 Agent。 | in-process Team 和跨进程 swarm 已有 permission bridge/sync；普通后台 Agent、无人接收、断线和超时路径未形成统一证明。 | 所有本地后台 Agent 通过同一可信审批链回传；不得绕过父权限，也不得无限挂起。 | **待对齐。** | `src/utils/swarm/leaderPermissionBridge.ts`、`permissionSync.ts`、`inProcessRunner.ts`、`src/components/permissions/WorkerPendingPermission.tsx` | 新增 `scripts/validation/agent-permission-relay.ts`。 |
| P0-12 | 取消与资源回收 | 取消、失败和恢复不会遗留后台进程、临时工作树或不可管理任务。 | 已有 AbortController 传播、worktree finally 清理和后台 housekeeping；崩溃、强停、恢复交叉场景未覆盖。 | 回收 worktree、锁、临时目录、任务输出句柄、Shell/MCP 子进程和后台服务；终态持久化先于可复活入口。 | **待对齐。** | `src/utils/abortController.ts`、`src/utils/worktree.ts`、`src/utils/backgroundHousekeeping.ts`、Agent/LocalShellTask | 新增 `scripts/validation/agent-resource-cleanup.ts`。 |
| P0-13 | headless/stream-json | 嵌套/后台事件保持稳定父子关联，协议输出与诊断分流，终态和部分失败可被调用方识别。 | 已有 SDK/stream-json 事件和任务关联代码，但嵌套文本、推理事件、终态顺序及父 `tool_use` 关联未作为完整矩阵验收。 | 支持可配置转发并保持稳定父 ID；stdout 只输出协议，诊断进入 stderr；中断产生明确终态。 | **待对齐。** | `src/entrypoints/sdk/*`、`src/services/tools/toolExecution.ts`、`src/utils/toolResultStorage.ts` | 新增 `scripts/validation/agent-stream-json.ts`，并纳入现有 stream-json 冒烟。 |
| P0-14 | 间接内容安全 | Agent 返回的外部内容不能被当作系统控制、权限结果或可信父消息。 | 已有权限硬拒绝和跨会话消息防伪，但 Agent 最终报告、MCP、网页、Shell 与仓库内容没有统一信任标记和验收。 | 对间接内容进行来源标记/转义；不能扩大权限、伪造控制消息或泄露凭据。 | **可比官方更严格的本地增强。** | `src/utils/crossProjectResume.ts`、消息转换层、MCP/Tool 结果处理、Agent 结果处理 | 新增 `scripts/validation/agent-indirect-content.ts`，复用 `cross-session-authority.ts`。 |
| P0-15 | 云端/远程 Agent 产品 | 官方还提供 Agent View、Remote Control 和云端会话产品。 | 项目只保留本地运行与本地 daemon，不提供官方账号或云端控制面。 | 不实现；README 必须持续明确范围，且本地命令不得暗示支持官方云产品。 | **明确差异，不参与对齐判定。** | `README.md`、本地 `src/daemon/*` | 文档边界检查；禁止新增云端入口。 |

## 实施顺序

1. Shell cwd 与 Agent cwd 隔离。
2. 统一状态模型。
3. 前后台默认值、嵌套限制与预算。
4. 权限回传、取消传播和生命周期。
5. `/fork`、`/subtask`、Shell/MCP 后台任务及资源回收。
6. headless/stream-json 与间接内容安全。
7. 本地模型和跨平台完整验收。

## 完成判定

- `P0-02` 至 `P0-13` 的官方行为项全部通过；标记为本地增强的规则不得放宽官方安全边界。
- `P0-01` 和 `P0-15` 始终作为明确差异保留，不因 P0 完成而改写成官方能力。
- 所有新增验证均为 `scripts/validation` 下的独立脚本，不引入测试框架，并统一加入 `bun run verify`。
- Windows PowerShell 5.1、PowerShell 7、Git Bash、worktree、resume 和 stream-json 的适用场景均有固定输入与预期结果。
- 本地 OpenAI-compatible 模型完成前台 Agent、后台 Agent、权限回传、取消和完成通知冒烟；确定性状态验证不得依赖模型主动配合。
- P0 关闭前再次核对官方 `2.1.220` 文档，但不得在未更新本矩阵的情况下把验收目标滚动到更高版本。
