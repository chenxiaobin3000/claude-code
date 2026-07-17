import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, parse } from 'node:path'
import {
  getTheme,
  hasCustomTheme,
  isBuiltinThemeName,
  isCustomThemeName,
  isThemeSetting,
  registerCustomThemes,
  type BuiltinThemeName,
  type CustomThemeName,
  type RegisteredCustomTheme,
  type Theme,
  type ThemeSetting,
} from './theme.js'
import { getClaudeConfigHomeDir } from './envUtils.js'

const MAX_THEME_FILE_BYTES = 256 * 1024
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const RGB_COLOR_PATTERN = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/
const ANSI_256_PATTERN = /^ansi256\(\s*(\d{1,3})\s*\)$/
const ANSI_COLOR_NAMES = new Set([
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
])

export type CustomThemeParseResult = {
  theme: RegisteredCustomTheme
  warnings: string[]
}

let diagnostics: string[] = []
const warnedPreferences = new Set<string>()

export function getUserThemesDirectory(): string {
  return join(getClaudeConfigHomeDir(), 'themes')
}

export function getCustomThemeDiagnostics(): readonly string[] {
  return diagnostics
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isValidThemeColor(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (HEX_COLOR_PATTERN.test(value)) return true

  const rgb = RGB_COLOR_PATTERN.exec(value)
  if (rgb) {
    return rgb.slice(1).every(component => Number(component) <= 255)
  }

  const ansi256 = ANSI_256_PATTERN.exec(value)
  if (ansi256) return Number(ansi256[1]) <= 255

  if (value.startsWith('ansi:')) {
    return ANSI_COLOR_NAMES.has(value.slice('ansi:'.length))
  }
  return false
}

function parseBase(value: unknown, warnings: string[]): BuiltinThemeName {
  if (value === undefined) return 'dark'
  if (isBuiltinThemeName(value)) return value
  warnings.push(`invalid base ${JSON.stringify(value)}; using "dark"`)
  return 'dark'
}

export function parseCustomThemeDefinition(
  value: unknown,
  slug: string,
): CustomThemeParseResult {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      'filename slug must start with a letter or number and contain only letters, numbers, dot, underscore, or hyphen',
    )
  }
  if (!isRecord(value)) throw new Error('theme root must be a JSON object')

  const warnings: string[] = []
  const base = parseBase(value.base, warnings)
  const basePalette = getTheme(base)
  const overrides: Partial<Theme> = {}

  if (value.overrides !== undefined && !isRecord(value.overrides)) {
    warnings.push('overrides must be an object; ignoring it')
  } else if (isRecord(value.overrides)) {
    for (const [token, color] of Object.entries(value.overrides)) {
      if (!(token in basePalette)) {
        warnings.push(`unknown color token ${JSON.stringify(token)}; ignoring it`)
        continue
      }
      if (!isValidThemeColor(color)) {
        warnings.push(
          `invalid color for token ${JSON.stringify(token)}; ignoring it`,
        )
        continue
      }
      overrides[token as keyof Theme] = color
    }
  }

  let name = slug
  if (value.name !== undefined) {
    if (typeof value.name === 'string' && value.name.trim()) {
      name = value.name.trim()
    } else {
      warnings.push('name must be a non-empty string; using the filename slug')
    }
  }

  return {
    theme: {
      id: `custom:${slug}`,
      slug,
      name,
      base,
      palette: { ...basePalette, ...overrides },
    },
    warnings,
  }
}

export function loadUserCustomThemes(
  directory = getUserThemesDirectory(),
): readonly RegisteredCustomTheme[] {
  const loaded: RegisteredCustomTheme[] = []
  const nextDiagnostics: string[] = []
  let entries

  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      nextDiagnostics.push(
        `Unable to read custom theme directory ${directory}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    diagnostics = nextDiagnostics
    registerCustomThemes([])
    for (const diagnostic of diagnostics) console.warn(`[theme] ${diagnostic}`)
    return loaded
  }

  const seenSlugs = new Set<string>()
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.json') {
      continue
    }
    const filePath = join(directory, entry.name)
    const slug = parse(entry.name).name
    const normalizedSlug = slug.toLowerCase()
    if (seenSlugs.has(normalizedSlug)) {
      nextDiagnostics.push(
        `Ignoring duplicate custom theme slug ${JSON.stringify(slug)} at ${filePath}`,
      )
      continue
    }

    try {
      if (statSync(filePath).size > MAX_THEME_FILE_BYTES) {
        throw new Error(`file exceeds ${MAX_THEME_FILE_BYTES} bytes`)
      }
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      const result = parseCustomThemeDefinition(parsed, slug)
      seenSlugs.add(normalizedSlug)
      loaded.push(result.theme)
      nextDiagnostics.push(
        ...result.warnings.map(warning => `${filePath}: ${warning}`),
      )
    } catch (error) {
      nextDiagnostics.push(
        `Ignoring invalid custom theme ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  diagnostics = nextDiagnostics
  registerCustomThemes(loaded)
  for (const diagnostic of diagnostics) console.warn(`[theme] ${diagnostic}`)
  return loaded
}

export function getValidThemeSetting(value: unknown): ThemeSetting {
  if (!isThemeSetting(value)) {
    warnInvalidPreference(value, 'is not a supported theme setting')
    return 'dark'
  }
  if (isCustomThemeName(value) && !hasCustomTheme(value)) {
    warnInvalidPreference(value, 'does not match a loaded custom theme')
    return 'dark'
  }
  return value
}

function warnInvalidPreference(value: unknown, reason: string): void {
  const key = JSON.stringify(value)
  if (warnedPreferences.has(key)) return
  warnedPreferences.add(key)
  console.warn(
    `[theme] Configured theme ${key} ${reason}; using "dark". Add or repair the corresponding JSON file in ${getUserThemesDirectory()} and restart.`,
  )
}

export function _resetCustomThemesForValidation(): void {
  diagnostics = []
  warnedPreferences.clear()
  registerCustomThemes([])
}
