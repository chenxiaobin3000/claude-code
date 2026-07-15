# Claude Code 差异与后续开发计划

> 文档基线：2026-07-15  
> 本地项目：`claude-code` 2.8.3
> 对照版本：Claude Code 官方 v2.1.210（2026-07-14）

## 1. 文档目的

本文记录当前项目与 Claude Code 官方版本之间的主要差异，并作为后续开发、兼容性维护和验收工作的统一路线图。

当前项目不是一份未经修改的“2026 年 4 月 1 日源码快照”。代码中已经包含对官方 v2.1.117、v2.1.118、v2.1.123 等版本的逆向对齐说明，也移植了部分 5 月和 6 月发布的功能；与此同时，项目已经删除自动化测试和语音、音频原生模块。因此，后续开发应以实际代码能力为基线，不以根目录版本号或最初来源日期推断功能版本。

## 2. 当前项目能力基线

### 2.1 已有核心能力

- 交互式 CLI、流式输出、工具调用和上下文压缩。
- 模型运行时只使用 OpenAI 及 OpenAI-compatible 接口，OpenAI 为默认 Provider。
- Anthropic SDK 仅作为本地消息、工具和流事件类型依赖，不作为模型供应商；Anthropic 官方直连和账号登录已移除。
- MCP、Plugin、Skill、Hook 和自定义命令。
- Agent、后台 Session、Coordinator 和 Agent Team 相关实现。
- `/monitor`、`/autofix-pr`、`/ultraplan`、`/ultrareview`、`/recap`、`/goal`。
- 动态 Workflow 和 `ultracode`。
- Artifact 工具。
- `/usage` 及成本、Token 统计。
- PowerShell、Bash、工作树和远程控制相关能力。

### 2.2 当前模型基线

- 默认模型及自定义模型均通过 OpenAI-compatible 协议调用。
- 模型由 `OPENAI_MODEL`、`OPENAI_BASE_URL` 和相关 OpenAI 配置指定。
- 模型配置入口：`src/utils/model/configs.ts`。
- Provider 请求入口：`src/services/api/claude.ts`。
- OpenAI-compatible 适配：`src/services/api/openai`。
- 不规划任何非 OpenAI-compatible 协议的专用模型接入。

### 2.3 已知工程状态

- 项目以 TypeScript 为主体，构建和开发流程依赖 Bun，部分产物可由 Node.js 执行。
- 官方已经转向平台原生可执行文件，本项目仍是 JS/TS 应用架构。
- 自动化测试内容已按项目精简要求移除，当前回归主要依赖类型检查、构建检查和人工冒烟测试。
- 语音模式、录音、音频 NAPI Workspace 和相关二进制依赖已经移除。
- 本地版本号 `2.8.3` 和 CLI 兜底版本 `2.1.888` 均不代表对应的官方版本。

## 3. 与官方 v2.1.210 的主要差异

状态说明：

- **已有**：本地已经存在主体实现。
- **部分**：存在相似实现，但协议、行为或稳定性没有完全对齐。
- **缺失**：当前代码搜索未发现完整实现。
- **外部依赖**：依赖官方服务端、账号资格或官方桌面端，不适合只靠本地代码复刻。

