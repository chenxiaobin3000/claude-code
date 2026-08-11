# @claude-code/workflow-engine

Deterministic JS script orchestration engine for multi-agent workflows. The core layer has zero runtime dependencies and talks to the outside world exclusively through **port adapters** — you bring your own agent backend, journal store, and progress sink.

## Why

When you orchestrate multiple LLM agents, you want the orchestration itself to be **deterministic and replayable**. This engine executes a plain JS function body with primitives like `agent()`, `phase()`, `parallel()` and `pipeline()`. The non-deterministic parts (the LLM, the file system, the clock) are isolated behind ports, so the same script produces the same journal on every replay.

## Installation

```bash
bun add @claude-code/workflow-engine
```

The package requires Bun 1.3 or newer. `ajv` and `zod` are pulled in automatically as dependencies. Imports such as `node:fs`, `node:path`, and `node:crypto` use Bun's compatible standard-library APIs and do not require an external Node.js runtime.

## Minimal example

```ts
import {
  createFileJournalStore,
  createHostHandle,
  runWorkflow,
  type WorkflowPorts,
} from '@claude-code/workflow-engine'

const script = `
export const meta = { name: 'hello', description: 'minimal demo' }
phase('Greet')
const reply = await agent('Say hi in one short sentence.', { label: 'greeting' })
return { reply }
`

const ports: WorkflowPorts = {
  // Provide your own agent runner + journal + progress emitter.
  // See examples/smoke.ts for a complete Anthropic SDK wiring.
} as WorkflowPorts

const handle = createHostHandle(null)
const result = await runWorkflow({
  script,
  args: null,
  runId: 'hello-run',
  ports,
  host: handle,
  signal: new AbortController().signal,
  cwd: process.cwd(),
  budgetTotal: null,
})
```

For a complete deterministic adapter and Journal example, see [`examples/registry-demo.ts`](./examples/registry-demo.ts). The repository validation additionally executes the same fixed Workflow through source, emitted package files, and a Bun standalone binary.

## Core primitives

- `agent(prompt, options)` — call the configured AgentRunner; supports structured output via JSON Schema.
- `phase(name)` — declare a logical phase (display + progress grouping).
- `parallel([thunks])` — barrier-style fan-out with bounded concurrency.
- `pipeline(items, ...stages)` — process each item through deterministic async stages.
- `log(message)` / `workflow(...)` / budgets — see the TypeScript definitions for the full surface.

## Building from source

```bash
bun install            # from the repo root
bun run build          # outputs dist/index.js + dist/**/*.d.ts
```

## License

MIT © claude-code
