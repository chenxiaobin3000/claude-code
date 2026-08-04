# Telegram User plugin

This local Channel plugin connects ordinary Telegram user accounts through GramJS/MTProto. It is separate from the Telegram Bot plugin and acts as the logged-in user identity.

Create Telegram application credentials at `my.telegram.org`, place the API ID, API hash, and E.164 phone number in secret environment variables, then configure and log in interactively:

```text
telegram-user-host account add personal TELEGRAM_API_ID TELEGRAM_API_HASH TELEGRAM_PHONE
telegram-user-host account login personal
telegram-user-host access allow personal user 123456789
telegram-user-host account doctor personal
```

如果三个值已存在于用户级 `settings.json.env`，也可以直接传入，反查并保存变量名：

```text
telegram-user-host account add-local personal 12345678 0123456789abcdef0123456789abcdef +15551234567
```

`add-local` 不保存 API ID、API Hash 或手机号，只读取 `~/.claude/settings.json`（或
`CLAUDE_CONFIG_DIR/settings.json`）并要求每个值各自唯一匹配一个 `env` 变量；项目和管理级
设置不参与匹配。参数可能保留在 Shell 历史和进程命令行中，普通 `account add` 仍是推荐
方式。后续运行仍读取环境变量；一次性验证码与 2FA 密码只在 `account login` 时交互输入。

The one-time code and optional 2FA password are read interactively and are not persisted. The resulting StringSession is a long-lived credential stored privately under `~/.claude/channels/telegram-user/accounts/<alias>` (or `TELEGRAM_USER_STATE_DIR`). Protect and back up that directory as you would a password.

Only allowlisted peers are delivered to Claude Code. The MCP tool can reply only to a recent inbound message and cannot initiate a conversation, bulk-send, manage contacts/groups/channels, or modify the account. Outbound files must be inside `TELEGRAM_USER_ALLOWED_FILE_ROOTS` and at most 20 MiB. Use a low-privilege test account for initial acceptance.
