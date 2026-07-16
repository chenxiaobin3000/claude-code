# Claude Code 差异与后续开发计划

> 文档基线：2026-07-15  
> 本地项目：`claude-code` 2.1.116
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
- 模型统一配置在 `~/.claude/models.json`：每个唯一模型 ID 绑定一个 OpenAI-compatible 地址，多个模型可以共享地址。
- 首次配置保留原有地址、API Key、模型 ID 输入流程并生成单模型注册表；多模型由用户手动编辑 JSON。
- `settings.json` 不再接受 `model` 或 `modelType`；会话选择来自 `--model`/`/model`，默认值只来自 `models.json.defaultModel`。
- 模型注册表入口：`src/utils/model/modelRegistry.ts`；`/model` 直接展示注册表中的模型。
- 模型查询入口：`src/services/model/query.ts`；`src/services/api/claude.ts` 仅保留兼容重导出。
- OpenAI-compatible Provider：`src/services/model/providers/openaiProvider.ts`；协议结果编排位于 `src/services/api/openai/index.ts`。
- 不规划任何非 OpenAI-compatible 协议的专用模型接入。

### 2.3 已知工程状态

- 项目以 TypeScript 为主体，构建和开发流程依赖 Bun，部分产物可由 Node.js 执行。
- 官方已经转向平台原生可执行文件，本项目仍是 JS/TS 应用架构。
- 自动化测试内容已按项目精简要求移除，当前回归主要依赖类型检查、构建检查和人工冒烟测试。
- 语音模式、录音、音频 NAPI Workspace 和相关二进制依赖已经移除。
- 本地版本号与 CLI 版本已统一为 `2.1.116`，构建版本以根目录 `package.json` 为唯一来源，源码直跑入口使用相同兜底值；该版本号不代表对应的官方版本。

### 2.4 当前工程与验证基线

以下状态由 2026-07-15 至 2026-07-16 的实际检查和验收确认，后续改动不得降低这些基线能力：

- Bun workspace 当前包含 18 个子包。
- Git 管理的 TypeScript 源码约 2,746 个文件、56 万行。
- 当前模型主路径由 `getAPIProvider()` 固定路由至 `openai`。Anthropic 账号登录、鉴权和官方模型直连已移除；Anthropic SDK 因大量内部消息、工具和流事件调用而继续作为兼容层保留。Bedrock Provider 已于 2026-07-15 移除；Vertex 客户端、GCP 鉴权、区域配置、专用请求行为和依赖已于 2026-07-16 移除；Foundry 客户端、Azure Identity 鉴权、专用配置和依赖也已于 2026-07-16 移除。
- 已新增统一最小验证命令 `bun run verify`，顺序覆盖锁定安装、类型检查、Lint，以及 Bun bundle、Vite/Rollup Node bundle、Windows x64 standalone EXE 三条构建链的完整性、版本、启动、单轮模型请求和 `Read` 工具调用。验证直接使用 `~/.claude/models.json` 的默认模型，并限制为回环或私有网络地址。2026-07-16 使用本地 llama.cpp（Qwen3.5-9B-Q6_K，65,536 上下文）完成三构建链全矩阵复验，所有检查通过，总耗时 69.1 秒。
- 多模型注册表已于 2026-07-15 完成：重复模型 ID 和无效默认模型会在加载时失败；同地址模型复用 OpenAI Client，不同地址使用独立 Client；旧 `OPENAI_MODEL`、`OPENAI_BASE_URL`、角色模型环境变量、模型映射和 `providers.json` 注册表已从运行链移除。类型检查、Lint、Bun 构建、Vite 构建及 Bun/Node CLI 启动验证通过。
- 第二模型验收已于 2026-07-16 完成：通过 `https://api.deepseek.com` 调用注册模型 `deepseek-v4-flash`，单轮流式响应和受权限约束的 `Read` 工具调用均通过；凭据只从配置指定的环境变量读取，未写入模型注册表、命令输出或诊断日志。结合本地 llama.cpp 的 Qwen3.5-9B-Q6_K 验证，至少两个 OpenAI-compatible 模型完成了流式响应和工具调用验收。
- `bun run typecheck`、`bun run lint`、三条构建链的完整性检查、CLI 启动、模型请求和工具调用必须持续通过，不允许把已修复问题重新定义为长期允许失败的状态。

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
7. 不在源码目录引入 `*.test.ts` 或测试框架；轻量逻辑验证统一写入 `scripts/validation`，并由现有 `bun run verify` 执行，不形成第二层验证。

