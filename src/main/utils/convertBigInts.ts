/**
 * Recursively convert BigInt values to Number for IPC serialization.
 *
 * IPC structured-clone cannot serialize BigInt. This converts them to Number,
 * which is safe for values within Number.MAX_SAFE_INTEGER (all our use cases).
 */
export function convertBigInts<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj) as unknown as T
  if (Array.isArray(obj)) return obj.map(convertBigInts) as unknown as T
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertBigInts(value)
    }
    return result as T
  }
  return obj
}
