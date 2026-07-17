export type ParentLinked<ID> = { uuid: ID; parentUuid: ID | null }

export function walkParentChain<ID, T extends ParentLinked<ID>>(
  messages: ReadonlyMap<ID, T>,
  leafMessage: T,
): { chain: T[]; seen: Set<ID>; cycleAt?: ID } {
  const chain: T[] = []
  const seen = new Set<ID>()
  let current: T | undefined = leafMessage
  let cycleAt: ID | undefined
  while (current) {
    if (seen.has(current.uuid)) {
      cycleAt = current.uuid
      break
    }
    seen.add(current.uuid)
    chain.push(current)
    current = current.parentUuid
      ? messages.get(current.parentUuid)
      : undefined
  }
  chain.reverse()
  return { chain, seen, cycleAt }
}
