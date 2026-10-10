import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { gateEnvironment, git, runCommand, signalAbort } from './process.mjs'
import { fullSelection, resolveChanges } from './changes.mjs'
import { selectStages, executeStages, stageEnvironment } from './stages.mjs'
import { acquireLock } from './lock.mjs'
import { ensureDependencies, installedFingerprint } from './dependencies.mjs'
import { materializeFixtures } from './fixtures.mjs'
import {
  assertCleanSnapshot,
  assertNoLocalEnv,
  assertUnchanged,
  digestPaths,
  hashValue,
  matchesReceipt,
  readReceipt,
  snapshotSource,
  writeReceipt
} from './receipt.mjs'
import { outgoingHistory } from './git-history.mjs'
import { runTool, toolFingerprint } from './tools.mjs'
import { startPostgres, buildAndSmokeContainer, scanContainer } from './containers.mjs'
import {
  screenshotFingerprint,
  verifyScreenshots,
  recordScreenshots,
  prepareDocs
} from './docs-screenshots.mjs'
import { expectedArtifacts } from '../release/artifact-manifest.mjs'
import { verifyLatestYml } from '../release/verify-latest-yml.mjs'

export function createWebTestState() {
  const directory = mkdtempSync(join(tmpdir(), 'varlens-ci-web-'))
  writeFileSync(join(directory, 'web-session-secret'), randomBytes(32), { mode: 0o600 })
  return {
    env: {
      VARLENS_RECOVERY_KEY_DIR: directory,
      VARLENS_METRICS_PORT: '0',
      VARLENS_WEB_HOST: '127.0.0.1',
      VARLENS_METRICS_HOST: '127.0.0.1'
    },
    close: () => rmSync(directory, { recursive: true, force: true })
  }
}

export async function validateWorkflows({
  cwd = process.cwd(),
  env = gateEnvironment(),
  signal
} = {}) {
  const options = { cwd, env, signal }
  await runCommand(process.execPath, ['scripts/ci/workflow-policy.mjs', 'check'], options)
  await runTool('actionlint', [], options)
  const scripts = git(['ls-files', '-z', '--', '*.sh', '.githooks/pre-push'], { cwd })
    .split('\0')
    .filter(Boolean)
  if (scripts.length) await runTool('shellcheck', ['--external-sources', ...scripts], options)
}
export async function runPostgresTests({
  cwd = process.cwd(),
  env = gateEnvironment(process.env, {
    VARLENS_PG_URL: process.env.VARLENS_PG_URL,
    VARLENS_RECOVERY_KEY_DIR: process.env.VARLENS_RECOVERY_KEY_DIR
  }),
  signal,
  logFile
} = {}) {
  if (!env.VARLENS_PG_URL) throw new Error('VARLENS_PG_URL is required for PostgreSQL tests')
  if (!existsSync(join(cwd, 'out/web/server.cjs')))
    throw new Error('Build the web bundle before PostgreSQL tests')
  // COPY-path tests intentionally use the configured application schema. Apply
  // the same migrations as web startup instead of depending on prior test order.
  await runCommand(
    process.execPath,
    ['--eval', "require('./out/web/server.cjs').buildApp().then(app => app.close())"],
    { cwd, env, signal, logFile }
  )
  const files = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (
        entry.name.endsWith('.test.ts') &&
        readFileSync(path, 'utf8').includes('VARLENS_RUN_POSTGRES_E2E')
      )
        files.push(path)
    }
  }
  visit(join(cwd, 'tests/main'))
  if (!files.length) throw new Error('PostgreSQL test inventory is empty')
  await runCommand(
    'npx',
    ['--no-install', 'vitest', 'run', '--project', 'main', '--maxWorkers=1', ...files],
    { cwd, env: { ...env, VARLENS_RUN_POSTGRES_E2E: '1' }, signal, logFile }
  )
}

