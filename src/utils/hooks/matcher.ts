import {
  getLegacyToolNames,
  normalizeLegacyToolName,
} from '../permissions/permissionRuleParser.js'

export function matchesHookPattern(
  matchQuery: string,
  matcher: string,
): boolean {
  if (!matcher || matcher === '*') return true
  if (/^[a-zA-Z0-9_|]+$/.test(matcher)) {
    if (matcher.includes('|')) {
      return matcher
        .split('|')
        .map(pattern => normalizeLegacyToolName(pattern.trim()))
        .includes(matchQuery)
    }
    return matchQuery === normalizeLegacyToolName(matcher)
  }
  try {
    const regex = new RegExp(matcher)
    if (regex.test(matchQuery)) return true
    return getLegacyToolNames(matchQuery).some(name => regex.test(name))
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
