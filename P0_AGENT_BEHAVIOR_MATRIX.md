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
| P0-04 | 状态模型 | Subagent、后台任务、Team 和独立后台 Session 各有清晰职责；用户能区分运行、等待输入、完成、失败和停止。 | Local Agent、Shell、Workflow、Monitor、Team 和本地后台 Session 共用权威 lifecycle；Task Framework 自动归一状态并拒绝终态回退。Team 的 idle 和真实权限等待进入同一契约及可见 UI。daemon 的同名状态明确只属于进程健康面。 | 唯一转换契约覆盖 `queued`、`running`、`waiting_permission`、`idle`、`completed`、`failed`、`stopped/cancelled`；迟到事件不得覆盖终态，终态元数据仍可幂等补充。 | **阶段 3 已对齐，保留 P0 总验收。** | `src/tasks/stateMachine.ts`、`src/Task.ts`、`src/utils/task/framework.ts`、`src/utils/swarm/inProcessRunner.ts` | `scripts/validation/agent-state-machine.ts` 已加入 `bun run verify`，覆盖完整转换表、终态不可逆、权限等待/恢复、Team idle 及 Framework 竞争更新。 |
| P0-05 | 前台/后台默认值 | 从官方 `2.1.198` 起 Subagent 默认后台运行；主流程必须立即使用结果时以前台运行。显式请求和禁用后台任务设置覆盖普通默认决策，强制异步运行模式仍保持其生命周期约束。 | 普通 Agent 默认后台；全局禁用与不支持后台的上下文优先保持前台，Coordinator/fork 实验/Assistant 等强制异步上下文其次，调用参数再次，Agent 定义最后覆盖普通默认；frontmatter 的 `background: false` 不再丢失。 | 对齐官方默认与覆盖优先级；`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 保持最高优先级，前台等待和后台通知语义稳定。 | **阶段 4 已对齐，保留 P0 总验收。** | `src/utils/agentExecutionPolicy.ts`、`packages/builtin-tools/src/tools/AgentTool/prompt.ts`、`AgentTool.tsx`、`loadAgentsDir.ts` | `scripts/validation/agent-background-policy.ts` 已加入 `bun run verify`，覆盖全部决策优先级和配置解析。 |
| P0-06 | 嵌套、数量与预算 | 官方允许的嵌套 Agent 按版本规则工作，并受工具集合、并发及上下文约束；取消需要向实际子树传播。 | 异步 Agent 已允许受控调用 Agent Tool；共享会话账本默认限制深度 2、会话总数 50、并发 8、累计 Token 1,000,000，支持环境变量配置。嵌套前台与后台 Agent 都连接即时父级 AbortController，根后台 Agent 不随主线程 ESC 退出；resume 延续深度并且不重复计入新建总数。 | 固化与官方兼容的嵌套可用性，并增加不放宽官方行为的本地安全上限；超限明确失败，禁止静默无限排队。 | **阶段 4 已对齐；可配置预算属于允许的本地安全增强。** | `src/utils/agentExecutionPolicy.ts`、`AgentTool.tsx`、`resumeAgent.ts`、`runAgent.ts`、`src/tasks/LocalAgentTask/*` | `scripts/validation/agent-execution-limits.ts` 已加入 `bun run verify`，覆盖默认/配置限额、深度、总数、并发、Token、幂等释放与取消链路。 |
| P0-07 | 生命周期与通知 | 后台 Agent 不阻塞主会话；完成、失败和需权限时主动通知。停止后的任务不得被恢复或重连意外复活。 | Agent 生命周期另存 `running/completed/failed/stopped` 持久状态；运行中和永久停止状态统一拒绝 resume，完成/失败允许显式继续。终态先于附加处理提交，分类器或 worktree 清理失败不能把 completed 改成 failed；通知用任务 `notified` 原子去重。 | 通知恰好关联原任务；stop/kill 形成不可逆终态；恢复只允许官方支持的可恢复状态。 | **阶段 5 已对齐，保留 P0 总验收。** | `src/utils/agentLifecycle.ts`、`src/utils/sessionStorageRuntime.ts`、`src/tasks/LocalAgentTask/*`、`AgentTool/agentToolUtils.ts`、`resumeAgent.ts` | `agent-lifecycle.ts` 已加入 `bun run verify`，结合 `agent-state-machine.ts` 覆盖不可逆停止、恢复判定和完成后附加处理失败。 |
| P0-08 | `/fork` 与 `/subtask` | `/subtask` 是继承当前上下文的子 Agent；`/fork` 是独立、可管理的后台 Session，两者的会话和结果归属不同。 | `/fork` 复制主对话到新 Session ID 并由 detached/tmux 后台引擎恢复执行，返回 Session ID、日志及管理命令；`/subtask` 调用继承当前上下文的异步 Agent，继续归属当前 Session 的任务、通知与预算。 | 保持官方职责；不得混淆 Session ID、Transcript、Checkpoint、Memory、通知或 worktree 所有权。 | **阶段 6 已对齐，保留 P0 总验收。** | `src/commands/fork/*`、`src/commands/subtask/*`、`src/commands/branch/branch.ts`、`src/cli/bg.ts` | `scripts/validation/agent-fork-subtask.ts` 已加入 `bun run verify`，固定命令注册、Transcript 分叉和后台进程边界。 |
| P0-09 | Shell/MCP 后台任务 | 显式后台任务立即返回 ID，完成后通知；长任务可按官方规则后台化，输出、退出码、取消和权限不能丢失。 | Bash/PowerShell 共用 2 秒进度阈值和 15 秒 Assistant 阻塞预算，迁移时复用原 ShellCommand、Tool Use ID、磁盘输出及取消链。MCP Monitor 进入相同 Task lifecycle，并在完成、失败、停止和进程退出时注销 cleanup、传播 Abort；普通 MCP Tool 不在已产生副作用后自动重放。 | Shell 与 MCP 共用可预测的任务契约；后台化不改变工具关联，不重放已经产生副作用的调用。 | **阶段 6 已对齐；禁止任意 MCP 调用推测性重放。** | Bash/PowerShell Tool、`src/tasks/LocalShellTask/*`、`src/tasks/MonitorMcpTask/*`、`src/utils/task/backgroundPolicy.ts` | `scripts/validation/background-task-lifecycle.ts` 已加入 `bun run verify`，覆盖共享阈值、原进程迁移、取消与 cleanup 契约。 |
| P0-10 | attach/detach/resume/kill/status | 管理操作对不存在、运行、等待、完成和停止任务返回一致结果；attach/detach 不改变任务本身终态。 | 本地 Session 注册表持久化 detached/tmux 引擎；status 只报告实时进程健康，attach/detach 不改终态；运行中拒绝 resume，已停止且 Transcript 存在时可带 Prompt 后台恢复；kill 清理陈旧 PID。TaskStop 对运行/等待/空闲使用同一底层 running 状态并对终态返回确定的 not-running。 | 固化单一转换表和幂等规则；重复 stop、迟到 status、断线 attach 都有确定结果。 | **阶段 6 已对齐，daemon status 明确为进程健康面。** | `src/cli/bg.ts`、`src/cli/bg/engines/*`、`src/utils/concurrentSessions.ts`、`src/tasks/stopTask.ts` | `background-task-lifecycle.ts` 覆盖 ID/PID/name 定位及引擎持久化；`agent-state-machine.ts` 继续覆盖任务转换。 |
| P0-11 | 后台权限回传 | 从官方 `2.1.186` 起后台 Subagent 的权限请求会显示在主会话并标明来源；拒绝单次调用不必终止 Agent。 | 普通交互式后台 Agent、Team 和 swarm 均可进入主会话可信审批链；普通 Agent 的对话框显示 Agent 类型，任务状态同步为 `waiting_permission`，未处理默认 300,000 ms 后仅 deny 当前工具。headless/stream-json 不创建本地对话框并安全拒绝。 | 所有本地后台 Agent 通过同一可信审批链回传；不得绕过父权限，也不得无限挂起。 | **阶段 5 已对齐；超时属于本地安全增强。** | `src/hooks/useCanUseTool.tsx`、`src/hooks/toolPermission/handlers/interactiveHandler.ts`、`src/utils/backgroundPermission.ts`、`AgentTool.tsx`、`resumeAgent.ts` | `scripts/validation/agent-permission-relay.ts` 已加入 `bun run verify`，覆盖交互/headless 分流、来源标记、等待态和超时。 |
| P0-12 | 取消与资源回收 | 取消、失败和恢复不会遗留后台进程、临时工作树或不可管理任务。 | Agent 子树、Shell 子进程和 MCP Monitor 均连接可终止资源；Agent 终态释放预算、cleanup、技能/诊断状态和 worktree，Shell 终态清理进程及输出，MCP Monitor 终态/进程退出传播 Abort 并注销 cleanup，本地 Session 注册表清扫崩溃 PID。永久停止先持久化，恢复前拒绝仍在运行的同 Session。 | 回收 worktree、锁、临时目录、任务输出句柄、Shell/MCP 子进程和后台服务；终态持久化先于可复活入口。 | **阶段 6 已完成本地范围，保留 P0 总验收。** | `src/utils/abortController.ts`、`src/utils/worktree.ts`、`src/tasks/LocalShellTask/*`、`src/tasks/MonitorMcpTask/*`、`src/cli/bg.ts` | `agent-resource-cleanup.ts` 与 `background-task-lifecycle.ts` 已加入 `bun run verify`。 |
| P0-13 | headless/stream-json | 嵌套/后台事件保持稳定父子关联，协议输出与诊断分流，终态和部分失败可被调用方识别。 | 调用方启用 partial messages 时，嵌套 Agent 的文本、推理和请求事件进入 SDK 事件队列并携带父 `tool_use` 与 Agent ID；反压只优先淘汰可损失增量，任务和会话生命周期事件保持顺序。 | 支持可配置转发并保持稳定父 ID；stdout 只输出协议，诊断进入 stderr；中断产生明确终态。 | **阶段 7 已对齐。** | `src/entrypoints/sdk/*`、`src/utils/sdkEventQueue.ts`、`packages/builtin-tools/src/tools/AgentTool/runAgent.ts` | `scripts/validation/agent-stream-json.ts` 已加入 `bun run verify`，覆盖开关继承、父子关联、Schema、反压和输出顺序。 |
| P0-14 | 间接内容安全 | Agent 返回的外部内容不能被当作系统控制、权限结果或可信父消息。 | Agent 最终报告与 Shell 交互提示尾部使用 `untrusted-content` 来源标记并转义；原生 MCP、网页、仓库和工具输出保持结构化 `tool_result`，不会被提升为应用控制队列。 | 对间接内容进行来源标记/转义；不能扩大权限、伪造控制消息或泄露凭据。 | **阶段 7 已完成；属于不放宽官方边界的本地增强。** | `src/utils/indirectContent.ts`、`src/tasks/LocalAgentTask/LocalAgentTask.tsx`、`src/tasks/LocalShellTask/LocalShellTask.tsx`、消息转换层 | `scripts/validation/agent-indirect-content.ts` 已加入 `bun run verify`，并复用 `cross-session-authority.ts` 的权限防伪覆盖。 |
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
