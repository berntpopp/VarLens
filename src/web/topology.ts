import { isAbsolute } from 'node:path'

export type WebDbTopologyMode = 'single' | 'hosted'

export interface SingleWebDbTopology {
  mode: 'single'
}

export interface HostedWebDbTopology {
  mode: 'hosted'
  controlReadUrl: string
  controlStateUrl: string
  workspaceSecretDir: string
  publicAnnotationUrl?: string
  pools: {
    controlPoolMax: number
    publicAnnotationPoolMax: number
    workspacePoolMax: number
    workspacePoolGlobalMax: number
    workspacePoolIdleMs: number
  }
  legacySinglePgUrlPresent: boolean
}

export type WebDbTopology = SingleWebDbTopology | HostedWebDbTopology

const HOSTED_ONLY_ENV = [
  'VARLENS_CONTROL_RO_PG_URL',
  'VARLENS_CONTROL_STATE_PG_URL',
  'VARLENS_PUBLIC_ANNOTATION_PG_URL',
  'VARLENS_WORKSPACE_DB_SECRET_DIR',
  'VARLENS_CONTROL_POOL_MAX',
  'VARLENS_PUBLIC_ANNOTATION_POOL_MAX',
  'VARLENS_WORKSPACE_POOL_MAX',
  'VARLENS_WORKSPACE_POOL_GLOBAL_MAX',
  'VARLENS_WORKSPACE_POOL_IDLE_MS'
] as const

const POSTGRES_SCHEMES = new Set(['postgres:', 'postgresql:'])

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function parseMode(raw: string | undefined): WebDbTopologyMode {
  if (!hasValue(raw)) return 'single'
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'single' || normalized === 'hosted') return normalized
  throw new Error('VARLENS_WEB_DB_TOPOLOGY must be either "single" or "hosted"')
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!hasValue(value)) {
    throw new Error(`${name} is required when VARLENS_WEB_DB_TOPOLOGY=hosted`)
  }
  return value.trim()
}

function validatePostgresUrl(envName: string, value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${envName} must be a valid PostgreSQL connection URL`)
  }

  if (!POSTGRES_SCHEMES.has(parsed.protocol)) {
    throw new Error(`${envName} must use the postgres: or postgresql: scheme`)
  }

  return value
}

function optionalPostgresUrl(env: NodeJS.ProcessEnv, envName: string): string | undefined {
  const value = env[envName]
  if (!hasValue(value)) return undefined
  return validatePostgresUrl(envName, value.trim())
}

function parsePositiveInteger(
  env: NodeJS.ProcessEnv,
  envName: string,
  fallback: number
): number {
  const value = env[envName]
  if (!hasValue(value)) return fallback

  const normalized = value.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${envName} must be a positive integer`)
  }
  return Number(normalized)
}

function assertNoHostedEnvInSingleMode(env: NodeJS.ProcessEnv): void {
  const present = HOSTED_ONLY_ENV.filter((name) => hasValue(env[name]))
  if (present.length === 0) return
  throw new Error(
    `Hosted-only database variables are set while VARLENS_WEB_DB_TOPOLOGY=single: ${present.join(', ')}`
  )
}

function requireAbsoluteDirectoryEnv(env: NodeJS.ProcessEnv, envName: string): string {
  const value = requireEnv(env, envName)
  if (!isAbsolute(value)) {
    throw new Error(`${envName} must be an absolute directory path`)
  }
  return value
}

export function assertSafeWorkspaceSecretRef(secretRef: string): void {
  if (!hasValue(secretRef)) {
    throw new Error('workspace secret ref must not be blank')
  }
  if (secretRef === '.' || secretRef === '..') {
    throw new Error('workspace secret ref must be a filename, not a directory marker')
  }
  if (secretRef.includes('/') || secretRef.includes('\\') || secretRef.includes('..')) {
    throw new Error('workspace secret ref must be a filename without path traversal')
  }
}

export function readWebDbTopology(env: NodeJS.ProcessEnv = process.env): WebDbTopology {
  const mode = parseMode(env.VARLENS_WEB_DB_TOPOLOGY)
  if (mode === 'single') {
    assertNoHostedEnvInSingleMode(env)
    return { mode: 'single' }
  }

  const publicAnnotationUrl = optionalPostgresUrl(env, 'VARLENS_PUBLIC_ANNOTATION_PG_URL')

  return {
    mode: 'hosted',
    controlReadUrl: validatePostgresUrl(
      'VARLENS_CONTROL_RO_PG_URL',
      requireEnv(env, 'VARLENS_CONTROL_RO_PG_URL')
    ),
    controlStateUrl: validatePostgresUrl(
      'VARLENS_CONTROL_STATE_PG_URL',
      requireEnv(env, 'VARLENS_CONTROL_STATE_PG_URL')
    ),
    workspaceSecretDir: requireAbsoluteDirectoryEnv(env, 'VARLENS_WORKSPACE_DB_SECRET_DIR'),
    ...(publicAnnotationUrl !== undefined ? { publicAnnotationUrl } : {}),
    pools: {
      controlPoolMax: parsePositiveInteger(env, 'VARLENS_CONTROL_POOL_MAX', 4),
      publicAnnotationPoolMax: parsePositiveInteger(
        env,
        'VARLENS_PUBLIC_ANNOTATION_POOL_MAX',
        4
      ),
      workspacePoolMax: parsePositiveInteger(env, 'VARLENS_WORKSPACE_POOL_MAX', 2),
      workspacePoolGlobalMax: parsePositiveInteger(env, 'VARLENS_WORKSPACE_POOL_GLOBAL_MAX', 20),
      workspacePoolIdleMs: parsePositiveInteger(env, 'VARLENS_WORKSPACE_POOL_IDLE_MS', 300_000)
    },
    legacySinglePgUrlPresent: hasValue(env.VARLENS_PG_URL)
  }
}
