/** Tool-specific permission specifier contracts. */

export type ToolSpecifierKind = 'shell' | 'path' | 'named' | 'name' | 'opaque'

export type ToolValidationConfig = {
  specifiers: Record<
    string,
    {
      kind: ToolSpecifierKind
      supportsWildcard: boolean
      parameterName?: string
      caseSensitive?: boolean
      supportsLegacyPrefix?: boolean
    }
  >

  /** Custom validation rules for specific tools */
  customValidation: {
    [toolName: string]: (content: string) => {
      valid: boolean
      error?: string
      suggestion?: string
      examples?: string[]
    }
  }
}

export const TOOL_VALIDATION_CONFIG: ToolValidationConfig = {
  specifiers: {
    Bash: {
      kind: 'shell',
      supportsWildcard: true,
      supportsLegacyPrefix: true,
      caseSensitive: true,
    },
    PowerShell: {
      kind: 'shell',
      supportsWildcard: true,
      supportsLegacyPrefix: true,
      caseSensitive: false,
    },
    Read: { kind: 'path', supportsWildcard: true },
    Write: { kind: 'path', supportsWildcard: true },
    Edit: { kind: 'path', supportsWildcard: true },
    Glob: { kind: 'path', supportsWildcard: true },
    NotebookRead: { kind: 'path', supportsWildcard: true },
    NotebookEdit: { kind: 'path', supportsWildcard: true },
    WebFetch: {
      kind: 'named',
      parameterName: 'domain',
      supportsWildcard: true,
      caseSensitive: false,
    },
    Agent: {
      kind: 'name',
      supportsWildcard: false,
      caseSensitive: true,
    },
    Skill: {
      kind: 'name',
      supportsWildcard: true,
      supportsLegacyPrefix: true,
      caseSensitive: true,
    },
    WebSearch: {
      kind: 'opaque',
      supportsWildcard: false,
    },
    VaultHttpFetch: {
      kind: 'opaque',
      supportsWildcard: true,
    },
  },

  // Custom validation (only if needed)
  customValidation: {
    // WebSearch doesn't support wildcards or complex patterns
    WebSearch: content => {
      if (content.includes('*') || content.includes('?')) {
        return {
          valid: false,
          error: 'WebSearch does not support wildcards',
          suggestion: 'Use exact search terms without * or ?',
          examples: ['WebSearch(claude ai)', 'WebSearch(typescript tutorial)'],
        }
      }
      return { valid: true }
    },

    // WebFetch uses domain: prefix for hostname-based permissions
    WebFetch: content => {
      // Check if it's trying to use a URL format
      if (content.includes('://') || content.startsWith('http')) {
        return {
          valid: false,
          error: 'WebFetch permissions use domain format, not URLs',
          suggestion: 'Use "domain:hostname" format',
          examples: [
            'WebFetch(domain:example.com)',
            'WebFetch(domain:github.com)',
          ],
        }
      }

      // Must start with domain: prefix
      if (!content.startsWith('domain:')) {
        return {
          valid: false,
          error: 'WebFetch permissions must use "domain:" prefix',
          suggestion: 'Use "domain:hostname" format',
          examples: [
            'WebFetch(domain:example.com)',
            'WebFetch(domain:*.google.com)',
          ],
        }
      }

      const domain = content.slice('domain:'.length)
      if (
        !domain ||
        domain.length > 253 ||
        domain !== domain.trim() ||
        /[/:?#@\s]/.test(domain)
      ) {
        return {
          valid: false,
          error: 'WebFetch permission contains an invalid domain pattern',
          suggestion:
            'Use a hostname only; URLs, paths, ports, credentials, and whitespace are not allowed',
          examples: [
            'WebFetch(domain:example.com)',
            'WebFetch(domain:*.example.com)',
          ],
        }
      }

      const labels = domain.split('.')
      if (
        labels.some(
          label =>
            !label ||
            (label !== '*' &&
              (!/^[A-Za-z0-9-]{1,63}$/.test(label) ||
                label.startsWith('-') ||
                label.endsWith('-'))),
        )
      ) {
        return {
          valid: false,
          error: 'WebFetch wildcard must occupy an entire domain label',
          suggestion: 'Use patterns such as "domain:*.example.com"',
          examples: [
            'WebFetch(domain:example.com)',
            'WebFetch(domain:*.example.com)',
          ],
        }
      }

      return { valid: true }
    },

    Agent: content => {
      if (content.includes('*') || content.includes('?')) {
        return {
          valid: false,
          error: 'Agent permission rules require an exact agent name',
          suggestion: 'Use a rule such as "Agent(Explore)"',
          examples: ['Agent(Explore)', 'Agent(Plan)'],
        }
      }
      return content.trim()
        ? { valid: true }
        : { valid: false, error: 'Agent name cannot be empty' }
    },
  },
}

export function getToolSpecifierPolicy(toolName: string) {
  return TOOL_VALIDATION_CONFIG.specifiers[toolName]
}

// Helper to check if a tool uses file patterns
export function isFilePatternTool(toolName: string): boolean {
  return getToolSpecifierPolicy(toolName)?.kind === 'path'
}

// Helper to check if a tool uses bash prefix patterns
export function isBashPrefixTool(toolName: string): boolean {
  return getToolSpecifierPolicy(toolName)?.kind === 'shell'
}

// Helper to get custom validation for a tool
export function getCustomValidation(toolName: string) {
  return TOOL_VALIDATION_CONFIG.customValidation[toolName]
}

/**
 * Match canonical `domain:` rule contents. Wildcards occupy exactly one DNS
 * label, so `*.example.com` cannot match `example.com` or cross label
 * boundaries.
 */
export function matchWebFetchDomainSpecifier(
  ruleContent: string,
  targetContent: string,
): boolean {
  const prefix = 'domain:'
  if (!ruleContent.startsWith(prefix) || !targetContent.startsWith(prefix)) {
    return false
  }

  const pattern = ruleContent.slice(prefix.length).toLowerCase()
  const target = targetContent.slice(prefix.length).toLowerCase()
  const patternLabels = pattern.split('.')
  const targetLabels = target.split('.')
  return (
    patternLabels.length === targetLabels.length &&
    patternLabels.every(
      (label, index) => label === '*' || label === targetLabels[index],
    )
  )
}
