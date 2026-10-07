import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sign as signHook } from '../../scripts/release/windows-sign-hook.mjs'
import {
  MAX_SIGNING_ATTEMPTS,
  readLedger,
  signFile,
  totpWaitMs
} from '../../scripts/release/windows-signing/sign-file.mjs'
import {
  createBackend,
  redact,
  resolveSigningMode
} from '../../scripts/release/windows-signing/signing-backends.mjs'
import {
  classifySigningRequest,
  EXPECTED_SIGNATURE_COUNT,
  listExecutables,
  planAppSigning,
  publishedWindowsArtifacts
} from '../../scripts/release/windows-signing/signing-plan.mjs'
import { fakeSign, makePe } from './support/pe-fixtures'

const VERSION = '9.9.9'
const STEP = 30_000
let dir: string
let env: Record<string, string>
let logged: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varlens-sign-'))
  env = {
    VARLENS_WINDOWS_SIGNING: 'esigner',
    VARLENS_WINDOWS_SIGN_LEDGER: join(dir, 'ledger.json'),
    VARLENS_WINDOWS_SIGN_VERSION: VERSION
  }
  logged = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    logged.push(String(chunk))
    return true
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function writePe(relativePath: string, body = relativePath): string {
  const path = join(dir, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, makePe(body))
  return path
}

/** A clock the tests advance by hand, plus a sleep that advances it. */
function fakeClock(startMs = 1000 * STEP) {
  let nowMs = startMs
  const slept: number[] = []
  return {
    slept,
    now: () => nowMs,
    advance: (ms: number): void => {
      nowMs += ms
    },
    sleep: (ms: number): Promise<void> => {
      slept.push(ms)
      nowMs += ms
      return Promise.resolve()
    }
  }
}

const stubSigner = () => vi.fn((path: string) => Promise.resolve(fakeSign(path)))

describe('signing plan', () => {
  it('costs five signatures per release', () => {
    expect(EXPECTED_SIGNATURE_COUNT).toBe(5)
  })

  it('publishes the two installers and latest.yml, not the transport zip', () => {
    expect(publishedWindowsArtifacts(VERSION)).toEqual([
      'Varlens-Setup-9.9.9.exe',
      'Varlens-Portable-9.9.9.exe',
      'latest.yml'
    ])
  })

  it('selects the app executable and ignores the elevate helper the NSIS target re-copies', () => {
    writePe('Varlens.exe')
    writePe('resources/elevate.exe')
    writeFileSync(join(dir, 'ffmpeg.dll'), 'dll')
    expect(listExecutables(dir)).toEqual(['Varlens.exe', 'resources/elevate.exe'])
    expect(planAppSigning(dir)).toEqual([join(dir, 'Varlens.exe')])
  })

  it('refuses an app directory with an executable the plan does not account for', () => {
    writePe('Varlens.exe')
    writePe('resources/app.asar.unpacked/node_modules/tool/bin/helper.exe')
    expect(() => planAppSigning(dir)).toThrow(/unplanned executable.*helper\.exe/)
  })

  it('refuses an app directory without the app executable', () => {
    writeFileSync(join(dir, 'ffmpeg.dll'), 'dll')
    expect(() => planAppSigning(dir)).toThrow(/missing from the app directory: Varlens\.exe/)
  })

  it.each([
    ['/w/win-unpacked/Varlens.exe', 'app'],
    ['D:\\a\\_temp\\win-unpacked\\resources\\elevate.exe', 'elevate'],
    ['/w/out/Varlens-Setup-9.9.9.__uninstaller.exe', 'uninstaller'],
    ['D:\\a\\_temp\\out\\Varlens-Setup-9.9.9.exe', 'installer'],
    ['/w/out/Varlens-Portable-9.9.9.exe', 'portable']
  ])('classifies %s as %s', (path, role) => {
    expect(classifySigningRequest(path, VERSION)).toBe(role)
  })

  it('refuses to classify a file outside the plan, including another version’s installer', () => {
    expect(() => classifySigningRequest('/w/out/Varlens-Setup-1.0.0.exe', VERSION)).toThrow(
      /not in the Windows signing plan/
    )
    expect(() => classifySigningRequest('/w/app/crashpad_handler.exe', VERSION)).toThrow(
      /refusing to sign crashpad_handler\.exe/
    )
  })
})

