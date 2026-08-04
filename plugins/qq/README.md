# qq

`qq` 是独立的 QQ 开放平台机器人 Channel 插件，只实现 C2C 私聊和群聊的
WebSocket Gateway 入站及 REST 被动回复。不实现 Webhook、个人 QQ 登录、Guild、
主动推送、Cron、热更新、OpenClaw Runtime 或官方内置 Skill。

兼容基线记录在 `package.json`。官方 OpenClaw 插件、扫码 Connector 和 Node SDK
只用于人工协议审计，没有安装、导入或打入产物。

## 配置

在 QQ 开放平台创建机器人，取得 AppID 和 AppSecret。推荐把 Secret 放入环境变量：

```powershell
$env:QQ_PRIMARY_SECRET = "your-app-secret"
bun plugins/qq/host/entry.ts bot add primary your-app-id QQ_PRIMARY_SECRET
bun plugins/qq/host/entry.ts bot doctor primary
```

如果 Secret 已存在于用户级 `settings.json.env`，也可以直接传入值，让命令反查并保存
对应的环境变量名：

```powershell
bun plugins/qq/host/entry.ts bot add-local primary your-app-id your-app-secret
```

`add-local` 不保存 Secret，只读取 `~/.claude/settings.json`（或
`CLAUDE_CONFIG_DIR/settings.json`）并要求 `env` 中有且仅有一个值精确匹配；项目和管理级
设置不参与匹配。明文参数可能保留在 Shell 历史和进程命令行中，普通 `bot add` 仍是
推荐方式。后续 `mcp` 和 `doctor` 与普通模式一样读取环境变量。

源码开发：

```powershell
bun run dev -- --plugin-dir plugins/qq --dangerously-load-development-channels plugin:qq@inline
```

生产分发：

```powershell
bun run build:qq-host
.\dist\plugins\qq\qq-host.exe bot list
.\dist\claude.exe --channels plugin:qq@local
```

首次发消息会得到配对码，由操作者运行：

```powershell
qq-host access pair primary 123456
```

本地媒体回复默认关闭。需要发送本地文件时，使用 `QQ_ALLOWED_FILE_ROOTS` 明确配置
允许根目录；Windows 多目录以分号分隔，Linux/macOS 以冒号分隔。

## 边界

- 群聊只消费 `GROUP_AT_MESSAGE_CREATE`，即明确 `@` 机器人的消息。
- `chat_id` 固定为 `bot-alias::c2c::user-openid` 或
  `bot-alias::group::group-openid`；OpenID 只按 Bot 作用域内的不透明字符串处理。
- 回复必须绑定 15 分钟内的原入站消息 ID；不提供主动发送。
- 单次媒体上传上限 20 MiB；当前不实现官方大文件分块上传。
- 远端入站媒体只允许 QQ HTTPS 媒体域名；本地出站文件必须位于显式允许根目录。
- 权限审批按 Bot、会话和发送者隔离，群内其他成员不能代为批准。
- 日志不记录 AppSecret、Access Token、Authorization Header 或完整消息正文。
