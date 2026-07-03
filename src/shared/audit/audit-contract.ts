import { ROLE_ADMIN, ROLE_USER } from '../auth/auth-constants'

type SafeAuditObject = Record<string, unknown>

export type AuditActionType =
  | 'acmg_classify'
  | 'acmg_evidence_update'
  | 'star'
  | 'unstar'
  | 'comment_add'
  | 'comment_edit'
  | 'comment_delete'
  | 'tag_assign'
  | 'tag_remove'
  | 'auth_login_success'
  | 'auth_login_failure'
  | 'auth_logout'
  | 'auth_password_change'
  | 'auth_password_reset'
  | 'auth_user_deactivate'
  | 'api_read'
  | 'api_write'

export type AuditEntityType =
  'variant_annotation' | 'case_variant_annotation' | 'user_account' | 'api_call'

export const AUDIT_ROLE_MEANINGS = Object.freeze({
  [ROLE_ADMIN]: 'App administrator',
  [ROLE_USER]: 'Clinical user'
})

const REDACTED_VALUE = Object.freeze({ redacted: true })
const REDACTED_TEXT_VALUE = Object.freeze({ redacted: true, kind: 'text' })
const REDACTED_METADATA_VALUE = Object.freeze({ redacted: true, kind: 'metadata' })

const SENSITIVE_KEY_PATTERN =
  /(payload|patient|file|content|comment|note|case_data|variant_details|variants|genotype|phenotype|hpo|sample|vcf|json|zip|password|secret|token|path|email|display_name|name)/i

function parseAuditValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return value

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    return REDACTED_TEXT_VALUE
  }
}

function isPlainObject(value: unknown): value is SafeAuditObject {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function sanitizeAuditField(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }

  switch (key) {
    case 'success':
    case 'must_change_password':
      return value === true
    case 'acmg_classification':
      return value === null || value === undefined ? null : String(value)
    case 'acmg_evidence':
      return { present: value !== null && value !== undefined && String(value).length > 0 }
    case 'starred':
      return value === true || value === 1 ? 1 : 0
    case 'tag_id':
      return typeof value === 'number' ? value : String(value)
    case 'role':
      return value === ROLE_ADMIN || value === ROLE_USER ? value : 'unknown'
    case 'method':
    case 'reason':
      return typeof value === 'string' && value.length <= 120 ? value : undefined
    case 'audited':
      return value === false ? false : true
    default:
      return undefined
  }
}

function sanitizeAuditObject(value: SafeAuditObject): SafeAuditObject {
  const safe: SafeAuditObject = {}

  for (const [key, rawValue] of Object.entries(value)) {
    const sanitizedValue = sanitizeAuditField(key, rawValue)
    if (sanitizedValue !== undefined) safe[key] = sanitizedValue
  }

  return Object.keys(safe).length > 0 || Object.keys(value).length === 0 ? safe : REDACTED_VALUE
}

export function serializeAuditContractValue(value: unknown): string | null {
  const parsed = parseAuditValue(value)
  if (parsed === null) return null
  if (isPlainObject(parsed)) return JSON.stringify(sanitizeAuditObject(parsed))
  return JSON.stringify(REDACTED_VALUE)
}

export function serializeAuditContractMetadata(value: unknown): string | null {
  const parsed = parseAuditValue(value)
  if (parsed === null) return null
  if (!isPlainObject(parsed)) return JSON.stringify(REDACTED_METADATA_VALUE)

  const source = parsed.source
  if (typeof source === 'string' && source.length > 0 && source.length <= 80) {
    return JSON.stringify({ source })
  }

  return Object.keys(parsed).length === 0
    ? JSON.stringify({})
    : JSON.stringify(REDACTED_METADATA_VALUE)
}
