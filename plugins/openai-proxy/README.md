# openai-proxy

`openai-proxy` is an optional, removable local Plugin. It will expose a
ChatGPT/Codex subscription through the OpenAI-compatible model configuration
already supported by this project.

Phase 1 provides the TypeScript/Bun Plugin boundary and loopback-only gateway.
Phase 2 adds isolated ChatGPT browser/device-code login and private atomic
session storage. Phase 3 forwards ordinary streaming Chat Completions requests
to the official Codex Responses endpoint and adapts Responses SSE back to the
existing model stream. It never reads or imports Codex's own auth file.
Phase 4 adds one loopback daemon shared by all active MCP clients, with
per-client leases, authenticated lifecycle control, crash diagnostics and idle
exit.
Phase 5 adds an optional explicit upstream HTTP/HTTPS CONNECT proxy for every
OpenAI authentication and model request, with no direct fallback.
Phase 6 fixes an auditable OpenAI Codex release baseline and permits only a
small, documented set of login, Responses/SSE, model and transport semantics.
The upstream `client_version` is pinned to `0.147.0` with that baseline and is
independent from the Plugin/Host package version.
Phase 7 locks the boundary into the full deterministic regression suite.

## Development commands

```powershell
bun run plugins/openai-proxy/host/entry.ts login
bun run plugins/openai-proxy/host/entry.ts login --device-code
bun run plugins/openai-proxy/host/entry.ts serve
bun run plugins/openai-proxy/host/entry.ts doctor
bun run plugins/openai-proxy/host/entry.ts status
bun run plugins/openai-proxy/host/entry.ts stop
bun run plugins/openai-proxy/host/entry.ts logout
bun run audit:openai-proxy-upstream -- --tag rust-v0.147.0
```

The upstream audit resolves the official release tag, downloads only the paths
listed in `upstream/BASELINE.json` into an OS temporary directory, compares
SHA-256 values, prints a semantic-review report, and removes the temporary
files. It never updates production code. Changes outside the scopes documented
in `upstream/SOURCE_MAP.md` are not eligible for synchronization.

The first `login` generates a 32-byte random local gateway token when none is
configured and atomically writes it to the user-level `settings.json` as
`env.OPENAI_PROXY_LOCAL_TOKEN`. It also writes the default port under
`openaiProxy.port`. Existing valid values are preserved; conflicting process
and settings tokens fail closed.

```json
{
  "env": {
    "OPENAI_PROXY_LOCAL_TOKEN": "<generated-by-login>"
  },
  "openaiProxy": {
    "port": 48481
  }
}
```

The default local base URL is `http://127.0.0.1:48481/v1`. The user-level
`openaiProxy.port` field may select another integer port from 1024 through
65535. Configure the subscription model as an ordinary OpenAI-compatible
model and keep its `baseUrl` port equal to that setting; no Provider or
proxy-specific model type is required:

```json
{
  "model": "<slug returned by /v1/models>",
  "baseUrl": "http://127.0.0.1:48481/v1",
  "apiKeyEnv": "OPENAI_PROXY_LOCAL_TOKEN"
}
```

The gateway implements `GET /v1/models` and streaming
`POST /v1/chat/completions`. Unsupported Chat Completions fields are rejected
explicitly instead of being silently removed. Upstream authentication, errors,
timeouts, cancellation and interrupted streams fail closed; there is no model
or endpoint fallback.

`max_tokens` and `max_completion_tokens` are validated for local profile and
request consistency, but are intentionally not forwarded as
`max_output_tokens`: the ChatGPT/Codex subscription backend rejects that public
Responses API field. Safe structured upstream error details are returned to the
local caller after credential and proxy-secret redaction.

To require an upstream proxy, set `OPENAI_PROXY_URL` in the Host process or in
the user-level `~/.claude/settings.json` `env` object. The process environment
wins when both are present:

```json
{
  "env": {
    "OPENAI_PROXY_URL": "http://user:password@proxy.example:8080"
  }
}
```

Only `http://` and `https://` proxy URLs are accepted. Proxy Basic
authentication is supported through URL credentials; SOCKS5, URL paths and
query parameters are rejected explicitly. Generic `HTTP_PROXY`, `HTTPS_PROXY`
and `NO_PROXY` do not select or bypass this route. OAuth token exchange,
device-code polling, refresh/revoke, model catalog and Responses/SSE requests
all use the configured proxy. A proxy refusal, authentication failure, timeout,
DNS failure or TLS failure is terminal for that request and never retries by
direct connection. The browser process and loopback callback/local gateway do
not use this transport. `status` and `doctor` show only the proxy scheme, host
and port; credentials are redacted.

The MCP entry acquires a per-client lease and automatically reuses or starts one
single-instance gateway. Closing a client releases only its own lease; other
CLI sessions continue using the same process. The daemon exits after 30 seconds
with no live lease. `stop` is an explicit authenticated shutdown and `serve`
runs the same lifecycle in the foreground.

Runtime state is kept under `~/.claude/openai-proxy/runtime/`: `runtime.json`
records the PID, instance ID, endpoint, mode and Host version; `connection.lock`
guards singleton ownership; `clients/` contains renewable leases; and
`last-exit.json` records idle, signal, control, startup-failure or stale-runtime
recovery. Recovery validates lock ownership and never sends a signal to a PID
read from mutable state. These files contain no ChatGPT Session tokens.

ChatGPT subscription credentials are stored only at
`~/.claude/openai-proxy/auth.json`. The separate local gateway capability
token is stored in the user-level `settings.json` env object so the main CLI
and standalone Host resolve the same value.
Writes use an atomic replacement and a bounded cross-process lock. POSIX mode is
restricted to `0600`; Windows uses a current-user-only ACL. Tokens are never
printed by `status` or `doctor` and are not exposed to the parent CLI.

`GET /health` contains no credentials and is intentionally available without
authentication. `/doctor`, `/v1/models`, `/v1/usage`, and
`/v1/chat/completions` require
`Authorization: Bearer $OPENAI_PROXY_LOCAL_TOKEN`.

`/v1/usage` reads the authenticated ChatGPT Codex 5-hour and 7-day quota
windows through the same OAuth session and explicit upstream proxy as model
requests. The Host caches the normalized snapshot for 60 seconds and exposes
only used/remaining percentages, window lengths, reset timestamps and capture
time; OAuth tokens and account identifiers never enter the response. When a
model configured with the loopback endpoint and `OPENAI_PROXY_LOCAL_TOKEN` is
selected, the CLI footer displays the remaining values as
`5h: 100% · 7d: 100%`. Other model endpoints do not display this indicator.
