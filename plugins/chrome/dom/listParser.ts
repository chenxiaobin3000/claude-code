import type { ChromeDomSnapshotResult } from '../protocol/index.js'
import { collectDomNodeText } from './sanitize.js'
import { indexChromeDomSnapshot } from './schema.js'

export interface ParseDomListOptions {
  listNodeId?: string
  maxItems?: number
  offset?: number
  itemMatchName?: string
  fieldMatchNames?: Readonly<Record<string, string>>
}

export interface ParsedDomListItem {
  index: number
  depth: number
  text: string
  links: string[]
  data: Record<string, string>
  fields: Record<string, string>
}

export interface ParsedDomList {
  listNodeId: string
  ordered: boolean
  items: ParsedDomListItem[]
  sourceItemCount: number
  returnedItemCount: number
  offset: number
  truncated: boolean
}

function validateMaxItems(value: number | undefined): number {
  const maxItems = value ?? 1_000
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10_000) {
    throw new Error('DOM list maxItems must be between 1 and 10000')
  }
  return maxItems
}

function validateOffset(value: number | undefined): number {
  const offset = value ?? 0
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000_000) {
    throw new Error('DOM list offset must be between 0 and 10000000')
  }
  return offset
}

export function parseDomList(
  snapshotValue: ChromeDomSnapshotResult | unknown,
  options: ParseDomListOptions = {},
): ParsedDomList {
  const index = indexChromeDomSnapshot(snapshotValue)
  const list = options.listNodeId
    ? index.nodesById.get(options.listNodeId)
    : options.itemMatchName
      ? index.nodesById.get(index.snapshot.rootNodeIds[0] ?? '')
      : index.snapshot.nodes.find(node => node.tag === 'ul' || node.tag === 'ol')
  if (
    !list ||
    (!options.itemMatchName && list.tag !== 'ul' && list.tag !== 'ol')
  ) {
    throw new Error('DOM snapshot does not contain the requested list')
  }
  const allItems = index.snapshot.nodes.filter(node => {
    if (options.itemMatchName) {
      if (!node.matches?.includes(options.itemMatchName)) return false
    } else if (node.tag !== 'li') {
      return false
    }
    let parentId = node.parentId
    while (parentId) {
      if (parentId === list.id) return true
      parentId = index.nodesById.get(parentId)?.parentId
    }
    return false
  })
  const maxItems = validateMaxItems(options.maxItems)
  const offset = validateOffset(options.offset)
  const items = allItems.slice(offset, offset + maxItems).map((item, itemIndex) => {
    const descendantIds: string[] = []
    const pending = [...item.childIds]
    for (let position = 0; position < pending.length; position++) {
      const id = pending[position]!
      const descendant = index.nodesById.get(id)
      if (!descendant) continue
      descendantIds.push(id)
      if (
        options.itemMatchName &&
        descendant.matches?.includes(options.itemMatchName)
      ) {
        continue
      }
      pending.push(...descendant.childIds)
    }
    const descendants = descendantIds
      .map(id => index.nodesById.get(id)!)
      .filter(Boolean)
    return {
      index: item.list?.itemIndex ?? offset + itemIndex,
      depth: item.list?.level ?? 1,
      text: collectDomNodeText(index, item.id),
      links: [
        ...new Set(
          descendants
            .map(node => node.href)
            .filter((href): href is string => typeof href === 'string'),
        ),
      ],
      data: Object.assign({}, item.data),
      fields: Object.fromEntries(
        Object.entries(options.fieldMatchNames ?? {}).map(
          ([fieldName, matchName]) => {
            const values = [item, ...descendants]
              .filter(node => node.matches?.includes(matchName))
              .map(node => collectDomNodeText(index, node.id))
              .filter(Boolean)
            return [fieldName, [...new Set(values)].join(' ')]
          },
        ),
      ),
    }
  })
  return {
    listNodeId: list.id,
    ordered: list.tag === 'ol',
    items,
    sourceItemCount: allItems.length,
    returnedItemCount: items.length,
    offset,
    truncated: offset + items.length < allItems.length,
  }
}
