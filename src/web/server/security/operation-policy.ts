/**
 * Policy vocabulary for the web operation security map
 * (operation-security-map.ts). One entry per reachable operation decides:
 *
 *   - `kind`     read (no server-side state change) or write
 *   - `minRole`  least role allowed to call it (`public` = no session needed)
 *   - `audit`    how the call reaches the audit trail
 *
 * The audit rule is a closed union, so a write can only be declared as
 * audited by the wrapper, audited by its handler (naming the event), or
 * exempt WITH a reason. `tests/web-gate/operation-security-registry.test.ts`
 * enforces that every reachable operation has an entry and that exemption
 * reasons are real sentences.
 */
import type { UserRole } from '../../../shared/auth/auth-constants'

export type MinRole = 'public' | UserRole

export type AuditRule =
  /** secure() appends `api_read` / `api_write` after a successful call. */
  | { mode: 'wrapper' }
  /** The handler appends its own, more specific row (e.g. `auth_login_success`). */
  | { mode: 'handler'; event: string }
  /** Not audited; the reason is mandatory and reviewed. */
  | { mode: 'exempt'; reason: string }

export interface OperationPolicy {
  kind: 'read' | 'write'
  minRole: MinRole
  audit: AuditRule
}

const WRAPPER: AuditRule = Object.freeze({ mode: 'wrapper' })

/** Audited read; viewers and up unless stated. */
export function read(minRole: MinRole = 'viewer'): OperationPolicy {
  return { kind: 'read', minRole, audit: WRAPPER }
}

/** Read that is deliberately not audited (polls, pickers, capability probes). */
export function readExempt(reason: string, minRole: MinRole = 'viewer'): OperationPolicy {
  return { kind: 'read', minRole, audit: { mode: 'exempt', reason } }
}

/** Audited write; analysts and up unless stated. */
export function write(minRole: MinRole = 'analyst'): OperationPolicy {
  return { kind: 'write', minRole, audit: WRAPPER }
}

/** Write whose handler records its own domain-specific audit row. */
export function writeAuditedByHandler(event: string, minRole: MinRole): OperationPolicy {
  return { kind: 'write', minRole, audit: { mode: 'handler', event } }
}

/** Write that is deliberately not audited (only harmless, self-scoped effects). */
export function writeExempt(reason: string, minRole: MinRole = 'analyst'): OperationPolicy {
  return { kind: 'write', minRole, audit: { mode: 'exempt', reason } }
}
