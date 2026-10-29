import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchElectronApp, type LaunchElectronAppResult } from './helpers/electron-app'

/**
 * Desktop platform sign-in (#295): with the admin config file VarLens shows the
 * sign-in screen and the main process refuses data, local accounts included.
 * The file comes through VARLENS_DESKTOP_AUTH_CONFIG, which VarLens reads only
 * when no machine-wide file exists.
 */
const CONFIG = {
  mode: 'platform',
  issuer: 'https://identity.example.invalid/realms/varlens',
  clientId: 'varlens-desktop',
  audience: 'varlens-desktop',
  requiredAcr: 'urn:varlens:acr:password-plus-totp',
  requiredAmr: ['pwd', 'otp'],
  access: { claim: 'groups', value: '/varlens-desktop' }
}

async function launchWithConfig(contents: string): Promise<{
  launched: LaunchElectronAppResult
  dir: string
}> {
  const dir = mkdtempSync(join(tmpdir(), 'varlens-auth-config-'))
  const path = join(dir, 'auth.json')
  writeFileSync(path, contents)
  const launched = await launchElectronApp({
    hideWindow: true,
    env: { VARLENS_DESKTOP_AUTH_CONFIG: path }
  })
  return { launched, dir }
}

test('a configured desktop shows the sign-in screen and refuses data', async () => {
  test.setTimeout(60_000)
  const { launched, dir } = await launchWithConfig(JSON.stringify(CONFIG))
  try {
    const signIn = launched.window.locator('[data-testid="desktop-sign-in-required"]')
    await expect(signIn).toBeVisible({ timeout: 30_000 })
    await expect(signIn).toContainText('identity.example.invalid')
    await expect(launched.window.locator('.v-app-bar')).toHaveCount(0)

    const answers = await launched.window.evaluate(async () => ({
      status: await window.api.auth.desktopStatus(),
      databaseInfo: await window.api.database.info(),
      login: await window.api.auth.login('someone', 'something')
    }))
    expect(answers.status).toMatchObject({ mode: 'platform', state: 'locked' })
    expect(answers.databaseInfo).toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(answers.login).toMatchObject({ code: 'FORBIDDEN' })
    // Startup opened nothing: on a fresh profile the default database would exist by now.
    expect(existsSync(join(launched.userDataDir, 'varlens.db'))).toBe(false)
  } finally {
    await launched.cleanup()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a refused config file keeps the data closed and says why', async () => {
  test.setTimeout(60_000)
  const { launched, dir } = await launchWithConfig('{ "mode": "platform", ')
  try {
    const problem = launched.window.locator('[data-testid="desktop-sign-in-problem"]')
    await expect(problem).toBeVisible({ timeout: 30_000 })
    await expect(problem).toContainText('not valid JSON')
    const databaseInfo = await launched.window.evaluate(() => window.api.database.info())
    expect(databaseInfo).toMatchObject({ code: 'UNAUTHENTICATED' })
  } finally {
    await launched.cleanup()
    rmSync(dir, { recursive: true, force: true })
  }
})
