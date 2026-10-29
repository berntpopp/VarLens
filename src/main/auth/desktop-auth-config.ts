/**
 * The admin config file that switches the desktop into platform sign-in.
 *
 * Without the file the desktop runs as it always has. With it, nobody reaches
 * data without signing in through the identity provider it names. The file
 * lives in a machine-wide folder that only administrators can change:
 *
 *   Windows  C:\ProgramData\VarLens\auth.json
 *   macOS    /Library/Application Support/VarLens/auth.json
 *   Linux    /etc/varlens/auth.json
 *
 * Only "the file does not exist" means no sign-in. A file, or a path, that
 * cannot be checked, trusted or parsed fails closed: the desktop stays locked
 * and says why, rather than quietly running without sign-in.
 *
 * `VARLENS_DESKTOP_AUTH_CONFIG` names a file for development builds. It is
 * read only when no machine-wide file exists, so it can add a sign-in but
 * never remove the one an administrator configured.
 */
import { z } from 'zod'
import { dirname, win32 } from 'path'
import type { Stats } from 'fs'
import { windowsAclProblem } from './windows-acl'

export interface DesktopAuthConfig {
  /** OIDC issuer, exactly as the identity provider puts it into `iss`. */
  issuer: string
  clientId: string
  /** Audience the access token must carry. */
  audience: string
  requiredAcr: string
  requiredAmr: string[]
  /** Desktop access: the token claim that must contain `value`. */
  access: { claim: string; value: string }
  /** Lock after this many minutes without input. */
  idleLockMinutes: number
  /** Sign in again after this many minutes at the latest. */
  maxSessionMinutes: number
  /** Refuse databases whose key the OS account alone unlocks. */
  requirePassphrase: boolean
}

export type DesktopAuthConfigResult =
  | { kind: 'none' }
  | { kind: 'platform'; path: string; config: DesktopAuthConfig }
  | { kind: 'invalid'; path: string; problem: string }

/** What `lstat` says about a path: only ENOENT counts as absent. */
export type PathProbe =
  { state: 'absent' } | { state: 'present'; stats: Stats } | { state: 'error'; code: string }

export interface ConfigFileSystem {
  /** `lstat`, without following a symbolic link. */
  probe(path: string): PathProbe
  /** Read a regular file of at most MAX_CONFIG_BYTES without following a symbolic link. */
  readFile(path: string): string
}

export interface ConfigSource {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  fs: ConfigFileSystem
  /** Development builds: read VARLENS_DESKTOP_AUTH_CONFIG and accept a loopback HTTP issuer. */
  development: boolean
  /**
   * Windows: the file's security descriptor and content, both through one
   * open handle, so the content is that of the file whose permissions were
   * checked; and the folder's descriptor, by path. Throws when it cannot.
   */
  windowsRead(path: string): WindowsConfigRead
}

export interface WindowsConfigRead {
  fileSddl: string
  folderSddl: string
  content: string
}

export const MAX_CONFIG_BYTES = 64 * 1024

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The one rule for identity provider addresses: HTTPS, or plain HTTP to this
 * machine in a development build only, since on a shared computer another
 * account could take the port.
 */
function isTrustedIdpUrl(url: URL, development: boolean): boolean {
  if (url.protocol === 'https:') return true
  return development && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

function issuerProblem(value: string, development: boolean): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'issuer must be a URL'
  }
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    return 'issuer must not carry a query, fragment or user'
  }
  return isTrustedIdpUrl(url, development) ? undefined : 'issuer must be an https URL'
}

const Token = z.string().trim().min(1).max(256)

function configSchema(development: boolean) {
  return z
    .object({
      mode: z.literal('platform'),
      issuer: z
        .string()
        .trim()
        .superRefine((value, context) => {
          const problem = issuerProblem(value, development)
          if (problem !== undefined) context.addIssue({ code: 'custom', message: problem })
        }),
      clientId: Token,
      audience: Token,
      requiredAcr: Token,
      requiredAmr: z.array(Token).min(1),
      access: z.object({ claim: Token, value: Token }).strict(),
      idleLockMinutes: z.number().int().min(1).max(240).default(15),
      maxSessionMinutes: z.number().int().min(15).max(1440).default(480),
      requirePassphrase: z.boolean().default(false)
    })
    .strict()
}

/**
 * Where an administrator's file may be, most trusted first. On Windows the
 * fixed path comes first: %ProgramData% is an environment variable any user
 * can point elsewhere, which must not hide the administrator's file.
 */
export function machineConfigPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const paths = ['C:\\ProgramData\\VarLens\\auth.json']
    const programData = env.ProgramData?.trim() ?? ''
    if (programData !== '') paths.push(win32.join(programData, 'VarLens', 'auth.json'))
    return [...new Set(paths)]
  }
  if (platform === 'darwin') return ['/Library/Application Support/VarLens/auth.json']
  return ['/etc/varlens/auth.json']
}

