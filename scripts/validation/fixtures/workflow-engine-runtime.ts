#!/usr/bin/env bun

import type {
  AgentAdapter,
  ProgressEvent,
  WorkflowPorts,
} from '../../../packages/workflow-engine/src/index.js'
import * as sourceWorkflow from '../../../packages/workflow-engine/src/index.js'

type WorkflowModule = typeof sourceWorkflow

const WORKFLOW_SCRIPT = `
export const meta = { name: 'bun-runtime-fixture', description: 'deterministic workflow runtime fixture' }
phase('Collect')
log('fixture-started')
const first = await agent('alpha' + args.suffix, { label: 'alpha', agentType: 'fixture' })
const second = await parallel([
  () => agent('beta' + args.suffix, { label: 'beta', agentType: 'fixture' }),
  async () => 'local',
])
return { first, second }
`

export type WorkflowFixtureSummary = {
  result: unknown
  resumedResult: unknown
  adapterCalls: number
  lifecycle: { initialized: number; disposed: number }
  journalSeq: number[]
  journalKeyLengths: number[]
  firstEventTypes: string[]
  resumedEventTypes: string[]
}

export async function executeWorkflowFixture(
  workflow: WorkflowModule,
  runsDir: string,
): Promise<WorkflowFixtureSummary> {
  let adapterCalls = 0
  let initialized = 0
  let disposed = 0
  const events: ProgressEvent[] = []

  const adapter: AgentAdapter = {
    id: 'fixture',
    capabilities: { structuredOutput: true, tools: true },
    async initialize() {
      initialized++
    },
    async dispose() {
      disposed++
    },
    async run(params, context) {
      adapterCalls++
      context.onProgress?.({ tokenCount: 3, toolCount: 1 })
      return {
        kind: 'ok',
        output: `fixture:${params.prompt}`,
        usage: { outputTokens: 1 },
      }
    },
  }

  const registry = new workflow.AgentAdapterRegistry()
    .register(adapter)
    .route({ kind: 'agentType', agentType: 'fixture', adapter: 'fixture' })
  const journalStore = workflow.createFileJournalStore(runsDir)
  const host = workflow.createHostHandle(null)
  const ports: WorkflowPorts = {
    agentRunner: {
      runAgentToResult: async () => {
        throw new Error('fixture must route through AgentAdapterRegistry')
      },
    },
    agentAdapterRegistry: registry,
    progressEmitter: { emit: event => void events.push(event) },
    taskRegistrar: {
      register: () => ({
        runId: 'fixture-run',
        signal: new AbortController().signal,
      }),
      complete() {},
      fail() {},
      kill() {},
      pendingAction: () => null,
    },
    journalStore,
    permissionGate: { isAborted: () => false },
    logger: { debug() {}, event() {}, warn() {} },
    hostFactory: () => ({
      handle: host,
      cwd: runsDir,
      budgetTotal: null,
    }),
  }

  await registry.initializeAll()
  const result = await workflow.runWorkflow({
    script: WORKFLOW_SCRIPT,
    args: { suffix: '!' },
    runId: 'fixture-run',
    ports,
    host,
    signal: new AbortController().signal,
    cwd: runsDir,
    budgetTotal: null,
  })
  const firstEventTypes = events.map(event => event.type)
  events.length = 0

  const resumedResult = await workflow.runWorkflow({
    script: WORKFLOW_SCRIPT,
    args: { suffix: '!' },
    runId: 'fixture-run',
    ports,
    host,
    signal: new AbortController().signal,
    cwd: runsDir,
    budgetTotal: null,
    resume: true,
  })
  const resumedEventTypes = events.map(event => event.type)
  const journal = await journalStore.read('fixture-run')
  await registry.disposeAll()

  return {
    result,
    resumedResult,
    adapterCalls,
    lifecycle: { initialized, disposed },
    journalSeq: journal.map(entry => entry.seq),
    journalKeyLengths: journal.map(entry => entry.key.length),
    firstEventTypes,
    resumedEventTypes,
  }
}

async function loadWorkflowModule(mode: string): Promise<WorkflowModule> {
  if (mode === 'source') return sourceWorkflow
  if (mode === 'dist') {
    const distSpecifier =
      '../../../packages/workflow-engine/dist/index.js'
    return (await import(distSpecifier)) as WorkflowModule
  }
  throw new Error(`unknown workflow fixture mode: ${mode}`)
}

if (import.meta.main) {
  const mode = process.argv[2] ?? 'source'
  const runsDir = process.argv[3]
  if (!runsDir) throw new Error('workflow fixture requires a runs directory')
  const workflow = await loadWorkflowModule(mode)
  console.log(JSON.stringify(await executeWorkflowFixture(workflow, runsDir)))
}
