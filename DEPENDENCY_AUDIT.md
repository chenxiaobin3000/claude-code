# Root dependency audit

Audit date: 2026-07-17

## Packaging model

The root package publishes `dist/` plus three installation scripts. All three supported production build chains bundle the CLI dependency graph:

- `build.ts`: `Bun.build` with no `external` packages.
- `vite.config.ts`: SSR build with `ssr.noExternal: true`.
- `scripts/build-exe.ts`: standalone `Bun.build({ compile: ... })` with no `external` packages.

Packages imported by `src/` and workspace source therefore belong in `devDependencies`: they are inputs to the production bundle, not modules that the installed CLI resolves from `node_modules` at runtime. Bundle integrity validation rejects unresolved third-party imports after both Bun and Vite builds.

## Installed production dependencies

Only packages directly resolved by scripts shipped outside the bundle remain in `dependencies`:

| Package | Published consumer | Reason |
| --- | --- | --- |
| `@claude-code-best/mcp-chrome-bridge` | `scripts/setup-chrome-mcp.mjs` | Resolves and executes the native messaging setup CLI during installation. |
| `fflate` | `scripts/postinstall.cjs` | Extracts the Windows ripgrep archive without relying solely on an external unzip executable. |
| `undici` | `scripts/postinstall.cjs` | Supplies proxy-aware fetch during ripgrep download; it is also bundled into the CLI for proxy and mTLS support. |
| `ws` | Bun and Vite bundle chunks | Dynamic WebSocket transport imports remain as runtime module references and are verified by artifact inspection. |

`@agentclientprotocol/sdk` and `highlight.js` were moved out of `dependencies`: they enter the production bundles and are not external runtime requirements. `ws` was intentionally retained after the Bun artifact audit found residual dynamic imports. The production list remains four direct packages, but two large source-only dependencies no longer expand the installed runtime closure and the two postinstall requirements are now declared explicitly.

## Development and bundle inputs

`devDependencies` contains three categories:

1. Runtime source inputs embedded in the bundles, including OpenAI/Anthropic compatibility types and clients, Ink/React, telemetry, LSP, archive, network, parsing, and terminal packages.
2. Workspace source packages embedded by the root build. `@claude-code-best/workflow-engine` is now declared explicitly because root source imports it directly.
3. Build and verification tools such as Bun/Node type declarations, TypeScript, Biome, Vite, Rollup, Knip, and package-specific type declarations.

The audit removed unused direct entries `@smithy/core`, `@types/sharp`, and `@types/shell-quote`. `@smithy/core` may still occur transitively through the retained AWS proxy credential path, but it is no longer a separately declared root dependency. Husky and lint-staged were also removed because the repository has no configured Git hook; retaining their packages and prepare lifecycle added installation surface without enforcing a check.

## Enforced boundary

`scripts/validation/dependency-boundary.ts` verifies the production dependency allowlist, bundle configuration, published-script consumers, explicit workspace declaration, and removed direct packages. It runs inside the single `bun run verify` pipeline. `scripts/check-bundle-integrity.ts` remains the artifact-level proof that Bun and Vite outputs do not contain undeclared third-party imports.

`bun.lock` is explicitly exempted from the repository-wide `*.lock` ignore rule. This makes the existing `bun install --frozen-lockfile` CI step reproducible from a clean checkout instead of relying on an untracked local lock file.
