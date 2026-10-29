import { test, expect } from '@playwright/test'
import { createHmac, randomBytes } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchElectronApp } from './helpers/electron-app'

/**
 * The desktop platform sign-in end to end (#295) against a real Keycloak with
 * the VarLens realm (realm `varlens`, client `varlens-desktop`, group
 * `varlens-desktop`). Opt-in: it runs only when these are set, and creates and
 * deletes its own throwaway user.
 *
 *   VARLENS_E2E_KEYCLOAK_URL             e.g. http://localhost:8080
 *   VARLENS_E2E_KEYCLOAK_ADMIN_USER      a master-realm admin
 *   VARLENS_E2E_KEYCLOAK_ADMIN_PASSWORD
 *
 * The app writes its authorization request to a file instead of opening a
 * browser (VARLENS_E2E_SIGN_IN_URL_FILE, development builds only); the test
 * plays the browser against Keycloak and lands on the app's loopback address.
 */
const KEYCLOAK = process.env.VARLENS_E2E_KEYCLOAK_URL?.replace(/\/+$/, '') ?? ''
const ADMIN_USER = process.env.VARLENS_E2E_KEYCLOAK_ADMIN_USER ?? ''
const ADMIN_PASSWORD = process.env.VARLENS_E2E_KEYCLOAK_ADMIN_PASSWORD ?? ''
const REALM = `${KEYCLOAK}/realms/varlens`

test.skip(KEYCLOAK === '' || ADMIN_USER === '', 'needs VARLENS_E2E_KEYCLOAK_URL and an admin')