## 5. 当前验证与构建基线

本节固化已经实现并验收的工程约束。统一入口为 `bun run verify`：本地模式覆盖安装、TypeScript、Biome、轻量源码验证、三条构建链、CLI 启动、模型请求和工具调用；CI 模式复用同一流程，仅跳过依赖本机模型配置的请求检查。

### 5.1 构建链支持边界

| 构建链 | 定位 | 支持运行时/平台 | 产物与边界 |
| --- | --- | --- | --- |
| Bun bundle | Bun 用户、开发与 Bun 运行时发布 | Bun `>=1.3.0`；当前已验证 Windows x64 | `dist/cli-bun.js`；允许 `bun:ffi` 等 Bun 专用模块，不将同次构建生成的 Node 包装入口作为正式 Node 产物。 |
| Vite/Rollup Node bundle | npm 默认 CLI 发布产物 | 当前基线为 Node.js 22；扩大 Node 版本或操作系统范围前必须增加对应 CI | `dist/cli-node.js` 与 `dist/chunks/*`；不得残留 Bun-only 必需依赖，Chunk 引用必须完整。 |
| Bun standalone EXE | 无需目标机器安装 Node.js/Bun 的单文件发布 | 仅 Windows x64 | `dist/ccb.exe`；内嵌 Bun Runtime，但 Git、Shell、MCP Server 等外部功能依赖不因此自动内嵌。 |

### 5.2 统一验证矩阵

| 检查 | Bun bundle | Vite/Node bundle | Windows x64 EXE |
| --- | --- | --- | --- |
| 构建成功 | 必须 | 必须 | Windows x64 必须，其他平台明确跳过 |
| JS/Chunk 完整性 | 必须 | 必须递归检查 `dist/chunks` | 不适用 |
| `--version` | 必须 | 必须 | 必须 |
| `--help` 启动 | 必须 | 必须 | 必须 |
| 本地模型单轮请求 | 必须 | 必须 | 必须 |
| `Read` 工具调用 | 必须 | 必须 | 必须 |
| 无需安装 Node.js/Bun | 不适用 | 不适用 | 构建产物属性，必须通过直接执行 EXE 验证 |

矩阵必须按“构建一条、立即验证一条”的顺序运行，因为 Bun 与 Vite 构建都会重建 `dist`。`scripts/check-bundle-integrity.ts` 对未知外部运行时模块保持错误；`bun:ffi` 仅在 Bun 产物中作为运行时专用警告，`@napi-rs/keyring` 作为可选运行时警告，缺失时必须安全降级。Vertex/Google 鉴权模块或 Foundry/Azure Identity 鉴权模块若重新进入产物将直接判定为错误。2026-07-16 实测 Bun 与 Node 产物完整性均为零错误，Windows x64 EXE 为 120.1 MiB，三种产物的版本、帮助、模型请求和工具调用全部通过。

### 5.3 CI 验证矩阵

| CI 平台 | 依赖/静态检查 | Bun bundle | Vite/Node bundle | Windows x64 EXE | 模型与工具调用 |
| --- | --- | --- | --- | --- | --- |
| `ubuntu-latest` | `bun install --frozen-lockfile`、TypeScript、Biome | 构建、完整性、版本、启动 | 构建、完整性、版本、启动 | 平台不适用，明确跳过 | 跳过，不要求模型配置或凭据 |
| `windows-latest` | `bun install --frozen-lockfile`、TypeScript、Biome | 构建、完整性、版本、启动 | 构建、完整性、版本、启动 | 构建、版本、启动 | 跳过，不要求模型配置或凭据 |

