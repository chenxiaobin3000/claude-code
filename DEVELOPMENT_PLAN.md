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
- 模型能力统一由 `src/utils/model/modelProfiles.ts` 显式硬编码，不在启动时请求 endpoint 探测能力，也不根据响应或名称相似度猜测能力。区分大小写的完整模型 ID 优先匹配专用 Profile；未登记模型统一使用复制自 Qwen 的显式默认 Profile（65,536 上下文、4,096 最大输出、无推理和 Prompt Cache、本地零价格），加载时必须警告正在使用默认配置并建议增加专用 Profile。当前专用登记 `Qwen3.5-9B-Q6_K` 与 `deepseek-v4-flash`；无法确认的 DeepSeek Cache 价格保持 `null`，不借用其他模型价格。`models.json` 只负责模型、地址、凭据引用及展示信息。
- 不规划任何非 OpenAI-compatible 协议的专用模型接入。
- OpenAI-compatible 请求失败统一分类为鉴权、限流、上下文、模型不存在、网络、超时、路由、请求字段、响应结构、服务端和未知错误；路由/字段/JSON/SSE 不兼容必须明确指出协议边界，不允许自动删字段重试、备用路由或厂商专用适配分支。
- 2026-07-17 协议错误分类完成验收：`bun run verify -- --ci` 的静态检查、18 个 workspace、轻量验证和三类构建产物全部通过（120.4 秒）；普通 `bun run verify` 使用本地 llama.cpp 对 Bun bundle、Vite/Node bundle 和 Windows standalone EXE 分别完成真实流式单轮请求及 `Read` 工具调用（145.1 秒），新增响应结构守卫未误判实际 SSE。
- Chat Completions 参数契约由精确模型 Profile 固定：输出字段只能是 `max_tokens` 或 `max_completion_tokens`，推理只能是无推理、DeepSeek `thinking` 或 OpenAI `reasoning_effort`，并显式声明 temperature、并行工具调用和严格 Schema 策略。主请求与 `sideQuery` 复用同一构造规则；`thinkingConfig` 和适用模型的 `effortValue` 必须进入请求，禁止根据错误响应动态换字段。
- 流适配必须保留 text/refusal/reasoning、交错并行工具参数、停止原因和 Usage 明细；无 `finish_reason`、遗留 `function_call`、无函数名或无效 JSON 属于协议错误。内部 Usage 保留 raw input、cache read/write、reasoning、total 和完整性标记；`completion_tokens` 包含 reasoning token，不得重复计费，缺少尾部 Usage 时必须明确记录不完整。

### 2.3 已知工程状态

