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
Phase 7 locks the boundary into the full deterministic regression suite.

## Development commands

```powershell
$env:OPENAI_PROXY_LOCAL_TOKEN = '<at-least-32-random-characters>'
bun run plugins/openai-proxy/host/entry.ts serve
bun run plugins/openai-proxy/host/entry.ts doctor
bun run plugins/openai-proxy/host/entry.ts login
bun run plugins/openai-proxy/host/entry.ts login --device-code
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

The local base URL is fixed to `http://127.0.0.1:48181/v1`. Configure the
subscription model as an ordinary OpenAI-compatible model; no Provider or
proxy-specific model type is required:

```json
{
  "model": "<slug returned by /v1/models>",
  "baseUrl": "http://127.0.0.1:48181/v1",
  "apiKeyEnv": "OPENAI_PROXY_LOCAL_TOKEN"
}
```

The gateway implements `GET /v1/models` and streaming
`POST /v1/chat/completions`. Unsupported Chat Completions fields are rejected
explicitly instead of being silently removed. Upstream authentication, errors,
timeouts, cancellation and interrupted streams fail closed; there is no model
or endpoint fallback.

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

ChatGPT credentials are stored only at `~/.claude/openai-proxy/auth.json`.
Writes use an atomic replacement and a bounded cross-process lock. POSIX mode is
restricted to `0600`; Windows uses a current-user-only ACL. Tokens are never
printed by `status` or `doctor` and are not exposed to the parent CLI.

`GET /health` contains no credentials and is intentionally available without
authentication. `/doctor`, `/v1/models`, and `/v1/chat/completions` require
`Authorization: Bearer $OPENAI_PROXY_LOCAL_TOKEN`.
