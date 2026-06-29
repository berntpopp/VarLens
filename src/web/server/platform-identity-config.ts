export type PlatformAuthMode = 'local' | 'platform'

export interface PlatformIdentityConfig {
  mode: 'platform'
  issuerUrl: string
  clientId: string
  audience: string
  callbackPath: string
  requiredAcr: string
  requiredAmr: string[]
  entitlementsUrl: string
  entitlementsToken?: string
  provisioningToken?: string
  requireHostedResource: boolean
}

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function normalizeMode(raw: string | undefined): PlatformAuthMode {
  if (!hasValue(raw)) return 'local'
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'local' || normalized === 'platform') return normalized
  throw new Error('VARLENS_AUTH_MODE must be either "local" or "platform"')
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!hasValue(value)) {
    throw new Error(`${name} is required when VARLENS_AUTH_MODE=platform`)
  }
  return value.trim()
}

function requireHttpsOrLocalHttpUrl(name: string, raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  const isLocalHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname.endsWith('.svc.cluster.local'))
  if (parsed.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(`${name} must use https, localhost http, or cluster-internal http`)
  }
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString().replace(/\/$/, '')
}

function requirePath(name: string, raw: string): string {
  if (!raw.startsWith('/')) {
    throw new Error(`${name} must start with /`)
  }
  if (raw.includes('\\') || raw.includes('..') || raw.startsWith('//')) {
    throw new Error(`${name} must be a safe absolute path`)
  }
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw
}

function parseRequiredAmr(raw: string): string[] {
  const values = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (values.length === 0) {
    throw new Error('VARLENS_PLATFORM_REQUIRED_AMR must include at least one amr value')
  }
  return values
}

export function readPlatformIdentityConfig(
  env: NodeJS.ProcessEnv = process.env
): PlatformIdentityConfig | null {
  const mode = normalizeMode(env.VARLENS_AUTH_MODE)
  if (mode === 'local') return null

  const issuerUrl = requireHttpsOrLocalHttpUrl(
    'VARLENS_PLATFORM_ISSUER_URL',
    requireEnv(env, 'VARLENS_PLATFORM_ISSUER_URL')
  )
  const entitlementsUrl = requireHttpsOrLocalHttpUrl(
    'VARLENS_PLATFORM_ENTITLEMENTS_URL',
    requireEnv(env, 'VARLENS_PLATFORM_ENTITLEMENTS_URL')
  )
  const clientId = requireEnv(env, 'VARLENS_PLATFORM_CLIENT_ID')
  const audience = requireEnv(env, 'VARLENS_PLATFORM_AUDIENCE')
  const requiredAcr = requireEnv(env, 'VARLENS_PLATFORM_REQUIRED_ACR')
  const requiredAmr = parseRequiredAmr(requireEnv(env, 'VARLENS_PLATFORM_REQUIRED_AMR'))
  const rawCallbackPath = env.VARLENS_PLATFORM_CALLBACK_PATH?.trim()
  const callbackPath = requirePath(
    'VARLENS_PLATFORM_CALLBACK_PATH',
    rawCallbackPath !== undefined && rawCallbackPath !== ''
      ? rawCallbackPath
      : '/auth/platform/callback'
  )
  const entitlementsToken = env.VARLENS_PLATFORM_ENTITLEMENTS_TOKEN?.trim()
  const provisioningToken = env.VARLENS_PLATFORM_PROVISIONING_TOKEN?.trim()

  return {
    mode: 'platform',
    issuerUrl,
    clientId,
    audience,
    callbackPath,
    requiredAcr,
    requiredAmr,
    entitlementsUrl: entitlementsUrl.replace(/\/$/, ''),
    ...(entitlementsToken !== undefined && entitlementsToken !== '' ? { entitlementsToken } : {}),
    ...(provisioningToken !== undefined && provisioningToken !== ''
      ? { provisioningToken }
      : {}),
    requireHostedResource: env.VARLENS_WEB_DB_TOPOLOGY === 'hosted'
  }
}

export function isPlatformIdentityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return normalizeMode(env.VARLENS_AUTH_MODE) === 'platform'
}
