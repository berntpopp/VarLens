/**
 * Desktop ↔ web parity contract gate (spec §6, layers 1–2). Runs in the
 * default `make test` — no Postgres, no Electron, no network.
 *
 *   - Desktop: the preload `window.api` forwards every manifest method to the
 *     main process (catches dropped methods like spec P-03).
 *   - Web: every `shared` method resolves on the dispatcher and never answers
 *     404/501; no `desktop-only` method is served; every served key has a
 *     manifest entry (catches alias autoroutes, P-18).
 *   - Ratchet: the `pending` count equals scripts/parity-baseline.json.
 *
 * Flip an entry: see src/shared/ipc/parity-manifest.ts and AGENTS.md.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  countPendingEntries,
  getChannelPolicy,
  listManifestEntries,
  PARITY_MANIFEST
} from '../../../src/shared/ipc/parity-manifest'
import { isCapabilityFeature } from '../../../src/shared/ipc/capability-features'
import { buildDispatcher, registerDispatcher } from '../../../src/web/server/dispatcher'
import {
  checkManifestAgainstDispatcher,
  dispatcherKey
} from '../../../src/web/server/method-resolution'
import { shouldAuditApiRead, shouldAuditOverrideWrite } from '../../../src/web/server/audit'
import { isWriteTaskType } from '../../../src/web/server/task-types'
import { makeDeps } from '../../web-gate/helpers/dispatcher-adapters'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  ipcRenderer: ipc,
  webUtils: { getPathForFile: () => '/tmp/dropped.vcf' },
  contextBridge: { exposeInMainWorld: vi.fn() }
}))

const ROOT = resolve(__dirname, '../../..')
const BASELINE_PATH = resolve(ROOT, 'scripts/parity-baseline.json')

/**
 * Preload methods that legitimately reach no IPC channel, with the reason.
 * Everything else must invoke, send or subscribe on a channel.
 */
const RENDERER_LOCAL_PRELOAD_METHODS: Record<string, string> = {
  'perf.isEnabled': 'reads VARLENS_PERF_MODE in the preload process',
  'perf.resetSnapshot': 'resets the renderer perf trace through a window CustomEvent'
}

function entryKey(entry: { domain: string; method: string }): string {
  return `${entry.domain}.${entry.method}`
}

