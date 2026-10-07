import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { electronBuilderArgs, rewrapWindows } from '../../scripts/release/rewrap-windows.mjs'
import {
  executablesTable,
  findProblems,
  flattenExecutables,
  inspectWindowsRelease
} from '../../scripts/release/verify-windows-signatures.mjs'
import { sign as signHook } from '../../scripts/release/windows-sign-hook.mjs'
import { signFile } from '../../scripts/release/windows-signing/sign-file.mjs'
import { createArchiveStub } from './support/archive-stub'
import { fakeSign, makePe } from './support/pe-fixtures'

const VERSION = '9.9.9'
const SETUP = `Varlens-Setup-${VERSION}.exe`
const PORTABLE = `Varlens-Portable-${VERSION}.exe`
const TRANSPORT = `Varlens-Setup-${VERSION}.zip`
const UNINSTALLER = `Varlens-Setup-${VERSION}.__uninstaller.exe`

type Env = Record<string, string>
interface Row {
  artifact: string
  path: string
  signed: boolean
}
/** Deviations a fake electron-builder run can be told to make. */
interface BuilderFaults {
  skipUninstallerSigning?: boolean
  tamperPayload?: boolean
  staleLatestYml?: boolean
  dualSign?: boolean
}

let root: string
let promotedDir: string
let outDir: string
let workDir: string
let stub: ReturnType<typeof createArchiveStub>
let backend: Mock<(path: string) => Promise<void>>

const signingDeps = () => ({ backend, now: () => 0, sleep: () => Promise.resolve() })
const sha512 = (path: string): string =>
  createHash('sha512').update(readFileSync(path)).digest('base64')

function latestYml(dir: string): string {
  const path = join(dir, SETUP)
  return [
    `version: ${VERSION}`,
    'files:',
    `  - url: ${SETUP}`,
    `    sha512: ${sha512(path)}`,
    `    size: ${readFileSync(path).length}`,
    `path: ${SETUP}`,
    `sha512: ${sha512(path)}`
  ].join('\n')
}

/** Registers the promoted zip: the unpacked app dir as build.yml archived it. */
function registerTransport(extraFiles: Record<string, Buffer | string> = {}): void {
  writeFileSync(join(promotedDir, TRANSPORT), 'zip')
  stub.register(join(promotedDir, TRANSPORT), (dest) => {
    const files: Record<string, Buffer | string> = {
      'Varlens.exe': makePe('varlens app'),
      'ffmpeg.dll': 'dll bytes',
      'resources/app.asar': 'asar bytes',
      ...extraFiles
    }
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dest, path)), { recursive: true })
      writeFileSync(join(dest, path), body)
    }
  })
}

/**
 * Behaves like `electron-builder --prepackaged`: leaves the app executable
 * alone, copies in and signs the elevate helper, builds and signs the
 * uninstaller, then builds and signs each installer around the app directory —
 * invoking the real signing hook for every file, in electron-builder's order.
 */
function fakeElectronBuilder(faults: BuilderFaults = {}) {
  return async (args: string[], env: Env): Promise<void> => {
    const appDir = args[args.indexOf('--prepackaged') + 1]
    const builderOut = (args.at(-1) ?? '').replace('-c.directories.output=', '')
    mkdirSync(builderOut, { recursive: true })
    const request = async (path: string): Promise<void> => {
      const options = { env, deps: signingDeps() }
      await signHook({ path, hash: 'sha256', isNest: false }, undefined, options)
      if (faults.dualSign)
        await signHook({ path, hash: 'sha256', isNest: true }, undefined, options)
    }

    const elevate = join(appDir, 'resources', 'elevate.exe')
    writeFileSync(elevate, makePe('elevate helper'))
    await request(elevate)

    const uninstaller = join(builderOut, UNINSTALLER)
    writeFileSync(uninstaller, makePe('uninstaller'))
    if (!faults.skipUninstallerSigning) await request(uninstaller)

    if (faults.tamperPayload) writeFileSync(join(appDir, 'resources', 'app.asar'), 'tampered')
    for (const name of [SETUP, PORTABLE]) {
      const installer = join(builderOut, name)
      writeFileSync(installer, makePe(`installer ${name}`))
      stub.registerInstaller(installer, appDir, name === SETUP ? uninstaller : undefined)
      if (name === SETUP && faults.staleLatestYml) {
        writeFileSync(join(builderOut, 'latest.yml'), latestYml(builderOut))
      }
      await request(installer)
    }
    if (!faults.staleLatestYml) writeFileSync(join(builderOut, 'latest.yml'), latestYml(builderOut))
    writeFileSync(join(builderOut, `${SETUP}.blockmap`), 'blockmap')
  }
}