GitHub Actions 在 `main` 分支 push、pull request 和手动触发时执行，使用 Node.js 22 与 Bun 1.3.14；安装阶段关闭只适用于用户机器的 Chrome MCP 注册。CI 与本地共用 `scripts/verify.ts`：普通 `bun run verify` 保留本地 llama.cpp 的单轮模型请求和 `Read` 工具调用；`bun run verify -- --ci` 仅跳过这两项环境相关检查，不读取 `models.json`，其余步骤完全一致。2026-07-16 在 Windows x64 本地执行 CI 模式，三类适用产物全部通过，耗时 45.7 秒；GitHub 托管环境结果以首次 push 或 pull request 的实际运行记录为准。

### 5.4 模型诊断安全边界

请求开始、首 Token、成功和失败事件只记录请求 ID、Provider、模型、无凭据 endpoint、消息/字符/工具数量、Token 上限、TTFT、总耗时、Usage、停止原因、HTTP 状态、错误码和 Provider 请求 ID。禁止把请求体、Headers、system/user Prompt、工具参数、工具返回值或原始错误对象传入诊断日志。`logForDebugging` 在最终写入前统一清理 Authorization、Bearer/Basic、API Key、OAuth/JWT、敏感 URL 参数和 URL 用户凭据，并截断超长内容；OpenAI 错误还会按本次请求实际使用的 API Key 和消息文本做精确替换。Langfuse LLM observation 仅保留输入、输出和工具的类型、数量、角色分布与序列化长度摘要，不再保存原文。

`scripts/validation/model-diagnostics.ts` 使用固定伪 API Key、OAuth JWT、URL 凭据和唯一 Prompt 标记验证脱敏、endpoint 清理、错误截断及摘要输出，并已并入唯一的 `bun run verify` 流程。2026-07-16 使用本地 llama.cpp 完成 Bun bundle、Vite/Node bundle 和 Windows x64 EXE 的模型与 `Read` 工具全矩阵验证，新增脱敏检查同时通过，总耗时 66.0 秒；另以 `--debug-file` 执行真实请求，落盘得到请求开始、首 Token、成功三类结构化事件，Prompt 标记未写入日志。

### 5.5 轻量源码验证矩阵

| 脚本 | 纯函数边界 | 固定样例覆盖 |
| --- | --- | --- |
| `message-conversion.ts` | `anthropicMessagesToOpenAI` | system/user/assistant、thinking、tool use/result 顺序、图片 |
| `openai-stream.ts` | `adaptOpenAIStreamToAnthropic` | thinking/text、分片工具参数、尾部 Usage、缓存 Token、`tool_use`/`max_tokens` 停止原因 |
| `tool-permissions.ts` | 权限规则解析、序列化和通配匹配 | exact/prefix/wildcard、括号与反斜杠转义、命令边界、Bash 大小写敏感、PowerShell 大小写不敏感 |
| `shell-parsers.ts` | Bash 纯 TypeScript AST 解析与 PowerShell JSON AST 转换 | 管道、控制符、命令替换、转义分号、heredoc、cmdlet/路径/模块前缀、参数、变量、重定向 |
| `model-diagnostics.ts` | 日志脱敏和摘要纯函数 | API Key、OAuth/JWT、URL 凭据、Prompt、截断和安全诊断字段 |

