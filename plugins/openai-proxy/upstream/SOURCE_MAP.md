# OpenAI Codex upstream source map

This directory records a review baseline; it does not vendor OpenAI Codex
source code. The local implementation is an independent TypeScript/Bun rewrite.
Upstream Rust files may only be downloaded to a temporary directory by the
audit command and must never be copied into this Plugin.

## Allowed semantic boundary

The whitelist in `BASELINE.json` is limited to:

- browser OAuth, device-code login, PKCE/state, tokens, session persistence,
  refresh/revoke/logout and account identity;
- authentication headers and OpenAI/Codex base-address selection;
- model/account/rate-limit metadata;
- Responses request transport and SSE event/usage semantics;
- TLS, CA and explicit HTTP/HTTPS proxy behavior.

Each baseline entry maps those semantics to specific `src/` targets. A changed
hash is only a review signal. It never authorizes automatic source conversion,
patching, dependency changes or production-code writes.

## Explicitly excluded

Do not sync Agent loops, prompts, tools, shell/file operations, sandboxing,
approvals, threads, MCP, Plugin/Skill systems, cloud/remote services, telemetry,
updates, UI, multi-agent behavior, memory, web/image/voice features or background
tasks. A whitelisted file can contain adjacent upstream responsibilities; only
the scopes named in its `scope` field are reviewable. Everything else in that
file remains excluded.

The audit report must be reviewed manually. Approved semantic changes are
reimplemented in TypeScript and covered by local deterministic tests; the
report itself is not an update mechanism.
