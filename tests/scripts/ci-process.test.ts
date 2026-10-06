import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
// @ts-expect-error Repository CLI modules are tested directly.
import { gateEnvironment, runCommand } from '../../scripts/ci/process.mjs'
describe('isolated gate processes', () => {
  it('allowlists host plumbing and strips injected modes, Git routing and credentials', () => {
    const env = gateEnvironment({
      PATH: '/bin',
      HOME: '/tmp',
      GIT_DIR: '/wrong',
      GIT_WORK_TREE: '/wrong',
      NODE_OPTIONS: '--require evil',
      VARLENS_WEB: '1',
      VARLENS_PG_URL: 'secret',
      COVERAGE: '0',
      GH_TOKEN: 'secret',
      CSC_KEY_PASSWORD: 'secret',
      RANDOM_SECRET: 'secret'
    })
    expect(env).toMatchObject({
      PATH: '/bin',
      HOME: '/tmp',
      CI: '1',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    })
    for (const key of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'NODE_OPTIONS',
      'VARLENS_WEB',
      'VARLENS_PG_URL',
      'COVERAGE',
      'GH_TOKEN',
      'CSC_KEY_PASSWORD',
      'RANDOM_SECRET'
    ])
      expect(env).not.toHaveProperty(key)
  })
  it('propagates nonzero exits and terminates aborted children', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'process.exit(9)'], { quiet: true })
    ).rejects.toThrow(/9/)
    const controller = new AbortController()
    const pending = runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      signal: controller.signal,
      quiet: true
    })
    setTimeout(() => controller.abort(), 50)
    await expect(pending).rejects.toThrow(/abort/i)
  })
  it.skipIf(process.platform === 'win32')(
    'kills a stubborn descendant after its group leader exits',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'varlens-process-group-'))
      const heartbeat = join(directory, 'heartbeat')
      const identity = join(directory, 'pid')
      const controller = new AbortController()
      const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(identity)},String(process.pid));let count=0;setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(++count)),10)`
      const leader = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`
      const pending = runCommand(process.execPath, ['-e', leader], {
        signal: controller.signal,
        quiet: true
      })
      // Install rejection handling before aborting, without masking the assertion.
      const result = pending.catch((error: Error) => error)
      try {
        const deadline = Date.now() + 5000
        while (!existsSync(heartbeat) && Date.now() < deadline) await delay(10)
        expect(existsSync(heartbeat)).toBe(true)
        controller.abort()
        expect(await result).toMatchObject({ message: 'Preflight aborted' })
        await delay(50)
        const stopped = readFileSync(heartbeat, 'utf8')
        await delay(80)
        expect(readFileSync(heartbeat, 'utf8')).toBe(stopped)
      } finally {
        controller.abort()
        if (existsSync(identity)) {
          try {
            process.kill(Number(readFileSync(identity, 'utf8')), 'SIGKILL')
          } catch {
            /* Already exited. */
          }
        }
        await result
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )
})

it('refuses a live shared lock and recovers a stale same-host owner', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir, hostname } = await import('node:os')
  const { join } = await import('node:path')
  const { acquireLock } = await import('../../scripts/ci/lock.mjs')
  const directory = mkdtempSync(join(tmpdir(), 'varlens-lock-'))
  const path = join(directory, 'lock')
  try {
    const release = acquireLock(path)
    expect(() => acquireLock(path)).toThrow(/already runs/)
    release()
    writeFileSync(path, JSON.stringify({ pid: 2147483647, host: hostname(), startedAt: 'past' }))
    const recovered = acquireLock(path)
    recovered()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
