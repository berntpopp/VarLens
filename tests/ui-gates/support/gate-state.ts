import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import type { GateServerState } from './gate-server'

export const GATE_OUTPUT_DIR = resolve(
  process.cwd(),
  process.env.UI_GATES_OUTPUT ?? 'test-results/ui-gates'
)
export const GATE_STATE_PATH = resolve(GATE_OUTPUT_DIR, 'server-state.json')
export const GATE_STORAGE_STATE_PATH = resolve(GATE_OUTPUT_DIR, 'storage-state.json')
export const DISCLAIMER_STORAGE_KEY = 'varlens_disclaimer_acknowledged_version'

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function readGateState(): GateServerState {
  return JSON.parse(readFileSync(GATE_STATE_PATH, 'utf8')) as GateServerState
}

/** Playwright storageState: logged-in session + Research-Use disclaimer acknowledged. */
export function buildStorageState(state: GateServerState): unknown {
  return {
    cookies: [
      {
        name: state.sessionCookie.name,
        value: state.sessionCookie.value,
        domain: '127.0.0.1',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Strict'
      }
    ],
    origins: [
      {
        origin: state.baseURL,
        localStorage: [{ name: DISCLAIMER_STORAGE_KEY, value: state.appVersion }]
      }
    ]
  }
}
