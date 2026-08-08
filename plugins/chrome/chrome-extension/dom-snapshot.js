const DOM_SNAPSHOT_EXCLUDED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'meta',
  'link',
])
const DOM_SNAPSHOT_TABLE_TAGS = new Set([
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
])
const DOM_SNAPSHOT_LIST_TAGS = new Set(['ul', 'ol', 'li', 'dl', 'dt', 'dd'])
const DOM_SNAPSHOT_FORM_TAGS = new Set([
  'form',
  'input',
  'select',
  'textarea',
  'option',
  'button',
])
const DOM_SNAPSHOT_ARIA_ATTRIBUTES = [
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-expanded',
  'aria-checked',
  'aria-selected',
  'aria-pressed',
  'aria-current',
  'aria-level',
  'aria-rowindex',
  'aria-colindex',
  'aria-rowcount',
  'aria-colcount',
  'aria-sort',
  'aria-haspopup',
]
const DOM_SNAPSHOT_ALLOWED_DATA_ATTRIBUTES = new Set([
  'data-testid',
  'data-test',
  'data-qa',
  'data-label',
  'data-name',
])
const DOM_SNAPSHOT_SENSITIVE_NAME =
  /(?:password|passwd|secret|token|authorization|api[-_ ]?key|session|cookie|credential|one[-_ ]?time[-_ ]?code)/i

