import { describe, it, expect } from 'vitest'
import type { Stats } from 'fs'
import {
  machineConfigPaths,
  readDesktopAuthConfig,
  type ConfigSource,
  type PathProbe
} from '../../../src/main/auth/desktop-auth-config'

const VALID = {
  mode: 'platform',
  issuer: 'https://keycloak.example.org/realms/varlens',
  clientId: 'varlens-desktop',
  audience: 'varlens-desktop',
  requiredAcr: 'urn:varlens:acr:password-plus-totp',
  requiredAmr: ['pwd', 'otp'],
  access: { claim: 'groups', value: '/varlens-desktop' }
}

function stats(
  kind: 'file' | 'folder' | 'link',
  uid = 0,
  mode = kind === 'folder' ? 0o755 : 0o644
): Stats {
  return {
    uid,
    mode,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'folder',
    isSymbolicLink: () => kind === 'link'
  } as Stats
}

type Entry = PathProbe | { text: string; stats: Stats }

function source(options: {
  platform?: NodeJS.Platform
  entries?: Record<string, Entry>
  env?: NodeJS.ProcessEnv
  development?: boolean
  windows?: { fileSddl: string; folderSddl: string; content: string } | Error
}): ConfigSource {
  const entries = options.entries ?? {}
  return {
    platform: options.platform ?? 'linux',
    env: options.env ?? {},
    development: options.development ?? false,
    fs: {
      probe: (path) => {
        const entry = entries[path]
        if (entry === undefined) return { state: 'absent' }
        return 'text' in entry ? { state: 'present', stats: entry.stats } : entry
      },
      readFile: (path) => {
        const entry = entries[path]
        if (entry === undefined || !('text' in entry)) throw new Error('EACCES')
        return entry.text
      }
    },
    windowsRead: () => {
      if (options.windows === undefined || options.windows instanceof Error) {
        throw options.windows ?? new Error('the check failed')
      }
      return options.windows
    }
  }
}

function linux(text: string, file = stats('file'), folder = stats('folder')): ConfigSource {
  return source({
    entries: {
      '/etc/varlens/auth.json': { text, stats: file },
      '/etc/varlens': { state: 'present', stats: folder }
    }
  })
}

const json = (value: unknown): string => JSON.stringify(value)