每个脚本都可由 `bun run scripts/validation/<name>.ts` 独立运行；`scripts/verify.ts` 按固定清单逐项执行，项目不增加第二个总验证命令。PowerShell 轻量验证不启动 `pwsh`，只调用运行路径实际使用的 `transformPowerShellParseOutput` 纯转换边界，因此可在 Windows/Linux CI 中得到相同结果；外部 PowerShell 进程发现与启动不属于本组纯函数验证。2026-07-16 五项脚本独立执行总耗时低于 1 秒，随后完整 `bun run verify` 通过，三构建链、模型和工具调用均成功，总耗时 69.8 秒。

2026-07-16 第二模型实测：显式选择 `deepseek-v4-flash` 后，单轮流式请求返回预期标记；随后仅开放并允许 `Read` 工具读取根目录 `package.json`，模型正确发起工具调用并返回版本 `2.1.116`。测试使用 `OPENAI_MAX_TOKENS=4096`，未记录 API Key 或完整 Prompt。本地功能基线已完成验收；跨平台 CI 仍以 GitHub 托管环境首次实际运行记录作为最终证据。

### 5.6 基线约束

- 全新环境可按文档完成安装、构建和启动。
- `bun run typecheck`、`bun run lint`、构建完整性检查和 CLI 冒烟检查全部通过。
- Bun 与 Node CLI 产物均能执行 `--version`；支持的平台上 standalone EXE 可以启动。
- 至少两个 OpenAI/OpenAI-compatible 模型完成流式对话与工具调用。
- 失败时能定位 Provider、模型注册与解析、鉴权或流解析阶段。

## 6. 后续开发路线图

### P0：工程结构与 Provider 边界治理

目标：降低核心模块修改风险，明确 OpenAI 模型主路径与 Anthropic SDK 内部兼容层的边界。

