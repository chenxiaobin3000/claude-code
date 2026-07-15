# Claude Code

> 一个基于 TypeScript、React/Ink 与 Bun 构建的 Claude Code CLI 逆向重构及增强项目。

本项目已经不只是终端聊天工具，而是一套面向 AI 编程助手的综合平台。它覆盖交互式 CLI、模型请求、工具调用、Agent 编排、MCP、插件与 Skill、会话管理、远程控制以及多模型供应商适配等能力。

## 项目概况

- 根包版本：`2.8.3`
- 运行环境：Bun `>=1.3.0`，当前开发配置为 Bun `1.3.13`、Node.js `22.22.2`
- 语言与框架：TypeScript、React 19、Ink
- 仓库结构：Bun workspaces monorepo
- Workspace 子包：18 个
- 代码规模：约 2,777 个代码文件、56.7 万行代码
- CLI 命令：`ccb`、`ccb-bun`、`claude-code-best`

## 核心能力

### 交互与会话

- 基于 React/Ink 的终端 REPL
- 流式模型响应与终端渲染
- 会话保存、恢复、压缩和历史记录
- 上下文预算、长期记忆与提示词管理
- 后台会话、任务和持久化 Goal

### 工具系统

- 文件读取、写入、编辑和搜索
- Bash、PowerShell 与终端捕获
- Glob、Grep、LSP 和 Notebook 编辑
- Tool Search 与动态工具发现
- 工具权限检查、Hook 和执行结果回填

### Agent 与工作流

- Agent、子 Agent、Team 和 Coordinator 模式
- 多任务编排与后台 Worker
- 可重放的确定性工作流引擎
- `phase()`、`parallel()`、`pipeline()` 等工作流原语
- Agent 消息、任务状态和进度管理

### 扩展与集成

- MCP 客户端、资源读取、工具调用与 OAuth
- 插件、Skill、Marketplace 和动态加载
- Remote Control、WebSocket、SSE 与 SSH
- Chrome/Computer Use 和微信扩展
- HTML 制品上传与远程访问

### 模型供应商

项目保留 Anthropic SDK 的消息、工具和流事件类型作为本地内部协议，但不提供 Anthropic 账号登录，也不默认连接 Anthropic API。模型运行时固定使用 OpenAI-compatible 协议：

- OpenAI 及 OpenAI 兼容接口（默认）

OpenAI 运行配置：

```bash
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

Provider 固定使用 OpenAI-compatible 路径，不再通过 `CLAUDE_CODE_USE_*` 环境变量选择厂商。Gemini 与 Grok 的专用 Provider、环境变量和模型映射已经移除；通用 OpenAI-compatible 自定义接口仍然保留。`/login`、`/logout`、`claude auth` 和 `setup-token` 已移除；MCP Server 自己的 OAuth 不受影响。

## 运行架构

主要执行链路如下：

```text
CLI 入口
  -> 参数解析与环境初始化
  -> 加载本地 Provider 配置、插件、Skill 和 MCP
  -> 启动 Ink/React REPL
  -> 构造模型请求与会话上下文
  -> 流式接收模型响应
  -> 识别和调度工具调用
  -> 权限检查、Hook 与工具执行
  -> 将结果写回会话并更新终端界面
```

关键文件：

- `src/entrypoints/cli.tsx`：最早的 CLI 入口
- `src/main.tsx`：主初始化流程、参数注册和运行模式分发
- `src/screens/REPL.tsx`：交互式终端主界面
- `src/query.ts`：模型查询、流式响应和工具调用循环
- `src/tools.ts`：工具集合与默认工具预设
- `src/services/tools/`：工具编排和流式工具执行
- `src/services/api/`：模型 API 和请求处理
- `src/services/mcp/`：MCP 客户端、认证和资源管理
- `scripts/defines.ts`：编译期 Feature Flag 定义

## 目录结构

```text
.
|-- src/
|   |-- entrypoints/       # CLI、MCP 和 SDK 入口
|   |-- screens/           # Ink 终端界面
|   |-- components/        # UI 组件
|   |-- services/          # API、MCP、插件、记忆、分析等服务
|   |-- commands/          # CLI 与斜杠命令
|   |-- coordinator/       # 多 Worker 编排
|   |-- workflow/          # 工作流集成
|   |-- bridge/            # 远程控制桥接
|   |-- utils/             # 权限、会话、Shell、模型等基础模块
|-- packages/
|   |-- builtin-tools/     # 内置工具实现
|   |-- agent-tools/       # Agent 工具
|   |-- mcp-client/        # MCP 客户端包
|   |-- workflow-engine/   # 确定性工作流引擎
|   |-- remote-control-server/
|   |-- weixin/            # 微信集成
|   |-- cloud-artifacts/   # 云端制品服务
|   `-- @ant/              # Ink、模型供应商和 Computer Use 等包
|-- scripts/               # 构建、开发、检查与发布脚本
|-- spec/                  # 功能设计和实施规格
|-- build.ts               # Bun 构建入口
|-- vite.config.ts         # Node/Vite 生产构建配置
`-- package.json
```

## 安装与开发

项目使用 Bun，并通过 `bun.lock` 锁定依赖。

```bash
bun install
```

常用命令：

```bash
# 开发模式
bun run dev

