import { expect, test } from '@playwright/test'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

test('postgres dev mode exposes seeded cases through cases:list', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched:
    | Awaited<ReturnType<typeof launchElectronApp>>
    | undefined

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL:
          process.env.VARLENS_PG_URL ??
          'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SCHEMA: process.env.VARLENS_PG_SCHEMA ?? 'public'
      }
    })

    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const cases = await launched.window.evaluate(async () => {
      return await window.api.cases.list()
    })

    expect(cases).toEqual([
      expect.objectContaining({ id: 3, name: 'Newest Case' }),
      expect.objectContaining({ id: 2, name: 'Middle Case' }),
      expect.objectContaining({ id: 1, name: 'Oldest Case' })
    ])
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
