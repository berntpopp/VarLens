/**
 * Web-mode `window.api`: an explicit, typed client derived from the parity
 * manifest (spec §4.3, Limin L6). No Proxy: every `WindowAPI` method exists
 * as a real function and nothing else does, so `typeof api.x.y` reflects the
 * contract and an undeclared method is a compile error.
 *
 * Per manifest policy:
 *   shared        RPC `POST {BASE}/api/<domain>/<method>` with `{ args }`
 *   adapter       browser implementation from local-api.ts (uploads, downloads,
 *                 server-sent events, client equivalents)
 *   desktop-only  refused locally with UNSUPPORTED_RUNTIME, never sent
 *   pending       refused locally with UNSUPPORTED_RUNTIME until served
 *
 * Shared calls the session's role may not make are refused locally with
 * FORBIDDEN (call-policy.ts), fail-closed until the capability document loads.
 * tests/shared/ipc/web-client-coverage.test.ts covers the whole surface.
 */
import type { CapabilityDocument } from '../../shared/ipc/capability-document'
import { listManifestEntries } from '../../shared/ipc/parity-manifest'
import type { ManifestEntry } from '../../shared/ipc/parity-manifest-types'
import type { WindowAPI } from '../../shared/types/api'
import { isIpcError } from '../../shared/types/errors'
import { refusalFor, setCapabilityDocument, WebCallRefusedError } from './call-policy'
import { LOCAL_API } from './local-api'
import { httpInvoke } from './transport'

export { WEB_UPLOAD_CANCEL_EVENT, WEB_UPLOAD_EVENT } from './uploads'
export type { WebUploadEventDetail, WebUploadStatus } from './uploads'

type AnyFunction = (...args: unknown[]) => unknown

function isSubscription(method: string): boolean {
  return /^on[A-Z]/.test(method)
}

function refusedMethod(entry: ManifestEntry): AnyFunction {
  const refusal = refusalFor(entry.domain, entry.method, entry.policy)
  if (refusal === null) {
    throw new Error(`web client: ${entry.domain}.${entry.method} is not refused`)
  }
  // A subscription without a bridge is a typed error, never a silent no-op.
  if (isSubscription(entry.method)) {
    return () => {
      throw new WebCallRefusedError(refusal)
    }
  }
  return () => Promise.resolve(refusal)
}

function remoteMethod(entry: ManifestEntry): AnyFunction {
  const { domain, method, policy } = entry
  const invoke = (args: unknown[]): Promise<unknown> => {
    const refusal = refusalFor(domain, method, policy)
    if (refusal !== null) return Promise.resolve(refusal)
    return httpInvoke(domain, method, args)
  }
  if (domain === 'system' && method === 'getCapabilities') {
    // Keep the call policy in step with the document the store just loaded.
    return async (...args) => {
      const result = await invoke(args)
      setCapabilityDocument(isIpcError(result) ? null : (result as CapabilityDocument))
      return result
    }
  }
  return (...args) => invoke(args)
}

function localMethod(entry: ManifestEntry): AnyFunction {
  const slice = LOCAL_API[entry.domain] as Record<string, AnyFunction | undefined> | undefined
  const implementation = slice?.[entry.method]
  if (implementation === undefined) {
    throw new Error(`web client: adapter ${entry.domain}.${entry.method} has no implementation`)
  }
  return implementation
}

function methodFor(entry: ManifestEntry): AnyFunction {
  switch (entry.policy.policy.web) {
    case 'shared':
      return remoteMethod(entry)
    case 'adapter':
      return localMethod(entry)
    case 'desktop-only':
    case 'pending':
      return refusedMethod(entry)
  }
}

export function createApi(): WindowAPI {
  const api: Record<string, Record<string, AnyFunction>> = {}
  for (const entry of listManifestEntries()) {
    api[entry.domain] ??= {}
    api[entry.domain][entry.method] = methodFor(entry)
  }
  for (const domain of Object.values(api)) Object.freeze(domain)
  // The manifest `satisfies` the full WindowAPI shape (parity-manifest.ts), so
  // this object has exactly one function per WindowAPI method.
  return Object.freeze(api) as unknown as WindowAPI
}
