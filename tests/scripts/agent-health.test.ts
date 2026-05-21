import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/check-agent-health.mjs')

const tempRoots: string[] = []

type AgentHealthInventoryEntry = {
  path: string
  lines: number
  threshold: number
  category: 'source' | 'test'
  reason: string
}

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'varlens-agent-health-'))
  tempRoots.push(root)
  return root
}

function createTempRepo(): string {
  const root = createTempRoot()
  writeFileSync(join(root, 'package.json'), '{}\n', 'utf8')
  return root
}

function writeLines(root: string, relativePath: string, lineCount: number): void {
  const target = join(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  const lines = Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`)
  writeFileSync(target, `${lines.join('\n')}\n`, 'utf8')
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const target = join(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function runAgentCheck(root: string, extraArgs: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      '--root',
      root,
      '--baseline',
      'scripts/agent-health-baseline.json',
      '--source-threshold',
      '10',
      '--test-threshold',
      '12',
      ...extraArgs
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000
    }
  )
}

function expectNoSpawnError(result: { error?: Error }): void {
  expect(result.error).toBeUndefined()
}

function expectInventoryEntry(value: unknown): asserts value is AgentHealthInventoryEntry {
  expect(value).toEqual(
    expect.objectContaining({
      path: expect.any(String),
      lines: expect.any(Number),
      threshold: expect.any(Number),
      category: expect.stringMatching(/^(source|test)$/),
      reason: expect.any(String)
    })
  )

  const entry = value as AgentHealthInventoryEntry
  expect(entry.path).not.toBe('')
  expect(entry.path).not.toMatch(/^([A-Za-z]:)?[\\/]/)
  expect(Number.isInteger(entry.lines)).toBe(true)
  expect(entry.lines).toBeGreaterThan(0)
  expect(Number.isInteger(entry.threshold)).toBe(true)
  expect(entry.threshold).toBeGreaterThan(0)
  expect(entry.lines).toBeGreaterThan(entry.threshold)
  expect(entry.reason.trim()).not.toBe('')
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('check-agent-health', () => {
  it('passes when authored files stay under thresholds', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/small.ts', 5)
    writeLines(root, 'scripts/small-tool.mjs', 6)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Agent health check passed')
    expect(result.stdout).toContain('Source threshold: 10')
    expect(result.stderr).toBe('')
  })

  it('fails when a new source file exceeds the threshold', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/too-large.ts', 11)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('New oversized source files')
    expect(result.stdout).toContain('src/main/too-large.ts')
  })

  it('fails when a baseline source file grows', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/baseline.ts', 14)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: 'src/main/baseline.ts',
          lines: 13,
          threshold: 10,
          category: 'source',
          reason: 'existing oversized source module'
        }
      ]
    })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Baseline oversized files that grew')
    expect(result.stdout).toContain('src/main/baseline.ts')
    expect(result.stdout).toContain('13 -> 14')
  })

  it('passes when a baseline source file is unchanged', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/baseline.ts', 13)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: 'src/main/baseline.ts',
          lines: 13,
          threshold: 10,
          category: 'source',
          reason: 'existing oversized source module'
        }
      ]
    })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Existing oversized files unchanged or improved')
    expect(result.stdout).toContain('13 -> 13')
  })

  it('passes when a baseline source file is smaller', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/baseline.ts', 12)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: 'src/main/baseline.ts',
          lines: 13,
          threshold: 10,
          category: 'source',
          reason: 'existing oversized source module'
        }
      ]
    })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Existing oversized files unchanged or improved')
    expect(result.stdout).toContain('13 -> 12')
  })

  it('reports actual line count when a baseline source file falls below threshold', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/baseline.ts', 8)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: 'src/main/baseline.ts',
          lines: 13,
          threshold: 10,
          category: 'source',
          reason: 'existing oversized source module'
        }
      ]
    })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('13 -> 8')
    expect(result.stdout).toMatch(/below threshold|remove from baseline/)
  })

  it('reports missing baseline source files as stale entries', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/small.ts', 5)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: 'src/main/deleted.ts',
          lines: 13,
          threshold: 10,
          category: 'source',
          reason: 'existing oversized source module'
        }
      ]
    })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/missing|remove from baseline/)
  })

  it('reports oversized tests without failing phase 1', () => {
    const root = createTempRepo()
    writeLines(root, 'tests/main/large.test.ts', 13)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Oversized test files reported only')
    expect(result.stdout).toContain('tests/main/large.test.ts')
  })

  it('ignores generated, fixture, migration, build, and cache paths', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/database/migrations.ts', 40)
    writeLines(root, 'src/renderer/src/mocks/fixtures/variants.ts', 40)
    writeLines(root, 'src/generated/schema.ts', 40)
    writeLines(root, 'out/main/index.js', 40)
    writeLines(root, 'tests/.cache/generated.ts', 40)
    writeLines(root, '.planning/artifacts/perf/result.ts', 40)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Agent health check passed')
    expect(result.stdout).not.toContain('migrations.ts')
    expect(result.stdout).not.toContain('fixtures/variants.ts')
    expect(result.stdout).not.toContain('tests/.cache/generated.ts')
  })

  it('returns usage error when the baseline is malformed', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/small.ts', 5)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts/agent-health-baseline.json'), '{', 'utf8')

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Failed to read baseline')
  })

  it('returns usage error when root does not exist', () => {
    const root = createTempRoot()

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        '--root',
        join(root, 'missing-root'),
        '--baseline',
        'scripts/agent-health-baseline.json'
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000
      }
    )

    expectNoSpawnError(result)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--root must exist and be a directory')
  })

  it('returns usage error when root has no scan roots', () => {
    const root = createTempRoot()

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Root does not contain any scan roots')
  })

  it('returns usage error when root has scan roots but no repository marker', () => {
    const root = createTempRoot()
    writeLines(root, 'src/main/small.ts', 5)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        '--root',
        root,
        '--baseline',
        'scripts/agent-health-baseline.json',
        '--source-threshold',
        '10',
        '--test-threshold',
        '12'
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000
      }
    )

    expectNoSpawnError(result)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Root does not look like a VarLens repository')
  })

  it('returns usage error when a source baseline path does not identify a source file', () => {
    const root = createTempRepo()
    writeLines(root, 'tests/main/bad.test.ts', 13)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: 'tests/main/bad.test.ts',
          lines: 13,
          threshold: 12,
          category: 'source',
          reason: 'invalid category'
        }
      ]
    })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid baseline')
    expect(result.stderr).toContain('files[0].path must start with "src/" or "scripts/"')
  })

  it('returns usage error when a baseline path is not repo-relative POSIX', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/small.ts', 5)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: '../outside.ts',
          lines: 11,
          threshold: 10,
          category: 'source',
          reason: 'invalid path'
        }
      ]
    })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid baseline')
    expect(result.stderr).toContain('files[0].path must be a normalized repo-relative POSIX path')
  })

  it('returns usage error when baseline contains test entries', () => {
    const root = createTempRepo()
    writeLines(root, 'tests/main/large.test.ts', 13)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: 'tests/main/large.test.ts',
          lines: 13,
          threshold: 12,
          category: 'test',
          reason: 'test baselines are report-only'
        }
      ]
    })

    const result = runAgentCheck(root)

    expectNoSpawnError(result)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid baseline')
    expect(result.stderr).toContain(
      'files[0].category must be "source"; test files are report-only'
    )
  })

  it('can print the current oversized-file inventory as JSON', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/too-large.ts', 11)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root, ['--print-current-json'])

    expectNoSpawnError(result)
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.files).toEqual([
      {
        path: 'src/main/too-large.ts',
        lines: 11,
        threshold: 10,
        category: 'source',
        reason: 'current oversized source file'
      }
    ])
  })

  it('prints valid current inventory JSON for the real repository', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--print-current-json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000
    })

    expectNoSpawnError(result)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as { version?: unknown; files?: unknown }
    expect(parsed.version).toBe(1)
    expect(Array.isArray(parsed.files)).toBe(true)

    const files = parsed.files as unknown[]
    for (const entry of files) {
      expectInventoryEntry(entry)
    }
  })
})
