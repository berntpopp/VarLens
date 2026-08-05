#!/usr/bin/env node
// Times each build-pipeline stage once and writes a baseline artifact.
// Usage: node scripts/perf/measure-build.mjs <label> [--only id,id]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { NATIVE_CACHE_ROOT } from '../native/native-abi.mjs'

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
export const OUT_DIR = join(REPO_ROOT, '.planning', 'artifacts', 'perf', 'build')

const rm = (...parts) => rmSync(join(REPO_ROOT, ...parts), { force: true, recursive: true })

// Order matters: `rebuild-electron-*` leave the tree on the Electron ABI, so
// `rebuild-node` must come last or `make test` fails afterwards with an ABI error.
export const STAGES = [
  { id: 'lint-cold', cmd: 'npm run lint:check', before: () => rm('.eslintcache') },
  { id: 'lint-warm', cmd: 'npm run lint:check' },
  {
    id: 'format-cold',
    cmd: 'npm run format:check',
    before: () => rm('node_modules', '.cache', 'prettier')
  },
  { id: 'format-warm', cmd: 'npm run format:check' },
  { id: 'typecheck', cmd: 'npm run typecheck' },
  { id: 'test', cmd: 'npm run test' },
  { id: 'build', cmd: 'npm run build' },
  {
    id: 'rebuild-electron-cold',
    cmd: 'npm run rebuild:electron',
    // Imported from native-abi.mjs rather than restated as '.cache/native'
    // here: if the cache root ever moves, this stage must fail to clear it
    // (and thus visibly fail to be cold) rather than silently measuring a
    // warm run and reporting a fabricated improvement.
    before: () => rmSync(NATIVE_CACHE_ROOT, { force: true, recursive: true })
  },
  { id: 'rebuild-electron-warm', cmd: 'npm run rebuild:electron' },
  { id: 'rebuild-node', cmd: 'npm run rebuild:node' }
]

const round2 = (n) => Math.round(n * 100) / 100

// `/usr/bin/time` existing is not proof it is GNU time: macOS ships a BSD
// `time` at that same path, which rejects `-v`/`-o` outright. Without this
// probe every stage would spawn `/usr/bin/time` successfully, fail on the
// unrecognized flags with a non-zero exit, and the harness would report
// every single stage as `failed` rather than degrading to the no-RSS path.
// `--version` is cheap and GNU time answers with "GNU time" on stdout; BSD
// time has no `--version` flag and exits non-zero instead.
export function isGnuTime(bin) {
  if (!existsSync(bin)) return false
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
  return r.status === 0 && /GNU time/i.test(r.stdout ?? '')
}

const GNU_TIME_BIN = '/usr/bin/time'
const HAS_GNU_TIME = isGnuTime(GNU_TIME_BIN)

function capture(cmd, timeFile) {
  // GNU time gives peak RSS, which the spec requires because the June 2026
  // incident was a memory failure, not a slowness failure.
  if (HAS_GNU_TIME) {
    const r = spawnSync(GNU_TIME_BIN, ['-v', '-o', timeFile, 'sh', '-c', cmd], {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    })
    let peakRssMb = null
    if (existsSync(timeFile)) {
      const kb = Number(
        (readFileSync(timeFile, 'utf8').match(/Maximum resident set size \(kbytes\): (\d+)/) ||
          [])[1]
      )
      if (Number.isFinite(kb)) peakRssMb = round2(kb / 1024)
      rmSync(timeFile, { force: true })
    }
    return { status: r.status, peakRssMb }
  }
  const r = spawnSync('sh', ['-c', cmd], { cwd: REPO_ROOT, stdio: 'inherit' })
  return { status: r.status, peakRssMb: null }
}

export function measureStage(stage) {
  stage.before?.()
  const started = process.hrtime.bigint()
  const { status, peakRssMb } = capture(stage.cmd, join(OUT_DIR, `.time-${stage.id}`))
  const wallSeconds = round2(Number(process.hrtime.bigint() - started) / 1e9)
  return { id: stage.id, wallSeconds, peakRssMb, exitCode: status ?? 1 }
}

function gitSha() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : 'unknown'
}

function electronVersion() {
  try {
    return JSON.parse(
      readFileSync(join(REPO_ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')
    ).version
  } catch {
    return null
  }
}

function main() {
  const label = process.argv[2]
  if (!label || label.startsWith('--')) {
    process.stdout.write('usage: measure-build.mjs <label> [--only id,id]\n')
    process.exit(2)
  }
  const onlyArg = process.argv.indexOf('--only')
  const only = onlyArg === -1 ? null : new Set(process.argv[onlyArg + 1].split(','))
  const selected = only ? STAGES.filter((s) => only.has(s.id)) : STAGES

  mkdirSync(OUT_DIR, { recursive: true })
  const stages = []
  for (const stage of selected) {
    process.stdout.write(`\n=== ${stage.id} ===\n`)
    const result = measureStage(stage)
    process.stdout.write(
      `${stage.id}: ${result.wallSeconds}s peakRss=${result.peakRssMb ?? 'n/a'}MB exit=${result.exitCode}\n`
    )
    stages.push(result)
  }

  const outFile = join(OUT_DIR, `${label}.json`)
  writeFileSync(
    outFile,
    `${JSON.stringify(
      {
        label,
        gitSha: gitSha(),
        nodeVersion: process.version,
        electronVersion: electronVersion(),
        createdAt: new Date().toISOString(),
        stages
      },
      null,
      2
    )}\n`
  )
  process.stdout.write(`\nwrote ${outFile}\n`)

  const failed = stages.filter((s) => s.exitCode !== 0)
  if (failed.length > 0) {
    process.stdout.write(`FAILED stages: ${failed.map((s) => s.id).join(', ')}\n`)
    process.exit(1)
  }
}

if (process.argv[1] === import.meta.filename) main()
