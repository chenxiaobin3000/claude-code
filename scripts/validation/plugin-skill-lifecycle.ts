#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ToolUseContext } from '../../src/Tool.js'
import type { Command } from '../../src/types/command.js'
import type { LoadedPlugin } from '../../src/types/plugin.js'
import {
  addDynamicSkillVariantGuidance,
  getNestedSkillQualifiedName,
  type DynamicSkillVariant,
} from '../../src/skills/loadSkillsDir.js'
import {
  PluginManifestSchema,
  type PluginDependencyRef,
} from '../../src/utils/plugins/schemas.js'
import { verifyAndDemote } from '../../src/utils/plugins/dependencyResolver.js'
import { parseStackedSkills } from '../../src/utils/slashCommandParsing.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

const root = resolve(import.meta.dir, '../..')

function plugin(
  name: string,
  version: string,
  dependencies: PluginDependencyRef[] = [],
): LoadedPlugin {
  return {
    name,
    source: `${name}@local`,
    repository: `${name}@local`,
    path: join(root, '.validation', name),
    enabled: true,
    manifest: PluginManifestSchema().parse({
      name,
      version,
      dependencies,
    }),
  }
}

const compatible = verifyAndDemote([
  plugin('runtime', '2.4.1'),
  plugin('consumer', '1.0.0', [{ name: 'runtime', version: '^2.0.0' }]),
])
assertEqual(compatible.demoted.size, 0, 'compatible plugin dependency version')

const incompatible = verifyAndDemote([
  plugin('runtime', '1.9.0'),
  plugin('consumer', '1.0.0', [{ name: 'runtime', version: '^2.0.0' }]),
  plugin('application', '1.0.0', [{ name: 'consumer' }]),
])
assert(incompatible.demoted.has('consumer@local'), 'version mismatch demotes consumer')
assert(incompatible.demoted.has('application@local'), 'demotion propagates to dependents')
assert(
  incompatible.errors.some(
    error =>
      error.type === 'dependency-version-unsatisfied' &&
      error.requiredRange === '^2.0.0',
  ),
  'version mismatch has a typed diagnostic',
)
assert(
  !PluginManifestSchema().safeParse({
    name: 'invalid-range',
    dependencies: [{ name: 'runtime', version: 'not semver' }],
  }).success,
  'invalid semver dependency range is rejected',
)

const nested = getNestedSkillQualifiedName(
  join(root, 'apps', 'web', '.claude', 'skills'),
  'deploy',
  root,
)
assertEqual(nested?.qualifiedName, 'apps/web:deploy', 'nested skill qualified name')
assertEqual(nested?.directory, 'apps/web', 'nested skill directory')
assertEqual(
  getNestedSkillQualifiedName(
    join(resolve(root, '..'), 'outside', '.claude', 'skills'),
    'deploy',
    root,
  ),
  null,
  'nested skill cannot escape session root',
)

const rootSkill = {
  type: 'prompt',
  name: 'deploy',
  description: 'root deploy',
  source: 'projectSettings',
  loadedFrom: 'skills',
  progressMessage: 'running',
  contentLength: 4,
  async getPromptForCommand() {
    return [{ type: 'text' as const, text: 'root' }]
  },
} satisfies Command
const nestedSkill = {
  ...rootSkill,
  name: 'apps/web:deploy',
  description: 'web deploy',
} satisfies Command
const variants: DynamicSkillVariant[] = [
  {
    command: nestedSkill,
    baseName: 'deploy',
    directory: 'apps/web',
  },
]
const guided = addDynamicSkillVariantGuidance([rootSkill], variants)[0]
assert(guided?.type === 'prompt', 'root skill remains a prompt')
const guidedPrompt = await guided.getPromptForCommand(
  '',
  {} as ToolUseContext,
)
assert(
  guidedPrompt.some(
    block =>
      block.type === 'text' &&
      block.text.includes('/apps/web:deploy') &&
      block.text.includes('files involved in the task'),
  ),
  'root skill advertises applicable nested variants',
)

const inline = (name: string): Command =>
  ({
    ...rootSkill,
    name,
  }) satisfies Command
const stackCommands = [
  inline('one'),
  inline('two'),
  inline('three'),
  inline('four'),
  inline('five'),
  inline('six'),
  inline('seven'),
  { ...inline('forked'), context: 'fork' as const },
  inline('loop'),
]
const stacked = parseStackedSkills('/one /two issue-123', stackCommands)
assertDeepEqual(
  stacked?.commands.map(command => command.name),
  ['one', 'two'],
  'stacked skills',
)
assertEqual(stacked?.args, 'issue-123', 'shared stacked skill arguments')
const capped = parseStackedSkills(
  '/one /two /three /four /five /six /seven tail',
  stackCommands,
)
assertEqual(capped?.commands.length, 6, 'stacked skills are capped at six')
assertEqual(capped?.args, '/seven tail', 'seventh skill remains in arguments')
const loopStop = parseStackedSkills('/one /two /loop 5m', stackCommands)
assertEqual(loopStop?.commands.length, 2, 'loop stops stacked expansion')
assertEqual(loopStop?.args, '/loop 5m', 'loop retains its argument syntax')
assertEqual(
  parseStackedSkills('/one /forked task', stackCommands),
  null,
  'forked skill is not stacked',
)

const refresh = await readFile(
  join(root, 'src/utils/plugins/refresh.ts'),
  'utf8',
)
for (const marker of [
  'clearAllCaches()',
  'enabled,',
  'disabled,',
  'commands: pluginCommands',
  'agentDefinitions,',
  'pluginReconnectKey: prev.mcp.pluginReconnectKey + 1',
  'reinitializeLspServerManager()',
  'await loadPluginHooks()',
]) {
  assert(refresh.includes(marker), `plugin reload lost lifecycle step: ${marker}`)
}

const commandsSource = await readFile(join(root, 'src/commands.ts'), 'utf8')
assert(
  commandsSource.indexOf('...skillDirCommands') <
    commandsSource.indexOf('...bundledSkills'),
  'local skills must override bundled skills',
)

console.log('[plugin-skill-lifecycle] PASS')
