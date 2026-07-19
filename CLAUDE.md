# Claude Code

基于 Claude Code CLI 的定制 fork，一个在终端中运行的交互式 AI 编程助手。

## 技术栈

- **运行时**: Bun ≥1.3.0（主要）、Node.js ≥22（次要）
- **语言**: TypeScript 6 + TSX（React JSX）
- **UI 框架**: React 19 + Ink（终端 React 渲染器）
- **构建工具**: Bun.build（主要）、Vite 8（次要/Node.js 构建）
- **代码质量**: Biome 2（linter + formatter），统一由 `bun run verify` 和 CI 执行
- **包管理**: Bun workspace monorepo

## Windows Shell 约定

- 在 Windows 上优先使用 PowerShell 工具执行 `git`、`bun`、`npm`、构建和其他终端命令。
- 除非任务明确依赖 POSIX Shell、`.sh` 脚本或 Git Bash，否则不要使用 Bash 工具。
- 工具已经位于正确的项目工作目录，不要在命令前添加 `cd` 或 `Set-Location`。
- 必须使用 Bash 时，Windows 路径 `C:\dev\claude-code` 在 Git Bash 中应写为 `/c/dev/claude-code`，在 WSL 中应写为 `/mnt/c/dev/claude-code`；不得写成 `/dev/claude-code`。
- PowerShell 命令使用 Windows 路径和 PowerShell 语法，不要混用 Bash 的环境变量、重定向或路径写法。

## Monorepo 工作空间

```yaml
# 自定义包（在 packages/ 下）
@claude-code-best/agent-tools:  子代理工具（Explore/Plan/Verification 等）
@claude-code-best/builtin-tools: 内置工具（Read、Write、Bash、Glob、Grep 等）
@claude-code-best/mcp-client:    MCP（Model Context Protocol）客户端
@claude-code-best/weixin:        微信集成
@claude-code-best/workflow-engine: 工作流编排引擎

# Ant 包（在 packages/@ant/ 下）
@ant/*:          Ant 相关工具（Chrome MCP、Computer Use 等）

# Anthropic 包（外部 npm 依赖）
@anthropic-ai/*: Anthropic SDK 和工具（外部 npm 依赖，非本地包）
```

## 构建系统

### 入口点

- `src/entrypoints/cli.tsx` — 主入口，包含多个快速路径：
  - `--version`：立即输出版本号，零模块加载
  - `--dump-system-prompt`：输出渲染后的系统提示
  - `--acp`：ACP（Agent Client Protocol）代理模式
  - `weixin`：微信 CLI 模式
  - `--daemon-worker`：守护进程 worker 模式
  - `remote-control` / `rc`：远程控制/Bridge 模式
  - `daemon`：守护进程管理（start/stop/status/bg/attach/logs/kill）
  - `autonomy`：自治状态查询
  - `--bg` / `--background`：后台会话快捷方式
  - `job`：模板任务
  - `--claude-in-chrome-mcp` / `--chrome-native-host`：Chrome 集成
  - `--computer-use-mcp`：Computer Use MCP 服务
  - `--worktree --tmux`：工作区 tmux 模式
  - `--update` / `--upgrade`：更新子命令
  - `--bare`：简约模式
  - 普通路径 → `src/main.tsx`（完整 CLI 启动）

### 构建产物

| 产物 | 命令 | 运行方式 |
|------|------|----------|
| `dist/cli-bun.js` | `bun run build:bun` | `bun dist/cli-bun.js` |
| `dist/cli-node.js` | `bun run build:vite` | `node dist/cli-node.js` |
| `dist/ccb.exe` | `bun run build:exe` | Windows 独立可执行文件 |

### 构建流程（`build.ts`）

1. 清理 `dist/` 目录
2. 用 `Bun.build` 打包（splitting、sourcemap、define）
3. 后处理——兼容 Node.js 的 `import.meta.require` 替换
4. 复制 vendored ripgrep 二进制文件
5. 生成 cli-bun.js / cli-node.js 入口

## 关键子系统