- [x] 建立明确的 Provider 接口边界，将共享消息预处理、OpenAI 请求、流事件适配和 Usage 统计分层，避免继续在 `src/services/api/claude.ts` 中扩展条件分支（2026-07-16 已新增 `services/model` 分层、唯一 OpenAI Provider 调度、统一 Usage 与流事件处理，并接入 `provider-boundary` 防回归检查）。
- [x] 对 `src/services/api/claude.ts` 中 Provider 调度后的不可达第一方实现进行引用和职责审计；将仍被外部调用的共享 Helper 迁移到 `services/model` 对应分层，在确认不承担 Anthropic SDK 内部兼容职责后，删除旧请求、鉴权、缓存 Beta、重试和流处理代码，并增加防回归检查（2026-07-16 已将查询编排、轻量查询、Token Limit、Metadata、Cache Control 和媒体预处理迁入 `services/model`，`claude.ts` 仅保留兼容重导出，并通过 `provider-boundary` 限制其恢复实现）。
- [x] 保留 Anthropic SDK 作为内部消息、工具和流事件兼容层，梳理并记录其实际调用范围；不得仅因模型 Provider 固定为 OpenAI 就删除 SDK 类型或共享处理逻辑（2026-07-16 已完成历史删除复核，新增 `ANTHROPIC_SDK_COMPATIBILITY.md`、`sdk-compat-boundary` 防回归检查，并补齐消息、工具和流事件行为验证）。
- [x] 明确移除范围仅包括 Anthropic 账号登录、账号鉴权和官方模型直连入口，并增加检查防止这些入口被意外恢复（2026-07-16 已移除账号鉴权实现、官方直连回退和账号专属命令，并接入 `anthropic-boundary` 验证）。
- [x] 完成 Bedrock 非主路径审计并删除专用 Provider 实现、AWS 鉴权配置和依赖，同时保留共享 Anthropic SDK 消息兼容逻辑（2026-07-15 已验证 Bun/Vite 构建及 Bun/Node CLI 启动）。
- [x] 对 Vertex 非主路径分支完成引用和运行时审计；确认其不承担共享 SDK 兼容职责且运行不可达后，已删除客户端、GCP 鉴权、区域配置、专用请求行为和依赖，并增加源码及构建产物防回归检查（2026-07-16）。
- [x] 对 Foundry 非主路径分支完成引用和运行时审计；确认其仅为独立传输与 Azure Identity 鉴权实现、不承担共享 SDK 兼容职责且运行不可达后，已删除客户端、Provider 行为、模型与环境配置以及依赖，并增加源码及构建产物防回归检查；历史 API Key 名称仅保留在子进程密钥过滤中（2026-07-16）。
- [x] 拆分 `src/main.tsx`，按启动阶段、参数注册、运行模式和服务初始化划分模块（2026-07-16 已完成：新增 `src/cli/startup`、`src/cli/arguments`、`src/cli/modes` 和 `src/cli/initialization` 分层；设置预加载、入口识别、早期 argv 改写、命令级初始化、迁移、首屏后延迟服务、Commander 根参数/功能参数/子命令注册、print 快速路径及默认运行体均已迁出，`main.tsx` 由 5528 行缩减至 150 行以内，并新增 `main-boundary` 防回归检查。`bun run verify --ci` 于 Windows 全部通过，用时 72.0 秒，覆盖 TypeScript、Biome、轻量验证、Bun/Vite 构建、Node CLI、Windows standalone EXE 及各产物 `--version`/`--help` 启动冒烟）。
- [x] 拆分 `src/screens/REPL.tsx`，将会话状态、输入控制、任务/Agent 状态和渲染职责分离（2026-07-16 已完成：`REPL.tsx` 收口为 2 行稳定导出入口；新增 `screens/repl/session`、`input`、`agents` 和 `view` 分层，分别承接消息时间线、输入与 transcript 控制、任务/Agent 状态及 transcript 纯渲染组件；剩余跨域编排集中到 `ReplController.tsx`，并新增 `repl-boundary` 防回归检查。`bun run verify --ci` 于 Windows 全部通过，用时 62.1 秒）。
- [ ] 拆分 `src/utils/messages.ts`、`src/utils/sessionStorage.ts` 和 `src/utils/hooks.ts`，优先抽出纯函数与协议转换层，并在 `scripts/validation` 中补充轻量验证脚本。
- [ ] 为所有 workspace 统一最小脚本约定：`typecheck`、`build`、`test` 或明确的 `test:smoke`；不适用的子包需写明原因。
- [ ] 审计根包 `devDependencies` 中实际进入生产 Bundle 的依赖，明确运行时依赖与构建期依赖，减少发布和供应链审计范围。
- [ ] 将 Feature Flag 分为稳定、实验、内部/部署专用三组，增加依赖关系和非法组合检查；默认构建只启用有验收覆盖的稳定能力。

验收标准：

- OpenAI-compatible 模型请求主路径清晰，Anthropic SDK 兼容层的保留原因和调用边界有明确文档。
- 不存在 Anthropic 账号登录、账号鉴权或官方模型直连的可用入口。
- 关键巨石文件有清晰的领域边界，新功能不再继续扩大其职责。
- 每个 workspace 都能被统一验证流程发现并得到明确结果。
- Feature Flag 的默认集合、依赖关系和支持级别可由机器读取并在构建时校验。

### P0：OpenAI-compatible 模型对齐

目标：建立统一、可配置的 OpenAI-compatible 模型调用链。

- [x] 建立以模型为核心的 `~/.claude/models.json` 注册表；每个模型配置唯一 ID 和 OpenAI-compatible 地址，地址允许重复（2026-07-15 已完成）。
- [x] `/model` 保留原有 UI 流程并直接展示注册模型；请求按所选模型解析地址和凭据，不再依赖 `OPENAI_MODEL`、`OPENAI_BASE_URL` 或 Claude 模型映射（2026-07-15 已完成）。
- [ ] 按接口能力配置上下文窗口、最大输出 Token、推理参数、Prompt Cache 和价格。
- [x] 移除 OpenAI 模型映射和隐式 fallback；未注册模型在发送请求前直接报错（2026-07-15 已完成）。
- [ ] 增加启动时模型能力探测，减少对模型名称的硬编码判断。
- [ ] 核对 OpenAI Chat Completions 的推理参数、工具选择、流事件和 Usage 字段。
- [ ] 对不兼容 OpenAI 协议的 endpoint 给出清晰错误，不增加专用适配分支。