function probeProblem(target: string, probe: PathProbe): string | undefined {
  if (probe.state === 'absent') return `${target} is missing`
  if (probe.state === 'error') return `${target} cannot be checked (${probe.code})`
  return undefined
}

/** POSIX: why the file or its folder could be changed by someone who is not root, if so. */
function posixProblem(source: ConfigSource, path: string): string | undefined {
  const checks: Array<[string, 'file' | 'folder']> = [
    [path, 'file'],
    [dirname(path), 'folder']
  ]
  for (const [target, kind] of checks) {
    const probe = source.fs.probe(target)
    const unreachable = probeProblem(target, probe)
    if (unreachable !== undefined || probe.state !== 'present') return unreachable
    const { stats } = probe
    if (stats.isSymbolicLink()) return `${target} is a symbolic link`
    if (kind === 'file' ? !stats.isFile() : !stats.isDirectory())
      return `${target} is not a ${kind}`
    if (stats.uid !== 0) return `${target} is not owned by root`
    if ((stats.mode & 0o022) !== 0) return `${target} is writable by group or others`
  }
  return undefined
}

/** Windows: the owner and the access control lists of the file and its folder. */
function windowsProblem(path: string, read: WindowsConfigRead): string | undefined {
  const checks: Array<[string, string, 'file' | 'folder']> = [
    [path, read.fileSddl, 'file'],
    [win32.dirname(path), read.folderSddl, 'folder']
  ]
  for (const [target, sddl, kind] of checks) {
    const problem = windowsAclProblem(sddl, kind)
    if (problem !== undefined) return `${target} ${problem}`
  }
  return undefined
}

function decode(text: string): string | undefined {
  // Windows tools often write a byte-order mark. UTF-16 shows as NUL bytes.
  if (text.includes('\u0000')) return undefined
  return text.startsWith('\uFEFF') ? text.slice(1) : text
}

function parse(path: string, raw: string, development: boolean): DesktopAuthConfigResult {
  const text = decode(raw)
  if (text === undefined) {
    return { kind: 'invalid', path, problem: `${path} must be saved as UTF-8` }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { kind: 'invalid', path, problem: `${path} is not valid JSON` }
  }
  const parsed = configSchema(development).safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue.path.length > 0 ? issue.path.join('.') : 'the file'
    return { kind: 'invalid', path, problem: `${path}: ${where}: ${issue.message}` }
  }
  const { issuer, clientId, audience, requiredAcr, requiredAmr, access } = parsed.data
  const { idleLockMinutes, maxSessionMinutes, requirePassphrase } = parsed.data
  const config = { issuer, clientId, audience, requiredAcr, requiredAmr, access }
  return {
    kind: 'platform',
    path,
    config: { ...config, idleLockMinutes, maxSessionMinutes, requirePassphrase }
  }
}

function failure(path: string, what: string, error: unknown): DesktopAuthConfigResult {
  const reason = error instanceof Error ? error.message : String(error)
  return { kind: 'invalid', path, problem: `${path} ${what}: ${reason}` }
}

function read(source: ConfigSource, path: string, machineWide: boolean): DesktopAuthConfigResult {
  if (machineWide && source.platform === 'win32') {
    const probe = source.fs.probe(path)
    const unreachable = probeProblem(path, probe)
    if (unreachable !== undefined || probe.state !== 'present') {
      return { kind: 'invalid', path, problem: unreachable ?? `${path} is missing` }
    }
    if (probe.stats.isSymbolicLink()) {
      return { kind: 'invalid', path, problem: `${path} is a symbolic link` }
    }
    let windowsRead: WindowsConfigRead
    try {
      windowsRead = source.windowsRead(path)
    } catch (error) {
      return failure(path, 'cannot be checked', error)
    }
    const problem = windowsProblem(path, windowsRead)
    if (problem !== undefined) return { kind: 'invalid', path, problem }
    return parse(path, windowsRead.content, source.development)
  }
  if (machineWide) {
    const problem = posixProblem(source, path)
    if (problem !== undefined) return { kind: 'invalid', path, problem }
  }
  let text: string
  try {
    text = source.fs.readFile(path)
  } catch (error) {
    return failure(path, 'cannot be read', error)
  }
  return parse(path, text, source.development)
}

export function readDesktopAuthConfig(source: ConfigSource): DesktopAuthConfigResult {
  for (const machinePath of machineConfigPaths(source.platform, source.env)) {
    const probe = source.fs.probe(machinePath)
    if (probe.state === 'absent') continue
    if (probe.state === 'error') {
      const problem = `${machinePath} cannot be checked (${probe.code})`
      return { kind: 'invalid', path: machinePath, problem }
    }
    return read(source, machinePath, true)
  }
  const override = source.env.VARLENS_DESKTOP_AUTH_CONFIG?.trim() ?? ''
  if (source.development && override !== '') return read(source, override, false)
  return { kind: 'none' }
}