- 项目以 TypeScript 为主体，构建和开发流程依赖 Bun，部分产物可由 Node.js 执行。
- 官方已经转向平台原生可执行文件，本项目仍是 JS/TS 应用架构。
- 官方大型测试体系和源码目录内的 `*.test.ts` 已按项目精简要求移除；回归统一使用 `scripts/validation` 独立轻量验证、workspace 冒烟、类型检查、Biome、三类构建和 CLI/模型/工具调用验收，不引入第二层总入口。
- 语音模式、录音、音频 NAPI Workspace 和相关二进制依赖已经移除。
- 本地版本号与 CLI 版本已统一为 `2.1.116`，构建版本以根目录 `package.json` 为唯一来源，源码直跑入口使用相同兜底值；该版本号不代表对应的官方版本。
- CLI 不具备自安装或自更新能力：根级 `install`、`update`、`rollback`（包括 `ccb update`）以及 native/local installer、自动更新器、版本锁和更新频道配置均已移除。版本升级只能由外部分发渠道替换产物。远程插件安装和自动更新同样已移除：本地目录插件仅通过 `--plugin-dir` 按会话加载，由用户替换文件后重启或执行 `/reload-plugins`；内置插件只能随新版 CLI 产物更新。SSH 远端部署和 standalone EXE 构建不受影响。包管理器来源检测已迁为只读 Doctor 能力；2026-07-16 执行 `bun run verify -- --ci` 全矩阵通过，耗时 120.3 秒，最终 EXE 帮助中不存在上述三个根命令。
- Provider 调度、共享请求预处理、OpenAI 请求、流事件适配和 Usage 统计已分层到 `src/services/model`；`src/services/api/claude.ts` 仅保留兼容重导出。模型主路径固定为 OpenAI-compatible，Anthropic SDK 仅承担内部消息、工具、流事件和 Usage 类型兼容，保留范围及删除规则见 `ANTHROPIC_SDK_COMPATIBILITY.md`。SDK 在根包、model-provider 和 workflow-engine 中统一精确锁定为 `0.81.0`，默认只允许类型导入；运行时值仅白名单保留 `APIUserAbortError`、`APIConnectionError`、`APIConnectionTimeoutError` 和 `APIError` 四个本地错误类。`sdk-compat-boundary.ts` 使用 TypeScript AST 检查版本、关键适配器、OpenAI 调用链及运行时导入，`anthropic-boundary.ts` 独立禁止账号、凭据、域名和模型 Client，防止把 SDK 类型误判为网络 Provider。2026-07-19 `bun run verify -- --ci` 全矩阵通过（108.5 秒）；普通 `bun run verify` 使用本地 llama.cpp 的 `Qwen3.5-9B-Q6_K` 对 Bun bundle、Vite/Node bundle 和 Windows standalone EXE 完成真实单轮请求及 `Read` 工具调用（120.0 秒）。Anthropic 账号及官方直连、Bedrock、Vertex 和 Foundry 专用传输与鉴权不得恢复。
- `src/main.tsx` 已收口为薄入口，启动阶段、参数注册、运行模式和服务初始化分别由 `src/cli/startup`、`arguments`、`modes`、`initialization` 承担。`src/screens/REPL.tsx` 同样为稳定入口，会话、输入、Agent、查询、运行时、视图和交互职责分布在 `src/screens/repl` 对应子层；入口和遗留 Runtime 均受只减不增的结构边界约束。
- `src/utils/messages.ts`、`sessionStorage.ts`、`hooks.ts` 已收口为稳定薄入口；纯消息处理、Transcript 链与投影、Hook 匹配和输出协议分别迁入 `utils/messages/`、`utils/sessionStorage/`、`utils/hooks/`。遗留运行时编排由同目录 `*Runtime.ts` 承接并设置只减不增的行数上限，新代码必须直接引用聚焦模块。
- 根包依赖按“发布后外部解析”与“构建时嵌入 Bundle”划分：生产依赖仅保留 `fflate`、`undici` 和 `ws`，其余源码及 workspace 输入归入 `devDependencies`；第三方 Chrome MCP bridge、默认服务配置和安装脚本已移除。完整职责与审计规则见 `DEPENDENCY_AUDIT.md`。`bun.lock` 必须纳入版本控制，并由冻结安装检查保证干净检出可复现。

### 2.4 当前工程与验证基线

以下状态由 2026-07-15 至 2026-07-17 的实际检查和验收确认，后续改动不得降低这些基线能力：

