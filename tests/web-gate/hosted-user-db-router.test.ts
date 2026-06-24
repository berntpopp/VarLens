import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const storageMocks = vi.hoisted(() => ({
  openSession: vi.fn(),
  opened: [] as Array<{ url: string; close: ReturnType<typeof vi.fn> }>
}))

vi.mock('../../src/main/storage/postgres/createPostgresStorageSession', () => ({
  openPostgresStorageSessionWithoutMigrating: storageMocks.openSession
}))

import { HostedUserDbRouter } from '../../src/web/hosted-user-db-router'
import type { HostedWebDbTopology } from '../../src/web/topology'

function topology(workspaceSecretDir: string): HostedWebDbTopology {
  return {
    mode: 'hosted',
    controlReadUrl: 'postgresql://control-ro/varlens_control',
    controlStateUrl: 'postgresql://control-state/varlens_control',
    workspaceSecretDir,
    pools: {
      controlPoolMax: 4,
      publicAnnotationPoolMax: 4,
      workspacePoolMax: 2,
      workspacePoolGlobalMax: 20,
      workspacePoolIdleMs: 60_000
    },
    legacySinglePgUrlPresent: false
  }
}

function user(secretRef: string | null, status = 'active') {
  return {
    username: 'unused',
    is_active: 1,
    private_db_status: status,
    private_db_secret_ref: secretRef
  }
}

function request(username?: string) {
  return {
    session: username === undefined ? {} : { user: { username } }
  } as never
}

describe('HostedUserDbRouter', () => {
  let workspaceSecretDir: string
  let users: Map<string, ReturnType<typeof user>>

  beforeEach(async () => {
    workspaceSecretDir = await mkdtemp(join(tmpdir(), 'varlens-hosted-router-'))
    users = new Map()
    storageMocks.opened.length = 0
    storageMocks.openSession.mockReset()
    storageMocks.openSession.mockImplementation(
      async (config: { url: string; schema: string }) => {
        const close = vi.fn()
        storageMocks.opened.push({ url: config.url, close })
        return {
          workspace: {
            kind: 'postgres',
            schema: config.schema,
            connectionUrlRedacted: config.url,
            connectionLabel: config.url
          },
          capabilities: { backend: 'postgres' },
          close,
          listCases: vi.fn(),
          getReadExecutor: vi.fn(),
          getWriteExecutor: vi.fn(),
          getImportExecutor: vi.fn()
        }
      }
    )
  })

  afterEach(async () => {
    await rm(workspaceSecretDir, { recursive: true, force: true })
  })

  function router(extra: Partial<HostedWebDbTopology> = {}): HostedUserDbRouter {
    return new HostedUserDbRouter({
      topology: { ...topology(workspaceSecretDir), ...extra },
      authService: {
        getUser: vi.fn(async (username: string) => users.get(username))
      } as never
    })
  }

  test('routes each authenticated user to its own private DB secret and caches by secret ref', async () => {
    await writeFile(join(workspaceSecretDir, 'alice.pgurl'), 'postgresql://alice/app_private_a')
    await writeFile(join(workspaceSecretDir, 'bob.pgurl'), 'postgresql://bob/app_private_b')
    users.set('alice', user('alice.pgurl'))
    users.set('bob', user('bob.pgurl'))
    const hostedRouter = router()

    const aliceFirst = await hostedRouter.resolveSession(request('alice'))
    const aliceSecond = await hostedRouter.resolveSession(request('alice'))
    const bob = await hostedRouter.resolveSession(request('bob'))

    expect(aliceSecond).toBe(aliceFirst)
    expect(bob).not.toBe(aliceFirst)
    expect(storageMocks.openSession).toHaveBeenCalledTimes(2)
    expect(storageMocks.opened.map((entry) => entry.url)).toEqual([
      'postgresql://alice/app_private_a',
      'postgresql://bob/app_private_b'
    ])
    await hostedRouter.close()
    expect(storageMocks.opened.map((entry) => entry.close.mock.calls.length)).toEqual([1, 1])
  })

  test('fails closed before opening a private DB when auth or routing metadata is invalid', async () => {
    users.set('missing-secret', user(null))
    users.set('inactive-db', user('inactive.pgurl', 'unassigned'))
    users.set('unsafe-ref', user('../secret.pgurl'))
    const hostedRouter = router()

    await expect(hostedRouter.resolveSession(request())).rejects.toThrow(/authenticated user/i)
    await expect(hostedRouter.resolveSession(request('unknown'))).rejects.toThrow(/inactive or missing/i)
    await expect(hostedRouter.resolveSession(request('missing-secret'))).rejects.toThrow(
      /secret ref is missing/i
    )
    await expect(hostedRouter.resolveSession(request('inactive-db'))).rejects.toThrow(
      /not active/i
    )
    await expect(hostedRouter.resolveSession(request('unsafe-ref'))).rejects.toThrow(
      /path traversal/i
    )
    expect(storageMocks.openSession).not.toHaveBeenCalled()
  })

  test('removes a failed private DB session from the cache so an operator fix can retry', async () => {
    users.set('alice', user('alice.pgurl'))
    const hostedRouter = router()

    await writeFile(join(workspaceSecretDir, 'alice.pgurl'), '')
    await expect(hostedRouter.resolveSession(request('alice'))).rejects.toThrow(/empty/i)
    expect(storageMocks.openSession).not.toHaveBeenCalled()

    await writeFile(join(workspaceSecretDir, 'alice.pgurl'), 'postgresql://alice/app_private_a')
    await expect(hostedRouter.resolveSession(request('alice'))).resolves.toEqual(
      expect.objectContaining({
        workspace: expect.objectContaining({ kind: 'postgres' })
      })
    )
    expect(storageMocks.openSession).toHaveBeenCalledTimes(1)
  })

  test('enforces the hosted workspace pool global limit', async () => {
    await writeFile(join(workspaceSecretDir, 'alice.pgurl'), 'postgresql://alice/app_private_a')
    await writeFile(join(workspaceSecretDir, 'bob.pgurl'), 'postgresql://bob/app_private_b')
    users.set('alice', user('alice.pgurl'))
    users.set('bob', user('bob.pgurl'))
    const hostedRouter = router({
      pools: {
        ...topology(workspaceSecretDir).pools,
        workspacePoolGlobalMax: 1
      }
    })

    await expect(hostedRouter.resolveSession(request('alice'))).resolves.toBeTruthy()
    await expect(hostedRouter.resolveSession(request('bob'))).rejects.toThrow(/pool limit/i)
    expect(storageMocks.openSession).toHaveBeenCalledTimes(1)
    await hostedRouter.close()
  })
})