| 模块 | 官方现状 | 本地状态 | 主要差异 |
| --- | --- | --- | --- |
| 运行时 | 平台原生可执行文件 | 部分 | 本地仍以 TypeScript、Bun/Node 为主 |
| Safe Mode | `--safe-mode` 禁用项目自定义能力排障 | 缺失 | 未发现完整 safe-mode 开关 |
| 会话迁移 | `/cd` 保留会话迁移到新目录 | 缺失 | 没有官方同等语义的会话迁移 |
| Shell 模式 | `! command` 后模型主动分析输出 | 缺失 | 未发现 `respondToBashCommands` |
| Sandbox | 凭据文件和秘密环境变量隔离 | 缺失 | 未发现 `sandbox.credentials` |
| 权限规则 | 支持工具输入参数匹配及更严格危险命令分类 | 部分 | 本地有权限系统，但未完整对齐最新规则 |
| Hook | MCP Tool Hook、参数数组、`continueOnBlock`、`MessageDisplay` 等 | 部分 | 基础 Hook 和 MCP 存在，新字段不完整 |
| Agent | Dashboard、attach/detach、嵌套子 Agent、默认后台运行 | 部分 | 本地有后台 Agent/Coordinator，但行为和协议可能不同 |
| Worktree 隔离 | 持续修复跨工作树写入和 Git 命令逃逸 | 部分 | 需要专项安全审计和回归 |
| Plugin | prune、依赖检查、最低版本、搜索和动态重载 | 部分 | 未发现 `plugin prune`、`requiredMinimumVersion` 等完整能力 |
| MCP | CLI OAuth 登录、启动重试、审批状态和会话重连 | 部分 | 基础能力存在，需按最新协议逐项核对 |
| Doctor | 完整配置检查和修复建议 | 部分 | 本地有 Doctor 页面，但检查项较旧 |
| 浏览器 | Claude in Chrome GA、Desktop 内置浏览器 | 外部依赖 | 本地工具不能等同于官方浏览器集成和登录态共享 |
| Artifact | 官方托管、实时更新和分享页面 | 部分/外部依赖 | 本地有 Artifact 工具，托管能力依赖服务端 |
| Desktop | Windows、macOS、Linux Desktop | 外部依赖 | 不属于当前 CLI 仓库的直接开发目标 |
| 性能稳定性 | 持续优化 CPU、内存、网络重试、后台服务 | 部分 | 本地混合多个逆向版本，缺少完整回归保障 |
| 语音 | 官方仍保留语音相关能力 | 主动移除 | 本项目明确不再维护语音功能 |
| 测试 | 官方内部有持续回归体系 | 主动移除 | 需要建立轻量替代验证流程 |

## 4. 开发原则

1. 优先解决协议兼容、安全和数据完整性，再增加界面型功能。
2. 不以模拟官方版本号代替能力检测；功能必须有明确的 capability 判断。
3. 不直接照搬依赖官方云端的功能，先明确服务端接口、账号权限和替代方案。
4. 模型供应商必须通过 OpenAI-compatible 协议接入，不新增厂商专用 Provider 分支。
5. 新模型必须同时补齐模型 ID、上下文、推理参数、价格、显示名称和兼容能力判断。
6. 保持语音功能移除状态，除非后续单独立项恢复。
7. 在不恢复大型测试体系的前提下，至少保留构建、类型检查和关键链路冒烟验证。

## 5. 后续开发路线图

### P0：建立可靠基线

目标：让后续开发可以判断“改动是否破坏核心功能”。

- [ ] 统一项目版本来源，移除或替换 `2.1.888` 等误导性兜底版本。
- [ ] 增加 `PROJECT_CAPABILITIES.md` 或机器可读 capability 清单。
- [ ] 固化最小验证命令：安装、类型检查、构建、启动、单轮模型请求、工具调用。
- [ ] 增加不依赖测试框架的冒烟脚本，覆盖 OpenAI 和另一个 OpenAI-compatible Provider。
- [ ] 对当前 Bun、Node.js 运行边界形成明确文档。
- [ ] 为模型请求增加可脱敏的诊断日志，禁止记录 API Key、OAuth Token 和完整敏感 Prompt。

验收标准：

- 全新环境可按文档完成安装、构建和启动。
- 至少两个 OpenAI/OpenAI-compatible 模型完成流式对话与工具调用。
- 失败时能定位 Provider、模型映射、鉴权或流解析阶段。

### P1：OpenAI-compatible 模型对齐

目标：建立统一、可配置的 OpenAI-compatible 模型调用链。

- [ ] 将 `configs.ts`、`model.ts` 和 `modelOptions.ts` 中的模型配置改为 Provider-neutral 结构。
- [ ] 以 `OPENAI_MODEL` 和自定义模型配置为真实模型 ID，不再依赖 Claude 系列别名映射。
- [ ] 按接口能力配置上下文窗口、最大输出 Token、推理参数、Prompt Cache 和价格。
- [ ] 完善 OpenAI 模型映射的 fallback 策略，禁止把内部占位模型 ID 直接传给服务端。
- [ ] 增加启动时模型能力探测，减少对模型名称的硬编码判断。
- [ ] 核对 OpenAI Chat Completions 的推理参数、工具选择、流事件和 Usage 字段。
- [ ] 对不兼容 OpenAI 协议的 endpoint 给出清晰错误，不增加专用适配分支。

验收标准：

- `/model` 正确显示 OpenAI 或当前 OpenAI-compatible endpoint 可用的模型。
- 至少两个 OpenAI-compatible 模型可以流式响应并调用工具。
- 上下文、推理参数、Prompt Cache 和价格统计与实际模型能力一致。

### P1：权限、Sandbox 和 Worktree 安全

目标：优先补齐最新版最重要的安全差异。

