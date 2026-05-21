#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { posix, relative, resolve, sep } from 'node:path'

const VERSION = 1
const SOURCE_THRESHOLD = 600
const TEST_THRESHOLD = 800
const DEFAULT_BASELINE = 'scripts/agent-health-baseline.json'
const SCAN_ROOTS = ['src', 'scripts', 'tests']
const ROOT_MARKERS = ['.git', 'package.json', 'Makefile', 'AGENTS.md']
const AUTHORED_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx', '.vue'])
const IGNORED_NAMES = new Set([
  '.git',
  '.cache',
  'node_modules',
  'out',
  'dist',
  'release',
  'coverage',
  'test-results',
  'playwright-report',
  'playwright-output',
  '__snapshots__',
  'fixtures'
])

function printHelp() {
  console.log(`Usage: node scripts/check-agent-health.mjs [options]

Options:
  --root <path>                 Repository root to scan (default: cwd)
  --baseline <path>             Baseline JSON path (default: scripts/agent-health-baseline.json)
  --source-threshold <number>   Maximum source file lines before reporting (default: 600)
  --test-threshold <number>     Maximum test file lines before reporting (default: 800)
  --print-current-json          Print the current oversized-file inventory and exit
  --help, -h                    Show this help
`)
}

function usageError(message) {
  console.error(message)
  process.exit(2)
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    usageError(`${optionName} must be a positive integer`)
  }
  return parsed
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    baseline: DEFAULT_BASELINE,
    sourceThreshold: SOURCE_THRESHOLD,
    testThreshold: TEST_THRESHOLD,
    printCurrentJson: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }

    if (arg === '--print-current-json') {
      options.printCurrentJson = true
      continue
    }

    if (arg === '--root') {
      index += 1
      if (index >= argv.length) usageError('--root requires a path')
      options.root = argv[index]
      continue
    }

    if (arg === '--baseline') {
      index += 1
      if (index >= argv.length) usageError('--baseline requires a path')
      options.baseline = argv[index]
      continue
    }

    if (arg === '--source-threshold') {
      index += 1
      if (index >= argv.length) usageError('--source-threshold requires a number')
      options.sourceThreshold = parsePositiveInteger(argv[index], '--source-threshold')
      continue
    }

    if (arg === '--test-threshold') {
      index += 1
      if (index >= argv.length) usageError('--test-threshold requires a number')
      options.testThreshold = parsePositiveInteger(argv[index], '--test-threshold')
      continue
    }

    usageError(`Unknown option: ${arg}`)
  }

  options.root = resolve(options.root)
  options.baseline = resolve(options.root, options.baseline)
  return options
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function validateRoot(root) {
  if (!isDirectory(root)) {
    usageError(`--root must exist and be a directory: ${root}`)
  }

  const hasScanRoot = SCAN_ROOTS.some((scanRoot) => {
    const path = resolve(root, scanRoot)
    return isDirectory(path)
  })

  if (!hasScanRoot) {
    usageError(`Root does not contain any scan roots (${SCAN_ROOTS.join(', ')}): ${root}`)
  }

  const hasRootMarker = ROOT_MARKERS.some((marker) => existsSync(resolve(root, marker)))
  if (!hasRootMarker) {
    usageError(`Root does not look like a VarLens repository: ${root}`)
  }
}

function toPosixPath(path) {
  return path.split(sep).join('/')
}

function isRepoRelativePosixPath(path) {
  if (path.trim() === '' || path.trim() !== path) return false
  if (path.includes('\\')) return false
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  if (path.split('/').some((part) => part === '..')) return false
  return posix.normalize(path) === path
}

function hasIgnoredPath(relativePath) {
  const parts = relativePath.split('/')
  if (parts.some((part) => IGNORED_NAMES.has(part))) return true
  if (relativePath.startsWith('.planning/artifacts/')) return true
  if (relativePath.includes('/mocks/fixtures/')) return true
  if (parts.some((part) => part === 'migrations' || part === 'migration')) return true
  if (parts.at(-1) === 'migrations.ts' || parts.at(-1) === 'migration.ts') return true
  if (relativePath.startsWith('src/generated/')) return true
  if (relativePath.startsWith('src/renderer/public/')) return true
  if (relativePath.endsWith('.d.ts')) return true
  if (relativePath.endsWith('.snap')) return true
  if (relativePath === 'package-lock.json') return true
  return false
}

