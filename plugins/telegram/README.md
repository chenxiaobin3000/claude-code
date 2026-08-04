# telegram

`telegram` 是独立的 Telegram Bot Channel 插件，使用固定的 `grammy@1.45.1`
和 Telegram Bot API 10.2，只通过 `getUpdates` 长轮询接收私聊、群聊及 Forum Topic
消息。不建立 Webhook，不会自动删除既有 Webhook，也不提供广播、定时任务、Mini App、
Bot 管理面板或主动发送。

## 配置

在 BotFather 创建 Bot。推荐将 Token 放入环境变量，避免进入命令历史：

```powershell
$env:TELEGRAM_PRIMARY_TOKEN = "123456:your-secret-token"
bun plugins/telegram/host/entry.ts bot add primary TELEGRAM_PRIMARY_TOKEN
bun plugins/telegram/host/entry.ts bot doctor primary
bun run dev -- --plugin-dir plugins/telegram --dangerously-load-development-channels plugin:telegram@inline
```

配置只保存环境变量名，不保存 Token。后续运行优先读取进程环境变量；独立运行 Host 且
变量未注入时，会按已保存的变量名回退读取用户级 `settings.json.env`。项目和管理级设置
不参与该回退。

生产分发：

```powershell
bun run build:telegram-host
.\dist\plugins\telegram\telegram-host.exe bot list
.\dist\claude.exe --channels plugin:telegram@local
```

首次发消息会返回配对码，由操作者运行：

```powershell
telegram-host access pair primary 123456
```

## 边界

- 每个 Bot 的 Token、Update 排重、配对、权限和连接租约彼此隔离。
- 群聊只接收明确 `@` Bot、回复 Bot 或带 `@bot_username` 的 Bot 命令。
- `chat_id` 固定编码 Bot、私聊/群聊、Telegram Chat ID 和可选 Topic ID。
- `reply` 与 `send_typing` 必须绑定 15 分钟内的入站消息；不提供主动发送。
- 文本按 4096 个 Unicode 字符确定性拆分，不默认启用 Markdown 或 HTML。
- 入站和出站单文件上限 20 MiB；本地出站文件必须位于 `TELEGRAM_ALLOWED_FILE_ROOTS`。
- `429` 只按 Telegram 明确的 `retry_after` 有界重试一次；网络结果不确定时不重放发送。
- Token、含 Token 的文件 URL、完整消息和媒体地址不得写入日志。
