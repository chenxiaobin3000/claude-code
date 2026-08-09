# Node.js 运行时边界

本文件冻结 P0 第一阶段的 Node.js 运行时依赖清单。目标不是禁止 `node:` 标准库名称或 Node 兼容类型，而是识别必须在系统上安装、启动或面向 Node.js 分发的路径，供后续 Bun-only 迁移逐项归零。

## 分类规则

| 分类 | 判定 | 迁移策略 |
| --- | --- | --- |
| 外部运行时 | 脚本、CI、Shebang 或子进程会启动 `node`、`node.exe`、`npm` 或 `npx` | P0 必须移除或切换为 Bun |
| Node 分发契约 | 产物明确面向 Node.js，或 package `engines`/`bin` 要求 Node | P0 必须迁移为 Bun 契约或删除该产物 |
| Bun 兼容 API | Bun 中运行的代码导入 `node:fs`、`node:path`、`node:crypto` 等兼容 API | 不要求机械改写；以 Bun 验收结果为准 |
| 类型与名称 | `NodeJS.*`、`@types/node`、TS `types: ["node"]`，或 AWS/Smithy 包名中包含 `node` | 只有运行时证据证明需要外部 Node 时才清理 |
| 用户工具内容 | 权限解析器、提示词和 MCP 配置示例中出现 `node`/`npx` | 不属于项目运行时；保留其安全识别能力 |

## 当前外部运行时和分发清单

| 范围 | 当前入口 | 原因 | 后续阶段 |
| --- | --- | --- | --- |
| CI | Linux、Windows Job 使用 `actions/setup-node` 固定 Node 22 | 历史 CI 仍显式供应 Node，项目验证已不再直接启动它 | 第七阶段删除 |
| `workflow-engine` | `engines.node >=20` | 对外包运行契约仍声明 Node；实际构建已由 Bun 驱动 | 第四/第六阶段改为 Bun |
| `acp-link` | `engines.node >=18`、Node Shebang、`@hono/node-server`、`@hono/node-ws` | HTTP/WebSocket/Manager 是真实 Node Server 实现 | 第五/第六阶段迁移到 Bun 原生服务 |

第三阶段已经删除根 Vite/Rollup Node Bundle、`dist/cli-node.js`、Node Shebang及其专用补丁。根包所有 `bin` 均指向 `dist/cli-bun.js`，`prepublishOnly` 使用 Bun bundle 并执行完整性检查，`packageManager` 固定声明 Bun；兼容 npm registry 只代表分发渠道，不再提供 Node 启动契约。生产 `build:production`、`claude.exe` 和独立 Plugin Host 继续由 Bun standalone 生成，目标机器不依赖 Node.js。

第二阶段已经消除根命令中的直接 Node/npm-family 调用：依赖安装改为 `bun scripts/postinstall.cjs`，脚本 Shebang 同步改为 Bun；文档预览改为 `bunx --bun mintlify dev`，并已通过真实 CLI 启动检查。Mintlify 仍是按需下载的非核心文档工具，不进入项目依赖或生产产物。

## 非 Node 运行时依赖

以下内容不得仅因名称中出现 `node` 而删除：

- Bun 支持的 `node:` 文件、路径、加密、流、进程和网络 API。
- TypeScript 编译所需的 `NodeJS.*` 与 `@types/node`，除非 Bun 类型已经完整替代且验证通过。
- `@aws-sdk/credential-provider-node`、`@smithy/node-http-handler` 等包；是否保留由真实 Bundle 和 Bun 运行兼容决定。
- Bash/PowerShell 权限分类中的 `node`、`npm`、`npx` 解释器规则，以及用户配置 MCP Server 时对这些命令的识别。
- Remote Control Web 使用的 Vite/Tailwind。它们由 Bun 执行，不等于系统安装 Node；P0 第三阶段只删除根 CLI 的 Vite/Rollup Node Bundle。

## 防回归

`scripts/validation/node-runtime-boundary.ts` 会枚举所有 workspace `package.json` 中直接启动 Node/npm-family 的脚本、`engines.node` 和 Node CLI `bin`，并检查源码 Shebang、生成的 Node 入口、直接 Node 子进程、CI Node 安装、Bun 发布入口和 `acp-link` Node Server Adapter。当前清单使用精确允许集合：新增、删除或迁移任一项时验证都会失败，要求实现与本文件同步更新。

后续阶段完成一项迁移时，应同时缩小验证允许集合；P0 完成时所有外部运行时和 Node 分发记录必须归零。
