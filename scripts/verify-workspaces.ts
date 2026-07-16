#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

type ScriptMap = Record<string, string | undefined>

interface WorkspaceManifest {
  name?: string
  scripts?: ScriptMap
  workspaceValidation?: {
    build?: {
      applicable?: boolean
      reason?: string
    }
  }
}

interface Workspace {
  dir: string
  manifestPath: string
  manifest: WorkspaceManifest
  name: string
}

const projectRoot = resolve(import.meta.dir, '..')
const bunExecutable = process.execPath
const mode = process.argv[2] ?? 'all'
const validModes = new Set(['all', 'contract', 'typecheck', 'build', 'smoke'])
const concurrency = Math.max(
  1,
  Math.min(
    4,
    Number.parseInt(process.env.WORKSPACE_VERIFY_CONCURRENCY ?? '4', 10) || 4,
  ),
)

async function discoverWorkspaces(): Promise<Workspace[]> {
  const rootManifest = JSON.parse(
    await readFile(join(projectRoot, 'package.json'), 'utf8'),
  ) as { workspaces?: string[] }
  const patterns = rootManifest.workspaces
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error('Root package.json does not define workspaces')
  }

  const manifestPaths = new Set<string>()
  for (const pattern of patterns) {
    const glob = new Bun.Glob(`${pattern.replace(/\\/g, '/')}/package.json`)
    for await (const path of glob.scan({ cwd: projectRoot, onlyFiles: true })) {
      manifestPaths.add(resolve(projectRoot, path))
    }
  }

  const workspaces = await Promise.all(
    [...manifestPaths].sort().map(async manifestPath => {
      const manifest = JSON.parse(
        await readFile(manifestPath, 'utf8'),
      ) as WorkspaceManifest
      const dir = resolve(manifestPath, '..')
      const name = manifest.name?.trim()
      if (!name) {
        throw new Error(
          `${relative(projectRoot, manifestPath)} must define a package name`,
        )
      }
      return { dir, manifestPath, manifest, name }
    }),
  )

  const names = new Set<string>()
  for (const workspace of workspaces) {
    if (names.has(workspace.name)) {
      throw new Error(`Duplicate workspace package name: ${workspace.name}`)
    }
    names.add(workspace.name)
  }
  return workspaces
}

function checkContract(workspaces: Workspace[]): void {
  const errors: string[] = []
  for (const workspace of workspaces) {
    const scripts = workspace.manifest.scripts ?? {}
    if (!scripts.typecheck?.trim()) {
      errors.push(`${workspace.name}: missing scripts.typecheck`)
    }
    if (!scripts.test?.trim() && !scripts['test:smoke']?.trim()) {
      errors.push(
        `${workspace.name}: missing scripts.test or scripts.test:smoke`,
      )
    }

    const buildException = workspace.manifest.workspaceValidation?.build
    if (!scripts.build?.trim()) {
      if (buildException?.applicable !== false) {
        errors.push(
          `${workspace.name}: missing scripts.build and workspaceValidation.build.applicable=false`,
        )
      }
      if (!buildException?.reason?.trim()) {
        errors.push(
          `${workspace.name}: missing non-empty build exception reason`,
        )
      }
    } else if (buildException?.applicable === false) {
      errors.push(
        `${workspace.name}: build script conflicts with build exception`,
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(`Workspace contract violations:\n- ${errors.join('\n- ')}`)
  }
  console.log(`[workspaces] PASS contract (${workspaces.length} workspaces)`)
}

async function runWorkspaceScript(
  workspace: Workspace,
  script: string,
): Promise<void> {
  const startedAt = Date.now()
  const proc = Bun.spawn([bunExecutable, 'run', script], {
    cwd: workspace.dir,
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (exitCode !== 0) {
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    throw new Error(
      `${workspace.name} ${script} failed with exit code ${exitCode}`,
    )
  }
  console.log(
    `[workspaces] PASS ${workspace.name} ${script} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
  )
}

async function runConcurrent(
  workspaces: Workspace[],
  getScript: (workspace: Workspace) => string | null,
  limit = concurrency,
): Promise<void> {
  let index = 0
  const workers = Array.from(
    { length: Math.min(limit, workspaces.length) },
    async () => {
      while (index < workspaces.length) {
        const workspace = workspaces[index++]!
        const script = getScript(workspace)
        if (script) await runWorkspaceScript(workspace, script)
      }
    },
  )
  await Promise.all(workers)
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  if (!validModes.has(mode)) {
    throw new Error(
      `Unknown mode ${JSON.stringify(mode)}; expected all, contract, typecheck, build, or smoke`,
    )
  }
  const workspaces = await discoverWorkspaces()
  checkContract(workspaces)

  if (mode === 'all' || mode === 'typecheck') {
    console.log('\n[workspaces] Independent TypeScript checks')
    await runConcurrent(workspaces, () => 'typecheck')
  }

  if (mode === 'all' || mode === 'build') {
    console.log('\n[workspaces] Applicable builds')
    for (const workspace of workspaces) {
      if (!workspace.manifest.scripts?.build) {
        console.log(
          `[workspaces] SKIP ${workspace.name} build: ${workspace.manifest.workspaceValidation?.build?.reason}`,
        )
      }
    }
    await runConcurrent(
      workspaces.filter(workspace =>
        Boolean(workspace.manifest.scripts?.build),
      ),
      () => 'build',
      2,
    )
  }

  if (mode === 'all' || mode === 'smoke') {
    console.log('\n[workspaces] Lightweight smoke checks')
    await runConcurrent(workspaces, workspace =>
      workspace.manifest.scripts?.test ? 'test' : 'test:smoke',
    )
  }

  console.log(
    `\n[workspaces] ${mode.toUpperCase()} PASSED (${workspaces.length} workspaces) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  )
}

main().catch(error => {
  console.error(
    `\n[workspaces] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
})
