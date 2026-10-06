/**
 * Boots the built web server (`out/web/server.cjs`) against an isolated,
 * throwaway Postgres schema, bootstraps an admin and seeds three synthetic
 * cases. Used by the UI quality gates (axe + Lighthouse) so they run against
 * the same production bundle users get, with deterministic data.
 *
 * Nothing here touches an existing schema: every run creates
 * `<prefix>_<timestamp>_<random>` and drops it on teardown.
 */
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setTimeout as delay } from 'timers/promises'
import { defaultPasswordProvider } from '../../../src/main/auth/providers/argon2-provider'
import { Pool } from 'pg'

export const GATE_CASE_NAMES = ['gate-case-a', 'gate-case-b', 'gate-case-c'] as const
const FIXTURE_PATH = resolve(process.cwd(), 'tests/fixtures/import/columnar-format.json.gz')
const SERVER_ENTRY = resolve(process.cwd(), 'out/web/server.cjs')
const ADMIN_USERNAME = 'ui-gate-admin'

export function gatePort(): number {
  return Number(process.env.UI_GATES_PORT ?? '8870')
}

export function gateBaseURL(): string {
  return `http://127.0.0.1:${gatePort()}`
}

export interface GateServerState {
  baseURL: string
  pid: number
  schema: string
  recoveryDir: string
  username: string
  password: string
  appVersion: string
  sessionCookie: { name: string; value: string }
  cases: Array<{ caseId: number; caseName: string; variantCount: number }>
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required for the UI quality gates (web build + Postgres).`)
  }
  return value
}

function makeSchemaName(): string {
  const prefix = (process.env.UI_GATES_SCHEMA_PREFIX ?? 'ui_gates').replace(/[^a-z0-9_]/gi, '_')
  // Keep it short: the PG repositories derive prepared-statement names from
  // the schema, and Postgres truncates identifiers at 63 characters.
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(2).toString('hex')}`.toLowerCase()
}

async function waitForHealthy(baseURL: string, child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`web server exited early (${child.exitCode})`)
    try {
      const res = await fetch(`${baseURL}/healthz`)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await delay(250)
  }
  throw new Error(`web server at ${baseURL} did not become healthy within 60s`)
}

async function apiCall(
  state: Pick<GateServerState, 'baseURL'>,
  cookie: string,
  path: string,
  init: { body: BodyInit; headers?: Record<string, string> }
): Promise<{ status: number; json: unknown; setCookie: string[] }> {
  const res = await fetch(`${state.baseURL}${path}`, {
    method: 'POST',
    body: init.body,
    headers: {
      origin: state.baseURL,
      accept: 'application/json',
      ...(cookie !== '' ? { cookie } : {}),
      ...init.headers
    }
  })
  const text = await res.text()
  return {
    status: res.status,
    json: text === '' ? null : (JSON.parse(text) as unknown),
    setCookie: res.headers.getSetCookie()
  }
}

async function rpc(
  state: Pick<GateServerState, 'baseURL'>,
  cookie: string,
  domainMethod: string,
  args: unknown[]
): Promise<unknown> {
  const res = await apiCall(state, cookie, `/api/${domainMethod}`, {
    body: JSON.stringify({ args }),
    headers: { 'content-type': 'application/json' }
  })
  if (res.status >= 400) {
    throw new Error(`${domainMethod} failed: HTTP ${res.status} ${JSON.stringify(res.json)}`)
  }
  return res.json
}

async function login(baseURL: string, password: string): Promise<{ name: string; value: string }> {
  const res = await apiCall({ baseURL }, '', '/api/auth/login', {
    body: JSON.stringify({ args: [ADMIN_USERNAME, password] }),
    headers: { 'content-type': 'application/json' }
  })
  const body = res.json as { success?: boolean } | null
  if (res.status !== 200 || body?.success !== true) {
    throw new Error(`gate admin login failed: HTTP ${res.status} ${JSON.stringify(body)}`)
  }
  const raw = res.setCookie.find((c) => c.includes('varlens.sid'))
  if (raw === undefined) throw new Error('login did not set a session cookie')
  const [pair] = raw.split(';')
  const eq = pair.indexOf('=')
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1) }
}

