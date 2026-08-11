# Root dependency audit

Audit date: 2026-07-22

## Packaging model

The root package publishes `dist/` plus two runtime scripts. Both supported production build classes bundle the CLI dependency graph:

- `build.ts`: `Bun.build` with no `external` packages.
- `scripts/build-exe.ts`: standalone `Bun.build({ compile: ... })` with no `external` packages.

Packages imported by `src/` and workspace source therefore belong in `devDependencies`: they are inputs to the production bundle, not modules that the installed CLI resolves from `node_modules` at runtime. Bundle integrity validation rejects unresolved third-party imports after the Bun build.

The local `plugins/weixin` workspace owns its `qrcode`, MCP SDK, and Zod dependencies. They are compiled into the independent `weixin-host` distribution and are not imported by `src/` or included through a root workspace dependency. This keeps optional WeChat networking, media, and QR code code outside the main CLI bundle and its runtime dependency boundary.

The optional `plugins/x` workspace owns only its MCP SDK and Zod runtime dependencies. XDK `0.6.6` was frozen and inspected, but its generated runtime uses a private module-level HTTP client that cannot safely receive a per-plugin proxy in Bun standalone; it is therefore excluded from all production dependencies and Bundles. The X Host uses a local, GET-only transport for the six approved public-data endpoints, with Bun-native HTTP/HTTPS proxy injection and independent Bundle validation.

## Installed production dependencies

Only packages directly resolved by scripts shipped outside the bundle remain in `dependencies`:

| Package | Published consumer | Reason |
| --- | --- | --- |
| `fflate` | `scripts/postinstall.cjs` | Extracts the Windows ripgrep archive without relying solely on an external unzip executable. |
| `undici` | `scripts/postinstall.cjs` | Supplies proxy-aware fetch during ripgrep download; it is also bundled into the CLI for proxy and mTLS support. |
| `ws` | Bun bundle chunks | Dynamic WebSocket transport imports remain as runtime module references and are verified by artifact inspection. |

`@agentclientprotocol/sdk` and `highlight.js` were moved out of `dependencies`: they enter the production bundles and are not external runtime requirements. `ws` was intentionally retained after the Bun artifact audit found residual dynamic imports. The third-party `@claude-code/mcp-chrome-bridge`, its published setup script, and the hard-coded `mcp-chrome` server were removed on 2026-07-19; browser integration can still be supplied explicitly through user MCP configuration or the separately gated local `claude-in-chrome` implementation. The production list is now three direct packages.

## Development and bundle inputs

`devDependencies` contains three categories:

1. Runtime source inputs embedded in the bundles, including the project-owned lightweight OpenAI-compatible Chat Completions Client, the small Anthropic SDK error-class compatibility allowlist, Ink/React, LSP, archive, network, parsing, and terminal packages. The `openai` package is retained for compile-time Chat Completions protocol types only; its runtime Client and bundled Workload Identity OAuth implementation do not enter production artifacts. `@anthropic-ai/sdk` remains an internal message/tool/stream/Usage compatibility dependency: type imports are unrestricted, while runtime values are limited by `sdk-compat-boundary.ts` to the four local error classes documented in `ANTHROPIC_SDK_COMPATIBILITY.md`. Runtime error imports must use the narrow `@anthropic-ai/sdk/error` export so the SDK model client, default domain, and credential discovery code cannot enter production bundles.
2. Workspace source packages embedded by the root build. `@claude-code/workflow-engine` is declared explicitly because root source imports it directly; the package declares Bun as its runtime and package-manager contract, while its `node:fs`/`node:path`/`node:crypto` imports are exercised as Bun-compatible APIs by the independent source, emitted-package, and standalone Workflow fixture.
3. Build and verification tools such as Bun/Node type declarations, TypeScript, Biome, Knip, and package-specific type declarations. The root Node CLI build no longer depends on Vite or Rollup; the remote-control-server workspace independently owns Vite for its browser frontend and invokes it through Bun.

The independent `acp-link` workspace now uses Bun-native HTTP/HTTPS, WebSocket, and subprocess streams. Its `@hono/node-server`, `@hono/node-ws`, and `@types/ws` declarations were removed; the runtime-neutral `hono` router remains for Manager routes.

The audit removed unused direct entries `@smithy/core`, `@types/sharp`, and `@types/shell-quote`. The Bun-only metadata cleanup also removed the root `ws`/`@types/ws` pair, the unused AWS proxy helper, and its direct `@aws-sdk/credential-provider-node`/`@smithy/node-http-handler` declarations. QQ and WeCom continue to own `ws` and `@types/ws` because their Gateway protocols use that client at runtime; AWS/Smithy names may remain transitively through the `openai` optional peer tree but are not project-owned provider paths. `@types/node` remains an explicit compile-time dependency for the existing `NodeJS.*` compatibility types. Husky and lint-staged were also removed because the repository has no configured Git hook; retaining their packages and prepare lifecycle added installation surface without enforcing a check.

## Enforced boundary

`scripts/validation/dependency-boundary.ts` verifies the production dependency allowlist, Bun bundle configuration, published-script consumers, explicit workspace declaration, and removed direct packages. It runs inside the single `bun run verify` pipeline. `scripts/check-bundle-integrity.ts` checks the Bun output for unresolved third-party imports and removed cloud-interface markers; `scripts/check-exe-integrity.ts` applies the equivalent marker policy to the standalone executable.

No production dependency is retained for Anthropic account login or hosted APIs, ChatGPT account OAuth, remote Plugin Marketplace distribution, automatic self-update, remote Feature Flag delivery, Sentry, Datadog, Langfuse, OpenTelemetry export, or official MCP Registry discovery. MCP OAuth remains part of the user-configured MCP protocol and is not a CLI account dependency. Self-hosted RCS/ACP, GitHub, Weixin, search, WebFetch, HTTP Hooks, and OpenAI-compatible endpoints are separate explicit network surfaces and remain in scope.

The artifact audit is performed immediately after each build. The Bun output is scanned as a JavaScript dependency graph; the standalone EXE is scanned as binary ASCII/UTF-16 content and then exercised with `--version` and `--help`.

`bun.lock` is explicitly exempted from the repository-wide `*.lock` ignore rule. This makes the existing `bun install --frozen-lockfile` CI step reproducible from a clean checkout instead of relying on an untracked local lock file.
