#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { containerScope } from './container-lifecycle.mjs'
import { toolCommand } from './tool-command.mjs'
import { gateEnvironment } from './process.mjs'
import { dockerLayerCache } from './docker-cache.mjs'
import { receiptImages } from './container-images.mjs'
import { runTool as pinnedTool } from './tools.mjs'
import { createScratch as diskScratch } from './scratch.mjs'

const uniqueName = (kind) => `varlens-ci-${kind}-${randomUUID()}`
const nativeProbe = `(async () => {
  require('./out/web/server.cjs');
  require('node:fs').accessSync('./out/web/postgres-import-worker.cjs');
  require('./out/web/postgres-import-worker.cjs');
  require('./out/web/provision-platform-user.cjs');
  const Database = require('better-sqlite3-multiple-ciphers');
  const database = new Database(':memory:');
  if (database.prepare('SELECT 1').get()['1'] !== 1) throw new Error('SQLite probe failed');
  database.close();
  const argon2 = require('@node-rs/argon2');
  const hash = await argon2.hash('synthetic-ci-native-probe');
  if (!await argon2.verify(hash, 'synthetic-ci-native-probe')) throw new Error('Argon2 probe failed');
})().catch(() => { process.exitCode = 1; })`

export function createContainerServices(dependencies = {}) {
  const {
    run = toolCommand,
    runTool = pinnedTool,
    createScratch = diskScratch,
    signals = process,
    sleep = (ms, signal) => delay(ms, undefined, { signal }),
    now = Date.now
  } = dependencies
  const docker = async (args, options = {}) => {
    try {
      return await run('docker', args, options)
    } catch (error) {
      const details = String(error.stderr ?? '')
        .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://<redacted>@')
        .replace(/POSTGRES_PASSWORD=\S+/g, 'POSTGRES_PASSWORD=<redacted>')
      error.message = `Docker ${args[0]}: ${error.message}${details ? `\n${details.slice(-8000)}` : ''}`
      throw error
    }
  }
  const remove = (args, options) =>
    docker(args, { cwd: options.cwd, env: options.env, timeout: 60_000 })

  async function requireDocker(options) {
    try {
      await docker(['version', '--format', '{{.Server.Version}}'], options)
    } catch (error) {
      throw new Error('Docker is required: install Docker with buildx and start its daemon', {
        cause: error
      })
    }
  }

  async function waitUntilReady(check, signal, description) {
    for (let attempt = 0; attempt < 60; attempt++) {
      signal?.throwIfAborted()
      try {
        if (await check()) return
      } catch {
        signal?.throwIfAborted()
      }
      await sleep(1000, signal)
    }
    throw new Error(`${description} was not ready within 60 checks`)
  }

  async function portOf(name, port, options) {
    const result = await docker(['port', name, `${port}/tcp`], options)
    const match = String(result.stdout)
      .trim()
      .match(/^127\.0\.0\.1:(\d+)$/)
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) {
      throw new Error('Docker did not allocate an ephemeral loopback port')
    }
    return match[1]
  }

  async function startPostgres(options = {}) {
    await requireDocker(options)
    const scope = containerScope({ signal: options.signal, signals })
    const name = uniqueName('postgres')
    const password = randomBytes(24).toString('hex')
    const commandOptions = { ...options, signal: scope.signal }
    scope.defer(() => remove(['rm', '--force', '--volumes', name], options))
    try {
      await docker(
        [
          'run',
          '--detach',
          '--name',
          name,
          '--label',
          'org.varlens.ci=disposable',
          '--memory',
          '1g',
          '--cpus',
          '2',
          '--tmpfs',
          '/var/lib/postgresql/data:rw,size=1073741824',
          ...(!options.network ? ['--publish', '127.0.0.1::5432'] : []),
          ...(options.network ? ['--network', options.network, '--network-alias', 'postgres'] : []),
          '--env',
          'POSTGRES_USER=varlens_ci',
          '--env',
          'POSTGRES_DB=varlens_ci',
          '--env',
          `POSTGRES_PASSWORD=${password}`,
          'postgres:16'
        ],
        commandOptions
      )
      await waitUntilReady(
        async () => {
          await docker(
            ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'varlens_ci', '-d', 'varlens_ci'],
            commandOptions
          )
          return true
        },
        scope.signal,
        'Disposable PostgreSQL'
      )
      const port = options.network ? '5432' : await portOf(name, 5432, commandOptions)
      const host = options.network ? 'postgres' : '127.0.0.1'
      scope.ready()
      return {
        env: {
          ...options.env,
          VARLENS_PG_URL: `postgresql://varlens_ci:${password}@${host}:${port}/varlens_ci`,
          VARLENS_PG_SSL_MODE: 'disable',
          VARLENS_PG_SCHEMA: 'varlens'
        },
        // Used only inside an invocation's private Docker network; never logged.
        internalUrl: `postgresql://varlens_ci:${password}@postgres:5432/varlens_ci`,
        close: scope.close
      }
    } catch (error) {
      await scope.close().catch(() => {})
      throw error
    }
  }

  async function imageIdentity(image, options) {
    if (typeof image !== 'string' || !image || image.startsWith('-'))
      throw new Error('An image reference is required')
    const inspected = await docker(['image', 'inspect', image], options)
    const identity = JSON.parse(String(inspected.stdout))[0]
    if (!identity?.Id || identity.Architecture !== 'amd64' || identity.Os !== 'linux') {
      throw new Error('Container validation requires a loaded linux/amd64 image')
    }
    return { image, imageId: identity.Id, architecture: identity.Architecture, os: identity.Os }
  }

  async function smokeContainer(image, options = {}) {
    await requireDocker(options)
    const scope = containerScope({ signal: options.signal, signals })
    const commandOptions = { ...options, signal: scope.signal }
    try {
      const metadata = await imageIdentity(image, commandOptions)
      const network = uniqueName('network')
      scope.defer(() => remove(['network', 'rm', network], options))
      await docker(
        ['network', 'create', '--internal', '--label', 'org.varlens.ci=disposable', network],
        commandOptions
      )
      const pg = await startPostgres({ ...commandOptions, network })
      scope.defer(pg.close)
      const probe = uniqueName('native')
      scope.defer(() => remove(['rm', '--force', '--volumes', probe], options))
      await docker(
        [
          'run',
          '--name',
          probe,
          '--network',
          'none',
          '--memory',
          '512m',
          '--cpus',
          '2',
          '--entrypoint',
          'node',
          metadata.imageId,
          '-e',
          nativeProbe
        ],
        commandOptions
      )
      const name = uniqueName('web')
      scope.defer(() => remove(['rm', '--force', '--volumes', name], options))
      await docker(
        [
          'run',
          '--detach',
          '--name',
          name,
          '--network',
          network,
          '--label',
          'org.varlens.ci=disposable',
          '--memory',
          '1g',
          '--cpus',
          '2',
          '--env',
          `VARLENS_PG_URL=${pg.internalUrl}`,
          '--env',
          'VARLENS_PG_SSL_MODE=disable',
          '--env',
          'VARLENS_AUTH_MODE=local',
          '--env',
          'VARLENS_METRICS_ENABLED=0',
          '--env',
          'VARLENS_LOG_LEVEL=error',
          metadata.imageId
        ],
        commandOptions
      )
      const readinessProbe =
        "fetch('http://127.0.0.1:8080/readyz').then(async (response) => { const data = await response.json(); if (!response.ok || data.db?.open !== true) throw new Error('not ready') }).catch(() => { process.exitCode = 1 })"
      await waitUntilReady(
        async () => {
          await docker(['exec', name, 'node', '-e', readinessProbe], commandOptions)
          return true
        },
        scope.signal,
        'Pruned web image with PostgreSQL'
      )
      await scope.close()
      return { ...metadata, nativeProbe: 'passed', readinessProbe: 'passed' }
    } catch (error) {
      await scope.close().catch(() => {})
      throw error
    }
  }

  async function scanContainer(image, options = {}) {
    options = { ...options, env: gateEnvironment(options.env ?? process.env) }
    await requireDocker(options)
    const scope = containerScope({ signal: options.signal, signals })
    const commandOptions = { ...options, signal: scope.signal }
    try {
      const metadata = await imageIdentity(image, commandOptions)
      // Fresh run-scoped DB: advisories are never a reusable scan verdict and
      // the previous database cannot suppress a remote refresh via NextUpdate.
      const scratch = createScratch('trivy', { env: options.env })
      scope.defer(scratch.close)
      const cache = join(scratch.directory, 'cache')
      const temporary = join(scratch.directory, 'tmp')
      await mkdir(cache)
      await mkdir(temporary)
      const config = join(scratch.directory, 'trivy.yaml')
      const ignore = join(scratch.directory, '.trivyignore')
      await writeFile(config, '{}\n')
      await writeFile(ignore, '')
      const common = ['--cache-dir', cache, '--config', config]
      // Trivy exports the image (gigabytes) below its temporary directory and
      // has no flag for it. Keep that beside the database, off a tmpfs /tmp.
      const scanOptions = {
        ...commandOptions,
        env: { ...options.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary }
      }
      await runTool(
        'trivy',
        ['image', ...common, '--download-db-only', '--no-progress'],
        scanOptions
      )
      const version = await runTool(
        'trivy',
        ['--version', ...common, '--format', 'json'],
        scanOptions
      )
      const updatedAt = JSON.parse(String(version.stdout)).VulnerabilityDB?.UpdatedAt
      // Upstream publishes once every 24 h; a 24 h limit failed on every late publish.
      const age = now() - Date.parse(updatedAt)
      if (!Number.isFinite(age) || age < -5 * 60_000 || age > 48 * 60 * 60_000) {
        throw new Error('Trivy vulnerability database must be updated within the last 48 hours')
      }
      await runTool(
        'trivy',
        [
          'image',
          ...common,
          '--ignorefile',
          ignore,
          '--skip-db-update',
          '--image-src',
          'docker',
          '--scanners',
          'vuln',
          '--severity',
          'CRITICAL',
          '--ignore-unfixed',
          '--exit-code',
          '1',
          '--no-progress',
          metadata.imageId
        ],
        scanOptions
      )
      await scope.close()
      return {
        ...metadata,
        databaseUpdatedAt: updatedAt,
        scannedAt: new Date(now()).toISOString(),
        severity: 'CRITICAL',
        ignoreUnfixed: true
      }
    } catch (error) {
      await scope.close().catch(() => {})
      throw error
    }
  }

  async function buildAndSmokeContainer(options = {}) {
    await requireDocker(options)
    const scope = containerScope({ signal: options.signal, signals })
    const commandOptions = { ...options, signal: scope.signal }
    const images = receiptImages(docker, commandOptions)
    let retained
    try {
      const cache = await dockerLayerCache(
        resolve(options.cwd ?? process.cwd(), '.cache/docker/linux-amd64')
      )
      scope.defer(cache.close)
      const scratch = createScratch('builder', { env: options.env })
      scope.defer(scratch.close)
      const config = join(scratch.directory, 'buildkitd.toml')
      await writeFile(config, '[worker.oci]\n  max-parallelism = 2\n')
      const builder = uniqueName('builder')
      scope.defer(() => remove(['buildx', 'rm', '--force', builder], options))
      await docker(
        [
          'buildx',
          'create',
          '--name',
          builder,
          '--driver',
          'docker-container',
          '--driver-opt',
          'memory=4g',
          '--driver-opt',
          'memory-swap=4g',
          '--driver-opt',
          'cpu-period=100000',
          '--driver-opt',
          'cpu-quota=200000',
          '--buildkitd-config',
          config
        ],
        commandOptions
      )
      const image = `${uniqueName('web')}:local`
      scope.defer(() => remove(['image', 'rm', image], options))
      await docker(
        [
          'buildx',
          'build',
          '--builder',
          builder,
          '--platform',
          'linux/amd64',
          '--load',
          '--tag',
          image,
          ...images.labelArgs,
          '--file',
          'Dockerfile',
          ...cache.args,
          '.'
        ],
        { ...commandOptions, timeout: 30 * 60_000 }
      )
      // BuildKit cache is deterministic build input reuse, never a smoke/scan verdict.
      await cache.publish()
      const smoke = await smokeContainer(image, commandOptions)
      const scan = options.scan ? await scanContainer(image, commandOptions) : undefined
      scope.signal.throwIfAborted()
      if (options.retainImage) retained = await images.retain(smoke)
      await scope.close()
      return { ...(retained ?? smoke), ...(scan ? { scan } : {}) }
    } catch (error) {
      if (retained) await images.discard(retained).catch(() => {})
      await scope.close().catch(() => {})
      throw error
    }
  }

  return { startPostgres, buildAndSmokeContainer, smokeContainer, scanContainer }
}

export const { startPostgres, buildAndSmokeContainer, smokeContainer, scanContainer } =
  createContainerServices()

const isMain =
  process.argv[1] &&
  (() => {
    try {
      return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    } catch {
      return false
    }
  })()
if (isMain) {
  const [command, image] = process.argv.slice(2)
  try {
    const options = { cwd: process.cwd(), env: process.env }
    let result
    if (command === 'smoke') result = await smokeContainer(image, options)
    else if (command === 'scan') result = await scanContainer(image, options)
    else if (command === 'build')
      result = await buildAndSmokeContainer({ ...options, scan: image === '--scan' })
    else throw new Error('Usage: containers.mjs smoke <image> | scan <image> | build [--scan]')
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
