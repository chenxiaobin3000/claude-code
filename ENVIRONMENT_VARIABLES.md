# Environment variables

This document lists the supported user-facing environment-variable groups. Values containing credentials must be supplied by the process environment or an approved settings source; they must not be committed to `models.json`, logs, or shell history.

## Model routing and credentials

Model IDs and endpoints are configured in `~/.claude/models.json`, not with provider-selection environment variables. Each model entry may set `apiKeyEnv` to the name of the variable containing its credential. When omitted, the runtime reads `OPENAI_API_KEY`. Local llama.cpp endpoints normally need no credential.

`CLAUDE_CODE_VERIFY_MODEL` selects a local model ID from the same registry for `bun run verify`. The selected endpoint must use loopback or a private-network address; verification refuses external paid endpoints.

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
