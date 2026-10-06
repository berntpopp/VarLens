import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
import { createContainerServices } from '../../scripts/ci/containers.mjs'
import { containerScope } from '../../scripts/ci/container-lifecycle.mjs'
import { createScratch } from '../../scripts/ci/scratch.mjs'

type Call = { command: string; args: string[]; options: Record<string, unknown> }
function fixture(fail?: (args: string[]) => boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'varlens-containers-test-'))
  temporary.push(directory)
  const calls: Call[] = []
  const images = new Map<
    string,
    { Id: string; Architecture: string; Os: string; Config: { Labels: Record<string, string> } }
  >()
  let generation = 0
  const signals = new EventEmitter()
  const now = new Date('2026-10-06T12:00:00Z')
  const run = async (command: string, args: string[], options: Record<string, unknown> = {}) => {
    calls.push({ command, args, options })
    if (fail?.(args)) throw new Error('simulated Docker failure')
    if (args[0] === 'buildx' && args[1] === 'build' && args.includes('--cache-to')) {
      const labels: Record<string, string> = {}
      args.forEach((arg, index) => {
        if (arg === '--label') {
          const [name, value] = args[index + 1].split('=')
          labels[name] = value
        }
      })
      const details = {
        Id: generation++ === 0 ? 'sha256:abc' : `sha256:build-${generation}`,
        Architecture: 'amd64',
        Os: 'linux',
        Config: { Labels: labels }
      }
      images.set(args[args.indexOf('--tag') + 1], details)
      images.set(details.Id, details)
      const destination = args[args.indexOf('--cache-to') + 1].match(/dest=([^,]+)/)![1]
      await mkdir(destination, { recursive: true })
      await writeFile(
        join(destination, 'index.json'),
        JSON.stringify({ schemaVersion: 2, manifests: [{ digest: 'sha256:fixture' }] })
      )
    }
    if (args[0] === 'port') return { stdout: '127.0.0.1:49152\n' }
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (args[2].endsWith(':validated') && !images.has(args[2]))
        throw Object.assign(new Error('No such image'), {
          exitCode: 1,
          stderr: Buffer.from('No such image')
        })
      return {
        stdout: JSON.stringify([
          images.get(args[2]) ?? { Id: 'sha256:abc', Architecture: 'amd64', Os: 'linux' }
        ])
      }
    }
    if (args[0] === 'tag') images.set(args[2], images.get(args[1])!)
    if (args[0] === 'image' && args[1] === 'rm') images.delete(args.at(-1)!)
    if (args[0] === 'image' && args[1] === 'ls')
      return { stdout: [...images.keys()].filter((key) => key.startsWith('sha256:')).join('\n') }
    if (args[0] === '--version') {
      return { stdout: JSON.stringify({ VulnerabilityDB: { UpdatedAt: now.toISOString() } }) }
    }
    return { stdout: '' }
  }
  const scratch = join(directory, 'scratch')
  const services = createContainerServices({
    run,
    runTool: run,
    createScratch: (kind: string) =>
      createScratch(kind, { env: { VARLENS_CI_SCRATCH_DIR: scratch } }),
    signals,
    now: () => now.getTime(),
    sleep: async () => {},
    fetch: async () => ({ ok: true, json: async () => ({ status: 'ok', db: { open: true } }) })
  })
  return { services, calls, signals, now, directory, images, scratch }
}

