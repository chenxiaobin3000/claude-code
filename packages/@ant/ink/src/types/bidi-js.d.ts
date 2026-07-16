declare module 'bidi-js' {
  interface BidiInstance {
    getEmbeddingLevels(
      text: string,
      defaultDirection?: string,
    ): { paragraphLevel: number; levels: Uint8Array }
    getReorderSegments(
      text: string,
      embeddingLevels: { paragraphLevel: number; levels: Uint8Array },
      start?: number,
      end?: number,
    ): [number, number][]
    getVisualOrder(reorderSegments: [number, number][]): number[]
  }

  export default function bidiFactory(): BidiInstance
}
