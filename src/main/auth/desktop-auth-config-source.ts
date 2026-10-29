/**
 * Where the admin config file of the desktop sign-in is read from (#295): the
 * real file system, without following links, and on Windows one PowerShell
 * call that checks and reads the file through the same open handle.
 */
import { spawnSync } from 'child_process'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'fs'
import { win32 } from 'path'
import { app } from 'electron'
import {
  MAX_CONFIG_BYTES,
  type ConfigSource,
  type PathProbe,
  type WindowsConfigRead
} from './desktop-auth-config'

function probe(path: string): PathProbe {
  try {
    return { state: 'present', stats: lstatSync(path) }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
    return code === 'ENOENT' ? { state: 'absent' } : { state: 'error', code }
  }
}

/** One open without following a symbolic link, then checks on that handle. */
function readConfigFile(path: string): string {
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
  const fd = openSync(path, constants.O_RDONLY | noFollow)
  try {
    const stats = fstatSync(fd)
    if (!stats.isFile()) throw new Error('not a regular file')
    if (stats.size > MAX_CONFIG_BYTES) throw new Error(`larger than ${MAX_CONFIG_BYTES} bytes`)
    const buffer = Buffer.alloc(stats.size)
    let read = 0
    while (read < stats.size) {
      const chunk = readSync(fd, buffer, read, stats.size - read, read)
      if (chunk === 0) break
      read += chunk
    }
    return buffer.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * Windows: open the file once in the system's own Windows PowerShell, take its
 * security descriptor from that handle and read the content from it; then the
 * folder's descriptor. Reparse points (links, junctions) are refused. The path
 * travels in the environment, never in the command.
 */
const WINDOWS_READ_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$p = $env:VARLENS_ACL_TARGET',
  '$d = [IO.Path]::GetDirectoryName($p)',
  'if ([IO.Directory]::Exists($p)) { exit 4 }',
  'foreach ($x in @($p, $d)) {',
  '  if (([IO.File]::GetAttributes($x) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 2 }',
  '}',
  "$fs = [IO.File]::Open($p, 'Open', 'Read', 'Read')",
  'try {',
  "  $file = $fs.GetAccessControl().GetSecurityDescriptorSddlForm('Owner,Access')",
  `  if ($fs.Length -gt ${MAX_CONFIG_BYTES}) { exit 3 }`,
  '  $bytes = New-Object byte[] $fs.Length',
  '  $n = 0',
  '  while ($n -lt $bytes.Length) { $r = $fs.Read($bytes, $n, $bytes.Length - $n); if ($r -le 0) { break }; $n += $r }',
  '} finally { $fs.Dispose() }',
  "$folder = [IO.Directory]::GetAccessControl($d).GetSecurityDescriptorSddlForm('Owner,Access')",
  '@{ file = $file; folder = $folder; content = [Convert]::ToBase64String($bytes, 0, $n) } | ConvertTo-Json -Compress'
].join('\n')

const WINDOWS_READ_EXITS: Record<number, string> = {
  2: 'is a link or junction, or sits in one',
  3: `is larger than ${MAX_CONFIG_BYTES} bytes`,
  4: 'is a folder, not a file'
}

/** Turn the script's exit code and output into the descriptors and content, or a reason. */
export function parseWindowsRead(result: {
  status: number | null
  stdout: string
  error?: Error
}): WindowsConfigRead {
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const reason = WINDOWS_READ_EXITS[result.status ?? -1]
    throw new Error(reason ?? `the check failed (${result.status ?? 'no status'})`)
  }
  const answer = JSON.parse(result.stdout) as Record<string, unknown>
  const { file, folder, content } = answer
  if (typeof file !== 'string' || typeof folder !== 'string' || typeof content !== 'string') {
    throw new Error('the check returned no descriptor')
  }
  return {
    fileSddl: file,
    folderSddl: folder,
    content: Buffer.from(content, 'base64').toString('utf8')
  }
}

function windowsRead(path: string): WindowsConfigRead {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const powershell = win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const result = spawnSync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_READ_SCRIPT],
    {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
      env: { SystemRoot: systemRoot, VARLENS_ACL_TARGET: path }
    }
  )
  return parseWindowsRead(result)
}

export function nodeConfigSource(): ConfigSource {
  return {
    platform: process.platform,
    env: process.env,
    fs: { probe, readFile: readConfigFile },
    development: !app.isPackaged,
    windowsRead
  }
}