async function adminToken(): Promise<string> {
  const response = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN_USER,
      password: ADMIN_PASSWORD
    })
  })
  expect(response.ok).toBe(true)
  return ((await response.json()) as { access_token: string }).access_token
}

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await adminToken()
  return fetch(`${KEYCLOAK}/admin/realms/varlens${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  })
}

async function createUser(username: string, password: string, inGroup = true): Promise<string> {
  const created = await admin('/users', {
    method: 'POST',
    body: JSON.stringify({
      username,
      enabled: true,
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
      credentials: [{ type: 'password', value: password, temporary: true }]
    })
  })
  expect(created.status).toBe(201)
  const id = created.headers.get('location')?.split('/').pop() ?? ''
  if (!inGroup) return id
  const groups = (await (await admin('/groups?search=varlens-desktop')).json()) as Array<{
    id: string
    name: string
  }>
  const group = groups.find((g) => g.name === 'varlens-desktop')
  expect(group).toBeDefined()
  expect((await admin(`/users/${id}/groups/${group!.id}`, { method: 'PUT' })).status).toBe(204)
  return id
}

/** A minimal browser: cookies, forms, no automatic redirects. */
class Browser {
  private cookies = new Map<string, string>()

  async go(url: string, form?: Record<string, string>): Promise<{ location: string; body: string }> {
    let target = url
    let body: URLSearchParams | undefined = form === undefined ? undefined : new URLSearchParams(form)
    for (let hop = 0; hop < 10; hop++) {
      const response = await fetch(target, {
        method: body === undefined ? 'GET' : 'POST',
        body,
        redirect: 'manual',
        headers: { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
      })
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';')
        const index = pair.indexOf('=')
        this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1))
      }
      const location = response.headers.get('location')
      if (location === null || !location.startsWith(KEYCLOAK)) {
        return { location: location ?? '', body: await response.text() }
      }
      target = location
      body = undefined
    }
    throw new Error('too many redirects inside Keycloak')
  }
}

function forms(body: string): Array<{ action: string; fields: Record<string, string> }> {
  const found: Array<{ action: string; fields: Record<string, string> }> = []
  for (const match of body.matchAll(/<form\b[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/g)) {
    const fields: Record<string, string> = {}
    for (const input of match[2].matchAll(/<input\b[^>]*>/g)) {
      const name = /name="([^"]*)"/.exec(input[0])?.[1]
      if (name !== undefined) fields[name] = /value="([^"]*)"/.exec(input[0])?.[1] ?? ''
    }
    found.push({ action: match[1].replaceAll('&amp;', '&'), fields })
  }
  return found
}

function totp(secret: string): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)))
  const digest = createHmac('sha1', Buffer.from(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

async function nextTotpWindow(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, (31 - ((Date.now() / 1000) % 30)) * 1000))
}

/** Sign in at Keycloak; returns the loopback redirect and the TOTP secret. */
async function keycloakSignIn(
  url: string,
  username: string,
  password: string,
  setup: { newPassword: string } | { secret: string }
): Promise<{ redirect: string; secret: string }> {
  const browser = new Browser()
  let page = await browser.go(url)
  const login = forms(page.body).find((f) => 'username' in f.fields)!
  page = await browser.go(login.action, { ...login.fields, username, password })
  let secret = 'secret' in setup ? setup.secret : ''
  for (let step = 0; step < 5 && !page.location.startsWith('http://127.0.0.1'); step++) {
    const form = forms(page.body).find((f) => 'password-new' in f.fields || 'totp' in f.fields || 'otp' in f.fields)
    if (form === undefined) throw new Error('unexpected Keycloak page')
    if ('password-new' in form.fields && 'newPassword' in setup) {
      page = await browser.go(form.action, {
        ...form.fields,
        'password-new': setup.newPassword,
        'password-confirm': setup.newPassword
      })
    } else if ('totp' in form.fields) {
      secret = form.fields.totpSecret
      page = await browser.go(form.action, { ...form.fields, totp: totp(secret), userLabel: 'e2e' })
    } else {
      page = await browser.go(form.action, { ...form.fields, otp: totp(secret) })
    }
  }
  expect(page.location).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback\?/)
  return { redirect: page.location, secret }
}

/** Lock through the toolbar; the first-start disclaimer may open a moment after the app. */
async function lockFromToolbar(window: import('@playwright/test').Page): Promise<void> {
  const disclaimer = window.getByRole('button', { name: 'I Understand' })
  const lock = window.locator('[data-testid="desktop-lock"]')
  await expect(async () => {
    if ((await disclaimer.count()) > 0) await disclaimer.click({ timeout: 2_000 })
    await lock.click({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

async function waitForFile(path: string, previous: string): Promise<string> {
  await expect
    .poll(() => (existsSync(path) ? readFileSync(path, 'utf8') : ''), { timeout: 15_000 })
    .not.toBe(previous)
  return readFileSync(path, 'utf8')
}

const CONFIG = {
  mode: 'platform',
  issuer: REALM,
  clientId: 'varlens-desktop',
  audience: 'varlens-desktop',
  requiredAcr: 'urn:varlens:acr:password-plus-totp',
  requiredAmr: ['pwd', 'otp'],
  access: { claim: 'groups', value: '/varlens-desktop' }
}

interface Person {
  username: string
  oneTime: string
  password: string
  inGroup: boolean
  id: string
  secret: string
}

function person(inGroup: boolean): Person {
  return {
    username: `e2e-${randomBytes(4).toString('hex')}`,
    oneTime: randomBytes(18).toString('base64url'),
    password: randomBytes(18).toString('base64url'),
    inGroup,
    id: '',
    secret: ''
  }
}

test('accounts sign in at Keycloak: the group decides access, the first account owns the data', async () => {
  test.setTimeout(360_000)
  const dir = mkdtempSync(join(tmpdir(), 'varlens-keycloak-e2e-'))
  const urlFile = join(dir, 'sign-in-url')
  const configFile = join(dir, 'auth.json')
  writeFileSync(configFile, JSON.stringify(CONFIG))
  const owner = person(true)
  const colleague = person(true)
  const outsider = person(false)
  for (const p of [owner, colleague, outsider]) p.id = await createUser(p.username, p.oneTime, p.inGroup)
  const launched = await launchElectronApp({
    hideWindow: true,
    env: { VARLENS_DESKTOP_AUTH_CONFIG: configFile, VARLENS_E2E_SIGN_IN_URL_FILE: urlFile }
  })
  try {
    const { window } = launched
    const button = window.locator('[data-testid="desktop-sign-in-button"]')
    const notice = window.locator('[data-testid="desktop-sign-in-notice"]')
    const appBar = window.locator('.v-app-bar')
    const ask = {
      status: () => window.evaluate(() => window.api.auth.desktopStatus()),
      info: () => window.evaluate(() => window.api.database.info())
    }
    let url = ''
    /** The first sign-in sets the password and the authenticator app up, the second uses them. */
    const signIn = async (who: Person): Promise<void> => {
      for (const enrolling of [true, false]) {
        await expect(button).toBeVisible({ timeout: 30_000 })
        // Keycloak takes each code only once.
        if (!enrolling) await nextTotpWindow()
        await button.click()
        url = await waitForFile(urlFile, url)
        const done = enrolling
          ? await keycloakSignIn(url, who.username, who.oneTime, { newPassword: who.password })
          : await keycloakSignIn(url, who.username, who.password, { secret: who.secret })
        who.secret = done.secret
        await fetch(done.redirect)
        if (enrolling) await expect(notice).toContainText('once more')
      }
    }

    // The owner opens, and so binds, the default database that startup skipped.
    await signIn(owner)
    await expect(appBar).toBeVisible({ timeout: 30_000 })
    expect(await ask.status()).toMatchObject({ mode: 'platform', state: 'signed-in' })
    expect(await ask.info()).toMatchObject({ path: expect.any(String) })
    // Locking returns to the sign-in screen and closes the data.
    await lockFromToolbar(window)
    await expect(button).toBeVisible({ timeout: 30_000 })
    expect(await ask.info()).toMatchObject({ code: 'UNAUTHENTICATED' })

    // A colleague signs in, but the owner's default database stays closed.
    await signIn(colleague)
    await expect(appBar).toBeVisible({ timeout: 30_000 })
    expect(await ask.info()).toBeNull()
    await lockFromToolbar(window)

    // An account outside the access group is refused after a full sign-in.
    await signIn(outsider)
    await expect(notice).toContainText('may not use VarLens Desktop')
    expect(await ask.status()).toMatchObject({ mode: 'platform', state: 'locked' })
  } finally {
    await launched.cleanup()
    for (const p of [owner, colleague, outsider]) await admin(`/users/${p.id}`, { method: 'DELETE' })
    rmSync(dir, { recursive: true, force: true })
  }
})
