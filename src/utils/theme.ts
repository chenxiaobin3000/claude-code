/**
 * Application-facing theme exports.
 *
 * The canonical palettes and registry live in @anthropic/ink so every
 * renderer resolves built-in and user themes through the same source.
 */
export {
  THEME_NAMES,
  THEME_SETTINGS,
  getCustomThemes,
  getTheme,
  getThemeBaseName,
  hasCustomTheme,
  isBuiltinThemeName,
  isCustomThemeName,
  isThemeSetting,
  registerCustomThemes,
  themeColorToAnsi,
} from '@anthropic/ink'

export type {
  BuiltinThemeName,
  CustomThemeName,
  RegisteredCustomTheme,
  Theme,
  ThemeName,
  ThemeSetting,
} from '@anthropic/ink'
