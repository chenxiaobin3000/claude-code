import type {
  ChromeDomSnapshotNode,
  ChromeDomSnapshotResult,
} from '../protocol/index.js'
import { collectDomNodeText, makeUniqueColumnNames } from './sanitize.js'
import { indexChromeDomSnapshot } from './schema.js'

export interface ParseDomTableOptions {
  tableNodeId?: string
  maxRows?: number
  columnAliases?: Readonly<Record<string, string>>
}

export interface ParsedDomTable {
  tableNodeId: string
  columns: string[]
  rows: Array<Record<string, string>>
  sourceRowCount: number
  returnedRowCount: number
  truncated: boolean
}

function nearestAncestor(
  node: ChromeDomSnapshotNode,
  nodesById: ReadonlyMap<string, ChromeDomSnapshotNode>,
  tag: string,
): ChromeDomSnapshotNode | undefined {
  let parentId = node.parentId
  while (parentId) {
    const parent = nodesById.get(parentId)
    if (!parent) return undefined
    if (parent.tag === tag) return parent
    parentId = parent.parentId
  }
  return undefined
}

function validateMaxRows(value: number | undefined): number {
  const maxRows = value ?? 1_000
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10_000) {
    throw new Error('DOM table maxRows must be between 1 and 10000')
  }
  return maxRows
}

export function parseDomTable(
  snapshotValue: ChromeDomSnapshotResult | unknown,
  options: ParseDomTableOptions = {},
): ParsedDomTable {
  const index = indexChromeDomSnapshot(snapshotValue)
  const table = options.tableNodeId
    ? index.nodesById.get(options.tableNodeId)
    : index.snapshot.nodes.find(node => node.tag === 'table')
  if (!table || table.tag !== 'table') {
    throw new Error('DOM snapshot does not contain the requested table')
  }
  const rows = index.snapshot.nodes.filter(
    node =>
      node.tag === 'tr' &&
      nearestAncestor(node, index.nodesById, 'table')?.id === table.id,
  )
  if (rows.length === 0) {
    return {
      tableNodeId: table.id,
      columns: [],
      rows: [],
      sourceRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
    }
  }

  const grid: Array<Array<string | undefined>> = []
  const rowKinds: Array<'header' | 'data'> = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!
    const cells = index.snapshot.nodes.filter(
      node =>
        (node.tag === 'th' || node.tag === 'td') &&
        nearestAncestor(node, index.nodesById, 'tr')?.id === row.id &&
        nearestAncestor(node, index.nodesById, 'table')?.id === table.id,
    )
    rowKinds.push(
      cells.length > 0 && cells.every(cell => cell.tag === 'th')
        ? 'header'
        : 'data',
    )
    grid[rowIndex] ??= []
    let columnIndex = 0
    for (const cell of cells) {
      while (grid[rowIndex]![columnIndex] !== undefined) columnIndex++
      const value = collectDomNodeText(index, cell.id)
      const rowSpan = Math.max(1, cell.table?.rowSpan ?? 1)
      const colSpan = Math.max(1, cell.table?.colSpan ?? 1)
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset++) {
        const targetRow = rowIndex + rowOffset
        grid[targetRow] ??= []
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset++) {
          grid[targetRow]![columnIndex + columnOffset] = value
        }
      }
      columnIndex += colSpan
    }
  }

  const columnCount = grid.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  )
  let headerRowCount = 0
  while (rowKinds[headerRowCount] === 'header') headerRowCount++
  const rawColumns = Array.from({ length: columnCount }, (_, columnIndex) => {
    if (headerRowCount === 0) return ''
    const parts: string[] = []
    for (let rowIndex = 0; rowIndex < headerRowCount; rowIndex++) {
      const value = grid[rowIndex]?.[columnIndex] ?? ''
      if (value && parts.at(-1) !== value) parts.push(value)
    }
    return parts.join(' / ')
  })
  const uniqueColumns = makeUniqueColumnNames(rawColumns)
  const columns = uniqueColumns.map(
    name => options.columnAliases?.[name] ?? name,
  )
  const finalColumns = makeUniqueColumnNames(columns)
  const sourceRows = grid.slice(headerRowCount, rows.length)
  const maxRows = validateMaxRows(options.maxRows)
  const parsedRows = sourceRows.slice(0, maxRows).map(row =>
    Object.fromEntries(
      finalColumns.map((column, columnIndex) => [
        column,
        row[columnIndex] ?? '',
      ]),
    ),
  )
  return {
    tableNodeId: table.id,
    columns: finalColumns,
    rows: parsedRows,
    sourceRowCount: sourceRows.length,
    returnedRowCount: parsedRows.length,
    truncated: parsedRows.length < sourceRows.length,
  }
}
