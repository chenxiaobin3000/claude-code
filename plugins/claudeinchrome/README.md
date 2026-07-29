# claudeinchrome

`claudeinchrome` 是项目的本地 Chrome 集成插件边界。Claude 主程序本身不提供
Chrome 控制能力；只有显式加载并启用本插件后，才能通过插件提供的 MCP 与 Skill
访问 Chrome。

目标数据路径：

`Claude 主程序 -> claudeinchrome 插件 -> Native Host -> Chrome 扩展 -> Chrome`

## 当前状态

- `chrome-extension/`：Manifest V3 扩展源码已经归入插件，固定扩展 ID 为
  `dlpofjonbnceelbmpelkfblmnghclmkm`。
- `.claude-plugin/plugin.json`：本地插件清单已经建立，可通过
  `--plugin-dir plugins/claudeinchrome` 识别。
- MCP、Skill 与 Native Host：尚未迁移到插件，也尚未完成验收。

因此当前插件只完成目录、清单和浏览器端扩展归位，不能宣称 Chrome 自动化已经
可用。主程序不会回退到原先的内置 Chrome 控制入口。

后续迁移及验收范围以根目录 `DEVELOPMENT_PLAN.md` 为准。
