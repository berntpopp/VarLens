import { spawn } from 'node:child_process'

/** Run argv directly. Errors omit argv/env: synthetic database passwords may be present. */
export function toolCommand(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    signal,
    timeout = 120_000,
    maxBuffer = 256 * 1024 * 1024
  } = options
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, signal, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    let size = 0
    let failure
    let forceTimer
    const timer = setTimeout(() => {
      failure = new Error(`${command} exceeded its ${timeout}ms timeout`)
      child.kill('SIGKILL')
    }, timeout)
    timer.unref()
    const collect = (chunks) => (data) => {
      size += data.length
      if (size > maxBuffer) {
        failure = new Error(`${command} exceeded its output limit`)
        child.kill('SIGKILL')
      } else {
        chunks.push(data)
      }
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once('error', (error) => {
      clearTimeout(timer)
      failure = new Error(`Unable to run ${command}: ${error.code ?? error.name}`, { cause: error })
      if (!child.pid) reject(failure)
      else {
        // AbortSignal emits error before close. Wait for close so resource
        // removal cannot race the command that is still creating it.
        forceTimer = setTimeout(() => child.kill('SIGKILL'), 3000)
        forceTimer.unref()
      }
    })
    child.once('close', (code, terminationSignal) => {
      clearTimeout(timer)
      clearTimeout(forceTimer)
      const output = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
      if (failure || code !== 0) {
        const error = failure ?? new Error(`${command} failed (${terminationSignal ?? code})`)
        // Consumers may deliberately print redacted tool output. Never embed it in error.message.
        Object.assign(error, output, { exitCode: code })
        reject(error)
      } else {
        resolve(
          options.binary
            ? output
            : {
                stdout: output.stdout.toString('utf8'),
                stderr: output.stderr.toString('utf8')
              }
        )
      }
    })
  })
}
