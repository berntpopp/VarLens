/**
 * Client-side call policy for the typed web client (spec §4.3, Limin L5).
 *
 * The web client refuses a call before it reaches the network when:
 *   - the parity manifest marks the method `desktop-only` or `pending`
 *     (code UNSUPPORTED_RUNTIME), or
 *   - the method needs a role the session does not have, or the latest
 *     capability document lists it as blocked (code FORBIDDEN).
 *
 * Fail-closed: an `admin` method is refused until a capability document has
 * been loaded that grants the admin role.
 */
import type { CapabilityDocument } from '../../shared/ipc/capability-document'
import { CAPABILITY_FEATURES } from '../../shared/ipc/capability-features'
import type { ChannelPolicy } from '../../shared/ipc/parity-manifest-types'
import { ErrorCode, type SerializableError } from '../../shared/types/errors'

let currentDocument: CapabilityDocument | null = null

/** Record the capability document the server returned for this session. */
export function setCapabilityDocument(document: CapabilityDocument | null): void {
  currentDocument = document
}

export function getCapabilityDocument(): CapabilityDocument | null {
  return currentDocument
}

export class WebCallRefusedError extends Error implements SerializableError {
  readonly code: ErrorCode
  readonly userMessage: string
  readonly details: Record<string, unknown>

  constructor(error: SerializableError) {
    super(error.message)
    this.name = 'WebCallRefusedError'
    this.code = error.code
    this.userMessage = error.userMessage
    this.details = error.details ?? {}
  }
}

function runtimeReason(policy: ChannelPolicy): string {
  const feature = policy.capability
  return feature !== undefined
    ? CAPABILITY_FEATURES[feature].unavailableInWeb
    : 'This action is not available in the web version.'
}

/** Why the web client must not send this call, or null when it may. */
export function refusalFor(
  domain: string,
  method: string,
  policy: ChannelPolicy
): SerializableError | null {
  const key = `${domain}.${method}`
  const web = policy.policy.web
  if (web === 'desktop-only' || web === 'pending') {
    return {
      code: ErrorCode.UNSUPPORTED_RUNTIME,
      message: `${key} is ${web} in the web runtime`,
      userMessage: runtimeReason(policy),
      details: { method: key, policy: web }
    }
  }
  const roleRefused = policy.authz === 'admin' && currentDocument?.role !== 'admin'
  if (roleRefused || currentDocument?.blockedMethods.includes(key) === true) {
    return {
      code: ErrorCode.FORBIDDEN,
      message: `${key} is not allowed for this session`,
      userMessage: 'Your account is not allowed to perform this action.',
      details: { method: key, authz: policy.authz }
    }
  }
  return null
}
