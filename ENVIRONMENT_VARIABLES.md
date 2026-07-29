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

CI mode performs dependency, type, lint, workspace, protocol, permission, and three-build artifact checks without contacting a model. Normal mode adds local model and tool-call smoke checks.
