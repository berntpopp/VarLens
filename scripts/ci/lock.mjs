import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
function processIdentity(pid) {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]
  } catch {
    return null
  }
}
export function acquireLock(path) {
  mkdirSync(dirname(path), { recursive: true })
  const owner = {
    pid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
    identity: processIdentity(process.pid),
    token: randomUUID()
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
      return () => {
        if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).token === owner.token)
          unlinkSync(path)
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let previous
      try {
        previous = JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        throw new Error(
          `Invalid preflight lock ${path}; inspect and remove it only after verifying no gate is running.`
        )
      }
      let live = true
      if (previous.host === hostname()) {
        try {
          process.kill(previous.pid, 0)
          live = !previous.identity || processIdentity(previous.pid) === previous.identity
        } catch (error) {
          live = error.code !== 'ESRCH'
        }
      }
      if (live)
        throw new Error(
          `Preflight already runs on ${previous.host} as PID ${previous.pid} since ${previous.startedAt} (${path}).`,
          { cause: error }
        )
      unlinkSync(path)
    }
  }
  throw new Error(`Could not acquire preflight lock ${path}`)
}
