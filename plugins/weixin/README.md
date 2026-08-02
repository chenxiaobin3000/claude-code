# weixin

`weixin` 是独立的本地 Channel 插件。主程序只通过标准插件加载器启动其 MCP，
不包含微信登录、轮询、媒体或二维码实现。

## 源码开发

```powershell
bun plugins/weixin/host/entry.ts login
bun run dev -- --plugin-dir plugins/weixin --dangerously-load-development-channels plugin:weixin@inline
```

开发来源为 `weixin@inline`，必须通过显式开发 Channel 确认，不能继承生产
`weixin@local` 的信任身份。

## 生产分发

```powershell
bun run build:weixin-host
.\dist\plugins\weixin\weixin-host.exe login
.\dist\claude.exe --channels plugin:weixin@local
```

生产 EXE 只扫描同级 `plugins` 目录的一级子目录，因此完整分发单元为
`dist/claude.exe` 与 `dist/plugins/weixin`。删除该插件目录即可移除微信能力。

账号与配对状态继续保存在用户目录的 `.claude/channels/weixin`，不会写入插件目录。
