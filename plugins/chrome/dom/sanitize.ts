import type { ChromeDomSnapshotIndex } from './schema.js'

export function normalizeDomValue(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function collectDomNodeText(
  index: ChromeDomSnapshotIndex,
  nodeId: string,
): string {
  const root = index.nodesById.get(nodeId)
  if (!root) throw new Error(`DOM snapshot node does not exist: ${nodeId}`)
  const values: string[] = []
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()!
    const text = normalizeDomValue(node.text)
    if (text) values.push(text)
    for (let position = node.childIds.length - 1; position >= 0; position--) {
      const child = index.nodesById.get(node.childIds[position]!)
      if (child) pending.push(child)
    }
  }
  return normalizeDomValue(values.join(' '))
}

export function normalizeColumnName(value: unknown, index: number): string {
  return normalizeDomValue(value) || `column_${index + 1}`
}

export function makeUniqueColumnNames(values: readonly string[]): string[] {
  const counts = new Map<string, number>()
  return values.map((value, index) => {
    const base = normalizeColumnName(value, index)
    const count = (counts.get(base) ?? 0) + 1
    counts.set(base, count)
    return count === 1 ? base : `${base}_${count}`
  })
}