describe('resolveSigningMode', () => {
  it('is off when unset or blank', () => {
    expect(resolveSigningMode({})).toBe('off')
    expect(resolveSigningMode({ VARLENS_WINDOWS_SIGNING: ' ' })).toBe('off')
  })

  it('throws on an unknown value instead of silently not signing', () => {
    expect(() => resolveSigningMode({ VARLENS_WINDOWS_SIGNING: 'esinger' })).toThrow(
      /not a signing mode/
    )
    expect(() => resolveSigningMode({ VARLENS_WINDOWS_SIGNING: 'true' })).toThrow()
  })
})

describe('signing backends', () => {
  const secrets = {
    CST_DIR: '/cst',
    CST_JAR: '/cst/jar/code_sign_tool.jar',
    ES_USERNAME: 'user-name',
    ES_PASSWORD: 'p@ss word',
    ES_CREDENTIAL_ID: 'cred-id',
    ES_TOTP_SECRET: 'totp-secret'
  }

  it('fails before signing when an eSigner secret is missing', () => {
    expect(() => createBackend('esigner', { env: { ...secrets, ES_TOTP_SECRET: '' } })).toThrow(
      /ES_TOTP_SECRET is not set/
    )
  })

  it('runs CodeSignTool `sign` from its own directory without a shell', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, output: '' })
    await createBackend('esigner', { env: secrets, run })('/w/Varlens.exe')
    expect(run).toHaveBeenCalledTimes(1)
    const [command, args, options] = run.mock.calls[0]
    expect(command).toBe('java')
    expect(args).toEqual([
      '-jar',
      '/cst/jar/code_sign_tool.jar',
      'sign',
      '-username=user-name',
      '-password=p@ss word',
      '-credential_id=cred-id',
      '-totp_secret=totp-secret',
      '-input_file_path=/w/Varlens.exe',
      '-override'
    ])
    expect(options.cwd).toBe('/cst')
  })

  it('never lets a secret reach the log, even when the tool echoes it', async () => {
    const run = vi.fn().mockResolvedValue({
      code: 1,
      output: 'auth failed for user-name / p@ss word (totp-secret, cred-id)'
    })
    await expect(createBackend('esigner', { env: secrets, run })('/w/a.exe')).rejects.toThrow(
      /CodeSignTool exited with code 1/
    )
    const log = logged.join('')
    expect(log).toContain('auth failed for *** / *** (***, ***)')
    for (const secret of ['user-name', 'p@ss word', 'cred-id', 'totp-secret']) {
      expect(log).not.toContain(secret)
    }
  })

  it('redacts every occurrence of every secret', () => {
    expect(redact('a=s1 b=s2 c=s1', ['s1', 's2', ''])).toBe('a=*** b=*** c=***')
  })

  it('rehearses on Windows with Set-AuthenticodeSignature and a store thumbprint', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, output: '' })
    const backend = createBackend('selfsigned', {
      env: { VARLENS_SELFSIGN_THUMBPRINT: 'ABC123' },
      run,
      platform: 'win32'
    })
    await backend('C:\\w\\Varlens.exe')
    const [command, args, options] = run.mock.calls[0]
    expect(command).toBe('pwsh')
    expect(args.at(-1)).toContain('Set-AuthenticodeSignature')
    expect(args.at(-1)).toContain('-HashAlgorithm SHA256')
    expect(options.env.VARLENS_SIGN_TARGET).toBe('C:\\w\\Varlens.exe')
  })

  it('has no backend for the off mode', () => {
    expect(() => createBackend('off')).toThrow(/no signing backend/)
  })
})

describe('totpWaitMs', () => {
  it('does not wait before the first call', () => {
    expect(totpWaitMs(null, 123_456)).toBe(0)
  })

  it('waits until two seconds into the step after the previous call finished', () => {
    // Previous call finished in step 10 (300 000–329 999 ms).
    expect(totpWaitMs(10, 300_000)).toBe(32_000)
    expect(totpWaitMs(10, 329_999)).toBe(2_001)
    expect(totpWaitMs(10, 331_000)).toBe(1_000)
    expect(totpWaitMs(10, 332_000)).toBe(0)
    expect(totpWaitMs(10, 400_000)).toBe(0)
  })
})