- [ ] 审计 Bash、PowerShell 命令解析与权限分类。
- [ ] 增加 `sandbox.credentials`：阻止读取常见凭据文件和秘密环境变量。
- [ ] 支持 `Tool(param:value)` 权限规则及通配符。
- [ ] 对 `git reset --hard`、`git clean -fd`、`git stash drop`、`terraform destroy` 等增加上下文约束。
- [ ] 验证 Worktree Agent 无法修改主工作区。
- [ ] 验证符号链接、目录切换、后台命令不会绕过写入边界。
- [ ] 跨 Session 消息默认不继承用户权限。
- [ ] 对未知或无效权限规则启动时告警。

验收标准：

- 隔离 Agent 的 Git 写操作只能影响自己的工作树。
- 未经明确授权，模型不能读取凭据或执行破坏性命令。
- Bash 和 PowerShell 对相同危险操作给出一致决策。

### P2：排障和会话体验

目标：降低复杂配置导致的启动和会话故障。

- [ ] 实现 `--safe-mode`，禁用 CLAUDE.md、Skill、Plugin、Hook、MCP 和自定义 Agent。
- [ ] 扩展 `/doctor`，检查运行时、Provider、凭据、MCP、Plugin、Hook、模型和权限配置。
- [ ] 实现 `/cd`，明确新目录信任、CLAUDE.md 加载和 Session 存储迁移语义。
- [ ] 实现 `respondToBashCommands`，让 `! command` 可配置是否触发模型响应。
- [ ] 支持 `/rewind` 跨 `/clear` 恢复。
- [ ] 完善 API 中断重试和流断线恢复。

验收标准：

- Safe Mode 能在用户配置损坏时正常启动和调用基础工具。
- `/cd` 后当前会话可继续，并能由 `--resume` 正确找到。
- Shell 命令响应行为可由设置显式控制。

### P2：Agent 和后台任务

目标：统一本地 Coordinator、Agent Team 和官方后台 Agent 语义。

- [ ] 梳理 Agent、Coordinator、Team、Background Session 的状态模型，移除重复实现。
- [ ] 明确 foreground/background 默认策略。
- [ ] 支持嵌套子 Agent，并限制最大深度、并发数和 Token 预算。
- [ ] 统一 attach、detach、resume、kill 和状态查询。
- [ ] 后台 Agent 权限请求回传主会话，不自动吞掉或永久挂起。
- [ ] 完善 Agent 崩溃恢复、工作树清理和锁释放。
- [ ] 防止子 Agent 读取的外部内容形成间接 Prompt Injection。

验收标准：

- Agent 树和实际进程状态一致。
- Session 切换、终端 resize 和后台服务重连不会丢任务。
- Agent 异常退出后无残留 Worktree 锁和孤儿进程。

### P2：Hook、Plugin、Skill 和 MCP 对齐

目标：稳定扩展生态接口，避免每个版本重复修改核心代码。

- [ ] Hook 支持直接 MCP Tool 调用。
- [ ] 增加 `continueOnBlock`、`MessageDisplay`、`additionalContext` 等最新字段。
- [ ] 支持 Hook 命令参数数组，减少 Shell 转义问题。
- [ ] 增加 Plugin 依赖检查、最低版本约束、prune 和动态重载。
- [ ] 增加 `disableBundledSkills` 和嵌套 `.claude/skills` 发现规则。
- [ ] 增加 `claude mcp login/logout`。
- [ ] 完善 MCP 启动重试、审批状态、OAuth 凭据清理和会话重连。
- [ ] 明确扩展 API 的版本号和向后兼容策略。

验收标准：

- 旧插件仍可加载；新字段缺失时有安全默认值。
- MCP 重连或配置刷新不会错误关闭其他 Plugin 的 MCP Server。
- Skill、Hook 和 Plugin 的上下文成本可在 `/usage` 中识别。

### P3：性能和稳定性

目标：解决长会话与高并发 Agent 下的资源问题。

- [ ] 分析流式渲染 CPU 占用和终端输出缓存增长。
- [ ] 限制历史消息、工具结果、图片和 MCP 大结果的常驻内存。
- [ ] 统一网络重试、退避和 Provider rate limit 分类。
- [ ] 处理 Windows 网络盘、云同步目录和文件锁问题。
- [ ] 检查后台服务 crash-loop、Session 清理和临时文件残留。
- [ ] 增加长会话、并发 Agent、MCP 重连的压力冒烟脚本。

验收标准：