async function seedCases(baseURL: string, cookie: string): Promise<GateServerState['cases']> {
  const fixture = readFileSync(FIXTURE_PATH)
  const cases: GateServerState['cases'] = []
  for (const caseName of GATE_CASE_NAMES) {
    const upload = await apiCall({ baseURL }, cookie, '/api/import/upload', {
      body: fixture,
      headers: {
        'content-type': 'application/octet-stream',
        'x-varlens-file-name': `${caseName}.json.gz`
      }
    })
    const ref = (upload.json as { ref?: string } | null)?.ref
    if (upload.status !== 200 || ref === undefined) {
      throw new Error(`fixture upload failed: HTTP ${upload.status} ${JSON.stringify(upload.json)}`)
    }
    const result = (await rpc({ baseURL }, cookie, 'import/start', [ref, caseName])) as {
      caseId: number
      variantCount: number
    }
    cases.push({ caseId: result.caseId, caseName, variantCount: result.variantCount })
  }
  return cases
}

export async function startGateServer(): Promise<GateServerState> {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error('out/web/server.cjs is missing. Run `VARLENS_WEB_BASE=/ npm run build:web`.')
  }
  const pgUrl = requireEnv('VARLENS_PG_URL')
  const port = gatePort()
  const baseURL = gateBaseURL()
  const schema = makeSchemaName()
  const recoveryDir = mkdtempSync(join(tmpdir(), 'varlens-ui-gates-'))
  const password = randomBytes(18).toString('base64url')
  const appVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string })
    .version

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: false,
    env: {
      ...process.env,
      // development only relaxes the Secure cookie flag (plain http on
      // localhost) and enables the latency knob, which we pin to 0.
      NODE_ENV: 'development',
      VARLENS_WEB_API_LATENCY_MS: '0',
      APP_PATH_PREFIX: '/',
      VARLENS_WEB_HOST: '127.0.0.1',
      VARLENS_WEB_PORT: String(port),
      VARLENS_PG_URL: pgUrl,
      VARLENS_PG_SCHEMA: schema,
      VARLENS_RECOVERY_KEY_DIR: recoveryDir,
      VARLENS_METRICS_ENABLED: '0',
      VARLENS_METRICS_PORT: process.env.UI_GATES_METRICS_PORT ?? '0',
      VARLENS_LOG_LEVEL: 'warn',
      VARLENS_ADMIN_USERNAME: ADMIN_USERNAME,
      VARLENS_ADMIN_DISPLAY_NAME: 'UI Gate Admin',
      VARLENS_ADMIN_PASSWORD_HASH: await defaultPasswordProvider.hashPassword(password),
      VARLENS_ADMIN_MUST_CHANGE_PASSWORD: 'false'
    }
  })
  if (child.pid === undefined) throw new Error('failed to spawn web server')

  try {
    await waitForHealthy(baseURL, child)
    const sessionCookie = await login(baseURL, password)
    const cookieHeader = `${sessionCookie.name}=${sessionCookie.value}`
    const cases = await seedCases(baseURL, cookieHeader)
    child.unref()
    return {
      baseURL,
      pid: child.pid,
      schema,
      recoveryDir,
      username: ADMIN_USERNAME,
      password,
      appVersion,
      sessionCookie,
      cases
    }
  } catch (error) {
    child.kill('SIGTERM')
    rmSync(recoveryDir, { recursive: true, force: true })
    await dropSchema(pgUrl, schema)
    throw error
  }
}

async function dropSchema(pgUrl: string, schema: string): Promise<void> {
  const pool = new Pool({ connectionString: pgUrl })
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema.replace(/"/g, '')}" CASCADE`)
  } finally {
    await pool.end()
  }
}

export async function stopGateServer(state: GateServerState): Promise<void> {
  try {
    process.kill(state.pid, 'SIGTERM')
  } catch {
    // already gone
  }
  await delay(500)
  rmSync(state.recoveryDir, { recursive: true, force: true })
  await dropSchema(requireEnv('VARLENS_PG_URL'), state.schema)
}