- Bun workspace 当前包含 18 个子包。
- 18 个 workspace 均遵循机器可检查的最小脚本契约：必须提供独立 `typecheck` 和 `test`/`test:smoke`；有独立产物的包必须提供 `build`，源码直引包则必须在 `workspaceValidation.build.reason` 中说明不适用原因。统一由 `bun run workspaces:verify` 发现和执行，并已接入唯一总入口 `bun run verify`。
- Git 管理的 TypeScript 源码约 2,746 个文件、56 万行。
- 当前模型主路径由 `getAPIProvider()` 固定路由至 `openai`。Anthropic 账号登录、鉴权和官方模型直连已移除；Anthropic SDK 因大量内部消息、工具和流事件调用而继续作为兼容层保留。Bedrock Provider 已于 2026-07-15 移除；Vertex 客户端、GCP 鉴权、区域配置、专用请求行为和依赖已于 2026-07-16 移除；Foundry 客户端、Azure Identity 鉴权、专用配置和依赖也已于 2026-07-16 移除。
- 已新增统一最小验证命令 `bun run verify`，顺序覆盖锁定安装、类型检查、Lint，以及 Bun bundle、Vite/Rollup Node bundle、Windows x64 standalone EXE 三条构建链的完整性、版本、启动、单轮模型请求和 `Read` 工具调用。验证默认使用 `~/.claude/models.json` 的默认模型，也可用 `CLAUDE_CODE_VERIFY_MODEL` 显式选择注册表中的本地模型；地址始终限制为回环或私有网络，禁止误用外部付费接口。2026-07-16 使用本地 llama.cpp（Qwen3.5-9B-Q6_K，65,536 上下文）完成三构建链全矩阵复验，所有检查通过，总耗时 69.1 秒。
- 多模型注册表已于 2026-07-15 完成：重复模型 ID 和无效默认模型会在加载时失败；同地址模型复用 OpenAI Client，不同地址使用独立 Client；旧 `OPENAI_MODEL`、`OPENAI_BASE_URL`、角色模型环境变量、模型映射和 `providers.json` 注册表已从运行链移除。类型检查、Lint、Bun 构建、Vite 构建及 Bun/Node CLI 启动验证通过。
- 第二模型验收已于 2026-07-16 完成：通过 `https://api.deepseek.com` 调用注册模型 `deepseek-v4-flash`，单轮流式响应和受权限约束的 `Read` 工具调用均通过；凭据只从配置指定的环境变量读取，未写入模型注册表、命令输出或诊断日志。结合本地 llama.cpp 的 Qwen3.5-9B-Q6_K 验证，至少两个 OpenAI-compatible 模型完成了流式响应和工具调用验收。
- OpenAI-compatible 模型对齐已于 2026-07-17 完成验收：注册表、精确模型 Profile、共享 Chat Completions 请求构造、工具选择、流事件、Usage 明细和协议错误分类均由 `scripts/validation` 定向覆盖；未登记模型使用固定默认 Profile 并告警，不探测 endpoint、不按名称猜测、不自动换字段或增加厂商分支。`bun run verify -- --ci` 全矩阵通过（139.0 秒）；普通 `bun run verify` 使用本地 llama.cpp 对 Bun bundle、Vite/Node bundle 和 Windows standalone EXE 分别完成真实单轮请求及 `Read` 工具调用（159.4 秒）。
- 主题来源固定为 6 个内置主题和启动时从 `~/.claude/themes/*.json` 只读加载的本地 JSON；文件名生成 `custom:<slug>` 配置值，`base` 继承内置 Palette，`overrides` 只覆盖合法颜色 Token。程序不创建、编辑、删除或热更新主题文件，也不加载 Plugin 主题；外部文件变更在重启后生效，当前自定义主题缺失或损坏时回退 `dark` 并警告。2026-07-18 `bun run verify -- --ci` 全矩阵通过（124.2 秒）；PowerShell 7.6.3 下显式选择本地 Qwen 后，普通 `bun run verify` 的三类产物真实请求与 `Read` 工具调用全部通过（140.8 秒）。
- `bun run typecheck`、`bun run lint`、三条构建链的完整性检查、CLI 启动、模型请求和工具调用必须持续通过，不允许把已修复问题重新定义为长期允许失败的状态。
- Feature Flag 已统一登记在 `scripts/feature-policy.ts`，按稳定、实验、内部/部署专用三组提供机器可读的默认值、验收目标、依赖和冲突关系。默认构建当前只启用 20 个具有验收覆盖标识的稳定能力；实验与内部能力分别要求显式授权，未知 Flag、非法值、缺失依赖和冲突组合在开发或构建启动时直接失败。Bun bundle、Vite/Node bundle、standalone EXE 与 `bun run dev` 共用同一解析器，规则说明见 `FEATURE_FLAGS.md`。
- 工程结构防回归由 `provider-boundary`、`sdk-compat-boundary`、各已移除 Provider boundary、`main-boundary`、`repl-boundary`、`utility-modules-boundary`、`dependency-boundary` 和 `feature-flags` 等轻量脚本持续执行；它们共同约束 Provider 主路径、兼容层保留范围、巨石入口规模与依赖方向、workspace/依赖契约及 Feature Policy。2026-07-17 Windows x64 `bun run verify -- --ci` 完整验收通过，18/18 workspace、全部轻量边界、Bun bundle、Vite/Node bundle、standalone EXE、版本和启动冒烟均通过，总耗时 114.5 秒。

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
8. CLI 永远不得安装、升级、降级或替换自身；版本变更由包管理、发布系统或人工替换产物完成。项目不提供远程插件安装或自动更新；本地目录插件由用户维护文件并在重启后加载，或在当前会话显式执行 `/reload-plugins`，内置插件随 CLI 产物更新。
9. 模型能力必须在源码中显式硬编码；禁止启动时能力探测、运行时试探和名称模糊匹配。未知模型只能使用固定默认 Profile 并明确警告，不得动态猜测能力。
10. 项目不再维护远程 Plugin Marketplace、遥测/可观测性上报或 Anthropic 云服务接口；第三方网络能力只保留模型、微信、GitHub、搜索以及用户显式配置的 MCP、WebFetch 和 HTTP Hook 等独立功能。

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