- 长会话内存增长有上限且可解释。
- 网络短暂中断不会丢失整个会话。
- Windows 文件写入不会产生零字节或截断文件。

### P3：可选产品能力

以下能力应单独评估，不作为核心兼容阻塞项：

- [ ] 浏览器控制：优先采用公开 MCP/浏览器协议，不绑定官方 Chrome 私有服务。
- [ ] Artifact：先实现本地静态或实时预览，再评估托管分享。
- [ ] Desktop：如需要，单独建立桌面壳项目，不侵入 CLI 核心。
- [ ] Linux Desktop 或系统级 Computer Use：作为独立项目评估权限和安全成本。
- [ ] 语音模式：保持移除，恢复必须另立需求并重新评估原生依赖。

## 6. 推荐实施顺序

建议按照以下顺序推进，每一阶段完成验收后再进入下一阶段：

1. P0 基线和诊断能力。
2. OpenAI-compatible 模型配置、能力探测与协议稳定性。
3. 权限、Sandbox、Worktree 安全。
4. Safe Mode、Doctor、会话迁移。
5. Agent 和后台任务状态统一。
6. Hook、Plugin、Skill、MCP 扩展协议。
7. 性能优化及可选产品能力。

不建议首先重写为官方原生二进制架构。该改造投入大、风险高，且不会直接解决模型协议、安全和稳定性问题。应先把当前 TypeScript 架构维护到可靠状态，再通过独立调研决定是否迁移 Rust、Go 或其他原生运行时。

## 7. 每项功能的完成定义

一个计划项只有同时满足以下条件才可标记完成：

- 代码实现完成，错误路径有明确处理。
- 配置项、环境变量和默认行为有文档。
- 至少完成类型检查、构建和关键链路冒烟验证。
- 不记录或泄露密钥、Token、凭据文件及敏感 Prompt。
- Windows、macOS、Linux 的差异已评估；无法支持的平台有明确提示。
- 旧配置有迁移或兼容方案。
- README 或本文件中的状态已同步更新。

## 8. 暂不追求的一致性

- 官方私有服务端接口的完全兼容。
- 官方订阅、额度、组织管理和灰度实验的完整复刻。
- 官方 Desktop、Chrome 扩展和移动端推送的像素级或协议级一致。
- 官方内部遥测、发布系统和闭源安全分类器。
- 已移除的语音能力。

这些差异不影响项目作为独立 CLI Agent 使用，但必须在发布说明中明确，避免用户把本项目误认为官方 Claude Code 的可替代发行版。

## 9. 官方参考

- [Claude Code 官方 Changelog](https://code.claude.com/docs/en/changelog)
- [2026 年 3 月 30 日至 4 月 3 日更新](https://code.claude.com/docs/en/whats-new/2026-w14)
- [2026 年 4 月 6 日至 10 日更新](https://code.claude.com/docs/en/whats-new/2026-w15)
- [2026 年 4 月 13 日至 17 日更新](https://code.claude.com/docs/en/whats-new/2026-w16)
- [2026 年 4 月 20 日至 24 日更新](https://code.claude.com/docs/en/whats-new/2026-w17)
- [2026 年 4 月 27 日至 5 月 1 日更新](https://code.claude.com/docs/en/whats-new/2026-w18)
- [2026 年 5 月 11 日至 15 日更新](https://code.claude.com/docs/en/whats-new/2026-w20)
- [2026 年 5 月 25 日至 29 日更新](https://code.claude.com/docs/en/whats-new/2026-w22)
- [2026 年 6 月 8 日至 12 日更新](https://code.claude.com/docs/en/whats-new/2026-w24)
- [2026 年 6 月 15 日至 19 日更新](https://code.claude.com/docs/en/whats-new/2026-w25)
- [2026 年 6 月 22 日至 26 日更新](https://code.claude.com/docs/en/whats-new/2026-w26)
- [2026 年 6 月 29 日至 7 月 3 日更新](https://code.claude.com/docs/en/whats-new/2026-w27)
- [Claude Code v2.1.210](https://github.com/anthropics/claude-code/releases/tag/v2.1.210)

## 10. 维护规则

- 官方 Claude Code 发布新版本时，只更新经过源码核对或实际验证的差异项。
- 每完成一个计划项，勾选对应复选框，并记录验证命令或验证结果。
- 每月至少重新核对一次官方 Changelog、模型列表和安全修复。
- 如果本地实现与官方采用不同设计，应记录“能力等价”而不是宣称“代码对齐”。