### MACRO 编译时注入

`MACRO.*` 在构建时通过 `-d` 标志注入，运行时不可变。定义在 `scripts/defines.ts` 中：
- `MACRO.VERSION` — 来自 package.json
- `MACRO.BUILD_TIME` — 构建时间戳
- `MACRO.ISSUES_EXPLAINER`、`MACRO.PACKAGE_URL` 等

### Feature Flags（编译时条件编译）

使用 `bun:bundle` 的 `feature()` 函数实现构建时死代码消除。Flag 定义在 `scripts/feature-policy.ts` 的 `FEATURE_POLICY` 中，按层级（tier）分为三类：

- **`stable`**：默认启用。可在环境变量 `FEATURE_<NAME>=0` 时关闭。
- **`experimental`**：默认关闭。需 `FEATURE_<NAME>=1` + `ALLOW_EXPERIMENTAL_FEATURES=1` 启用。
- **`internal`**：内部功能。需 `FEATURE_<NAME>=1` + `ALLOW_INTERNAL_FEATURES=1` 启用。

**Stable（默认启用）：**
- `ACP` — Agent Client Protocol
- `AGENT_TRIGGERS` — 本地 Agent 触发器
- `AUTOFIX_PR` — 自动修复 PR
- `AWAY_SUMMARY` — 离开摘要
- `BG_SESSIONS` — 后台会话
- `BUDDY` — 陪伴宠物
- `BUILTIN_EXPLORE_PLAN_AGENTS` — 内置 Explore/Plan 子代理
- `COMMIT_ATTRIBUTION` — Git 提交归属追踪
- `CONNECTOR_TEXT` — 消息转换
- `DIRECT_CONNECT` — 直连模式
- `GOAL` — 持久化线程目标系统
- `MONITOR_TOOL` — Monitor 工具
- `PROMPT_CACHE_BREAK_DETECTION` — 提示缓存断裂检测
- `SSH_REMOTE` — SSH 远程控制
- `TEMPLATES` — 模板任务
- `TOKEN_BUDGET` — Token 预算
- `TRANSCRIPT_CLASSIFIER` — 转录分类
- `ULTRATHINK` — 超深度思考模式
- `WORKFLOW_SCRIPTS` — 工作流脚本

**Stable（默认关闭）：**
- `AUTO_THEME` — 自动主题

**Experimental：**
- `ABLATION_BASELINE`, `AGENT_MEMORY_SNAPSHOT`, `BASH_CLASSIFIER`, `BREAK_CACHE_COMMAND`, `CACHED_MICROCOMPACT`, `COMPACTION_REMINDERS`, `CONTEXT_COLLAPSE`, `ENHANCED_TELEMETRY_BETA`, `EXPERIMENTAL_SEARCH_EXTRA_TOOLS`, `EXPERIMENTAL_SKILL_SEARCH`, `EXTRACT_MEMORIES`, `FORK_SUBAGENT`, `HISTORY_PICKER`, `HISTORY_SNIP`, `HOOK_PROMPTS`, `LODESTONE`, `MCP_RICH_OUTPUT`, `MCP_SKILLS`, `MESSAGE_ACTIONS`, `NATIVE_CLIPBOARD_IMAGE`, `NEW_INIT`, `POOR`, `POWERSHELL_AUTO_MODE`, `PROACTIVE`, `QUICK_SEARCH`, `REACTIVE_COMPACT`, `RUN_SKILL_GENERATOR`, `SKILL_IMPROVEMENT`, `SKILL_LEARNING`, `STREAMLINED_OUTPUT`, `TEAMMEM`, `TERMINAL_PANEL`, `TORCH`, `TREE_SITTER_BASH`, `ULTRAPLAN`, `UNATTENDED_RETRY`, `VERIFICATION_AGENT`, `WEB_BROWSER_TOOL`