GitHub Actions 在 `main` 分支 push、pull request 和手动触发时执行，使用 Node.js 22 与 Bun 1.3.14。CI 与本地共用 `scripts/verify.ts`：普通 `bun run verify` 保留本地 llama.cpp 的单轮模型请求和 `Read` 工具调用；`bun run verify -- --ci` 仅跳过这两项环境相关检查，不读取 `models.json`，其余步骤完全一致。2026-07-16 在 Windows x64 本地执行 CI 模式，三类适用产物全部通过，耗时 45.7 秒；GitHub 托管环境结果以首次 push 或 pull request 的实际运行记录为准。

### 5.4 模型诊断安全边界

本地诊断日志只记录请求 ID、Provider、模型、无凭据 endpoint、消息/字符/工具数量、Token 上限、TTFT、总耗时、Usage、停止原因、错误分类、HTTP 状态、错误码和 Provider 请求 ID。禁止把请求体、Headers、system/user Prompt、工具参数、工具返回值或原始错误对象传入诊断日志。`logForDebugging` 在最终写入前统一清理 Authorization、Bearer/Basic、API Key、OAuth/JWT、敏感 URL 参数和 URL 用户凭据，并截断超长内容；OpenAI 错误还会按本次请求实际使用的 API Key 和消息文本做精确替换。诊断内容只写本地调试输出，不接入远程遥测或可观测性后端。

`scripts/validation/model-diagnostics.ts` 使用固定伪 API Key、OAuth JWT、URL 凭据和唯一 Prompt 标记验证脱敏、endpoint 清理、错误截断及摘要输出，并已并入唯一的 `bun run verify` 流程。2026-07-16 使用本地 llama.cpp 完成 Bun bundle、Vite/Node bundle 和 Windows x64 EXE 的模型与 `Read` 工具全矩阵验证，新增脱敏检查同时通过，总耗时 66.0 秒；另以 `--debug-file` 执行真实请求，落盘得到请求开始、首 Token、成功三类结构化事件，Prompt 标记未写入日志。

### 5.5 轻量源码验证矩阵

| 脚本 | 纯函数边界 | 固定样例覆盖 |
| --- | --- | --- |
| `message-conversion.ts` | `anthropicMessagesToOpenAI` | system/user/assistant、thinking、tool use/result 顺序、图片 |
| `openai-stream.ts` | `adaptOpenAIStreamToAnthropic` | thinking/text/refusal、交错并行工具参数、尾部 Usage 与 reasoning/cache 明细、停止原因、异常断流和遗留协议拒绝 |
| `openai-errors.ts` | OpenAI-compatible 错误分类与结构守卫 | 鉴权/限流/上下文/模型/网络/协议分类、endpoint 与凭据脱敏、非流响应和 SSE chunk 结构 |
| `tool-permissions.ts` | 权限规则解析、序列化和通配匹配 | exact/prefix/wildcard、括号与反斜杠转义、命令边界、Bash 大小写敏感、PowerShell 大小写不敏感 |
| `shell-parsers.ts` | Bash 纯 TypeScript AST 解析与 PowerShell JSON AST 转换 | 管道、控制符、命令替换、转义分号、heredoc、cmdlet/路径/模块前缀、参数、变量、重定向 |
| `model-diagnostics.ts` | 日志脱敏和摘要纯函数 | API Key、OAuth/JWT、URL 凭据、Prompt、截断和安全诊断字段 |
| `themes.ts` | 本地主题解析、Palette 合并和注册表 | Dracula 固定样例、颜色格式、非法字段隔离、损坏 JSON、配置 ID、单一 Palette 来源和 base 回退 |
| `self-update-boundary.ts` | CLI 自更新禁用边界 | 禁止根级 install/update/rollback、安装器与更新器实现及配置字段，同时禁止恢复远程插件安装和自动更新；保留本地目录插件加载、手动重载和 standalone 构建 |
| `message-utils.ts` | 消息 ID、文本协议和谓词 | 稳定 UUID、XML Tag、文本块、Thinking、Tool Call 和 Compact Boundary |
| `session-transcript.ts` | Transcript 纯转换 | Entry/Chain 守卫、序列化字段清理、父链顺序与环检测、Agent/Teammate 投影 |
| `hook-protocol.ts` | Hook 输出协议和匹配 | exact/pipe/regex、非法正则、去重命名空间、Shell/HTTP JSON、blocking 聚合 |
| `utility-modules-boundary.ts` | 巨石文件拆分边界 | 薄入口、运行时只减不增、子模块规模、纯函数依赖方向和关键循环引用 |