function rewrap(faults: BuilderFaults = {}, env: Env = { VARLENS_WINDOWS_SIGNING: 'esigner' }) {
  return rewrapWindows({
    promotedDir,
    outDir,
    workDir,
    version: VERSION,
    env,
    deps: {
      extract: stub.extract,
      runBuilder: fakeElectronBuilder(faults),
      sign: (options: Parameters<typeof signFile>[0]) =>
        signFile({ ...options, deps: signingDeps() }),
      packageVersion: () => VERSION
    }
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'varlens-rewrap-'))
  promotedDir = join(root, 'promoted')
  outDir = join(root, 'publish')
  workDir = join(root, 'work')
  mkdirSync(promotedDir)
  stub = createArchiveStub()
  backend = vi.fn((path: string) => Promise.resolve(fakeSign(path)))
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('electronBuilderArgs', () => {
  it('re-wraps a prepackaged directory and never publishes', () => {
    const args = electronBuilderArgs({ appDir: '/w/app', outDir: '/w/out' })
    const prepackaged = args.indexOf('--prepackaged')
    const publish = args.indexOf('--publish')
    expect(args.slice(prepackaged, prepackaged + 2)).toEqual(['--prepackaged', '/w/app'])
    expect(args.slice(publish, publish + 2)).toEqual(['--publish', 'never'])
    // The zip target is build.yml's transport only; the release does not rebuild it.
    expect(args.slice(0, 4)).toEqual(['--win', 'nsis', 'portable', '--x64'])
  })
})

describe('rewrapWindows', () => {
  it('signs all five executables once and stages exactly the published set', async () => {
    registerTransport()
    const { executables } = (await rewrap()) as { executables: Row[] }

    expect(backend).toHaveBeenCalledTimes(5)
    expect(readdirSync(outDir).sort()).toEqual([PORTABLE, SETUP, 'latest.yml'])
    expect(executables.map((row) => `${row.artifact} :: ${row.path}`)).toEqual([
      `${SETUP} :: ${SETUP}`,
      `${SETUP} :: $R0/Uninstall Varlens.exe`,
      `${SETUP} :: Varlens.exe`,
      `${SETUP} :: resources/elevate.exe`,
      `${PORTABLE} :: ${PORTABLE}`,
      `${PORTABLE} :: Varlens.exe`,
      `${PORTABLE} :: resources/elevate.exe`
    ])
    expect(executables.every((row) => row.signed)).toBe(true)
    const ledger = JSON.parse(readFileSync(join(workDir, 'signing-ledger.json'), 'utf8')) as {
      signed: { role: string }[]
    }
    expect(ledger.signed.map((entry) => entry.role)).toEqual([
      'app',
      'elevate',
      'uninstaller',
      'installer',
      'portable'
    ])
  })

  it('signs each layer before the layer that embeds it', async () => {
    registerTransport()
    const order: string[] = []
    backend.mockImplementation((path: string) => {
      order.push(path.split(/[\\/]/).at(-1) ?? '')
      return Promise.resolve(fakeSign(path))
    })
    await rewrap()
    expect(order).toEqual(['Varlens.exe', 'elevate.exe', UNINSTALLER, SETUP, PORTABLE])
  })

  it('drops a stale elevate helper that raced into the promoted archive', async () => {
    registerTransport({ 'resources/elevate.exe': makePe('stale unsigned elevate') })
    await rewrap()
    // Still five: the stale copy was neither signed nor counted as unplanned.
    expect(backend).toHaveBeenCalledTimes(5)
  })

  it('fails when an executable inside the installer was left unsigned', async () => {
    registerTransport()
    await expect(rewrap({ skipUninstallerSigning: true })).rejects.toThrow(
      /Uninstall Varlens\.exe is not signed[\s\S]*signature ledger does not match the plan/
    )
  })

  it('fails when the installer payload is not the promoted build', async () => {
    registerTransport()
    await expect(rewrap({ tamperPayload: true })).rejects.toThrow(
      /payload differs from the promoted build — changed: resources\/app\.asar/
    )
  })

  it('fails when latest.yml was written before the last byte change', async () => {
    registerTransport()
    await expect(rewrap({ staleLatestYml: true })).rejects.toThrow(/mismatch for Varlens-Setup/)
  })

  it('fails on a second, nested signature request instead of paying for it', async () => {
    registerTransport()
    await expect(rewrap({ dualSign: true })).rejects.toThrow(/nested signing request/)
    expect(backend).toHaveBeenCalledTimes(2) // app + elevate; the nested request was refused
  })

  it('spends nothing when the app directory holds an unplanned executable', async () => {
    registerTransport({ 'crashpad_handler.exe': makePe('helper') })
    await expect(rewrap()).rejects.toThrow(/unplanned executable.*crashpad_handler\.exe/)
    expect(backend).not.toHaveBeenCalled()
  })

  it('spends nothing when package.json is not the version being released', async () => {
    registerTransport()
    await expect(
      rewrapWindows({
        promotedDir,
        outDir,
        workDir,
        version: VERSION,
        env: { VARLENS_WINDOWS_SIGNING: 'esigner' },
        deps: { extract: stub.extract, packageVersion: () => '1.0.0' }
      })
    ).rejects.toThrow(/package\.json is 1\.0\.0 but the release is 9\.9\.9/)
    expect(backend).not.toHaveBeenCalled()
  })

  it('fails before touching anything when eSigner credentials are missing', async () => {
    registerTransport()
    await expect(
      rewrapWindows({
        promotedDir,
        outDir,
        workDir,
        version: VERSION,
        env: { VARLENS_WINDOWS_SIGNING: 'esigner' },
        deps: { extract: stub.extract, packageVersion: () => VERSION }
      })
    ).rejects.toThrow(/CST_DIR, CST_JAR is not set/)
    expect(existsSync(workDir)).toBe(false)
  })

  it('refuses to run with signing off or without the promoted archive', async () => {
    await expect(rewrap({}, {})).rejects.toThrow(/VARLENS_WINDOWS_SIGNING is off/)
    await expect(rewrap()).rejects.toThrow(/promoted app archive not found/)
  })
})

describe('inspectWindowsRelease on promoted, unsigned installers', () => {
  // The kill-switch path: build.yml's installers are published untouched.
  function promotedInstallers(): string {
    const dir = join(root, 'unsigned')
    const appDir = join(root, 'app')
    mkdirSync(join(appDir, 'resources'), { recursive: true })
    mkdirSync(dir)
    writeFileSync(join(appDir, 'Varlens.exe'), makePe('varlens app'))
    writeFileSync(join(appDir, 'resources', 'elevate.exe'), makePe('elevate'))
    const uninstaller = join(root, 'uninstaller.exe')
    writeFileSync(uninstaller, makePe('uninstaller'))
    for (const name of [SETUP, PORTABLE]) {
      writeFileSync(join(dir, name), makePe(name))
      stub.registerInstaller(join(dir, name), appDir, name === SETUP ? uninstaller : undefined)
    }
    return dir
  }
  const inspect = (dir: string, version = VERSION) =>
    inspectWindowsRelease({ dir, version, workDir, extract: stub.extract })

  it('reports every executable as unsigned without failing in report mode', async () => {
    const report = await inspect(promotedInstallers())
    const rows = flattenExecutables(report) as Row[]
    expect(rows).toHaveLength(7)
    expect(rows.some((row) => row.signed)).toBe(false)
    expect(findProblems(report, { requireSigned: false })).toEqual([])
    expect(executablesTable(rows).split('\n')[2]).toBe(
      `| \`${SETUP}\` | \`${SETUP}\` | **not signed** |`
    )
  })

  it('lists each unsigned executable inside signed installers when signatures are required', async () => {
    const dir = promotedInstallers()
    fakeSign(join(dir, SETUP))
    fakeSign(join(dir, PORTABLE))
    // Exactly the state v0.75.0 shipped in: outer files signed, contents not.
    expect(findProblems(await inspect(dir), { requireSigned: true })).toEqual([
      `${SETUP}: $R0/Uninstall Varlens.exe is not signed`,
      `${SETUP}: Varlens.exe is not signed`,
      `${SETUP}: resources/elevate.exe is not signed`,
      `${PORTABLE}: Varlens.exe is not signed`,
      `${PORTABLE}: resources/elevate.exe is not signed`
    ])
  })

  it('fails when an installer does not contain what it must, even in report mode', async () => {
    const dir = promotedInstallers()
    const emptyApp = join(root, 'empty-app')
    mkdirSync(emptyApp)
    writeFileSync(join(emptyApp, 'readme.txt'), 'no executables here')
    stub.registerInstaller(join(dir, PORTABLE), emptyApp)
    expect(findProblems(await inspect(dir), { requireSigned: false })).toEqual([
      `${PORTABLE}: does not contain Varlens.exe`,
      `${PORTABLE}: does not contain resources/elevate.exe`
    ])
  })

  it('throws when an artifact is missing', async () => {
    const dir = promotedInstallers()
    rmSync(join(dir, PORTABLE))
    await expect(inspect(dir)).rejects.toThrow(/missing Windows artifact: Varlens-Portable/)
    await expect(inspect(dir, '1.2.3')).rejects.toThrow(
      /missing Windows artifact: Varlens-Setup-1\.2\.3\.exe/
    )
  })
})
