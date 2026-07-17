import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _resetCustomThemesForValidation,
  getCustomThemeDiagnostics,
  getValidThemeSetting,
  isValidThemeColor,
  loadUserCustomThemes,
  parseCustomThemeDefinition,
} from '../../src/utils/customThemes.js'
import {
  getCustomThemes,
  getTheme,
  getThemeBaseName,
} from '../../src/utils/theme.js'
import { getTheme as getInkTheme } from '@anthropic/ink'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dracula = {
  name: 'Dracula',
  base: 'dark',
  overrides: {
    claude: '#bd93f9',
    promptBorder: '#6272a4',
    planMode: '#8be9fd',
    error: '#ff5555',
    warning: '#f1fa8c',
    success: '#50fa7b',
    diffAdded: '#193c2b',
    diffRemoved: '#4c2026',
    userMessageBackground: '#1e1b4b',
    selectionBg: '#44475a',
  },
}

_resetCustomThemesForValidation()
const parsed = parseCustomThemeDefinition(dracula, 'dracula')
assert(parsed.theme.id === 'custom:dracula', 'slug must produce custom:dracula')
assert(parsed.theme.name === 'Dracula', 'display name must be preserved')
assert(parsed.theme.base === 'dark', 'base must be preserved')
assert(parsed.theme.palette.claude === '#bd93f9', 'override must win')
assert(
  parsed.theme.palette.text === getTheme('dark').text,
  'unspecified tokens must inherit from the base theme',
)
assert(parsed.warnings.length === 0, 'valid Dracula theme must not warn')

const invalid = parseCustomThemeDefinition(
  {
    name: '',
    base: 'missing',
    overrides: {
      claude: '#xyzxyz',
      notAThemeToken: '#ffffff',
      success: 'rgb(1, 2, 3)',
    },
  },
  'invalid-sample',
)
assert(invalid.theme.base === 'dark', 'invalid base must fall back to dark')
assert(invalid.theme.name === 'invalid-sample', 'invalid name must use slug')
assert(
  invalid.theme.palette.claude === getTheme('dark').claude,
  'invalid color must be ignored',
)
assert(
  invalid.theme.palette.success === 'rgb(1, 2, 3)',
  'valid rgb color must be retained',
)
assert(invalid.warnings.length === 4, 'invalid fields must produce warnings')

for (const color of [
  '#fff',
  '#12aBcF',
  'rgb(0, 127, 255)',
  'ansi256(255)',
  'ansi:cyanBright',
]) {
  assert(isValidThemeColor(color), `expected valid color ${color}`)
}
for (const color of [
  '#12',
  'rgb(256,0,0)',
  'ansi256(256)',
  'ansi:not-a-color',
  '\u001b[31m',
]) {
  assert(!isValidThemeColor(color), `expected invalid color ${color}`)
}

const directory = mkdtempSync(join(tmpdir(), 'claude-code-themes-'))
try {
  writeFileSync(
    join(directory, 'dracula.json'),
    `${JSON.stringify(dracula)}\n`,
    'utf8',
  )
  writeFileSync(join(directory, 'broken.json'), '{', 'utf8')
  const originalWarn = console.warn
  console.warn = () => {}
  let loaded: ReturnType<typeof loadUserCustomThemes>
  try {
    loaded = loadUserCustomThemes(directory)
  } finally {
    console.warn = originalWarn
  }
  assert(loaded.length === 1, 'one valid theme must load beside invalid JSON')
  assert(getCustomThemes().length === 1, 'registry must contain loaded themes')
  assert(
    getValidThemeSetting('custom:dracula') === 'custom:dracula',
    'loaded custom preference must be valid',
  )
  assert(
    getTheme('custom:dracula').selectionBg === '#44475a',
    'root theme resolver must use the custom palette',
  )
  assert(
    getInkTheme('custom:dracula').selectionBg === '#44475a',
    'Ink and root must share one custom theme registry',
  )
  assert(
    getThemeBaseName('custom:dracula') === 'dark',
    'custom theme syntax rendering must use its base',
  )
  assert(
    getCustomThemeDiagnostics().some(message => message.includes('broken.json')),
    'invalid JSON must be diagnosed without blocking valid themes',
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
  _resetCustomThemesForValidation()
}

console.log('[themes] PASS')
