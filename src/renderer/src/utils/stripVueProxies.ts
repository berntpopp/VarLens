import { isRef, toRaw, unref } from 'vue'

/**
 * Sprint A A2: strip Vue reactive()/ref() proxies and deep-clone in one pass.
 *
 * Replaces renderer-side cloneForIpc — `structuredClone` throws DataCloneError
 * on Vue proxies; JSON round-trip works but is opaque. This walker handles
 * proxies natively, then returns plain JS that is safe to ship over IPC.
 *
 * Cross-process / main-side callers should use `structuredClone` directly
 * on already-plain input.
 */
export function stripVueProxies<T>(value: T): T {
  return stripInner(value, new WeakMap()) as T
}

function stripInner(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || value === undefined) return value
  if (isRef(value)) return stripInner(unref(value), seen)
  if (typeof value !== 'object') return value

  const raw = toRaw(value as object)
  const cached = seen.get(raw)
  if (cached !== undefined) return cached

  if (Array.isArray(raw)) {
    const arr: unknown[] = []
    seen.set(raw, arr)
    for (const item of raw) arr.push(stripInner(item, seen))
    return arr
  }

  const out: Record<string, unknown> = {}
  seen.set(raw, out)
  for (const k of Object.keys(raw)) {
    out[k] = stripInner((raw as Record<string, unknown>)[k], seen)
  }
  return out
}
