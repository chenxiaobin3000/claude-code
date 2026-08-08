export interface DomVisualComparison<TDom, TVisual> {
  domValue: TDom
  visualValue: TVisual
  consistent: boolean | null
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/**
 * Keep DOM and visual evidence separate. Callers may supply an explicit
 * comparator; otherwise exact canonical JSON equality is used.
 */
export function compareDomAndVisual<TDom, TVisual>(
  domValue: TDom,
  visualValue: TVisual,
  comparator?: (dom: TDom, visual: TVisual) => boolean,
): DomVisualComparison<TDom, TVisual> {
  return {
    domValue,
    visualValue,
    consistent: comparator
      ? comparator(domValue, visualValue)
      : canonicalJson(domValue) === canonicalJson(visualValue),
  }
}
