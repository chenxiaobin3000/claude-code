# Node.js 运行时边界

本文件记录当前 Node.js 运行时边界。目标不是禁止 `node:` 标准库名称或 Node 兼容类型，而是防止脚本、CI、发布入口或生产产物重新引入外部 Node.js 可执行文件要求。

## 分类规则

| 分类 | 判定 | 迁移策略 |
| --- | --- | --- |
| 外部运行时 | 脚本、CI、Shebang 或子进程会启动 `node`、`node.exe`、`npm` 或 `npx` | 禁止进入项目必需流程 |
| Node 分发契约 | 产物明确面向 Node.js，或 package `engines`/`bin` 要求 Node | 禁止作为项目发布入口 |
| Bun 兼容 API | Bun 中运行的代码导入 `node:fs`、`node:path`、`node:crypto` 等兼容 API | 不要求机械改写；以 Bun 验收结果为准 |
| 类型与名称 | `NodeJS.*`、`@types/node`、TS `types: ["node"]`，或 AWS/Smithy 包名中包含 `node` | 只有运行时证据证明需要外部 Node 时才清理 |
| 用户工具内容 | 权限解析器、提示词和 MCP 配置示例中出现 `node`/`npx` | 不属于项目运行时；保留其安全识别能力 |

## 当前外部运行时和分发清单

当前清单为空。Linux、Windows CI 均只配置 `oven-sh/setup-bun` 安装固定的 Bun 1.3.14，不再执行 `actions/setup-node`，项目脚本、workspace、发布入口和生产产物也不要求外部 Node.js、npm 或 npx。Windows 是当前真实发行验收平台；Linux 保留相同 CI 矩阵并按发布或平台需求执行。

根发行链已删除 Vite/Rollup Node Bundle、`dist/cli-node.js`、Node Shebang及其专用补丁。根包所有 `bin` 均指向 `dist/cli-bun.js`，`prepublishOnly` 使用 Bun bundle 并执行完整性检查，`packageManager` 固定声明 Bun；兼容 npm registry 只代表分发渠道，不再提供 Node 启动契约。生产 `build:production`、`claude.exe` 和独立 Plugin Host 由 Bun standalone 生成，目标机器不依赖 Node.js。

根命令不直接调用 Node/npm-family：依赖安装使用 `bun scripts/postinstall.cjs`，脚本 Shebang 统一为 Bun；文档预览使用 `bunx --bun mintlify dev`。Mintlify 是按需下载的非核心文档工具，不进入项目依赖或生产产物。

`@claude-code/workflow-engine` 的对外运行契约为 Bun，并用源码、TypeScript 编译产物和 Bun standalone 三形态 Fixture 验证 Workflow 的 Agent Adapter、Journal、恢复和进度事件一致。源码继续使用 Bun 已兼容的 `node:fs`、`node:path`、`node:crypto` API，不会启动外部 Node.js。

`acp-link` 的 HTTP/HTTPS、WebSocket、Manager 和 ACP 子进程桥接使用 Bun 原生实现，不包含 Node Server Adapter、Node Shebang 或 Node engine 契约。独立运行时 Fixture 验证鉴权、消息上限、JSON-RPC、ACP 会话与权限回传、Manager 和 TLS；RCS 与多实例管理语义保持不变。

workspace 元数据和直接依赖已经收敛。主 CLI 的两套 WebSocket Transport 只使用 Bun 原生实现，不再动态加载 `ws`；根包不直接声明 `ws`、`@types/ws`、`@aws-sdk/credential-provider-node` 或 `@smithy/node-http-handler`。QQ 与企业微信 Plugin 因真实 Gateway 协议继续各自声明 `ws` 和 `@types/ws`。`@types/node` 仍被 `NodeJS.ProcessEnv`、Stream、Timeout、错误码等兼容类型广泛使用，因此作为编译期依赖保留；`openai` 可选 Peer 在锁文件中带入的 AWS/Smithy 传递包不会启动外部 Node.js。`scripts/validation/bun-websocket-runtime.ts` 通过真实回环服务验证 CLI 与 MCP 的 Bun 原生 WebSocket 连接、发送、接收和关闭。

CI 不安装 Node，并把 Bun-only PATH 固化到唯一的 `bun run verify`。验证入口会删除任何包含 `node`、`node.exe`、`npm` 或 `npx` 的 PATH 目录，确认这些命令均不可解析，再让冻结安装、开发入口、全部 workspace、TypeScript、Biome、Fixture、Bundle、standalone EXE 和所有 Plugin Host 子进程继承同一 PATH。`scripts/validation/bun-only-path.ts` 使用固定危险/安全目录验证过滤、环境变量归一化和当前平台命令不可达性。

## 非 Node 运行时依赖

以下内容不得仅因名称中出现 `node` 而删除：

- Bun 支持的 `node:` 文件、路径、加密、流、进程和网络 API。
- TypeScript 编译所需的 `NodeJS.*` 与 `@types/node`，除非 Bun 类型已经完整替代且验证通过。
- 上游依赖的传递树中名称包含 `node` 的包；只有成为项目直接依赖或造成外部 Node 执行时才属于本边界问题。
- Bash/PowerShell 权限分类中的 `node`、`npm`、`npx` 解释器规则，以及用户配置 MCP Server 时对这些命令的识别。
- Remote Control Web 使用的 Vite/Tailwind。它们由 Bun 执行，不等于系统安装 Node；P0 第三阶段只删除根 CLI 的 Vite/Rollup Node Bundle。

## 防回归

`scripts/validation/node-runtime-boundary.ts` 会枚举所有 workspace `package.json` 中直接启动 Node/npm-family 的脚本、`engines.node`、Node CLI `bin` 与 Hono Node Adapter，并检查源码 Shebang、生成的 Node 入口、直接 Node 子进程、动态 `ws` 回退、CI 只安装固定 Bun、Bun-only PATH、开发/生产命令覆盖、Bun 发布入口、Bun-only workspace 契约及 Plugin WebSocket 依赖归属。当前清单使用精确允许集合：新增、删除或迁移任一项时验证都会失败，要求实现与本文件同步更新。

任何后续变更恢复外部运行时或 Node 分发记录时，都必须先更新本边界并获得明确的产品决策；默认防回归清单保持为零。
