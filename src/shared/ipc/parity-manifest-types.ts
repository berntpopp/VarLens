/**
 * Types for the desktop ↔ web parity manifest (`parity-manifest.ts`).
 *
 * Every `window.api.<domain>.<method>` carries exactly one `ChannelPolicy`
 * that says how the web runtime serves it. The manifest is checked with
 * `satisfies ParityManifestShape`, so a new preload method without a policy,
 * or a stale entry for a removed method, is a typecheck error.
 *
 * Spec: .planning/specs/2026-10-06-desktop-web-parity-spec.md §4.2
 */
import type { UserRole } from '../auth/auth-constants'
import type { WindowAPI } from '../types/api'
import type { CapabilityFeature } from './capability-features'

/** How an HTTP-served method reaches the server, or why it doesn't. */
export type WebPolicy =
  /** Same handler, served by the web dispatcher (`POST /api/<domain>/<method>`). */
  | { readonly web: 'shared' }
  /**
   * Implemented in the typed web client instead of a dispatcher RPC:
   * browser upload pickers (`upload`), streamed downloads (`download`),
   * server-sent events (`sse`) or a pure client equivalent (`client`).
   */
  | { readonly web: 'adapter'; readonly via: 'upload' | 'download' | 'sse' | 'client' }
  /** Never reachable over HTTP; the renderer must gate the call on its capability. */
  | { readonly web: 'desktop-only'; readonly webUx: string }
  /** Temporary web gap, ratcheted by scripts/parity-baseline.json (may only shrink). */
  | { readonly web: 'pending'; readonly tracking: string; readonly webUx: string }

/**
 * Least role that may call the method (`public` needs no session: login
 * flow). Roles are ordered viewer < analyst < admin; data is shared and the
 * role gates writes. For served methods this must equal the web security
 * map's `minRole` (tests/shared/ipc/parity-manifest.test.ts).
 */
export type ChannelAuthz = 'public' | UserRole

/** Audit expectation for the web dispatcher (L9). */
export type ChannelAudit = 'write' | 'read' | { readonly exempt: string }

export interface ChannelPolicy {
  readonly policy: WebPolicy
  readonly authz: ChannelAuthz
  readonly audit: ChannelAudit
  /**
   * Capability feature the renderer gates on. Required for `desktop-only`
   * and `pending` methods (enforced by tests/shared/ipc/parity-manifest.test.ts).
   */
  readonly capability?: CapabilityFeature
  /** A served method whose web behaviour is known to differ, with its owner. */
  readonly degraded?: { readonly tracking: string; readonly note: string }
}

/** Method names of a `window.api` domain (functions only). */
export type DomainMethod<D extends keyof WindowAPI> = Extract<keyof WindowAPI[D], string>

/** Per-domain manifest slice: exactly one policy per preload method. */
export type DomainManifest<D extends keyof WindowAPI> = {
  readonly [M in DomainMethod<D>]: ChannelPolicy
}

/** Shape the manifest must satisfy: every domain, every method. */
export type ParityManifestShape = {
  readonly [D in keyof WindowAPI]: DomainManifest<D>
}

export interface ManifestEntry {
  readonly domain: keyof WindowAPI
  readonly method: string
  readonly policy: ChannelPolicy
}

// ---------------------------------------------------------------------------
// Constructors. Keep manifest slices one line per method.
// ---------------------------------------------------------------------------

interface PolicyOptions {
  readonly authz?: ChannelAuthz
  readonly audit?: ChannelAudit
  readonly capability?: CapabilityFeature
  readonly degraded?: { readonly tracking: string; readonly note: string }
}

const NOT_SERVED: ChannelAudit = { exempt: 'not served by the web dispatcher' }

/**
 * Writes default to analyst (viewers are read-only), everything else to
 * viewer (any signed-in account).
 */
function build(policy: WebPolicy, defaults: ChannelAudit, options: PolicyOptions): ChannelPolicy {
  return {
    policy,
    authz: options.authz ?? (defaults === 'write' ? 'analyst' : 'viewer'),
    audit: options.audit ?? defaults,
    ...(options.capability !== undefined ? { capability: options.capability } : {}),
    ...(options.degraded !== undefined ? { degraded: options.degraded } : {})
  }
}

/** Shared read (dispatcher read-audits it). */
export function sharedRead(options: PolicyOptions = {}): ChannelPolicy {
  return build({ web: 'shared' }, 'read', options)
}

/** Shared write (dispatcher write-audits it). */
export function sharedWrite(options: PolicyOptions = {}): ChannelPolicy {
  return build({ web: 'shared' }, 'write', options)
}

/** Shared method that the dispatcher deliberately does not audit. */
export function sharedExempt(reason: string, options: PolicyOptions = {}): ChannelPolicy {
  return build({ web: 'shared' }, { exempt: reason }, options)
}

export function adapter(
  via: 'upload' | 'download' | 'sse' | 'client',
  options: PolicyOptions = {}
): ChannelPolicy {
  return build({ web: 'adapter', via }, NOT_SERVED, options)
}

export function desktopOnly(
  capability: CapabilityFeature,
  webUx: string,
  options: Omit<PolicyOptions, 'capability'> = {}
): ChannelPolicy {
  return build({ web: 'desktop-only', webUx }, NOT_SERVED, { ...options, capability })
}

export function pending(
  capability: CapabilityFeature,
  tracking: string,
  webUx: string,
  options: Omit<PolicyOptions, 'capability'> = {}
): ChannelPolicy {
  return build({ web: 'pending', tracking, webUx }, NOT_SERVED, { ...options, capability })
}
