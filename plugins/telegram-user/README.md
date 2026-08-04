# Telegram User plugin

This local Channel plugin connects ordinary Telegram user accounts through GramJS/MTProto. It is separate from the Telegram Bot plugin and acts as the logged-in user identity.

Create Telegram application credentials at `my.telegram.org`, place the API ID, API hash, and E.164 phone number in secret environment variables, then configure and log in interactively:

```text
telegram-user-host account add personal TELEGRAM_API_ID TELEGRAM_API_HASH TELEGRAM_PHONE
telegram-user-host account login personal
telegram-user-host access allow personal user 123456789
telegram-user-host account doctor personal
```

也可以直接传入并逐账号保存在本地私有文件中：

```text
telegram-user-host account add-local personal 12345678 0123456789abcdef0123456789abcdef +15551234567
```

`add-local` 的 API Hash 和手机号可能保留在 Shell 历史和进程命令行中，且凭据以明文
JSON 保存于 `~/.claude/channels/telegram-user/accounts/<alias>/credentials.json`；环境变量
模式仍是推荐方式。相同别名重新执行普通 `account add` 会切回环境变量模式并删除本地
凭据。一次性验证码与 2FA 密码仍只在 `account login` 时交互输入，不落盘。

The one-time code and optional 2FA password are read interactively and are not persisted. The resulting StringSession is a long-lived credential stored privately under `~/.claude/channels/telegram-user/accounts/<alias>` (or `TELEGRAM_USER_STATE_DIR`). Protect and back up that directory as you would a password.

Only allowlisted peers are delivered to Claude Code. The MCP tool can reply only to a recent inbound message and cannot initiate a conversation, bulk-send, manage contacts/groups/channels, or modify the account. Outbound files must be inside `TELEGRAM_USER_ALLOWED_FILE_ROOTS` and at most 20 MiB. Use a low-privilege test account for initial acceptance.
