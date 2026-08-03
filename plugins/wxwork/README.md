# wxwork

`wxwork` 是独立的企业微信 API 模式智能机器人 Channel 插件。它只实现官方
WebSocket 长连接协议，不实现 Bot Webhook、自建应用 XML 回调、Agent HTTP API、
Bot→Agent 回退、OpenClaw Runtime、自动安装或自动更新。

当前兼容基线记录在 `package.json`：官方 CLI `1.1.0`、OpenClaw 插件
`20206.7.201`（commit `1a91ef7`）和 `@wecom/aibot-node-sdk@1.0.7`
（commit `80615b9`）。这些上游包只用于人工协议审计，没有安装、导入或打入产物。

## 配置

先在企业微信后台创建“API 模式智能机器人”，取得 Bot ID 和 Secret。Secret 只放在
环境变量中，配置保存环境变量名而不保存 Secret：

```powershell
$env:WXWORK_PRIMARY_SECRET = "your-secret"
bun plugins/wxwork/host/entry.ts bot add primary your-bot-id WXWORK_PRIMARY_SECRET
bun plugins/wxwork/host/entry.ts bot doctor primary
```

多 Bot 使用不同别名、Bot ID 和 Secret 环境变量。状态保存在
`.claude/channels/wxwork`，不会写入插件目录。新用户首次发消息会收到配对码：

```powershell
bun plugins/wxwork/host/entry.ts access pair primary 123456
```

源码开发：

```powershell
bun run dev -- --plugin-dir plugins/wxwork --dangerously-load-development-channels plugin:wxwork@inline
```

生产分发：

```powershell
bun run build:wxwork-host
.\dist\plugins\wxwork\wxwork-host.exe bot list
.\dist\claude.exe --channels plugin:wxwork@local
```

## 边界

- 只允许绑定入站 `req_id` 的最终 Markdown 和媒体被动回复，主动发送不开放。
- 图片、语音、视频和文件分别限制为 10 MiB、2 MiB、10 MiB、20 MiB；上传按
  512 KiB 分片执行。
- 凭据、会话、排重、配对和权限状态按 Bot 隔离；目标不唯一时拒绝。
- 群内审批绑定 Bot、群、发送者和请求 ID，其他成员不能代为批准。
- 欢迎语、模板卡片、用户反馈、流式中间结果和企业业务 API 不在当前范围。
