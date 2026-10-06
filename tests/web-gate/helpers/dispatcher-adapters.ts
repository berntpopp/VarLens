import { vi } from 'vitest'

import type { StorageReadTask } from '../../../src/main/storage/read-executor'
import type { DispatcherDeps } from '../../../src/web/server/dispatcher'

export function makeDeps(): {
  deps: DispatcherDeps
  execute: ReturnType<typeof vi.fn>
  writeExecute: ReturnType<typeof vi.fn>
  importSingleFile: ReturnType<typeof vi.fn>
  importMultiFile: ReturnType<typeof vi.fn>
  reply: { code: ReturnType<typeof vi.fn> }
} {
  const execute = vi.fn(async (task: StorageReadTask) => ({ task }))
  const writeExecute = vi.fn(async (task: unknown) => ({ task }))
  const importSingleFile = vi.fn(async () => ({
    caseId: 11,
    variantCount: 2,
    skipped: 0,
    errors: [],
    elapsed: 12
  }))
  const importMultiFile = vi.fn(async () => ({
    caseId: 11,
    variantCount: 2,
    skipped: 0,
    errors: [],
    files: [],
    elapsed: 12
  }))
  const isAccountsEnabled = vi.fn(async () => false)
  const createUser = vi.fn(async () => ({ id: 2, username: 'analyst' }))
  const listUsers = vi.fn(async () => [{ id: 1, username: 'admin', role: 'admin' }])
  const deactivateUser = vi.fn(async () => undefined)
  const resetPassword = vi.fn(async () => undefined)
  const setRole = vi.fn(async () => undefined)
  const reactivateUser = vi.fn(async () => undefined)
  const publish = vi.fn()
  const deps = {
    session: {
      capabilities: { backend: 'postgres' },
      getReadExecutor: () => ({ execute }),
      getWriteExecutor: () => ({ execute: writeExecute }),
      getImportExecutor: () => ({ importSingleFile, importMultiFile, cancel: vi.fn() }),
      listCases: vi.fn(async () => [{ id: 1, name: 'Case A' }]),
      health: vi.fn()
    },
    authService: {
      isAccountsEnabled,
      createUser,
      listUsers,
      deactivateUser,
      resetPassword,
      invalidateUser: vi.fn(),
      getUser: vi.fn(async (username: string) => ({ id: 2, username })),
      setRole,
      reactivateUser
    },
    events: {
      publish,
      publishToUserAndAdmins: vi.fn(),
      closeSession: vi.fn(),
      closeUser: vi.fn()
    }
  } as unknown as DispatcherDeps
  return {
    deps,
    execute,
    writeExecute,
    importSingleFile,
    importMultiFile,
    reply: { code: vi.fn() }
  }
}

/**
 * Give every request a signed-in session, as the real session preHandler
 * (src/web/server/auth.ts) does for authenticated traffic. The dispatcher's
 * `secure()` wrapper refuses anonymous calls to non-public methods.
 */
export function withSession(
  app: { addHook: (name: 'preHandler', hook: (request: never) => Promise<void>) => unknown },
  role: 'viewer' | 'analyst' | 'admin' = 'admin',
  username = role
): void {
  app.addHook('preHandler', async (request: never) => {
    const target = request as { session?: unknown }
    target.session ??= {
      user: { id: 1, username, role, passwordChangedAt: null }
    }
  })
}