每个脚本都可由 `bun run scripts/validation/<name>.ts` 独立运行；`scripts/verify.ts` 按固定清单逐项执行，项目不增加第二个总验证命令。PowerShell 轻量验证不启动 `pwsh`，只调用运行路径实际使用的 `transformPowerShellParseOutput` 纯转换边界，因此可在 Windows/Linux CI 中得到相同结果；外部 PowerShell 进程发现与启动不属于本组纯函数验证。新增消息、Transcript、Hook 协议与结构边界验证同样直接调用源码模块，不经过兼容入口。

2026-07-16 第二模型实测：显式选择 `deepseek-v4-flash` 后，单轮流式请求返回预期标记；随后仅开放并允许 `Read` 工具读取根目录 `package.json`，模型正确发起工具调用并返回版本 `2.1.116`。测试使用 `OPENAI_MAX_TOKENS=4096`，未记录 API Key 或完整 Prompt。本地功能基线已完成验收；跨平台 CI 仍以 GitHub 托管环境首次实际运行记录作为最终证据。

### 5.6 Workspace 验证契约

`scripts/verify-workspaces.ts` 从根 `package.json.workspaces` 自动发现子包，不维护固定名单。每个 workspace 必须提供可独立运行的 `typecheck` 及 `test`/`test:smoke`；存在发布、服务或部署产物时还必须提供 `build`，否则必须通过 `workspaceValidation.build.applicable=false` 和非空 `reason` 明确说明由根 CLI 构建链统一打包。源码直引内部包明确标记为无需独立构建，`acp-link`、`workflow-engine` 和 `remote-control-server` 分别执行实际构建。

轻量冒烟统一调用 `scripts/validation/workspace-smoke.ts`，不引入 `*.test.ts` 或测试框架：源码包导入公开入口；发布包检查并导入构建产物；`acp-link` 验证 CLI 帮助；Remote Control Server 使用临时本机端口验证 `/health`。验证器支持 `contract`、`typecheck`、`build`、`smoke` 和默认全流程模式，便于定位失败，但不形成第二个总验收层级。

2026-07-16 Windows x64 实测：18/18 workspace 契约、独立 TypeScript 和轻量冒烟全部通过，4/4 适用构建通过；`bun run verify -- --ci` 随后完成锁定安装、Biome、源码验证、workspace 全流程、Bun bundle、Vite/Node bundle 和 Windows standalone EXE 验证，总耗时 109.5 秒。普通模式同次执行到 Bun CLI 模型请求前的全部项目均通过，模型请求因本地 llama.cpp 的 `127.0.0.1:33350` 未监听而未在本次复验；此前记录的本地模型验收结论不变。

### 5.7 基线约束

- 全新环境可按文档完成安装、构建和启动。
- `bun run typecheck`、`bun run lint`、构建完整性检查和 CLI 冒烟检查全部通过。
- Bun 与 Node CLI 产物均能执行 `--version`；支持的平台上 standalone EXE 可以启动。
- CLI 帮助中不存在根级 `install`、`update` 或 `rollback`，源码边界检查禁止恢复任何自安装、自更新或自降级实现。
- 至少两个 OpenAI/OpenAI-compatible 模型完成流式对话与工具调用。
- 失败时能定位 Provider、模型注册与解析、鉴权或流解析阶段。

## 6. 后续开发路线图

### P0：第三方云接口收敛与遗留清理

状态：进行中。已完成的条目按实际验证结果标记，其余条目仍描述目标状态。

