import {
  isChromeDomSnapshotResult,
  type ChromeDomSnapshotNode,
  type ChromeDomSnapshotResult,
} from '../protocol/index.js'

export interface ChromeDomSnapshotIndex {
  snapshot: ChromeDomSnapshotResult
  nodesById: ReadonlyMap<string, ChromeDomSnapshotNode>
}

export function parseChromeDomSnapshot(
  value: unknown,
): ChromeDomSnapshotResult {
  if (!isChromeDomSnapshotResult(value)) {
    throw new Error('Invalid Chrome DOM snapshot response')
  }
  return value
}

export function indexChromeDomSnapshot(
  value: unknown,
): ChromeDomSnapshotIndex {
  const snapshot = parseChromeDomSnapshot(value)
  return {
    snapshot,
    nodesById: new Map(snapshot.nodes.map(node => [node.id, node])),
  }
}

export function descendantNodeIds(
  index: ChromeDomSnapshotIndex,
  rootId: string,
): string[] {
  if (!index.nodesById.has(rootId)) {
    throw new Error(`DOM snapshot node does not exist: ${rootId}`)
  }
  const output: string[] = []
  const pending = [rootId]
  while (pending.length > 0) {
    const id = pending.pop()!
    output.push(id)
    const node = index.nodesById.get(id)!
    for (let position = node.childIds.length - 1; position >= 0; position--) {
      pending.push(node.childIds[position]!)
    }
  }
  return output
}
