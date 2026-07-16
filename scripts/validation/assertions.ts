import { isDeepStrictEqual } from 'node:util'

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

export function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

export async function collectAsync<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}