目标：移除不属于独立 OpenAI-compatible CLI 核心能力的远程市场、遥测和 Anthropic 云依赖，缩小发布包网络面、凭据面及供应链审计范围。

- [x] 移除远程 Plugin Marketplace 能力（2026-07-18 已删除官方 Marketplace CDN、GitHub 安装量统计、远程浏览/添加/安装命令与 UI、Git/HTTPS 克隆和缓存、启动安装、插件推荐、自动更新及旧 Marketplace 设置 Schema；MCPB 收敛为仅加载本地 `.mcpb`/`.dxt` 文件）。`/plugin` 现仅列出本地目录和内置 Plugin，并保留本地清单校验；`--plugin-dir`、Skill、Hook、插件 MCP/LSP 配置及内置 Plugin 加载链继续保留。新增 `plugin-distribution-boundary.ts` 与构建产物标记扫描，防止远程入口、域名和下载函数恢复；17 个 workspace 全流程及 `bun run verify --ci` 全部通过，最终完整验证用时 109.5 秒。
- [x] 移除全部遥测和可观测性上报（2026-07-18 已移除 Anthropic 1P Event Logging、BigQuery Metrics、GrowthBook 远程配置、Sentry、Datadog、Langfuse、OpenTelemetry OTLP、Beta Tracing 与本地 Perfetto 上报链；运行 Feature Flag 固化到 `scripts/feature-policy.ts`，支持 `CLAUDE_LOCAL_FEATURE_OVERRIDES` 和 `localFeatureOverrides` 显式本地覆盖。已删除相关 SDK、初始化/刷新、Provider 状态、缓存、失败队列、环境变量、退出 flush 和纯遥测启动扫描，并新增 `observability-boundary.ts` 防止依赖、环境变量和实现入口恢复；17 个 workspace、三类构建产物及 `bun run verify --ci` 全部通过，最终完整验证用时 126.6 秒）。
- [x] 停止读取和写入 `~/.claude/telemetry` 中只服务于旧上报链的失败队列与缓存（2026-07-18 已随 exporter、instrumentation 和事件 logger 删除完成；未自动删除用户已有文件，用户可自行清理历史目录）。
- [x] 移除全部 Anthropic 云服务接口（2026-07-18 已删除事件日志、指标与组织开关、Feedback/Transcript Share、Public Files API、Claude Remote Control/Bridge、Remote Trigger、Trusted Device、Claude OAuth/API Key/角色接口，以及依赖 Claude 账号的推送、附件、SSH 凭据转发和桌面云端交接链路；同时移除会话分享专用的完整请求与分类器快照保留）。本地 Chrome 仅保留 Native Messaging，自托管 RCS 改为显式 `CLAUDE_CODE_RCS_AUTH_TOKEN`，ACP 使用部署方提供的 RCS URL/Token 与本地 OpenAI-compatible Provider 配置，三者均不读取 Anthropic 域名、Claude OAuth 或服务端下发凭据。新增并接入 `anthropic-boundary.ts`，分别扫描主源码和自托管 RCS/ACP 边界；Chrome 本地注册改为显式执行，不再由依赖安装修改或校验用户注册表。17 个 workspace、全部源码边界、Bun/Node 构建、bundle 完整性和 Windows standalone EXE 均通过，最终 `bun run verify --ci` 用时 110.8 秒。
- [x] 移除第三方 `mcp-chrome`（2026-07-19 已删除普通启动时硬编码的 `127.0.0.1:12306/mcp` 服务、固定 Bearer Token、默认禁用名单、`@claude-code-best/mcp-chrome-bridge` 生产依赖、发布安装脚本和 CI 遗留开关）。通用 MCP 客户端、用户显式配置的浏览器 MCP 以及条件启用的本地 `claude-in-chrome` 保持不变；`dependency-boundary.ts` 防止默认服务、依赖和发布脚本恢复。17 个 workspace、全部轻量边界、Bun bundle、Vite/Node bundle、Windows standalone EXE、版本和启动冒烟均通过，最终 `bun run verify -- --ci` 用时 113.9 秒。
- [ ] 删除无调用入口或已失效的接口实现：ChatGPT `auth.openai.com`/`chatgpt.com/backend-api/codex/responses`、Anthropic 官方 MCP Registry 预取、旧国内模型供应商引导表、内部 GitHub Webhook/KAIROS 分支，以及与已移除云接口绑定的常量、设置项、Feature Flag、UI、命令和依赖。
- [ ] 增加第三方接口边界验证，扫描禁止域名、禁止 SDK、禁止环境变量和孤立网络调用；默认构建中出现 `api.anthropic.com`、`claude.ai` 云 API、Sentry/Datadog/Langfuse/OTLP 或远程 Marketplace 调用时直接失败。文档链接若确需保留，必须与运行时网络请求白名单分开维护。
- [ ] 更新 README、依赖审计、Feature Policy、帮助文本、配置 Schema、环境变量说明和三类构建完整性检查，确保删除后的产物不再宣传或暗示上述云能力。