describe('signFile', () => {
  it('signs a file once, records it and returns "signed"', async () => {
    const file = writePe('Varlens.exe')
    const deps = { backend: stubSigner(), ...fakeClock() }
    expect(await signFile({ file, role: 'app', mode: 'esigner', env, deps })).toBe('signed')
    const ledger = readLedger(env.VARLENS_WINDOWS_SIGN_LEDGER)
    expect(ledger.attempts).toBe(1)
    expect(ledger.signed).toEqual([{ role: 'app', file, attempt: 1, mode: 'esigner' }])
  })

  it('never starts two eSigner calls in the same TOTP step', async () => {
    const clock = fakeClock(1000 * STEP + 5_000) // 5 s into step 1000
    const startedInStep: number[] = []
    const backend = vi.fn((path: string) => {
      startedInStep.push(Math.floor(clock.now() / STEP))
      clock.advance(4_000) // each call takes 4 s
      fakeSign(path)
      return Promise.resolve()
    })
    for (const [name, role] of [
      ['Varlens.exe', 'app'],
      ['elevate.exe', 'elevate'],
      ['Varlens-Setup-9.9.9.exe', 'installer']
    ] as const) {
      await signFile({
        file: writePe(name),
        role,
        mode: 'esigner',
        env,
        deps: { backend, ...clock }
      })
    }
    expect(startedInStep).toEqual([1000, 1001, 1002])
    // The first call ends 9 s into its step → wait 23 s to be 2 s into the
    // next one; after that every call ends 6 s into a step → wait 26 s.
    expect(clock.slept).toEqual([23_000, 26_000])
  })

  it('waits for the step after the one a slow call finished in, not the one it started in', async () => {
    const clock = fakeClock()
    const backend = vi.fn((path: string) => {
      clock.advance(45_000) // crosses a step boundary and finishes in step 1001
      fakeSign(path)
      return Promise.resolve()
    })
    const deps = { backend, ...clock }
    await signFile({ file: writePe('a.exe'), role: 'app', mode: 'esigner', env, deps })
    await signFile({ file: writePe('b.exe'), role: 'elevate', mode: 'esigner', env, deps })
    expect(clock.slept).toEqual([17_000]) // 15 s into step 1001 → 2 s into step 1002
  })

  it('does not space rehearsal signatures', async () => {
    const clock = fakeClock()
    const deps = { backend: stubSigner(), ...clock }
    await signFile({ file: writePe('a.exe'), role: 'app', mode: 'selfsigned', env, deps })
    await signFile({ file: writePe('b.exe'), role: 'elevate', mode: 'selfsigned', env, deps })
    expect(clock.slept).toEqual([])
  })

  it('retries once, in a fresh TOTP step, when the first attempt fails', async () => {
    const file = writePe('Varlens.exe')
    const backend = vi
      .fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('CodeSignTool exited with code 1'))
      .mockImplementationOnce((path) => Promise.resolve(fakeSign(path)))
    const clock = fakeClock()
    const deps = { backend, ...clock }
    expect(await signFile({ file, role: 'app', mode: 'esigner', env, deps })).toBe('signed')
    expect(backend).toHaveBeenCalledTimes(2)
    expect(clock.slept).toEqual([32_000])
    expect(readLedger(env.VARLENS_WINDOWS_SIGN_LEDGER).attempts).toBe(2)
  })

  it('accepts a signature that landed although the tool reported failure, without retrying', async () => {
    const file = writePe('Varlens.exe')
    const backend = vi.fn((path: string) => {
      fakeSign(path)
      return Promise.reject(new Error('timestamp server hiccup after signing'))
    })
    await signFile({ file, role: 'app', mode: 'esigner', env, deps: { backend, ...fakeClock() } })
    expect(backend).toHaveBeenCalledTimes(1)
  })

  it('fails when the tool exits cleanly but leaves the file unsigned', async () => {
    const file = writePe('Varlens.exe')
    const backend = vi.fn(() => Promise.resolve())
    await expect(
      signFile({ file, role: 'app', mode: 'esigner', env, deps: { backend, ...fakeClock() } })
    ).rejects.toThrow(/Varlens\.exe has no Authenticode signature after signing/)
    expect(backend).toHaveBeenCalledTimes(2)
  })

  it('costs nothing when asked to sign the same file again', async () => {
    const file = writePe('Varlens.exe')
    const backend = stubSigner()
    const deps = { backend, ...fakeClock() }
    await signFile({ file, role: 'app', mode: 'esigner', env, deps })
    expect(await signFile({ file, role: 'app', mode: 'esigner', env, deps })).toBe('already-signed')
    expect(backend).toHaveBeenCalledTimes(1)
  })

  it('refuses a second file for a role that was already signed', async () => {
    const backend = stubSigner()
    const deps = { backend, ...fakeClock() }
    await signFile({ file: writePe('a/Varlens.exe'), role: 'app', mode: 'esigner', env, deps })
    await expect(
      signFile({ file: writePe('b/Varlens.exe'), role: 'app', mode: 'esigner', env, deps })
    ).rejects.toThrow(/"app" signature was already spent/)
    expect(backend).toHaveBeenCalledTimes(1)
  })

  it('refuses a file that arrives already signed by someone else', async () => {
    const file = writePe('Varlens.exe')
    fakeSign(file, 'unknown')
    const backend = vi.fn()
    await expect(
      signFile({ file, role: 'app', mode: 'esigner', env, deps: { backend, ...fakeClock() } })
    ).rejects.toThrow(/signature this run did not create/)
    expect(backend).not.toHaveBeenCalled()
  })

  it('stops at the attempt ceiling so a retry loop cannot drain the quota', async () => {
    writeFileSync(
      env.VARLENS_WINDOWS_SIGN_LEDGER,
      JSON.stringify({ attempts: MAX_SIGNING_ATTEMPTS, lastTotpStep: null, signed: [] })
    )
    const backend = vi.fn()
    const file = writePe('Varlens.exe')
    await expect(
      signFile({ file, role: 'app', mode: 'esigner', env, deps: { backend, ...fakeClock() } })
    ).rejects.toThrow(/signing budget exhausted/)
    expect(backend).not.toHaveBeenCalled()
  })

  it('requires a ledger location', async () => {
    await expect(
      signFile({ file: writePe('Varlens.exe'), role: 'app', mode: 'esigner', env: {} })
    ).rejects.toThrow(/VARLENS_WINDOWS_SIGN_LEDGER is not set/)
  })
})