function domSnapshotError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeDomSnapshotText(value, maximum = 500) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return undefined
  return normalized
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, '<redacted-private-key>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<redacted-jwt>')
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/g, '<redacted-token>')
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '<redacted-access-key>')
    .replace(/\b(api[-_ ]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .slice(0, maximum)
}

function domSnapshotStructuralHash(value) {
  const input = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function sanitizeDomSnapshotUrl(value) {
  try {
    const url = new URL(
      String(value),
      globalThis.location?.href || 'https://invalid.local/',
    )
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.username = ''
    url.password = ''
    url.hash = ''
    for (const key of url.searchParams.keys()) {
      if (DOM_SNAPSHOT_SENSITIVE_NAME.test(key)) {
        url.searchParams.set(key, '<redacted>')
      }
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function isSensitiveDomSnapshotElement(element) {
  const tag = element.tagName.toLowerCase()
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false
  const type = String(element.getAttribute('type') || '').toLowerCase()
  if (type === 'password' || type === 'hidden') return true
  const identity = [
    element.getAttribute('name'),
    element.getAttribute('id'),
    element.getAttribute('autocomplete'),
    element.getAttribute('aria-label'),
  ]
    .filter(Boolean)
    .join(' ')
  return DOM_SNAPSHOT_SENSITIVE_NAME.test(identity)
}

function isDomSnapshotVisible(element) {
  const view = element.ownerDocument?.defaultView
  const style = view?.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return (
    style?.display !== 'none' &&
    style?.visibility !== 'hidden' &&
    style?.opacity !== '0' &&
    (rect.width > 0 || rect.height > 0)
  )
}

function directDomSnapshotText(element) {
  const text = Array.from(element.childNodes)
    .filter(node => node.nodeType === 3)
    .map(node => node.textContent || '')
    .join(' ')
  return normalizeDomSnapshotText(text)
}

function domSnapshotAria(element) {
  const aria = {}
  for (const name of DOM_SNAPSHOT_ARIA_ATTRIBUTES) {
    const value = normalizeDomSnapshotText(element.getAttribute(name), 240)
    if (value !== undefined) aria[name.slice(5)] = value
  }
  return Object.keys(aria).length > 0 ? aria : undefined
}

function domSnapshotDataAttributes(element) {
  const data = {}
  for (const attribute of element.attributes) {
    if (
      !DOM_SNAPSHOT_ALLOWED_DATA_ATTRIBUTES.has(attribute.name) ||
      DOM_SNAPSHOT_SENSITIVE_NAME.test(attribute.name)
    ) {
      continue
    }
    const value = normalizeDomSnapshotText(attribute.value, 240)
    if (value !== undefined) data[attribute.name.slice(5)] = value
  }
  return Object.keys(data).length > 0 ? data : undefined
}

function domSnapshotTableRelation(element) {
  const tag = element.tagName.toLowerCase()
  if (tag !== 'th' && tag !== 'td') return undefined
  const row = element.parentElement
  return {
    rowIndex: row?.tagName.toLowerCase() === 'tr' ? row.rowIndex : -1,
    columnIndex: Number(element.cellIndex),
    rowSpan: Number(element.rowSpan),
    colSpan: Number(element.colSpan),
    scope: normalizeDomSnapshotText(element.getAttribute('scope'), 32),
    headers: normalizeDomSnapshotText(element.getAttribute('headers'), 240),
  }
}

function domSnapshotListRelation(element) {
  if (element.tagName.toLowerCase() !== 'li') return undefined
  let level = 0
  let ancestor = element.parentElement
  while (ancestor) {
    if (ancestor.matches('ul, ol')) level++
    ancestor = ancestor.parentElement
  }
  const siblings = element.parentElement
      ? Array.from(element.parentElement.children).filter(
        child => child.tagName.toLowerCase() === 'li',
      )
    : []
  return { level, itemIndex: siblings.indexOf(element) }
}

function shouldIncludeDomSnapshotNode(tag, include) {
  if (DOM_SNAPSHOT_TABLE_TAGS.has(tag)) return include.tables
  if (DOM_SNAPSHOT_LIST_TAGS.has(tag)) return include.lists
  if (DOM_SNAPSHOT_FORM_TAGS.has(tag)) return include.forms
  if (tag === 'a') return include.links
  return true
}

function compileDomSnapshotMatchSelectors(matchSelectors) {
  const entries = Object.entries(matchSelectors || {})
  for (const [, selector] of entries) {
    if (
      /\p{Cc}/u.test(selector) ||
      /:has\s*\(|:host(?:-context)?\s*\(|::part\s*\(/i.test(selector)
    ) {
      throw domSnapshotError(
        'INVALID_DOM_MATCH_SELECTOR',
        'DOM match selector uses an unsupported boundary.',
      )
    }
    try {
      document.querySelector(selector)
    } catch (error) {
      throw domSnapshotError(
        'INVALID_DOM_MATCH_SELECTOR',
        `Invalid DOM match selector: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return entries
}

function createSanitizedDomSnapshot(args, metadata) {
  let root
  try {
    root = document.querySelector(args.scopeSelector)
  } catch (error) {
    throw domSnapshotError(
      'INVALID_DOM_SCOPE_SELECTOR',
      `Invalid DOM scope selector: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!root) {
    throw domSnapshotError(
      'DOM_SCOPE_NOT_FOUND',
      `DOM scope selector did not match: ${args.scopeSelector}`,
    )
  }

  const matchSelectors = compileDomSnapshotMatchSelectors(args.matchSelectors)

  if (args.metadataOnly) {
    const result = {
      ...metadata,
      rootNodeIds: [],
      nodes: [],
      partial: false,
      partialReasons: [],
    }
    const byteLength = new TextEncoder().encode(JSON.stringify(result)).byteLength
    if (byteLength > args.maxBytes) {
      throw domSnapshotError(
        'DOM_SNAPSHOT_TOO_LARGE',
        `DOM snapshot metadata requires ${byteLength} bytes and exceeds the ${args.maxBytes}-byte request limit.`,
      )
    }
    return result
  }

  const nodes = []
  const nodesById = new Map()
  const rootNodeIds = []
  const partialReasons = new Set()
  let nextNodeId = 1

  function visit(element, parentId, context) {
    const tag = element.tagName.toLowerCase()
    if (
      DOM_SNAPSHOT_EXCLUDED_TAGS.has(tag) ||
      isSensitiveDomSnapshotElement(element)
    ) {
      return
    }
    const isVisible = isDomSnapshotVisible(element)
    const includeNode =
      (!args.visibleOnly || isVisible) &&
      shouldIncludeDomSnapshotNode(tag, args.include)
    let effectiveParentId = parentId

    if (includeNode) {
      if (nodes.length >= args.maxNodes) {
        throw domSnapshotError(
          'DOM_SNAPSHOT_TOO_MANY_NODES',
          `DOM snapshot exceeds the ${args.maxNodes}-node request limit. Narrow scopeSelector.`,
        )
      }
      const id = `node_${nextNodeId++}`
      const rect = element.getBoundingClientRect()
      const scroll =
        element.scrollHeight > element.clientHeight + 1
          ? {
              scrollTop: Math.max(0, Math.round(element.scrollTop)),
              scrollHeight: Math.max(0, Math.round(element.scrollHeight)),
              clientHeight: Math.max(0, Math.round(element.clientHeight)),
            }
          : undefined
      const node = {
        id,
        parentId,
        childIds: [],
        tag,
        role: normalizeDomSnapshotText(element.getAttribute('role'), 80),
        text: directDomSnapshotText(element),
        aria: domSnapshotAria(element),
        data: domSnapshotDataAttributes(element),
        href:
          tag === 'a'
            ? sanitizeDomSnapshotUrl(element.href)
            : undefined,
        visible: isVisible,
        treeScope: context.treeScope,
        frameDepth: context.frameDepth,
        bounds: {
          x: Math.round(rect.x + context.offsetX),
          y: Math.round(rect.y + context.offsetY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        scroll,
        table: domSnapshotTableRelation(element),
        list: domSnapshotListRelation(element),
        matches: matchSelectors
          .filter(([, selector]) => element.matches(selector))
          .map(([name]) => name),
      }
      nodes.push(node)
      nodesById.set(id, node)
      if (parentId) {
        const parent = nodesById.get(parentId)
        if (parent) parent.childIds.push(id)
      } else {
        rootNodeIds.push(id)
      }
      effectiveParentId = id
      if (scroll) partialReasons.add('scrollable_content_requires_explicit_paging')
    }

    for (const child of element.children) visit(child, effectiveParentId, context)

    if (element.shadowRoot) {
      const shadowContext = { ...context, treeScope: 'shadow-root' }
      for (const child of element.shadowRoot.children) {
        visit(child, effectiveParentId, shadowContext)
      }
    } else if (
      tag.includes('-') &&
      typeof element.matches === 'function' &&
      element.matches(':defined')
    ) {
      partialReasons.add('closed_shadow_root_unavailable')
    }

    if (tag === 'iframe') {
      try {
        const frameDocument = element.contentDocument
        if (!frameDocument?.documentElement) {
          partialReasons.add('cross_origin_iframe_unavailable')
        } else {
          const frameRect = element.getBoundingClientRect()
          visit(frameDocument.documentElement, effectiveParentId, {
            treeScope: 'iframe',
            frameDepth: context.frameDepth + 1,
            offsetX: context.offsetX + frameRect.x,
            offsetY: context.offsetY + frameRect.y,
          })
        }
      } catch {
        partialReasons.add('cross_origin_iframe_unavailable')
      }
    }
    if (
      tag === 'canvas' ||
      tag === 'svg' ||
      tag === 'img' ||
      tag === 'picture' ||
      tag === 'video' ||
      tag === 'object'
    ) {
      partialReasons.add('visual_content_not_included')
    }
  }

  visit(root, undefined, {
    treeScope: 'document',
    frameDepth: 0,
    offsetX: 0,
    offsetY: 0,
  })
  const result = {
    ...metadata,
    rootNodeIds,
    nodes,
    partial: partialReasons.size > 0,
    partialReasons: [...partialReasons].sort(),
  }
  result.contentHash = `${metadata.contentHash}:${domSnapshotStructuralHash({
    rootNodeIds,
    nodes,
    partialReasons: result.partialReasons,
  })}`
  const byteLength = new TextEncoder().encode(JSON.stringify(result)).byteLength
  if (byteLength > args.maxBytes) {
    throw domSnapshotError(
      'DOM_SNAPSHOT_TOO_LARGE',
      `DOM snapshot requires ${byteLength} bytes and exceeds the ${args.maxBytes}-byte request limit. Narrow scopeSelector or maxNodes.`,
    )
  }
  return result
}

globalThis.__CLAUDE_CHROME_DOM_SNAPSHOT__ = Object.freeze({
  create: createSanitizedDomSnapshot,
  normalizeText: normalizeDomSnapshotText,
  sanitizeUrl: sanitizeDomSnapshotUrl,
})