验收标准：

- `bun run verify -- --ci` 和普通 `bun run verify` 全部通过，OpenAI-compatible 模型、微信、GitHub、搜索、本地 Plugin、用户配置 MCP/WebFetch/HTTP Hook 及保留的自托管 RCS/ACP 能力不回归。
- 三类构建产物不包含已禁止的域名、接口路径、客户端初始化代码或仅服务于这些能力的生产依赖；启动和退出阶段不产生遥测、Feature Flag 拉取、远程 Marketplace 或 Anthropic 云请求。
- 未设置任何环境变量时，除显式模型请求和用户主动调用的保留工具外，CLI 不主动连接第三方服务。
- 删除远程 Marketplace、遥测或 Anthropic 账号配置后，旧设置必须被安全忽略并给出一次性迁移说明，不得导致启动失败或泄露旧 Token。

### P0：权限、Sandbox 和 Worktree 安全

目标：优先补齐最新版最重要的安全差异。

- [x] 审计 Bash、PowerShell 命令解析与权限分类（2026-07-19 完成源码级审计）。两条主链均遵循显式 deny 优先、无法解析时转人工审批、复杂结构不自动放行的总体方向；PowerShell 使用原生 AST，并对解析失败、动态命令名、别名/模块前缀、Unicode 参数前缀、脚本块、子表达式、Splatting、`--%`、Provider/UNC、嵌套 PowerShell、`Start-Process`、WMI/CIM、模块加载和路径变化做了专项处理。Bash 已有 Tree-sitter AST、语义检查、子命令 fanout 上限和遗留正则防线，但默认构建中 `TREE_SITTER_BASH` 仍属实验能力，实际权威路径仍是 `shell-quote`、字符串拆分和正则组合；`CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK` 还能关闭关键误解析检查。现有 `shell-parsers.ts` 与 `tool-permissions.ts` 只验证解析片段和规则匹配，没有调用完整 `bashToolHasPermission`/`powershellToolHasPermission` 决策链。危险 Git、文件删除、数据库和基础设施命令的多数识别当前只生成审批 UI 警告，不构成独立于 allow 规则和模式的权限约束。
- [ ] 将 Bash Tree-sitter 权威解析路径升为稳定默认能力：先补齐与真实 Bash/Git Bash 的差分样例，覆盖解析不可用、超长、超时、节点预算、未知 AST 节点和语义拒绝；任何无法证明为简单命令的输入必须返回 `ask`，不得回落到更宽松的自动允许路径。升为稳定后删除仅用于 Shadow/GrowthBook 的分支和重复遗留解析层，保留最小故障兜底。
- [ ] 收紧 `CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK`：默认和发布构建不得允许普通环境变量关闭命令注入防线；若保留诊断开关，只能让命令统一降级为 `ask`，不得跳过 AST、误解析、路径、重定向或子命令 deny 检查。
- [ ] 将危险操作从“UI 提示”提升为权限分类约束。至少覆盖 `git reset --hard`、`git clean -f/-fd/-fdx`、`git checkout/restore -- .`、`git stash drop/clear`、`git branch -D`、强制 push、危险 `rm`/`Remove-Item`、`Clear-Disk`、`Format-Volume`、`terraform destroy`、`kubectl delete` 和无条件数据库删除；规则必须基于解析后的命令与参数，而不是仅靠展示层正则。涉及用户未明确授权的数据丢失、远端历史覆盖或系统级破坏时，即使存在宽泛 allow 规则也必须重新审批；系统根目录、用户主目录和关键配置路径继续保持硬拒绝或不可持久化审批。
- [ ] 统一 Bash 与 PowerShell 的决策优先级为：硬安全拒绝 > 显式 deny > 不可绕过安全审批 > 显式 ask > 精确 allow > 受约束的模式/只读自动允许 > 默认 ask。复核整条命令、每个管道段、控制流/嵌套命令、包装器解包、别名/模块限定名、路径型可执行文件和解析失败降级分支，确保前序 `ask`/`allow` 不会遮蔽后续 deny，工具级 `Bash(*)`/`PowerShell(*)` 不会覆盖硬安全结果。
- [ ] 在 `scripts/validation` 增加完整权限决策脚本，直接调用 `bashToolHasPermission` 和 `powershellToolHasPermission`，使用固定 `ToolUseContext`、规则集合、cwd 和预期 `allow`/`ask`/`deny` 判定，不引入测试框架。Bash 样例覆盖包装器、管道/控制符、命令/进程替换、变量、`eval`/`source`/嵌套 shell、heredoc、重定向、控制字符、Unicode、超过 50 个子命令、cwd 变化和符号链接；PowerShell 样例覆盖别名和模块前缀、动态调用、EncodedCommand、`Invoke-Expression`、`Start-Process`、脚本块、Splatting、Provider/UNC、Unicode dash、`--%`、变量路径、cwd 变化和链接创建。Linux 无 PowerShell 时必须验证解析失败安全降级，Windows CI 额外执行真实 PowerShell 5.1/7 AST 判定。
- [ ] 增加 `sandbox.credentials`：阻止读取常见凭据文件和秘密环境变量。
- [ ] 支持 `Tool(param:value)` 权限规则及通配符。
- [ ] 验证 Worktree Agent 无法修改主工作区。
- [ ] 验证符号链接、目录切换、后台命令不会绕过写入边界。
- [ ] 跨 Session 消息默认不继承用户权限。
- [ ] 对未知或无效权限规则启动时告警。