describe('desktop auth config', () => {
  it('is absent only when the file does not exist: the desktop runs as before', () => {
    expect(readDesktopAuthConfig(source({}))).toEqual({ kind: 'none' })
  })

  it('fails closed when the path cannot be checked', () => {
    for (const code of ['EACCES', 'EPERM', 'ELOOP', 'ENOTDIR']) {
      const result = readDesktopAuthConfig(
        source({ entries: { '/etc/varlens/auth.json': { state: 'error', code } } })
      )
      expect(result.kind).toBe('invalid')
      expect(result.kind === 'invalid' && result.problem).toContain(code)
    }
  })

  it('reads a valid file with defaults and keeps the issuer exactly as given', () => {
    const issuer = 'https://idp.example.org/'
    const result = readDesktopAuthConfig(linux(json({ ...VALID, issuer: ` ${issuer} ` })))
    expect(result).toEqual({
      kind: 'platform',
      path: '/etc/varlens/auth.json',
      config: {
        issuer,
        clientId: 'varlens-desktop',
        audience: 'varlens-desktop',
        requiredAcr: 'urn:varlens:acr:password-plus-totp',
        requiredAmr: ['pwd', 'otp'],
        access: { claim: 'groups', value: '/varlens-desktop' },
        idleLockMinutes: 15,
        maxSessionMinutes: 480,
        requirePassphrase: false
      }
    })
  })

  it('accepts a byte-order mark and refuses UTF-16', () => {
    expect(readDesktopAuthConfig(linux(`\uFEFF${json(VALID)}`)).kind).toBe('platform')
    const utf16 = readDesktopAuthConfig(linux('{\u0000"\u0000m\u0000'))
    expect(utf16.kind === 'invalid' && utf16.problem).toMatch(/UTF-8/)
  })

  it.each([
    ['plain http to another host', { ...VALID, issuer: 'http://keycloak.example.org/realms/v' }],
    [
      'plain http to this machine in a packaged build',
      { ...VALID, issuer: 'http://localhost:8080/realms/v' }
    ],
    ['an issuer with a query', { ...VALID, issuer: 'https://k.example.org/realms/v?x=1' }],
    ['no amr', { ...VALID, requiredAmr: [] }],
    ['no access claim', { ...VALID, access: undefined }],
    ['an unknown key', { ...VALID, entitlementsUrl: 'https://ops.example.org' }],
    ['another mode', { ...VALID, mode: 'none' }],
    ['a too short session', { ...VALID, maxSessionMinutes: 5 }]
  ])('fails closed on %s', (_label, config) => {
    expect(readDesktopAuthConfig(linux(json(config))).kind).toBe('invalid')
  })

  it('accepts plain http to this machine only in a development build', () => {
    for (const issuer of [
      'http://localhost:8080/realms/v',
      'http://127.0.0.1:8080/realms/v',
      'http://[::1]:8080/realms/v'
    ]) {
      const dev = source({
        development: true,
        entries: {
          '/etc/varlens/auth.json': { text: json({ ...VALID, issuer }), stats: stats('file') },
          '/etc/varlens': { state: 'present', stats: stats('folder') }
        }
      })
      expect(readDesktopAuthConfig(dev).kind).toBe('platform')
    }
  })

  it('fails closed on a file that is not JSON or cannot be read', () => {
    expect(readDesktopAuthConfig(linux('{ mode: platform')).kind).toBe('invalid')
    const unreadable = source({
      entries: {
        '/etc/varlens/auth.json': { state: 'present', stats: stats('file') },
        '/etc/varlens': { state: 'present', stats: stats('folder') }
      }
    })
    expect(readDesktopAuthConfig(unreadable).kind).toBe('invalid')
  })

  it('refuses a file or folder a non-administrator could change', () => {
    const cases: Array<[Stats, Stats, RegExp]> = [
      [stats('file', 501), stats('folder'), /not owned by root/],
      [stats('file', 0, 0o666), stats('folder'), /writable by group or others/],
      [stats('file'), stats('folder', 0, 0o777), /writable by group or others/],
      [stats('file'), stats('folder', 501), /not owned by root/],
      [stats('link'), stats('folder'), /symbolic link/],
      [stats('folder'), stats('folder'), /not a file/]
    ]
    for (const [file, folder, reason] of cases) {
      const result = readDesktopAuthConfig(linux(json(VALID), file, folder))
      expect(result.kind).toBe('invalid')
      expect(result.kind === 'invalid' && result.problem).toMatch(reason)
    }
  })

  describe('on Windows', () => {
    const path = 'C:\\ProgramData\\VarLens\\auth.json'
    const ADMIN_FILE = 'O:BAG:SYD:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;0x1200a9;;;BU)'
    const ADMIN_FOLDER =
      'O:BAG:SYD:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIIOID;GA;;;CO)(A;OICIID;0x1200a9;;;BU)(A;CIID;DCLCRPCR;;;BU)'
    const PLANTED =
      'O:S-1-5-21-1-2-3-1001G:S-1-5-21-1-2-3-513D:AI(A;ID;FA;;;S-1-5-21-1-2-3-1001)(A;ID;FA;;;BA)'

    function windows(
      read: { fileSddl: string; folderSddl: string; content?: string } | Error,
      entry: Entry = { state: 'present', stats: stats('file') }
    ): ConfigSource {
      const windowsRead = read instanceof Error ? read : { content: json(VALID), ...read }
      return source({ platform: 'win32', entries: { [path]: entry }, windows: windowsRead })
    }

    it('trusts a file an administrator placed with the inherited ProgramData permissions', () => {
      const result = readDesktopAuthConfig(
        windows({ fileSddl: ADMIN_FILE, folderSddl: ADMIN_FOLDER })
      )
      expect(result.kind).toBe('platform')
    })

    it('parses the content read through the checked handle', () => {
      const result = readDesktopAuthConfig(
        windows({ fileSddl: ADMIN_FILE, folderSddl: ADMIN_FOLDER, content: '{ broken' })
      )
      expect(result.kind === 'invalid' && result.problem).toMatch(/not valid JSON/)
    })

    it('refuses a file or folder another user owns or may change', () => {
      for (const read of [
        { fileSddl: PLANTED, folderSddl: ADMIN_FOLDER },
        { fileSddl: ADMIN_FILE, folderSddl: PLANTED },
        { fileSddl: 'O:BAG:SYD:(A;;FA;;;BA)(A;;0x1301bf;;;BU)', folderSddl: ADMIN_FOLDER },
        { fileSddl: ADMIN_FILE, folderSddl: 'O:BAG:SYD:(A;;FA;;;BA)(A;;0x1301ff;;;AU)' },
        { fileSddl: 'O:BAG:SYD:NO_ACCESS_CONTROL', folderSddl: ADMIN_FOLDER }
      ]) {
        const result = readDesktopAuthConfig(windows(read))
        expect(result.kind).toBe('invalid')
        expect(result.kind === 'invalid' && result.problem).not.toMatch(/S-1-5-21/)
      }
    })

    it('fails closed when the check cannot run, and on a symbolic link', () => {
      expect(readDesktopAuthConfig(windows(new Error('powershell blocked'))).kind).toBe('invalid')
      const link = windows(
        { fileSddl: ADMIN_FILE, folderSddl: ADMIN_FOLDER },
        { state: 'present', stats: stats('link') }
      )
      expect(readDesktopAuthConfig(link).kind).toBe('invalid')
    })

    it('looks at the fixed path first, then at %ProgramData%', () => {
      const paths = machineConfigPaths('win32', { ProgramData: 'D:\\Elsewhere' })
      expect(paths).toEqual([
        'C:\\ProgramData\\VarLens\\auth.json',
        'D:\\Elsewhere\\VarLens\\auth.json'
      ])
      expect(machineConfigPaths('darwin', {})).toEqual([
        '/Library/Application Support/VarLens/auth.json'
      ])
    })
  })

  describe('the development override', () => {
    const override = '/tmp/varlens-auth.json'
    const own = { text: json(VALID), stats: stats('file', 501) }

    it('is read in a development build when no machine-wide file exists', () => {
      const dev = source({
        development: true,
        env: { VARLENS_DESKTOP_AUTH_CONFIG: override },
        entries: { [override]: own }
      })
      expect(readDesktopAuthConfig(dev).kind).toBe('platform')
    })

    it('is ignored in a packaged build', () => {
      const packaged = source({
        env: { VARLENS_DESKTOP_AUTH_CONFIG: override },
        entries: { [override]: own }
      })
      expect(readDesktopAuthConfig(packaged)).toEqual({ kind: 'none' })
    })

    it('never replaces or repairs the machine-wide file', () => {
      const both = (machineText: string): ConfigSource =>
        source({
          development: true,
          env: { VARLENS_DESKTOP_AUTH_CONFIG: override },
          entries: {
            '/etc/varlens/auth.json': { text: machineText, stats: stats('file') },
            '/etc/varlens': { state: 'present', stats: stats('folder') },
            [override]: own
          }
        })
      const valid = readDesktopAuthConfig(both(json(VALID)))
      expect(valid.kind === 'platform' && valid.path).toBe('/etc/varlens/auth.json')
      expect(readDesktopAuthConfig(both('broken')).kind).toBe('invalid')
    })
  })
})
