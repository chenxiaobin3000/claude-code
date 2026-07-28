import {
  getLegacyToolNames,
  normalizeLegacyToolName,
} from '../permissions/permissionRuleParser.js'

export function matchesHookPattern(
  matchQuery: string,
  matcher: string,
): boolean {
  if (!matcher || matcher === '*') return true
  if (/^[a-zA-Z0-9_|,\s-]+$/.test(matcher)) {
    if (matcher.includes('|') || matcher.includes(',')) {
      return matcher
        .split(/[|,]/)
        .map(pattern => normalizeLegacyToolName(pattern.trim()))
        .filter(Boolean)
        .includes(matchQuery)
    }
    return matchQuery === normalizeLegacyToolName(matcher)
  }
  try {
    const regex = new RegExp(matcher)
    const test = (value: string) => {
      // Stateful /g and /y regexes otherwise make a later Hook observe a
      // stale lastIndex from an earlier test and silently fail to match.
      regex.lastIndex = 0
      return regex.test(value)
    }
    if (test(matchQuery)) return true
    return getLegacyToolNames(matchQuery).some(test)
  } catch {
    return false
  }
}

export function buildHookDedupKey(
  sourceRoot: string | undefined,
  payload: string,
): string {
  return `${sourceRoot ?? ''}\0${payload}`
}
