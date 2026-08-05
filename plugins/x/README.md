# X read-only MCP plugin

This optional local plugin exposes bounded public-data reads through the official X API. The official X TypeScript XDK `0.6.6` was audited, but its runtime uses a private module-level HTTP transport that cannot safely receive a per-plugin proxy in Bun standalone. The production plugin therefore uses a small local GET-only transport and does not bundle the XDK. It is not a Channel and never starts a stream, webhook, poller, or background task.

## Security boundary

- Authentication is App-only Bearer Token only. OAuth 1.0a, OAuth 2.0 user authorization and every write operation are intentionally unavailable.
- The only credential name is `X_BEARER_TOKEN`. For one configured App its value is the raw token. For multiple Apps it is a JSON object keyed by alias, for example `{"primary":"token-1","research":"token-2"}`.
- `X_PROXY_URL` optionally configures HTTP/HTTPS CONNECT through Bun's native `fetch` transport. Once configured, proxy failure is fatal and never falls back to a direct request. The current Bun standalone runtime does not support SOCKS5 and rejects it explicitly instead of silently connecting directly.
- Credentials may come from the Host environment or user-level `settings.json.env`. They are never saved by `x-host`, printed, logged, or returned to the model.
- The production API root is fixed to `https://api.x.com`; configuration cannot redirect the Bearer Token to another endpoint. Tests inject a local endpoint through a source-only constructor seam.

## Configure

```powershell
x-host.exe app add primary
x-host.exe app list
x-host.exe app doctor primary
```

The MCP tools are `x_get_post`, `x_get_thread`, `x_get_user`, `x_get_user_posts`, `x_search_recent`, and `x_get_mentions`. Every list call is limited to two pages, 100 records per page, 512 KiB output, two concurrent requests, a 15-second timeout, and no automatic retries. Thread results are explicitly marked partial because they use the recent-search window.