describe('parity manifest: declarations', () => {
  it('classifies every method with a complete policy', () => {
    const problems: string[] = []
    for (const entry of listManifestEntries()) {
      const { policy } = entry
      const web = policy.policy
      if ((web.web === 'desktop-only' || web.web === 'pending') && !policy.capability) {
        problems.push(`${entryKey(entry)}: ${web.web} needs a capability feature to gate on`)
      }
      if (policy.capability !== undefined && !isCapabilityFeature(policy.capability)) {
        problems.push(`${entryKey(entry)}: unknown capability ${String(policy.capability)}`)
      }
      if (web.web === 'pending' && (web.tracking.trim() === '' || web.webUx.trim() === '')) {
        problems.push(`${entryKey(entry)}: pending needs a tracking owner and a webUx`)
      }
      if (web.web === 'desktop-only' && web.webUx.trim() === '') {
        problems.push(`${entryKey(entry)}: desktop-only needs a webUx decision`)
      }
      if (typeof policy.audit === 'object' && policy.audit.exempt.trim() === '') {
        problems.push(`${entryKey(entry)}: audit exemption needs a reason`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('keeps the pending count equal to scripts/parity-baseline.json (ratchet)', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as { pending: number }
    const pending = countPendingEntries()
    expect(
      pending,
      pending > baseline.pending
        ? `pending grew from ${baseline.pending} to ${pending}: serve the method or declare it desktop-only`
        : `pending shrank to ${pending}: lower "pending" in scripts/parity-baseline.json to ${pending}`
    ).toBe(baseline.pending)
  })

  it('covers every WindowAPI domain', () => {
    expect(Object.keys(PARITY_MANIFEST).length).toBeGreaterThanOrEqual(34)
  })
})

describe('parity manifest: desktop preload', () => {
  let api: Record<string, Record<string, unknown>>

  beforeAll(async () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
    const { createWindowApi } = await import('../../../src/preload/window-api/create-window-api')
    api = createWindowApi() as unknown as Record<string, Record<string, unknown>>
  })

  it('exposes exactly the manifest domains and methods', () => {
    const manifestShape = Object.fromEntries(
      Object.entries(PARITY_MANIFEST).map(([domain, methods]) => [
        domain,
        Object.keys(methods).sort()
      ])
    )
    const preloadShape = Object.fromEntries(
      Object.entries(api).map(([domain, methods]) => [domain, Object.keys(methods).sort()])
    )
    expect(preloadShape).toEqual(manifestShape)
  })

  it('forwards every method to a main-process channel', () => {
    const silent: string[] = []
    for (const entry of listManifestEntries()) {
      const key = entryKey(entry)
      const fn = api[entry.domain]?.[entry.method]
      expect(typeof fn, key).toBe('function')
      if (RENDERER_LOCAL_PRELOAD_METHODS[key] !== undefined) continue

      ipc.invoke.mockClear()
      ipc.send.mockClear()
      ipc.on.mockClear()
      try {
        const result = (fn as (...args: unknown[]) => unknown)(() => undefined)
        if (result instanceof Promise) result.catch(() => undefined)
      } catch {
        // Argument validation may throw; the channel check below decides.
      }
      const reached =
        ipc.invoke.mock.calls.length + ipc.send.mock.calls.length + ipc.on.mock.calls.length
      if (reached === 0) silent.push(key)
    }
    expect(silent, `preload methods that reach no channel:\n${silent.join('\n')}`).toEqual([])
  })
})

describe('parity manifest: web dispatcher', () => {
  it('serves every shared method, no desktop-only method, and nothing unclassified', () => {
    const { deps } = makeDeps()
    const report = checkManifestAgainstDispatcher(buildDispatcher(deps).overrides)
    expect(report).toEqual({ unresolvedShared: [], servedDesktopOnly: [], unclassifiedServed: [] })
  })

  it('declares audit expectations the dispatcher actually applies', () => {
    const mismatches: string[] = []
    for (const entry of listManifestEntries()) {
      if (entry.policy.policy.web !== 'shared') continue
      const key = dispatcherKey(entry.domain, entry.method)
      const writes = isWriteTaskType(key) || shouldAuditOverrideWrite(key)
      const actual = writes ? 'write' : shouldAuditApiRead(key) ? 'read' : 'exempt'
      const declared = typeof entry.policy.audit === 'object' ? 'exempt' : entry.policy.audit
      if (declared !== actual) mismatches.push(`${entryKey(entry)}: ${declared} vs ${actual}`)
    }
    expect(mismatches, mismatches.join('\n')).toEqual([])
  })

  it('answers every shared method over HTTP without 404 or 501', async () => {
    const { deps } = makeDeps()
    const fakeJobs = {
      runner: { list: () => [], get: () => undefined, cancel: async () => undefined },
      caseDelete: {
        start: () => ({ id: 'job-1', result: Promise.resolve({ deleted: 0 }) }),
        assertDeletable: async () => undefined
      }
    }
    const withJobs = { ...deps, jobs: fakeJobs } as unknown as typeof deps
    const app = fastify({ logger: false })
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
      } as never
    })
    registerDispatcher(app, withJobs, buildDispatcher(withJobs).overrides)

    const failures: string[] = []
    try {
      for (const entry of listManifestEntries()) {
        if (entry.policy.policy.web !== 'shared') continue
        const response = await app.inject({
          method: 'POST',
          url: `/api/${entry.domain}/${entry.method}`,
          payload: { args: [] }
        })
        if (response.statusCode === 404 || response.statusCode === 501) {
          failures.push(`${entryKey(entry)} → ${response.statusCode} ${response.body}`)
        }
      }
    } finally {
      await app.close()
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('keeps desktop-only methods unreachable over HTTP (404)', async () => {
    const { deps } = makeDeps()
    const app = fastify({ logger: false })
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
      } as never
    })
    registerDispatcher(app, deps, buildDispatcher(deps).overrides)
    const served: string[] = []
    try {
      for (const entry of listManifestEntries()) {
        if (entry.policy.policy.web !== 'desktop-only') continue
        const response = await app.inject({
          method: 'POST',
          url: `/api/${entry.domain}/${entry.method}`,
          payload: { args: [] }
        })
        if (response.statusCode !== 404) served.push(`${entryKey(entry)} → ${response.statusCode}`)
      }
    } finally {
      await app.close()
    }
    expect(served, served.join('\n')).toEqual([])
  })

  it('looks policies up by window.api domain and method', () => {
    expect(getChannelPolicy('caseMetadata', 'get')?.policy.web).toBe('shared')
    expect(getChannelPolicy('database', 'open')?.policy.web).toBe('desktop-only')
    expect(getChannelPolicy('variants', 'filterOptions')).toBeUndefined()
  })
})