export async function scanSecrets({ cwd, env, commit, remote, signal }) {
  await runTool(
    'gitleaks',
    ['git', '--redact', '--no-banner', '--log-opts', outgoingHistory(commit, remote), '.'],
    { cwd, env, signal }
  )
}
function assertToolchain(cwd) {
  const required = readFileSync(join(cwd, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
  if (process.versions.node !== required)
    throw new Error(`Node ${required} from .nvmrc is required; got ${process.versions.node}`)
}
function assertArtifacts(cwd) {
  const version = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version
  const platform = { linux: 'linux', darwin: 'mac', win32: 'win' }[process.platform]
  if (!platform) throw new Error(`Packaging is unsupported on ${process.platform}`)
  const dir = join(cwd, 'release')
  for (const name of expectedArtifacts(platform, version)) {
    if (!existsSync(join(dir, name)))
      throw new Error(`Required installer artifact is missing: ${name}`)
    if (name.endsWith('.yml')) verifyLatestYml({ ymlPath: join(dir, name), dir })
  }
}
async function playwright(spec, context, extraEnv = {}, extraArgs = []) {
  const args = ['--no-install', 'playwright', 'test', spec, '--workers=1', ...extraArgs]
  const options = {
    ...context.options,
    env: {
      ...context.env,
      ...(context.noSandbox ? { VARLENS_E2E_NO_SANDBOX: '1' } : {}),
      ...extraEnv
    }
  }
  if (process.platform === 'linux')
    return runCommand(
      'xvfb-run',
      ['--auto-servernum', '--server-args=-screen 0 1280x960x24', 'npx', ...args],
      options
    )
  return runCommand('npx', args, options)
}
async function executeGate(stage, context) {
  const { cwd, options } = context
  const env = stageEnvironment(stage, context.env, context.postgres?.env)
  process.stdout.write(`\n[preflight] ${stage.id}\n`)
  for (const output of stage.clean ?? [])
    rmSync(join(cwd, output), { recursive: true, force: true })
  const command = (executable, args, overrides = {}) =>
    runCommand(executable, args, { ...options, env: { ...env, ...overrides } })
  if (stage.command) {
    const overrides = { ...stage.env }
    const args = [...stage.args]
    await command(stage.command, args, overrides)
    for (const path of stage.requiredFiles ?? []) {
      if (!existsSync(join(cwd, path))) throw new Error(`Required gate output is missing: ${path}`)
    }
    return
  }
  switch (stage.action) {
    case 'setup':
      return // Completed before checking deterministic receipts.
    case 'workflows':
      return validateWorkflows({ ...options, env })
    case 'secrets':
      return scanSecrets({ ...options, env, commit: context.commit, remote: context.remote })
    case 'quality':
      await command('npm', ['run', 'lint:check'])
      await command('npm', ['run', 'typecheck'])
      return
    case 'node':
      await command('npm', ['run', 'rebuild:node'])
      await command(process.execPath, ['scripts/native/assert-native-abi.mjs', 'node'])
      return
    case 'postgres':
      context.webState = createWebTestState()
      context.postgres = await startPostgres({
        ...options,
        env: { ...env, ...context.webState.env }
      })
      return
    case 'postgres-storage':
      return runPostgresTests({ ...options, cwd, env })
    case 'docker':
      context.container = await buildAndSmokeContainer({
        ...options,
        env: gateEnvironment(),
        scan: true,
        retainImage: true
      })
      return
    case 'release-contracts': {
      // Artifact/promotion verifier behavior runs in desktop-tests, once.
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
      if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version))
        throw new Error('Invalid release version')
      return
    }
    case 'electron':
      // All tests which load the Node-native addon have finished.
      await command('npm', ['run', 'rebuild:electron'])
      await command(process.execPath, ['scripts/native/assert-native-abi.mjs', 'electron'])
      return
    case 'startup':
      return playwright('tests/e2e/startup-smoke.e2e.ts', context)
    case 'interactions':
      return playwright('tests/e2e/renderer-perf-phase1.e2e.ts', context, {}, [
        '--grep',
        'interaction quality'
      ])
    case 'artifacts':
      return assertArtifacts(cwd)
    case 'packaged-smoke':
      return playwright('tests/e2e/packaged-smoke.e2e.ts', context)
    case 'screenshots':
      rmSync(context.screenshots.directory, { recursive: true, force: true })
      mkdirSync(context.screenshots.directory, { recursive: true })
      await playwright('tests/e2e/screenshots.e2e.ts', context, {
        VARLENS_SCREENSHOT_DIR: context.screenshots.directory
      })
      recordScreenshots(context.screenshots)
      return
    case 'docs': {
      const destination = prepareDocs(context.screenshots)
      await command('npx', ['--no-install', 'vitepress', 'build', destination])
      return
    }
    default:
      throw new Error(`No executor for required gate ${stage.id}`)
  }
}
async function refreshBase({ cwd, remote, base, env, signal }) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(remote))
    throw new Error('Preflight requires a named Git remote (for example origin)')
  // Fetch all configured remote branches so secret ranges and main reachability
  // describe the remote now, rather than the last developer fetch.
  await runCommand('git', ['fetch', '--no-tags', '--prune', remote], { cwd, env, signal })
  try {
    return git(['rev-parse', '--verify', `${base}^{commit}`], { cwd })
  } catch {
    return null
  }
}
export async function runPreflight({
  cwd = process.cwd(),
  full = false,
  cleanInstall = false,
  dryRun = false,
  base = 'origin/main',
  remote = 'origin',
  push = false,
  noSandbox = false
} = {}) {
  cwd = resolve(cwd)
  try {
    noSandbox ||= git(['config', '--bool', '--get', 'varlens.ciNoSandbox'], { cwd }) === 'true'
  } catch {
    /* Default keeps the sandbox enabled. */
  }
  let snapshot = snapshotSource(cwd)
  const initial = resolveChanges({ cwd, base, workingTree: true })
  const fingerprint = screenshotFingerprint({ root: cwd })
  const screenshots = {
    root: cwd,
    fingerprint,
    directory: join(cwd, '.cache', 'docs-screenshots', fingerprint)
  }
  const screenshotsMissing = !verifyScreenshots(screenshots)
  if (dryRun) {
    const selection = full ? fullSelection('explicit full preflight') : initial.selection
    const stages = selectStages(selection, { screenshotsMissing })
    const plan = {
      base: initial.base,
      selection,
      stages: stages.map(({ id, side }) => ({ id, side })),
      readiness: snapshot.status
        ? 'dirty; cannot record push readiness'
        : 'requires remote freshness and execution'
    }
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    return plan
  }
  assertToolchain(cwd)
  assertCleanSnapshot(snapshot)
  assertNoLocalEnv(cwd)
  const stateDir = resolve(cwd, git(['rev-parse', '--git-path', 'varlens-ci'], { cwd }))
  const commonDir = resolve(cwd, git(['rev-parse', '--git-common-dir'], { cwd }))
  const releaseWorktree = acquireLock(join(stateDir, 'run.lock'))
  let releaseCommon
  const termination = signalAbort()
  let context
  try {
    releaseCommon = acquireLock(join(commonDir, 'varlens-ci-heavy.lock'))
    const env = gateEnvironment()
    const signal = termination.signal
    const baseCommit = await refreshBase({ cwd, remote, base, env, signal })
    const changes = resolveChanges({ cwd, base, workingTree: true })
    const selection = full ? fullSelection('explicit full preflight') : changes.selection
    const stages = selectStages(selection, { screenshotsMissing })
    process.stdout.write(
      `${JSON.stringify({ base: changes.base, selection, stages: stages.map((stage) => stage.id) }, null, 2)}\n`
    )
    const logDir = join(stateDir, 'logs', `${Date.now()}`)
    mkdirSync(logDir, { recursive: true })
    const options = { cwd, env, signal, logFile: join(logDir, 'commands.log') }
    context = { cwd, env, options, commit: snapshot.commit, remote, screenshots, noSandbox }
    const execute = (command, args, overrides) =>
      runCommand(command, args, { ...options, ...overrides })
    const dependencies = await ensureDependencies({
      cwd,
      stateDir,
      env,
      execute,
      clean: cleanInstall
    })
    // Setup ends here: from this snapshot on, source and fixture bytes are bound.
    snapshot = await materializeFixtures({ cwd, execute, initial: snapshot })
    const toolchain = {
      node: process.version,
      abi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
      npm: (await runCommand('npm', ['--version'], { ...options, quiet: true })).stdout.trim(),
      tools: await toolFingerprint({ cwd, env, signal })
    }
    const inputs = {
      commit: snapshot.commit,
      tree: snapshot.tree,
      base: changes.base,
      policy: await digestPaths(cwd, ['scripts/ci', 'Makefile', 'AGENTS.md', 'package-lock.json']),
      toolchain,
      dependencies,
      generatedFixtures: snapshot.generatedFixtures,
      stages: stages.map((stage) => stage.id),
      requiredOutputs: stages.flatMap((stage) => stage.outputs ?? []),
      screenshotFingerprint: selection.docs ? fingerprint : null,
      electronNoSandbox: noSandbox
    }
    const recordPath = join(stateDir, 'receipts', `${snapshot.commit}-${hashValue(inputs)}.json`)
    const prior = readReceipt(recordPath)
    if (!cleanInstall && baseCommit && (await matchesReceipt(prior, inputs, { cwd }))) {
      process.stdout.write(
        'Reusing verified deterministic gates; refreshing outgoing-history and vulnerability scans.\n'
      )
      await scanSecrets({ ...options, commit: snapshot.commit, remote })
      if (selection.docker) {
        if (!prior.container?.imageId)
          throw new Error(
            'Saved Docker image identity is absent; rerun make preflight-full PREFLIGHT_ARGS=--clean-install'
          )
        context.container = {
          ...prior.container,
          scan: await scanContainer(prior.container.imageId, options)
        }
      }
      signal.throwIfAborted()
      assertNoLocalEnv(cwd)
      assertUnchanged(snapshot, snapshotSource(cwd))
      if (
        dependencies !==
        (await installedFingerprint(cwd, join(stateDir, 'dependency-digests.json')))
      )
        throw new Error('Installed dependencies changed during receipt validation')
      writeReceipt(recordPath, {
        ...prior,
        ...(context.container ? { container: context.container } : {}),
        refreshedAt: new Date().toISOString()
      })
      return { reused: true, recordPath }
    }
    const results = await executeStages(stages, (stage) => executeGate(stage, context), {
      signal,
      onResult: (result) => writeReceipt(join(logDir, `${result.id}.json`), result)
    })
    signal.throwIfAborted()
    assertUnchanged(snapshot, snapshotSource(cwd))
    assertNoLocalEnv(cwd)
    if (
      dependencies !== (await installedFingerprint(cwd, join(stateDir, 'dependency-digests.json')))
    )
      throw new Error(
        'Installed dependencies changed during preflight; rerun after resolving concurrent changes'
      )
    const outputs = await digestPaths(
      cwd,
      stages.flatMap((stage) => stage.outputs ?? [])
    )
    if (!baseCommit || !changes.base)
      throw new Error(
        'All selected gates ran, but comparison base is unresolved; configure/fetch the base before claiming push readiness.'
      )
    // Detect a source edit during output hashing too. A reverted edit remains a
    // documented limitation: these local conveniences are not attestations.
    assertUnchanged(snapshot, snapshotSource(cwd))
    signal.throwIfAborted()
    writeReceipt(recordPath, {
      inputs,
      outputs,
      stages: results,
      container: context.container,
      completedAt: new Date().toISOString(),
      push
    })
    process.stdout.write(
      `Local gates passed. Receipt: ${recordPath}\nHosted obligations: current merge result, other operating systems, signing and publication provenance.\n`
    )
    return { reused: false, recordPath }
  } finally {
    try {
      await context?.postgres?.close()
    } finally {
      context?.webState?.close()
      releaseCommon?.()
      releaseWorktree()
      termination.dispose()
    }
  }
}
const isMain =
  process.argv[1] &&
  (() => {
    try {
      return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
    } catch {
      return false
    }
  })()
if (isMain) {
  try {
    const { values } = parseArgs({
      options: {
        full: { type: 'boolean' },
        'clean-install': { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        base: { type: 'string' },
        remote: { type: 'string' },
        workflows: { type: 'boolean' },
        'postgres-tests': { type: 'boolean' },
        'electron-no-sandbox': { type: 'boolean' }
      }
    })
    if (values.workflows) await validateWorkflows()
    else if (values['postgres-tests']) await runPostgresTests()
    else
      await runPreflight({
        full: values.full,
        cleanInstall: values['clean-install'],
        dryRun: values['dry-run'],
        base: values.base,
        remote: values.remote,
        noSandbox: values['electron-no-sandbox']
      })
  } catch (error) {
    process.stderr.write(
      `Preflight failed: ${error.message}\n${error.stdout ?? ''}${error.stderr ?? ''}`
    )
    process.exitCode = 1
  }
}