验收标准：

- 默认构建的 Bash 权限判定使用已验收的 AST 路径；解析器不可用、被攻击性输入耗尽预算或遇到未知结构时只能拒绝自动允许，不存在关闭注入检查后扩大权限的环境变量路径。
- Bash 与 PowerShell 的固定恶意样例矩阵逐项证明 deny 优先、危险操作不可被宽泛规则静默放行、路径/重定向/嵌套命令无法绕过分类；Windows 同时验证 PowerShell 5.1 和 PowerShell 7 的真实 AST，跨平台 CI 验证无 PowerShell 时的安全降级。
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
- [ ] 为本地目录和内置 Plugin 增加依赖检查、最低版本约束、prune 和动态重载；不恢复远程 Marketplace、下载、安装量或自动更新接口。
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

- [ ] 验收内置 `claude-in-chrome`：确认 `--chrome`、`CLAUDE_CODE_ENABLE_CFC=true` 和 `claudeInChromeDefaultEnabled` 三种显式入口能够在重启后加载同一套进程内 MCP；Chrome Native Messaging Host 与扩展连接成功，`/mcp` 正确显示 `claude-in-chrome` 状态，并至少完成标签页上下文读取、页面导航、点击、输入、截图和控制台日志读取。扩展未安装、Native Host 注册失败或连接断开时必须给出可定位错误并安全退出或降级，未启用时不得注册 Host、启动 MCP 或产生浏览器副作用。Bun bundle、Vite/Node bundle 和 Windows standalone EXE 均需通过启用/禁用启动冒烟；不得恢复已移除的第三方 `mcp-chrome`、固定本地 HTTP 地址或 Bridge 依赖。
- [ ] VS Code 插件：提供会话交互、代码上下文传递、Diff 预览与权限确认，并通过稳定的公开协议连接 CLI，避免与编辑器进程内实现强耦合。

## 7. 推荐实施顺序

建议按照以下顺序推进，每一阶段完成验收后再进入下一阶段：

1. 第三方云接口收敛：先固化远程 Feature Flag，再移除远程 Marketplace、遥测、Anthropic 云接口和无调用入口残留。
2. 核心巨石文件和 workspace 工程结构治理。
3. 权限、Sandbox、Worktree 安全。
4. Safe Mode、Doctor、会话迁移。
5. Agent 和后台任务状态统一。
6. Hook、Plugin、Skill、MCP 本地扩展协议。
7. 性能优化及可选产品能力。

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
