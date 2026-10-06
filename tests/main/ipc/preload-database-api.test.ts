import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn((...args: unknown[]) => Promise.resolve({ success: true, args }))

vi.mock('electron', () => ({
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }
}))

/**
 * Regression: window.api.database (src/preload/window-api/core-api.ts) used to
 * drop `setupPassphrase` and omit migrateToEncrypted / deletePlaintextBackup /
 * setRecoveryPassphrase, hidden by an `as WindowAPI['database']` cast. On a
 * machine without an OS keyring, first-run database creation could never
 * complete (every create returned needsPassphraseSetup again). Found by the
 * renderer perf E2E harness under xvfb.
 */
describe('preload window.api.database', () => {
  beforeEach(() => invoke.mockClear())

  async function databaseApi() {
    const { createPreloadDomainApis } = await import('../../../src/preload/window-api/domains')
    const { createCoreApi } = await import('../../../src/preload/window-api/core-api')
    const domains = createPreloadDomainApis()
    return { api: createCoreApi(domains).database, domain: domains.databaseDomain }
  }

  it('exposes every database domain method', async () => {
    const { api, domain } = await databaseApi()
    expect(Object.keys(api).sort()).toEqual(Object.keys(domain).sort())
  })

  it('forwards setupPassphrase to database:create', async () => {
    const { api } = await databaseApi()
    await api.create('/tmp/a.db', undefined, 'first-run passphrase')
    expect(invoke).toHaveBeenCalledWith(
      'database:create',
      '/tmp/a.db',
      undefined,
      'first-run passphrase'
    )
  })

  it('reaches the encryption-migration and recovery channels', async () => {
    const { api } = await databaseApi()
    await api.migrateToEncrypted({ keepPlaintextBackup: true } as never)
    await api.deletePlaintextBackup('/tmp/a.db.bak')
    await api.setRecoveryPassphrase('recovery words')
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      'database:migrateToEncrypted',
      'database:deletePlaintextBackup',
      'database:setRecoveryPassphrase'
    ])
  })
})