function extensionOf(relativePath) {
  if (relativePath.endsWith('.d.ts')) return '.d.ts'
  const lastDot = relativePath.lastIndexOf('.')
  return lastDot === -1 ? '' : relativePath.slice(lastDot)
}

function categoryFor(relativePath) {
  if (relativePath.startsWith('tests/')) return 'test'
  if (relativePath.startsWith('src/') || relativePath.startsWith('scripts/')) return 'source'
  return null
}

function countLines(content) {
  if (content.length === 0) return 0
  const lines = content.split('\n').length
  return content.endsWith('\n') ? lines - 1 : lines
}

function walkDirectory(root, directory, files) {
  if (!existsSync(directory)) return

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name)
    const relativePath = toPosixPath(relative(root, absolutePath))

    if (hasIgnoredPath(relativePath)) continue

    if (entry.isDirectory()) {
      walkDirectory(root, absolutePath, files)
      continue
    }

    if (!entry.isFile()) continue
    if (!AUTHORED_EXTENSIONS.has(extensionOf(relativePath))) continue

    files.push({ absolutePath, relativePath })
  }
}

function buildCurrentInventory(options) {
  const files = []

  for (const scanRoot of SCAN_ROOTS) {
    walkDirectory(options.root, resolve(options.root, scanRoot), files)
  }

  return files
    .map(({ absolutePath, relativePath }) => {
      const category = categoryFor(relativePath)
      if (category === null) return null

      const threshold = category === 'source' ? options.sourceThreshold : options.testThreshold
      const lines = countLines(readFileSync(absolutePath, 'utf8'))
      if (lines <= threshold) return null

      return {
        path: relativePath,
        lines,
        threshold,
        category,
        reason:
          category === 'source' ? 'current oversized source file' : 'current oversized test file'
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path))
}

function validateEntry(entry, index) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`files[${index}] must be an object`)
  }
  if (typeof entry.path !== 'string' || entry.path.trim() === '') {
    throw new Error(`files[${index}].path must be a non-empty string`)
  }
  if (!isRepoRelativePosixPath(entry.path)) {
    throw new Error(`files[${index}].path must be a normalized repo-relative POSIX path`)
  }
  if (!Number.isInteger(entry.lines) || entry.lines < 0) {
    throw new Error(`files[${index}].lines must be a non-negative integer`)
  }
  if (!Number.isInteger(entry.threshold) || entry.threshold <= 0) {
    throw new Error(`files[${index}].threshold must be a positive integer`)
  }
  if (entry.category !== 'source' && entry.category !== 'test') {
    throw new Error(`files[${index}].category must be "source" or "test"`)
  }
  if (entry.category !== 'source') {
    throw new Error(`files[${index}].category must be "source"; test files are report-only`)
  }
  if (!entry.path.startsWith('src/') && !entry.path.startsWith('scripts/')) {
    throw new Error(`files[${index}].path must start with "src/" or "scripts/"`)
  }
  if (typeof entry.reason !== 'string') {
    throw new Error(`files[${index}].reason must be a string`)
  }
}

function validateBaseline(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('baseline must be an object')
  }
  if (value.version !== VERSION) {
    throw new Error('baseline version must be 1')
  }
  if (!Array.isArray(value.files)) {
    throw new Error('baseline files must be an array')
  }

  value.files.forEach(validateEntry)
  return value
}

function readBaseline(path) {
  if (!existsSync(path)) return { version: VERSION, files: [] }

  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`Failed to read baseline: ${error.message}`)
    process.exit(2)
  }

  try {
    return validateBaseline(parsed)
  } catch (error) {
    console.error(`Invalid baseline: ${error.message}`)
    process.exit(2)
  }
}

function readExistingBaselineFile(root, baselineEntry) {
  const path = resolve(root, baselineEntry.path)
  if (!existsSync(path)) {
    return { status: 'missing' }
  }

  const lines = countLines(readFileSync(path, 'utf8'))
  const threshold = baselineEntry.threshold
  return {
    status: lines > threshold ? 'oversized' : 'below-threshold',
    lines,
    threshold
  }
}

