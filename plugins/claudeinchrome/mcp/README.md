# MCP

独立 stdio MCP 入口位于 `../host/mcpServer.ts`，由同一个
`claudeinchrome-host` 产物的 `mcp` 模式运行。MCP 引擎、协议和工具声明均归属
本插件，不再依赖旧 workspace 包或主程序内的 Chrome 特例。

源码插件清单通过 Bun 启动 `../host/entry.ts mcp`，用于项目内开发；执行
`bun run build:chrome-host` 后，分发清单会改为直接启动同目录的独立 Host，
目标机器不需要安装 Bun 或 Node.js。
