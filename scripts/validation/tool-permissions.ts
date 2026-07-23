#!/usr/bin/env bun

import { WebFetchTool } from '../../packages/builtin-tools/src/tools/WebFetchTool/WebFetchTool.js'
import {
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../src/Tool.js'
import {
  hasWellFormedPermissionRuleSyntax,
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '../../src/utils/permissions/permissionRuleParser.js'
import {
  hasWildcards,
  matchWildcardPattern,
  parsePermissionRule,
} from '../../src/utils/permissions/shellRuleMatching.js'
import { validatePermissionRule } from '../../src/utils/settings/permissionValidation.js'
import {
  getToolSpecifierPolicy,
  matchWebFetchDomainSpecifier,
} from '../../src/utils/settings/toolValidationConfig.js'
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
assert(
  !hasWellFormedPermissionRuleSyntax('Bash(npm install)trailing'),
  'trailing permission rule content was accepted',
)
assert(
  !validatePermissionRule('Bash(npm install)trailing').valid,
  'malformed permission rule passed settings validation',
)
assert(
  !validatePermissionRule('Bash)').valid,
  'unmatched closing parenthesis passed settings validation',
)

const validRules = [
  'Bash(npm run *)',
  'PowerShell(Get-ChildItem *)',
  'Read(src/**)',
  'Edit(/docs/**)',
  'WebFetch(domain:example.com)',
  'WebFetch(domain:*.example.com)',
  'Agent(Explore)',
  'Agent(*)',
  'Skill(local-skill:*)',
  'mcp__local__*',
]
for (const rule of validRules) {
  assert(
    validatePermissionRule(rule).valid,
    `official permission rule was rejected: ${rule}`,
  )
}

const invalidRules = [
  'WebFetch(https://example.com/path)',
  'WebFetch(domain:example.com/path)',
  'WebFetch(domain:foo*bar.example.com)',
  'WebFetch(domain:example.com:443)',
  'Agent(Exp*)',
  'mcp__local__tool(*)',
]
for (const rule of invalidRules) {
  assert(
    !validatePermissionRule(rule).valid,
    `invalid tool specifier was accepted: ${rule}`,
  )
}

assertEqual(
  getToolSpecifierPolicy('Bash')?.kind,
  'shell',
  'Bash specifier contract',
)
assertEqual(
  getToolSpecifierPolicy('PowerShell')?.caseSensitive,
  false,
  'PowerShell case sensitivity contract',
)
assertEqual(
  getToolSpecifierPolicy('WebFetch')?.parameterName,
  'domain',
  'WebFetch named specifier contract',
)
assertEqual(
  getToolSpecifierPolicy('Agent')?.supportsWildcard,
  false,
  'Agent wildcard contract',
)
assertEqual(
  getToolSpecifierPolicy('UnregisteredPluginTool'),
  undefined,
  'unregistered tools must not gain a generic parameter matcher',
)

assert(
  matchWebFetchDomainSpecifier(
    'domain:*.example.com',
    'domain:api.example.com',
  ),
  'WebFetch domain wildcard did not match one label',
)
assert(
  matchWebFetchDomainSpecifier(
    'domain:*.EXAMPLE.com',
    'domain:api.example.COM',
  ),
  'WebFetch domain matching was not case-insensitive',
)
assert(
  !matchWebFetchDomainSpecifier('domain:*.example.com', 'domain:example.com'),
  'WebFetch wildcard unexpectedly matched the apex domain',
)
assert(
  !matchWebFetchDomainSpecifier(
    'domain:*.example.com',
    'domain:a.b.example.com',
  ),
  'WebFetch wildcard crossed a domain-label boundary',
)
assert(
  !matchWebFetchDomainSpecifier(
    'domain:*.example.com',
    'domain:example.com.attacker.test',
  ),
  'WebFetch wildcard matched a forged domain suffix',
)

const webFetchSource = await Bun.file(
  'packages/builtin-tools/src/tools/WebFetchTool/WebFetchTool.ts',
).text()
assert(
  webFetchSource.includes('matchWebFetchDomainSpecifier'),
  'WebFetch runtime stopped applying domain wildcard rules',
)

function webFetchContext(rules: {
  allow?: string[]
  ask?: string[]
  deny?: string[]
}): ToolUseContext {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    alwaysAllowRules: { cliArg: rules.allow ?? [] },
    alwaysAskRules: { cliArg: rules.ask ?? [] },
    alwaysDenyRules: { cliArg: rules.deny ?? [] },
  }
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
    getAppState: () => ({ toolPermissionContext }),
    setAppState: () => {},
  } as unknown as ToolUseContext
}

const wildcardWebFetchRule = 'WebFetch(domain:*.permissions-fixture.test)'
const wildcardWebFetchInput = {
  url: 'https://api.permissions-fixture.test/docs',
  prompt: 'summarize',
}
const wildcardAllow = await WebFetchTool.checkPermissions(
  wildcardWebFetchInput,
  webFetchContext({ allow: [wildcardWebFetchRule] }),
)
assertEqual(
  wildcardAllow.behavior,
  'allow',
  'WebFetch wildcard allow was not applied at runtime',
)

const apexNotAllowed = await WebFetchTool.checkPermissions(
  {
    url: 'https://permissions-fixture.test/docs',
    prompt: 'summarize',
  },
  webFetchContext({ allow: [wildcardWebFetchRule] }),
)
assertEqual(
  apexNotAllowed.behavior,
  'ask',
  'WebFetch wildcard unexpectedly allowed the apex domain',
)

const exactWebFetchRule = 'WebFetch(domain:api.permissions-fixture.test)'
const exactDenyWins = await WebFetchTool.checkPermissions(
  wildcardWebFetchInput,
  webFetchContext({
    allow: [wildcardWebFetchRule],
    deny: [exactWebFetchRule],
  }),
)
assertEqual(
  exactDenyWins.behavior,
  'deny',
  'WebFetch exact deny did not take precedence over wildcard allow',
)

const exactAskWins = await WebFetchTool.checkPermissions(
  wildcardWebFetchInput,
  webFetchContext({
    allow: [wildcardWebFetchRule],
    ask: [exactWebFetchRule],
  }),
)
assertEqual(
  exactAskWins.behavior,
  'ask',
  'WebFetch exact ask did not take precedence over wildcard allow',
)

const preapprovedInput = {
  url: 'https://docs.python.org/3/library/pathlib.html',
  prompt: 'summarize',
}
const preapprovedDeny = await WebFetchTool.checkPermissions(
  preapprovedInput,
  webFetchContext({ deny: ['WebFetch(domain:docs.python.org)'] }),
)
assertEqual(
  preapprovedDeny.behavior,
  'deny',
  'WebFetch preapproved host bypassed an explicit deny rule',
)
const preapprovedAsk = await WebFetchTool.checkPermissions(
  preapprovedInput,
  webFetchContext({ ask: ['WebFetch(domain:docs.python.org)'] }),
)
assertEqual(
  preapprovedAsk.behavior,
  'ask',
  'WebFetch preapproved host bypassed an explicit ask rule',
)

console.log('[validation] tool permission rules passed')