describe('disposable CI containers', () => {
  it('starts unique synthetic PG16 on an ephemeral loopback port and cleans only owned resources', async () => {
    const { services, calls } = fixture()
    const first = await services.startPostgres({ env: { VARLENS_PG_URL: 'secret-developer-db' } })
    const second = await services.startPostgres({})
    expect(first.env.VARLENS_PG_URL).toMatch(
      /^postgresql:\/\/varlens_ci:.+@127.0.0.1:49152\/varlens_ci$/
    )
    expect(first.env.VARLENS_PG_URL).not.toContain('secret-developer-db')
    const runs = calls.filter((call) => call.args[0] === 'run')
    expect(runs).toHaveLength(2)
    expect(runs[0].args).toContain('postgres:16')
    expect(runs[0].args).toContain('127.0.0.1::5432')
    expect(runs[0].args).not.toContain('--env-file')
    expect(runs[0].args).not.toContain('-v')
    expect(runs[0].args[runs[0].args.indexOf('--name') + 1]).not.toBe(
      runs[1].args[runs[1].args.indexOf('--name') + 1]
    )
    await first.close()
    await first.close()
    await second.close()
    expect(calls.filter((call) => call.args[0] === 'rm')).toHaveLength(2)
    expect(calls.some((call) => call.args.includes('prune'))).toBe(false)
  })

  it('cleans an allocated container when readiness fails', async () => {
    const { services, calls } = fixture((args) => args[0] === 'exec')
    await expect(services.startPostgres({})).rejects.toThrow(/ready/i)
    expect(calls.some((call) => call.args[0] === 'rm')).toBe(true)
  })

  it('fails clearly when Docker is missing', async () => {
    const services = createContainerServices({
      run: async () => {
        throw new Error('spawn docker ENOENT')
      }
    })
    await expect(services.startPostgres({})).rejects.toThrow(/Docker/i)
  })

  it('cleans active services on cancellation and unregisters signal listeners', async () => {
    const { services, calls, signals } = fixture()
    const controller = new AbortController()
    const pg = await services.startPostgres({ signal: controller.signal })
    controller.abort()
    await pg.close()
    expect(calls.some((call) => call.args[0] === 'rm')).toBe(true)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
    expect(signals.listenerCount('SIGINT')).toBe(0)
  })

  it('waits for resource creation to settle before cancellation cleanup', async () => {
    const controller = new AbortController()
    let finishCreate!: () => void
    let creationStarted!: () => void
    const started = new Promise<void>((resolve) => {
      creationStarted = resolve
    })
    const created = new Promise<void>((resolve) => {
      finishCreate = resolve
    })
    const removed: string[] = []
    const services = createContainerServices({
      run: async (_command: string, args: string[]) => {
        if (args[0] === 'run') {
          creationStarted()
          await created
        }
        if (args[0] === 'rm') removed.push(args.at(-1)!)
        return { stdout: '' }
      }
    })
    const pending = services.startPostgres({ signal: controller.signal })
    await started
    controller.abort()
    expect(removed).toEqual([])
    finishCreate()
    await expect(pending).rejects.toThrow(/cancelled/)
    expect(removed).toHaveLength(1)
  })

  it('retains only successfully validated images when a receipt needs reuse', async () => {
    const { services, calls, directory } = fixture()
    const result = await services.buildAndSmokeContainer({ retainImage: true, cwd: directory })
    expect(result.imageId).toBe('sha256:abc')
    expect(result.image).toMatch(/:validated$/)
    expect(
      calls
        .filter((call) => call.args[0] === 'image' && call.args[1] === 'rm')
        .every((call) => call.args.at(-1) !== result.image)
    ).toBe(true)
    expect(calls.some((call) => call.args[0] === 'buildx' && call.args[1] === 'rm')).toBe(true)
  })

  it('replaces only the previous image owned by this worktree', async () => {
    const { services, calls, directory } = fixture()
    const first = await services.buildAndSmokeContainer({ retainImage: true, cwd: directory })
    const second = await services.buildAndSmokeContainer({ retainImage: true, cwd: directory })
    expect(second.image).toBe(first.image)
    expect(second.imageId).not.toBe(first.imageId)
    expect(
      calls.some(
        (call) =>
          call.args[0] === 'image' && call.args[1] === 'rm' && call.args.at(-1) === first.imageId
      )
    ).toBe(true)
  })

  it('refuses to replace a stable tag whose ownership labels changed', async () => {
    const { services, directory, images } = fixture()
    const first = await services.buildAndSmokeContainer({ retainImage: true, cwd: directory })
    images.get(first.image)!.Config.Labels = {}
    await expect(
      services.buildAndSmokeContainer({ retainImage: true, cwd: directory })
    ).rejects.toThrow(/owned/)
    expect(images.get(first.image)!.Id).toBe(first.imageId)
  })

  it('removes a retained candidate if later builder cleanup fails', async () => {
    const { services, directory, images } = fixture(
      (args) => args[0] === 'buildx' && args[1] === 'rm'
    )
    await expect(
      services.buildAndSmokeContainer({ retainImage: true, cwd: directory })
    ).rejects.toThrow(/cleanup/)
    expect([...images.keys()].some((name) => name.endsWith(':validated'))).toBe(false)
  })

  it('cleans idle services on SIGHUP and removes the handler', async () => {
    const { services, calls, signals } = fixture()
    const pg = await services.startPostgres({})
    signals.emit('SIGHUP')
    await new Promise((resolve) => setImmediate(resolve))
    expect(calls.some((call) => call.args[0] === 'rm')).toBe(true)
    await pg.close()
    expect(signals.listenerCount('SIGHUP')).toBe(0)
  })

  it('uses a bounded private builder and removes it on build failure', async () => {
    const { services, calls, directory } = fixture(
      (args) => args[0] === 'buildx' && args[1] === 'build'
    )
    await expect(services.buildAndSmokeContainer({ cwd: directory })).rejects.toThrow(/failure/)
    const create = calls.find((call) => call.args[0] === 'buildx' && call.args[1] === 'create')!
    expect(create.args).toContain('docker-container')
    expect(create.args).toContain('memory=4g')
    expect(create.args).not.toContain('--use')
    const build = calls.find((call) => call.args[0] === 'buildx' && call.args[1] === 'build')!
    expect(build.args).toContain('--load')
    expect(build.args).toContain('linux/amd64')
    expect(build.args).not.toContain('--push')
    expect(calls.some((call) => call.args[0] === 'buildx' && call.args[1] === 'rm')).toBe(true)
  })

  it('reuses local layer exports without retaining a builder or accumulating generations', async () => {
    const { services, calls, directory } = fixture()
    await services.buildAndSmokeContainer({ cwd: directory })
    const cache = join(directory, '.cache/docker/linux-amd64')
    await mkdir(join(cache, 'next-stale0'))
    await services.buildAndSmokeContainer({ cwd: directory })
    expect(await readdir(cache)).toEqual(['current'])
    const builds = calls.filter((call) => call.args[0] === 'buildx' && call.args[1] === 'build')
    expect(builds[0].args).toContain('--cache-to')
    expect(builds[0].args).not.toContain('--cache-from')
    expect(builds[1].args).toContain('--cache-from')
    expect(builds[1].args.join(' ')).toContain('mode=max')
  })

  it('probes native hot paths and readiness of the exact pruned image', async () => {
    const { services, calls } = fixture()
    const result = await services.smokeContainer('varlens-test:unique', {})
    expect(result.imageId).toBe('sha256:abc')
    expect(calls.some((call) => call.args[0] === 'port')).toBe(false)
    expect(
      calls.some((call) => call.args[0] === 'exec' && call.args.join(' ').includes('/readyz'))
    ).toBe(true)
    const probe = calls.find(
      (call) => call.args[0] === 'run' && call.args.includes('--entrypoint')
    )!
    expect(probe.args).toContain('sha256:abc')
    expect(probe.args.join(' ')).toContain('better-sqlite3-multiple-ciphers')
    expect(probe.args.join(' ')).toContain("prepare('SELECT 1')")
    expect(probe.args.join(' ')).toContain('argon2')
    expect(calls.some((call) => call.args[0] === 'network' && call.args[1] === 'rm')).toBe(true)
  })

  it('refreshes scan advisories and uses release severity without publishing', async () => {
    const { services, calls, now } = fixture()
    const result = await services.scanContainer('varlens-test:unique', {})
    expect(result.imageId).toBe('sha256:abc')
    expect(result.databaseUpdatedAt).toBe(now.toISOString())
    const scan = calls.find((call) => call.command === 'trivy' && call.args.includes('--severity'))!
    expect(scan.args).toEqual(
      expect.arrayContaining([
        'CRITICAL',
        '--ignore-unfixed',
        '--exit-code',
        '1',
        '--image-src',
        'docker',
        'sha256:abc'
      ])
    )
    expect(calls.some((call) => call.args.includes('--download-db-only'))).toBe(true)
  })

  it('does not let inherited Trivy settings disable vulnerability checks', async () => {
    const { services, calls } = fixture()
    await services.scanContainer('image', {
      env: {
        PATH: '/usr/bin',
        TRIVY_SKIP_DIRS: '/app',
        TRIVY_EXIT_CODE: '0',
        GH_TOKEN: 'never-pass-me'
      }
    })
    const scan = calls.find((call) => call.command === 'trivy' && call.args.includes('--severity'))!
    expect(scan.options.env).not.toHaveProperty('TRIVY_SKIP_DIRS')
    expect(scan.options.env).not.toHaveProperty('TRIVY_EXIT_CODE')
    expect(scan.options.env).not.toHaveProperty('GH_TOKEN')
  })

  it('rejects stale advisory metadata even if the scanner would pass', async () => {
    const { services, now } = fixture()
    now.setUTCDate(now.getUTCDate() - 2)
    // A separate clock simulates metadata from an earlier database download.
    const { scratch } = fixture()
    const stale = createContainerServices({
      createScratch: (kind: string) =>
        createScratch(kind, { env: { VARLENS_CI_SCRATCH_DIR: scratch } }),
      run: async () => ({
        stdout: JSON.stringify([{ Id: 'sha256:abc', Architecture: 'amd64', Os: 'linux' }])
      }),
      runTool: async () => ({
        stdout: JSON.stringify({ VulnerabilityDB: { UpdatedAt: now.toISOString() } })
      }),
      now: () => Date.parse('2026-10-06T12:00:00Z')
    })
    await expect(stale.scanContainer('image', {})).rejects.toThrow(/24 hours/)
    expect(services).toBeDefined()
  })

  it('keeps Trivy databases and image exports in removable disk-backed scratch', async () => {
    const { services, calls, scratch } = fixture()
    await services.scanContainer('image', { env: { PATH: '/usr/bin', TMPDIR: '/dev/shm' } })
    const trivy = calls.filter((call) => call.command === 'trivy')
    expect(trivy).toHaveLength(3)
    for (const call of trivy) {
      const cache = call.args[call.args.indexOf('--cache-dir') + 1]
      const env = call.options.env as Record<string, string>
      expect(cache.startsWith(`${scratch}/`)).toBe(true)
      // Trivy has no flag for its docker-export directory; it follows TMPDIR.
      expect(env.TMPDIR.startsWith(`${scratch}/`)).toBe(true)
      expect(env.TMPDIR).not.toBe(cache)
      expect(env.PATH).toBe('/usr/bin')
    }
    expect(await readdir(scratch)).toEqual([])
  })

  it('removes scan scratch when the scanner fails or the run is cancelled', async () => {
    const failing = fixture((args) => args.includes('--severity'))
    await expect(failing.services.scanContainer('image', {})).rejects.toThrow(/simulated/)
    expect(await readdir(failing.scratch)).toEqual([])

    const { scratch, signals } = fixture()
    let populated: string[] = []
    const cancelled = createContainerServices({
      signals,
      createScratch: (kind: string) =>
        createScratch(kind, { env: { VARLENS_CI_SCRATCH_DIR: scratch } }),
      run: async () => ({
        stdout: JSON.stringify([{ Id: 'sha256:abc', Architecture: 'amd64', Os: 'linux' }])
      }),
      runTool: async (_name: string, _args: string[], options: { signal: AbortSignal }) => {
        populated = await readdir(scratch)
        signals.emit('SIGTERM')
        options.signal.throwIfAborted()
        return { stdout: '' }
      }
    })
    await expect(cancelled.scanContainer('image', {})).rejects.toThrow(/cancelled/)
    expect(populated).toHaveLength(1)
    expect(await readdir(scratch)).toEqual([])
  })

  it('keeps the private builder configuration out of the temporary directory', async () => {
    const { services, calls, directory, scratch } = fixture()
    await services.buildAndSmokeContainer({ cwd: directory, scan: true })
    const create = calls.find((call) => call.args[0] === 'buildx' && call.args[1] === 'create')!
    const config = create.args[create.args.indexOf('--buildkitd-config') + 1]
    expect(config.startsWith(`${scratch}/`)).toBe(true)
    expect(await readdir(scratch)).toEqual([])
  })

  it('stays subscribed to termination signals until owned resources are removed', async () => {
    const signals = new EventEmitter()
    const scope = containerScope({ signals })
    let duringCleanup = -1
    let release!: () => void
    const removing = new Promise<void>((resolve) => {
      release = resolve
    })
    scope.defer(async () => {
      // A second SIGTERM (make forwarding the one the cgroup already delivered)
      // must not find the process without a handler and kill it mid-removal.
      duringCleanup = signals.listenerCount('SIGTERM')
      await removing
    })
    signals.emit('SIGTERM')
    const closing = scope.close()
    await new Promise((resolve) => setImmediate(resolve))
    expect(duringCleanup).toBe(1)
    expect(() => signals.emit('SIGTERM')).not.toThrow()
    release()
    await closing
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) expect(signals.listenerCount(name)).toBe(0)
  })
})