# Bun 构建
bun run build

# Windows standalone EXE（目标机器不需要 Node.js 或 Bun）
bun run build:exe

# Vite/Node 生产构建
bun run build:vite

# TypeScript 检查
bun run typecheck

# Biome 检查
bun run check

# 完整健康检查
bun run health
```

构建完成后，CLI 入口位于：

```text
dist/cli-bun.js
dist/cli-node.js
```

## 构建说明

项目保留三条构建路径：

1. `build.ts` 使用 `Bun.build`，面向 Bun 运行时。
2. `vite.config.ts` 使用 Vite/Rollup 生成 Node.js 兼容产物。
3. `scripts/build-exe.ts` 使用 Bun compile 生成 `dist/ccb.exe`，其中包含 Bun Runtime，运行时不依赖本机 Node.js 或 Bun。

Bun 构建会对生成代码进行兼容性处理，包括替换 `import.meta.require`，以及保护对 `globalThis.Bun` 的直接访问。修改构建流程时，应同时验证 Bun 和 Node 两种产物。

项目还通过编译期 Feature Flag 控制大量可选能力。默认功能定义在 `scripts/defines.ts`，额外功能可通过 `FEATURE_<NAME>=1` 环境变量加入构建。

## 当前验证状态

本 README 基于当前工作区的静态分析生成。当前源码快照存在以下限制：

- 没有根级 `LICENSE` 和 CI 工作流。
- 当前没有已生成的 `dist` 目录。
- 当前未安装 `node_modules`，需要先恢复依赖才能构建。

建议在干净依赖环境中重新执行：

```bash
bun install
bun run typecheck
bun run check
```

## 工程现状

### 优点

- TypeScript 开启严格模式。
- 工具、MCP、Agent 和工作流已经拆分为独立 workspace 包。
- 工作流引擎强调确定性、端口隔离和可回放。
- 提供 Biome、Knip、TypeScript、产物完整性和健康检查工具。
- 同时支持 Bun 与 Node.js CLI 入口。

### 主要风险

#### 核心文件过大

部分模块已经承担过多职责：

- `src/screens/REPL.tsx`：约 299 KB
- `src/main.tsx`：约 247 KB
- `src/cli/print.ts`：约 223 KB
- `src/utils/messages.ts`：约 214 KB
- `src/utils/sessionStorage.ts`：约 187 KB
- `src/utils/hooks.ts`：约 168 KB

这些文件的修改影响面较大，建议逐步按启动阶段、运行模式、协议和领域职责拆分。

#### 双构建链可能发生行为漂移

Bun 与 Vite/Rollup 的依赖处理和代码转换逻辑不同，需要避免两种构建产物发生行为漂移。

#### Feature Flag 组合复杂

默认启用的功能数量较多，部分实验能力与稳定能力混在同一个编译列表中。建议将 Feature Flag 分为稳定、实验和部署专用三层，并增加组合合法性检查。

#### 安全审计范围较大

项目同时拥有 Shell、文件写入、远程控制、SSH、插件动态加载、MCP/OAuth 和公开制品上传能力。正式部署前应重点审计：

- Shell 和文件权限边界
- 插件与 Skill 的信任链
- 远程控制认证和令牌生命周期
- 日志、会话与遥测中的敏感信息
- MCP 服务权限
- HTML 制品的访问与过期策略

## 建议的改进顺序

1. 完善根级许可证和 CI。
2. 在干净环境中恢复可复现安装，并跑通静态检查。
3. 优先拆分 `main.tsx`、`REPL.tsx`、`messages.ts` 和 `sessionStorage.ts`。
4. 统一 Bun/Node 两种构建产物的兼容策略。
5. 对 Feature Flag 进行分层和组合约束。
6. 对远程控制、插件加载、Shell 权限和制品服务进行专项安全审计。

## 总结

该项目功能完整度很高，已经具备 AI 编程助手平台的雏形。它拥有较扎实的类型和模块化基础，但核心代码复杂度、构建分叉、Feature Flag 数量以及安全攻击面都已经超过普通 CLI 项目的范围。

当前阶段最重要的工作不是继续堆叠功能，而是恢复可复现构建、降低核心模块耦合、完善项目文档与 CI，并明确发布和安全边界。