describe('electron-builder signing hook', () => {
  const request = (path: string, overrides = {}) => ({
    path,
    hash: 'sha256',
    isNest: false,
    ...overrides
  })

  it('does nothing when signing is off, so ordinary packaging is unchanged', async () => {
    const file = writePe('Varlens.exe')
    const backend = vi.fn()
    await signHook(request(file), undefined, { env: {}, deps: { backend } })
    expect(backend).not.toHaveBeenCalled()
  })

  it('signs a planned file through the ledger', async () => {
    const file = writePe('Varlens-Setup-9.9.9.exe')
    await signHook(request(file), undefined, {
      env,
      deps: { backend: stubSigner(), ...fakeClock() }
    })
    expect(readLedger(env.VARLENS_WINDOWS_SIGN_LEDGER).signed[0].role).toBe('installer')
  })

  it('refuses a sha1 or nested request, which would double the cost per file', async () => {
    const file = writePe('Varlens.exe')
    const backend = vi.fn()
    await expect(
      signHook(request(file, { hash: 'sha1' }), undefined, { env, deps: { backend } })
    ).rejects.toThrow(/signingHashAlgorithms must stay \["sha256"\]/)
    await expect(
      signHook(request(file, { isNest: true }), undefined, { env, deps: { backend } })
    ).rejects.toThrow(/nested/)
    expect(backend).not.toHaveBeenCalled()
  })

  it('refuses a file outside the plan before spending a signature', async () => {
    const file = writePe('crashpad_handler.exe')
    const backend = vi.fn()
    await expect(signHook(request(file), undefined, { env, deps: { backend } })).rejects.toThrow(
      /not in the Windows signing plan/
    )
    expect(backend).not.toHaveBeenCalled()
  })
})
