import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

// Host plumbing only. Build modes, credentials and Git's repository routing are
// intentionally absent; each gate supplies its own fixed overrides.
const HOST_ENV = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'SSH_AUTH_SOCK',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy'
]
export function gateEnvironment(source = process.env, overrides = {}) {
  return {
    ...Object.fromEntries(
      HOST_ENV.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])
    ),
    CI: '1',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ...overrides
  }
}
export function git(args, { cwd = process.cwd(), env = process.env } = {}) {
  return execFileSync('git', args, {
    cwd,
    env: gateEnvironment(env),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024
  }).trimEnd()
}
export function runCommand(
  command,
  args = [],
  { cwd = process.cwd(), env = gateEnvironment(), signal, quiet = false, logFile } = {}
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Preflight aborted'))
    const executable =
      process.platform === 'win32' && ['npm', 'npx'].includes(command) ? `${command}.cmd` : command
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timer
    const collect = (stream, chunk) => {
      const value = chunk.toString()
      if (stream === 'stdout') stdout = (stdout + value).slice(-1024 * 1024)
      else stderr = (stderr + value).slice(-1024 * 1024)
      if (!quiet) process[stream].write(value)
      if (logFile) appendFileSync(logFile, value)
    }
    child.stdout.on('data', (data) => collect('stdout', data))
    child.stderr.on('data', (data) => collect('stderr', data))
    const terminate = (force = false) => {
      if (!child.pid) return
      try {
        if (process.platform === 'win32') {
          if (force) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
          else child.kill('SIGTERM')
        } else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
      } catch (error) {
        if (error.code !== 'ESRCH') reject(error)
      }
    }
    const abort = () => {
      terminate()
      timer = setTimeout(() => terminate(true), 3000)
      timer.unref()
    }
    signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    child.on('error', (error) => {
      cleanup()
      reject(error)
    })
    child.on('close', (code, killed) => {
      cleanup()
      if (signal?.aborted) reject(new Error('Preflight aborted'))
      else if (code !== 0) reject(new Error(`${command} failed (${killed ?? code})`))
      else resolve({ stdout, stderr, code })
    })
  })
}