function compareInventory(current, baseline, root) {
  const baselineByPath = new Map(baseline.files.map((entry) => [entry.path, entry]))
  const currentByPath = new Map(current.map((entry) => [entry.path, entry]))
  const newSourceFiles = []
  const grownSourceFiles = []
  const unchangedOrImproved = []
  const oversizedTests = current.filter((entry) => entry.category === 'test')

  for (const entry of current) {
    if (entry.category !== 'source') continue

    const baselineEntry = baselineByPath.get(entry.path)
    if (!baselineEntry) {
      newSourceFiles.push(entry)
      continue
    }

    if (entry.lines > baselineEntry.lines) {
      grownSourceFiles.push({ baseline: baselineEntry, current: entry })
    } else {
      unchangedOrImproved.push({ baseline: baselineEntry, current: entry })
    }
  }

  for (const baselineEntry of baseline.files) {
    if (baselineEntry.category !== 'source') continue
    if (currentByPath.has(baselineEntry.path)) continue
    unchangedOrImproved.push({
      baseline: baselineEntry,
      current: null,
      resolvedCurrent: readExistingBaselineFile(root, baselineEntry)
    })
  }

  const byPath = (left, right) => {
    const leftPath = left.path ?? left.current?.path ?? left.baseline.path
    const rightPath = right.path ?? right.current?.path ?? right.baseline.path
    return leftPath.localeCompare(rightPath)
  }

  return {
    newSourceFiles: newSourceFiles.sort(byPath),
    grownSourceFiles: grownSourceFiles.sort(byPath),
    unchangedOrImproved: unchangedOrImproved.sort(byPath),
    oversizedTests: oversizedTests.sort(byPath)
  }
}

function printSection(title, entries, formatter) {
  console.log(`\n${title}`)
  if (entries.length === 0) {
    console.log('  None')
    return
  }

  for (const entry of entries) {
    console.log(`  ${formatter(entry)}`)
  }
}

function printReport(options, comparison) {
  console.log('Agent health check')
  console.log(`Source threshold: ${options.sourceThreshold}`)
  console.log(`Test threshold: ${options.testThreshold}`)

  printSection('New oversized source files', comparison.newSourceFiles, (entry) => {
    return `${entry.path}: ${entry.lines} lines (threshold ${entry.threshold})`
  })

  printSection('Baseline oversized files that grew', comparison.grownSourceFiles, (entry) => {
    return `${entry.current.path}: ${entry.baseline.lines} -> ${entry.current.lines} lines`
  })

  printSection(
    'Existing oversized files unchanged or improved',
    comparison.unchangedOrImproved,
    (entry) => {
      if (entry.resolvedCurrent?.status === 'missing') {
        return `${entry.baseline.path}: ${entry.baseline.lines} -> missing (remove from baseline)`
      }

      if (entry.resolvedCurrent?.status === 'below-threshold') {
        return [
          `${entry.baseline.path}: ${entry.baseline.lines} -> ${entry.resolvedCurrent.lines} lines`,
          '(below threshold; remove from baseline)'
        ].join(' ')
      }

      const currentLines = entry.current?.lines ?? entry.resolvedCurrent?.lines ?? 0
      return `${entry.baseline.path}: ${entry.baseline.lines} -> ${currentLines} lines`
    }
  )

  printSection('Oversized test files reported only', comparison.oversizedTests, (entry) => {
    return `${entry.path}: ${entry.lines} lines (threshold ${entry.threshold})`
  })

  const failed = comparison.newSourceFiles.length > 0 || comparison.grownSourceFiles.length > 0
  console.log(`\nAgent health check ${failed ? 'failed' : 'passed'}`)
  return failed ? 1 : 0
}

const options = parseArgs(process.argv.slice(2))
validateRoot(options.root)
const current = buildCurrentInventory(options)

if (options.printCurrentJson) {
  console.log(JSON.stringify({ version: VERSION, files: current }, null, 2))
  process.exit(0)
}

const baseline = readBaseline(options.baseline)
const comparison = compareInventory(current, baseline, options.root)
process.exit(printReport(options, comparison))
