# weixin

`weixin` 是独立的本地 Channel 插件。主程序只通过标准插件加载器启动其 MCP，
不包含微信登录、轮询、媒体或二维码实现。

插件自行实现腾讯微信 iLink 协议，不安装或依赖 OpenClaw。当前冻结同步基线为
`@tencent-weixin/openclaw-weixin@2.4.6`，commit
`cef0bfc390393f716903e16d50408118047f87e0`。本地与官方版本分别记录；官方插件更新
不会自动进入本项目，必须经过差异审计和本地验证后同步。

当前已对齐请求头与 `base_info`、二维码验证码/重定向/重复绑定状态、动态长轮询、
Token 失效暂停、生命周期通知、游标和上下文 Token 持久化，以及 CDN 完整 URL、
重试和引用媒体。插件只声明私信和媒体通道，不代表可以读取联系人或历史聊天。

Host 可同时运行多个账号。账号 ID 使用 1-32 位字母、数字、下划线或连字符；入站
`chat_id` 固定编码为 `account-id::user-id`，回复必须原样使用。账号不唯一时，未限定
账号的命令和工具调用 fail-closed，不会选择第一个账号。旧的单一 `account.json` 会在
首次启动时迁移为 `default` 账号；随后每个账号分别保存凭据、游标、上下文 Token、
允许列表、配对状态和体验配置。

## 源码开发

```powershell
bun plugins/weixin/host/entry.ts login personal
bun plugins/weixin/host/entry.ts login work
bun plugins/weixin/host/entry.ts accounts
bun plugins/weixin/host/entry.ts login refresh personal
bun run dev -- --plugin-dir plugins/weixin --dangerously-load-development-channels plugin:weixin@inline
```

开发来源为 `weixin@inline`，必须通过显式开发 Channel 确认，不能继承生产
`weixin@local` 的信任身份。

## 生产分发

```powershell
bun run build:weixin-host
.\dist\plugins\weixin\weixin-host.exe login personal
.\dist\plugins\weixin\weixin-host.exe login work
.\dist\plugins\weixin\weixin-host.exe accounts
.\dist\plugins\weixin\weixin-host.exe login refresh personal
.\dist\claude.exe --channels plugin:weixin@local
```

生产 EXE 只扫描同级 `plugins` 目录的一级子目录，因此完整分发单元为
`dist/claude.exe` 与 `dist/plugins/weixin`。删除该插件目录即可移除微信能力。

账号索引保存在 `.claude/channels/weixin/accounts.json`，每个账号的私有状态位于
`.claude/channels/weixin/accounts/<account-id>`，不会写入插件目录。配对命令为
`weixin-host access pair <account-id> <code>`；只有一个账号时仍可省略账号 ID。

## 可选体验配置

每个账号可手工创建 `features.json`：

```json
{
  "quotedText": true,
  "remoteHttpMedia": false,
  "channelDiagnostics": false,
  "echo": false,
  "streamingMarkdown": false,
  "toolProgress": false
}
```

- `quotedText` 默认开启，控制引用消息文本是否进入 Channel 消息。
- `remoteHttpMedia` 默认关闭；开启后 `reply.files` 才接受 HTTP/HTTPS URL，仍执行
  100 MiB 上限并在上传后清理临时文件。
- `channelDiagnostics` 默认关闭；开启后提供只返回账号、Endpoint、开关和状态文件名的
  脱敏 `diagnostics` 工具，不返回 Token 或消息内容。
- `echo` 默认关闭；开启后 `/echo text` 由 Host 本地回复，不进入模型会话。
- `streamingMarkdown` 和 `toolProgress` 当前不支持。现有 MCP Channel 只在完整工具调用
  和权限请求边界提供事件，无法保证这两项的顺序和身份；配置为 `true` 会明确报错退出。
