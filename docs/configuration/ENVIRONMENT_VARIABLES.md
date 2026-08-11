# Environment variables

This document lists the supported user-facing environment-variable groups. Values containing credentials must be supplied by the process environment or an approved settings source; they must not be committed to `models.json`, logs, or shell history.

## Model routing and credentials

Model IDs and endpoints are configured in `~/.claude/models.json`, not with provider-selection environment variables. Each model entry may set `apiKeyEnv` to the name of the variable containing its credential. When omitted, the runtime reads `OPENAI_API_KEY`. Local llama.cpp endpoints normally need no credential.

`CLAUDE_CODE_VERIFY_MODEL` selects a local model ID from the same registry for `bun run verify`. The selected endpoint must use loopback or a private-network address; verification refuses external paid endpoints.

## API retry and stream recovery

- `API_TIMEOUT_MS` controls the complete request deadline; the default is 600000 ms (10 minutes).
- `API_MAX_RETRIES` controls retries after the original request; the default is 3 and values are capped at 10. Retries apply only to transient connection errors, timeouts, temporary 429 responses and 5xx responses before any visible stream output.
- `API_RETRY_MAX_DELAY_MS` caps exponential-backoff delay; the default is 10000 ms and the maximum accepted value is 60000 ms. A server `Retry-After` value is respected within that cap.
- `API_STREAM_IDLE_TIMEOUT_MS` controls how long an established SSE stream may send no bytes before it is considered stalled; the default is 120000 ms. Set `0` to disable the idle watchdog for unusually slow local models.

Once text, reasoning, or a tool-call delta has been exposed, the CLI never replays that request automatically: replay can duplicate a tool invocation. It retains the partial response and appends an incomplete-response error; send `continue` to start a new, explicit continuation request. Authentication, context-limit, model, request-schema and response-schema errors are never retried.

## Agent execution

Subagents run in the background by default. A tool call may set `run_in_background: false` when its result is required before the current turn continues; Agent frontmatter may set `background: true` or `background: false`. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` disables background execution and has the highest priority. Contexts whose lifecycle requires asynchronous execution (Coordinator, the fork experiment, and Assistant mode) remain backgrounded after the global disable and platform-support checks.

Local safety limits apply to the complete nested Agent tree:

- `CLAUDE_CODE_MAX_AGENT_DEPTH`: maximum root-relative nesting depth; default `2`.
- `CLAUDE_CODE_MAX_AGENT_COUNT`: maximum new Agents spawned in one session; default `50`.
- `CLAUDE_CODE_MAX_AGENT_CONCURRENCY`: maximum simultaneously active Agents; default `8`.
- `CLAUDE_CODE_MAX_AGENT_TOKENS`: cumulative Agent Token budget for the session; default `1000000`.

All values must be positive integers. Exceeding a limit fails the new spawn explicitly instead of silently queueing it. Cancelling a parent Agent propagates to its nested Agent subtree; root background Agents remain independently stoppable.

Interactive background Agents relay unresolved permission requests to the main session and identify the requesting Agent. `CLAUDE_CODE_BACKGROUND_PERMISSION_TIMEOUT_MS` controls how long such a request may remain unanswered before only that tool call is denied; the default is `300000` ms. The value must be a positive integer. Non-interactive and stream-json sessions do not open a local permission dialog and retain deterministic safe denial.

## Local Feature Policy

- `FEATURE_<NAME>=0|1` explicitly disables or enables a feature registered in `scripts/feature-policy.ts`.
- `ALLOW_EXPERIMENTAL_FEATURES=1` authorizes explicitly selected experimental features.
- `ALLOW_INTERNAL_FEATURES=1` authorizes explicitly selected internal or deployment-specific features.
- `CLAUDE_LOCAL_FEATURE_OVERRIDES` supplies a JSON object of local runtime values. It is parsed locally and is never uploaded or refreshed from a remote Feature Flag service.

Unknown feature names, values other than `0` or `1`, missing authorization, dependency failures, and conflicting combinations terminate the build with a clear error.

## Self-hosted and user-configured integrations

- `CLAUDE_CODE_RCS_AUTH_TOKEN` is the operator-provided token for self-hosted RCS ingress.
- `MCP_CLIENT_SECRET` can supply the OAuth client secret for a user-configured HTTP/SSE MCP Server.
- HTTP Hook header interpolation is limited by the `httpHookAllowedEnvVars` settings allowlist.

These variables do not enable a hosted CLI account, remote Plugin Marketplace, telemetry upload, or automatic update service.

## X read-only plugin

- `X_BEARER_TOKEN` is the only supported X credential name. With one configured App it contains the raw App-only Bearer Token. With multiple Apps it contains a JSON object keyed by App alias. OAuth user credentials are not accepted.
- `X_PROXY_URL` optionally routes every X API request through one HTTP or HTTPS CONNECT proxy. Once set, proxy failure is fatal and never falls back to direct networking. Proxy credentials are redacted. The current Bun standalone runtime rejects SOCKS5 explicitly because it cannot enforce that route reliably.
- `X_STATE_DIR` is a validation-only state-location injection point and is not normal production configuration. Production uses `~/.claude/x`, and the API root is fixed in code to `https://api.x.com` so configuration cannot redirect the Bearer Token.

The credential and proxy may come only from the X Host process environment or user-level `settings.json.env`; project and managed settings do not inject them into the external plugin Host.

## openai-proxy plugin

The first `openai-proxy-host login` creates a 32-byte random local gateway Token and stores it under `env.OPENAI_PROXY_LOCAL_TOKEN` in the user-level `settings.json`. The same initialization writes `openaiProxy.port` with the default `48481`; the port may be changed to an integer from `1024` through `65535`. The corresponding `models.json.baseUrl` must use the same loopback port. An existing valid Token and port are preserved, and a conflicting process-level Token is rejected instead of silently replacing the persisted value.

`OPENAI_PROXY_URL` optionally routes all OAuth, Token, model-catalogue, and Responses traffic from the plugin through one explicit HTTP or HTTPS CONNECT proxy. Once selected, proxy failure is fatal and does not fall back to a direct connection. ChatGPT credentials remain separately stored under `~/.claude/openai-proxy/auth.json`.

## Proxy, TLS, shell, and configuration

The runtime honors standard proxy variables such as `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`, together with the documented local settings for proxy and mTLS. `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, and `CLAUDE_CODE_CLIENT_KEY` configure additional trust or client certificates.

Common local runtime controls include:

- `CLAUDE_CONFIG_DIR`: override the local configuration directory.
- `CLAUDE_CODE_MANAGED_SETTINGS_PATH`: override the managed-settings file path for a deployment.
- `CLAUDE_CODE_SHELL`: explicitly select the command shell.
- `CLAUDE_CODE_GIT_BASH_PATH`: explicitly select Git Bash on Windows.
- `CLAUDE_CODE_USE_POWERSHELL_TOOL`: enable the PowerShell tool path where supported.
- `CLAUDE_CODE_TMPDIR`: select the CLI temporary directory.
Settings may also define an `env` object for child sessions. Provider credentials and other secrets are scrubbed from subprocess environments according to the runtime security policy.

## Build and validation

Build scripts consume Feature Policy variables described above. The single validation entry point is:

```powershell
bun run verify -- --ci

$env:CLAUDE_CODE_VERIFY_MODEL = 'Qwen3.5-9B-Q6_K'
bun run verify
```

CI mode performs dependency, type, lint, workspace, protocol, permission, Bun bundle, and standalone artifact checks without contacting a model. Normal mode adds local model and tool-call smoke checks.
