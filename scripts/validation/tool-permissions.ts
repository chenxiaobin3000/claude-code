#!/usr/bin/env bun

import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '../../src/utils/permissions/permissionRuleParser.js'
import {
  hasWildcards,
  matchWildcardPattern,
  parsePermissionRule,
} from '../../src/utils/permissions/shellRuleMatching.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

assertDeepEqual(
  permissionRuleValueFromString('Bash(npm install)'),
  { toolName: 'Bash', ruleContent: 'npm install' },
  'permission rule parsing',
)

const ruleWithEscapes = {
  toolName: 'Bash',
  ruleContent: 'python -c "print(1)" C:\\work',
}
const serializedRule = permissionRuleValueToString(ruleWithEscapes)
assertDeepEqual(
  permissionRuleValueFromString(serializedRule),
  ruleWithEscapes,
  'permission rule escaping round-trip',
)

assertDeepEqual(
  parsePermissionRule('git status'),
  { type: 'exact', command: 'git status' },
  'exact shell rule',
)
assertDeepEqual(
  parsePermissionRule('git:*'),
  { type: 'prefix', prefix: 'git' },
  'legacy prefix shell rule',
)
assertDeepEqual(
  parsePermissionRule('git *'),
  { type: 'wildcard', pattern: 'git *' },
  'wildcard shell rule',
)
assert(!hasWildcards('git:*'), 'legacy prefix was treated as a wildcard')
assert(hasWildcards('git *'), 'wildcard was not detected')
assert(!hasWildcards('file-\\*'), 'escaped wildcard was treated as active')

assert(
  matchWildcardPattern('git *', 'git status'),
  'wildcard did not match args',
)
assert(matchWildcardPattern('git *', 'git'), 'trailing args were not optional')
assert(
  !matchWildcardPattern('git *', 'github status'),
  'wildcard crossed the command boundary',
)
assert(
  matchWildcardPattern('file-\\*', 'file-*'),
  'escaped wildcard did not match a literal asterisk',
)
assert(
  !matchWildcardPattern('Get-ChildItem *', 'get-childitem .'),
  'Bash-style matching became case-insensitive',
)
assert(
  matchWildcardPattern('Get-ChildItem *', 'get-childitem .', true),
  'PowerShell-style case-insensitive matching failed',
)
assert(
  matchWildcardPattern('echo *', 'echo first\nsecond'),
  'wildcard did not match multiline command content',
)

const malformed = permissionRuleValueFromString('Bash(npm install)trailing')
assertEqual(
  malformed.toolName,
  'Bash(npm install)trailing',
  'malformed rule was broadened',
)
assertEqual(malformed.ruleContent, undefined, 'malformed rule gained content')

console.log('[validation] tool permission rules passed')
