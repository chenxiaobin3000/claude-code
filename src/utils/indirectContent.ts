import { escapeXml, escapeXmlAttr } from './xml.js'

export type IndirectContentSource =
  | 'agent'
  | 'mcp'
  | 'repository'
  | 'shell'
  | 'web'

export function formatIndirectContent(
  source: IndirectContentSource,
  content: string,
): string {
  return `<untrusted-content source="${escapeXmlAttr(source)}">\n${escapeXml(content)}\n</untrusted-content>`
}