验收标准：

- `/model` 正确显示 OpenAI 或当前 OpenAI-compatible endpoint 可用的模型。
- 至少两个 OpenAI-compatible 模型可以流式响应并调用工具。
- 上下文、推理参数、Prompt Cache 和价格统计与实际模型能力一致。

### P0：权限、Sandbox 和 Worktree 安全

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

### P1：排障和会话体验

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

### P1：Agent 和后台任务

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

### P1：Hook、Plugin、Skill 和 MCP 对齐

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

### P2：性能和稳定性

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

### P2：可选产品能力

以下能力应单独评估，不作为核心兼容阻塞项：

- [ ] 浏览器控制：优先采用公开 MCP/浏览器协议，不绑定官方 Chrome 私有服务。
- [ ] VS Code 插件：提供会话交互、代码上下文传递、Diff 预览与权限确认，并通过稳定的公开协议连接 CLI，避免与编辑器进程内实现强耦合。

## 7. 推荐实施顺序

建议按照以下顺序推进，每一阶段完成验收后再进入下一阶段：

1. Provider 接口收敛及 Anthropic SDK 兼容边界梳理。
2. OpenAI-compatible 模型能力探测与协议稳定性。
3. 核心巨石文件和 workspace 工程结构治理。
4. 权限、Sandbox、Worktree 安全。
5. Safe Mode、Doctor、会话迁移。
6. Agent 和后台任务状态统一。
7. Hook、Plugin、Skill、MCP 扩展协议。
8. 性能优化及可选产品能力。

不建议首先重写为官方原生二进制架构。该改造投入大、风险高，且不会直接解决模型协议、安全和稳定性问题。应先把当前 TypeScript 架构维护到可靠状态，再通过独立调研决定是否迁移 Rust、Go 或其他原生运行时。

## 8. 每项功能的完成定义

一个计划项只有同时满足以下条件才可标记完成：

- 代码实现完成，错误路径有明确处理。
- 配置项、环境变量和默认行为有文档。
- TypeScript 与 Biome 检查零错误通过。
- Bun、Node 及适用平台的 standalone EXE 构建完成，并通过相应 CLI 启动冒烟。
- 涉及消息、Provider、权限、命令解析或持久化的改动应在 `scripts/validation` 中具有独立轻量验证，并由 `bun run verify` 统一执行；无法脚本化时记录人工验证步骤和结果。
- 不记录或泄露密钥、Token、凭据文件及敏感 Prompt。
- Windows、macOS、Linux 的差异已评估；无法支持的平台有明确提示。
- 旧配置有迁移或兼容方案。
- README 或本文件中的状态已同步更新。

## 9. 暂不追求的一致性

- 官方私有服务端接口的完全兼容。
- 官方订阅、额度、组织管理和灰度实验的完整复刻。
- 官方 Desktop、Chrome 扩展和移动端推送的像素级或协议级一致。
- 官方内部遥测、发布系统和闭源安全分类器。
- 已移除的语音能力。

这些差异不影响项目作为独立 CLI Agent 使用，但必须在发布说明中明确，避免用户把本项目误认为官方 Claude Code 的可替代发行版。

## 10. 官方参考

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

## 11. 维护规则

- 官方 Claude Code 发布新版本时，只更新经过源码核对或实际验证的差异项。
- 每完成一个计划项，勾选对应复选框，并记录验证命令或验证结果。
- 每月至少重新核对一次官方 Changelog、模型列表和安全修复。
- 如果本地实现与官方采用不同设计，应记录“能力等价”而不是宣称“代码对齐”。