**Internal（需特殊标记）：**
- `CHICAGO_MCP`, `COORDINATOR_MODE`, `COWORKER_TYPE_TELEMETRY`, `DAEMON`, `DUMP_SYSTEM_PROMPT`, `HARD_FAIL`, `IS_LIBC_GLIBC`, `IS_LIBC_MUSL`, `KAIROS`, `KAIROS_BRIEF`, `KAIROS_CHANNELS`, `LAN_PIPES`, `MEMORY_SHAPE_TELEMETRY`, `PERFETTO_TRACING`, `PIPE_IPC`, `SHOT_STATS`, `SLOW_OPERATION_LOGGING`, `UDS_INBOX` 等

额外功能可通过环境变量 `FEATURE_<NAME>=1` 启用，同时需设置对应的 `ALLOW_EXPERIMENTAL_FEATURES=1` 或 `ALLOW_INTERNAL_FEATURES=1`。

### 命令行模式

- **交互式 REPL**：默认模式，Ink TUI
- **Bridge/远程控制**：`claude remote-control`
- **守护进程**：`claude daemon bg/status/attach/logs/kill`
- **ACP 代理**：`claude --acp`
- **微信**：`claude weixin`
- **模板任务**：`claude job new/list/reply`
- **自治管理**：`claude autonomy`

### 验证管道（`scripts/verify.ts`）

运行顺序：
1. `bun install --frozen-lockfile`
2. `bun run typecheck`（tsc --noEmit）
3. `bun run lint`（Biome）
4. 源验证脚本
5. Bun 构建 + 完整性检查
6. 对 Bun 产物进行冒烟测试（版本、启动、模型请求、Read 工具）
7. 对 Node.js 产物重复上述操作
8. Windows 上额外构建并验证 EXE

### 模型配置

配置文件 `models.example.json` 示例：
- 默认：本地 llama.cpp（Qwen3.5-9B-Q6_K，localhost:8080）
- 可选：DeepSeek Chat API

通过 `src/utils/model/modelRegistry.ts` 解析。

## 开发命令

```bash
bun run dev              # 启动开发服务器（注入 MACRO defines）
bun run dev:inspect      # 带调试器的开发模式
bun run build:bun        # 构建 Bun 产物
bun run build:vite       # 构建 Vite/Node 产物
bun run build:exe        # 构建 Windows 独立 EXE
bun run typecheck        # TypeScript 类型检查
bun run lint             # Biome 代码检查
bun run check:fix        # Biome 自动修复
bun run verify           # 完整验证管道（构建 + 类型 + lint + 冒烟测试）
bun run verify -- --ci   # CI 模式（跳过本地模型调用）
```

## 代码规范

- **缩进**：2 空格
- **引号**：单引号（JS）、JSX 属性双引号
- **分号**：`.ts/.js` 按需添加，`.tsx` 始终添加
- **尾逗号**：全部添加
- **行宽**：80（普通文件）、120（`.tsx`）
- **箭头函数参数**：尽可能省略括号
- Biome 配置关闭了许多严格规则（noExplicitAny、noForEach、noUnusedVariables 等）

## 项目结构

```
claude-code/
├── src/
│   ├── entrypoints/cli.tsx   # 入口
│   ├── main.tsx              # CLI 主启动
│   ├── bridge/               # 远程控制/Bridge
│   ├── cli/                  # CLI 处理器
│   ├── constants/            # 常量（提示、OAuth 等）
│   ├── daemon/               # 守护进程
│   ├── services/             # 服务层（API、MCP 等）
│   ├── utils/                # 工具函数
│   └── ...
├── packages/                 # 工作空间包
│   ├── @claude-code-best/    # 自定义包
│   └── @ant/                 # Ant 工具包
├── scripts/                  # 构建/开发/验证脚本
│   ├── defines.ts            # MACRO 定义
│   ├── feature-policy.ts     # Feature Flag 策略
│   ├── dev.ts                # 开发服务器
│   ├── build.ts              # 构建脚本
│   ├── verify.ts             # 验证管道
│   └── validation/           # 源验证脚本
├── models.example.json       # 模型配置示例
├── biome.json                # Biome 配置
└── tsconfig.json             # TypeScript 配置
```
