#!/usr/bin/env bun

import { getParserModule } from '../../src/utils/bash/bashParser.js'
import { analyzeCommand } from '../../src/utils/bash/treeSitterAnalysis.js'
import {
  classifyCommandName,
  getAllCommandNames,
  mapElementType,
  type RawParsedOutput,
  stripModulePrefix,
  transformPowerShellParseOutput,
} from '../../src/utils/powershell/parser.js'
import { assert, assertDeepEqual, assertEqual } from './assertions.js'

function analyzeBash(command: string) {
  const parser = getParserModule()
  assert(parser, 'Bash parser module is unavailable')
  const root = parser.parse(command, Infinity)
  assert(root, `Bash parser rejected ${JSON.stringify(command)}`)
  return analyzeCommand(root, command)
}

const compound = analyzeBash('cat input | grep needle && echo ok')
assert(compound.compoundStructure.hasPipeline, 'Bash pipeline was not detected')
assert(
  compound.compoundStructure.operators.includes('&&'),
  'Bash control operator was not detected',
)

const quotedPipe = analyzeBash('echo "a|b"')
assert(
  !quotedPipe.compoundStructure.hasPipeline,
  'quoted Bash pipe was treated as an operator',
)

const substitution = analyzeBash('echo $(whoami)')
assert(
  substitution.dangerousPatterns.hasCommandSubstitution,
  'Bash command substitution was not detected',
)

const escapedSemicolon = analyzeBash('find . -exec echo {} \\;')
assert(
  !escapedSemicolon.hasActualOperatorNodes,
  'escaped Bash semicolon was treated as a control operator',
)

const heredoc = analyzeBash("cat <<'EOF'\nhello\nEOF")
assert(heredoc.dangerousPatterns.hasHeredoc, 'Bash heredoc was not detected')

assertEqual(classifyCommandName('Get-ChildItem'), 'cmdlet', 'cmdlet name')
assertEqual(classifyCommandName('.\\script.ps1'), 'application', 'script path')
assertEqual(
  stripModulePrefix('Microsoft.PowerShell.Management\\Remove-Item'),
  'Remove-Item',
  'PowerShell module prefix',
)
assertEqual(
  stripModulePrefix('C:\\tools\\run.exe'),
  'C:\\tools\\run.exe',
  'PowerShell drive path',
)
assertEqual(
  mapElementType('CommandExpressionAst', 'SubExpressionAst'),
  'SubExpression',
  'PowerShell subexpression classification',
)

const rawPowerShell: RawParsedOutput = {
  valid: true,
  errors: [],
  statements: [
    {
      type: 'PipelineAst',
      text: 'Get-ChildItem . | Select-Object Name > output.txt',
      elements: [
        {
          type: 'CommandAst',
          text: 'Get-ChildItem .',
          commandElements: [
            {
              type: 'StringConstantExpressionAst',
              text: 'Get-ChildItem',
              value: 'Get-ChildItem',
            },
            {
              type: 'StringConstantExpressionAst',
              text: '.',
              value: '.',
            },
          ],
        },
        {
          type: 'CommandAst',
          text: 'Select-Object Name > output.txt',
          commandElements: [
            {
              type: 'StringConstantExpressionAst',
              text: 'Select-Object',
              value: 'Select-Object',
            },
            {
              type: 'StringConstantExpressionAst',
              text: 'Name',
              value: 'Name',
            },
          ],
          redirections: [
            {
              type: 'FileRedirectionAst',
              fromStream: 'Output',
              append: false,
              locationText: 'output.txt',
            },
          ],
        },
      ],
    },
  ],
  variables: [{ path: 'env:PATH', isSplatted: false }],
  hasStopParsing: false,
  originalCommand: 'Get-ChildItem . | Select-Object Name > output.txt',
  typeLiterals: ['System.IO.File'],
}

const parsedPowerShell = transformPowerShellParseOutput(rawPowerShell)
assert(parsedPowerShell.valid, 'PowerShell AST result became invalid')
assertDeepEqual(
  getAllCommandNames(parsedPowerShell),
  ['get-childitem', 'select-object'],
  'PowerShell command names',
)
assertDeepEqual(
  parsedPowerShell.statements[0]?.commands[1]?.args,
  ['Name'],
  'PowerShell arguments',
)
assertDeepEqual(
  parsedPowerShell.statements[0]?.redirections,
  [{ operator: '>', target: 'output.txt', isMerging: false }],
  'PowerShell redirection',
)
assertDeepEqual(
  parsedPowerShell.variables,
  [{ path: 'env:PATH', isSplatted: false }],
  'PowerShell variables',
)
assertDeepEqual(
  parsedPowerShell.typeLiterals,
  ['System.IO.File'],
  'PowerShell type literals',
)

console.log('[validation] Bash and PowerShell parsing passed')
