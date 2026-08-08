# Telegram User plugin

This local plugin reads allowlisted Telegram user-account history through GramJS/MTProto. It is separate from the Telegram Bot plugin and does not register a realtime Channel.

Create Telegram application credentials at `my.telegram.org`, place the API ID, API hash, and E.164 phone number in secret environment variables, then configure and log in interactively:

```text
telegram-user-host account add personal TELEGRAM_API_ID TELEGRAM_API_HASH TELEGRAM_PHONE
telegram-user-host account login personal
telegram-user-host account groups personal
telegram-user-host access allow personal user 123456789
telegram-user-host account history personal group -1001234567890 20
telegram-user-host account doctor personal
```

配置只保存三个环境变量名，不保存 API ID、API Hash 或手机号。后续运行优先读取进程环境
变量；独立运行 Host 且变量未注入时，会按已保存的变量名回退读取用户级
`settings.json.env`。项目和管理级设置不参与该回退。一次性验证码与 2FA 密码只在
`account login` 时交互输入。

`account groups [alias]` 使用已保存的 Session 只读列出当前账号可访问的普通群、超级群和
频道的 Peer ID 与名称；它不读取消息历史，也不会自动修改 allowlist。取得 ID 后，使用
`access allow <alias> group|channel <peer-id>` 显式允许按需读取历史消息。

`account history <alias> <user|group|channel> <peer-id> [limit]` 只读取已经加入无限制 Peer
allowlist 的目标，默认返回最近 20 条、最多 100 条，并按时间从旧到新输出 JSON Lines。
每行只包含消息 ID、UTC 时间、发送者 ID、文本和是否带媒体；命令不会下载附件。Topic
限定或发送者限定的 allowlist 不授权读取整个 Peer 的历史。

插件只注册独立的 `telegram-user-control` MCP Server。它不会常驻连接账号，按需提供：

- `list_chats`：按账号列出群、超级群和频道的名称、类型、allowlist 状态及不透明
  `chatRef`；不向模型返回 Peer ID。
- `set_chat_access`：使用 `chatRef` 增加或删除无限制 Peer allowlist；这是配置写操作，
  不声明为只读工具。
- `get_chat_history`：使用 `chatRef` 读取已 allow 的目标最近 1–100 条文本和附件存在性，
  不下载附件。

`chatRef` 使用当前账号 Session 作为本地 HMAC 密钥生成，不是 Peer ID 的编码；退出并重新
登录导致 Session 改变时应重新调用 `list_chats`。三个控制工具均不设置
`anthropic/alwaysLoad`，模型需要时再加载。

可选代理只从 Host 进程环境或用户级 `settings.json.env` 读取：

```text
TELEGRAM_USER_PROXY_URL=socks5://user:password@127.0.0.1:1080
telegram-user-host proxy capabilities
telegram-user-host account doctor personal
```

GramJS Host 支持 SOCKS5（含用户名/密码认证），不支持 HTTP/HTTPS 代理。代理在每次客户端
创建时绑定，覆盖登录、Session 恢复、DC 迁移、对话列表和历史消息请求；代理变化需要重新
执行命令或重启 Host。配置不支持或不可用的代理会明确失败且不会回退直连。代理凭据
不会写入账号索引、doctor、错误或日志。

The one-time code and optional 2FA password are read interactively and are not persisted. The resulting StringSession is a long-lived credential stored privately under `~/.claude/channels/telegram-user/accounts/<alias>` (or `TELEGRAM_USER_STATE_DIR`). Protect and back up that directory as you would a password.

Only allowlisted peers can be read by the history tool. Realtime Update listening, Channel delivery, replies, proactive sends, media downloads, bulk sends, and contact/group/channel management are unavailable. A future implementation may simulate near-realtime input by polling history, but no polling is implemented now. Use a low-privilege test account for initial acceptance.
