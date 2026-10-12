#!/usr/bin/env node
/**
 * 100-case perf fixture builder (Sprint A PR-3, C6).
 *
 * Generates 100 GIAB-derived cases by replicating and downsampling the existing
 * columnar perf fixture (tests/fixtures/import/columnar-format.json), landing the
 * total variant count near the ~5M target. The base fixture's ~50 annotated rows
 * are tiled with per-replica position offsets so each case carries a realistic
 * spread of distinct loci rather than exact duplicates.
 *
 * Output lands in tests/.cache/perf-100case/ (gitignored via tests/.cache/). The
 * builder is idempotent: if manifest.json already reports matching case and
 * variant counts within bounds, the run is a no-op.
 *
 * Each case is written as a wrapped-columnar .json.gz file
 * ({ "<caseId>": { header, data } }) so the existing import pipeline can ingest
 * it unchanged. The manifest has the shape:
 *   { generatedAt, totalCases, totalVariants, cases: [{ id, filePath, variantCount }] }
 *
 * This same generator seeds Sprint D's 1000-case fixture (bump TARGET_CASES).
 *
 * Usage:
 *   node scripts/perf/build-100-case-fixture.mjs
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, '..', '..')

const OUT_DIR = join(REPO_ROOT, 'tests', '.cache', 'perf-100case')
const MANIFEST_PATH = join(OUT_DIR, 'manifest.json')
const BASE_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'import', 'columnar-format.json')

const TARGET_CASES = 100
const TARGET_VARIANTS = 5_000_000
const VARIANT_BOUNDS = [TARGET_VARIANTS * 0.8, TARGET_VARIANTS * 1.2]

const PER_CASE_VARIANTS = Math.round(TARGET_VARIANTS / TARGET_CASES)

/**
 * Position offset applied per replica tile so successive copies of the base rows
 * occupy distinct loci. 1 Mb keeps offsets well clear of one another.
 */
const REPLICA_POS_OFFSET = 1_000_000

function readBaseFixture() {
  const raw = JSON.parse(readFileSync(BASE_FIXTURE, 'utf8'))
  const caseKey = Object.keys(raw)[0]
  const { header, data } = raw[caseKey]
  if (!Array.isArray(header) || !Array.isArray(data)) {
    throw new Error(`Base fixture ${BASE_FIXTURE} is not wrapped columnar`)
  }
  // Column indices used for per-replica offsetting (Pos is column 1).
  const posIndex = header.findIndex((col) => col.id === 'Pos')
  if (posIndex < 0) {
    throw new Error('Base fixture is missing a "Pos" column')
  }
  return { header, baseRows: data, posIndex }
}

/**
 * Build the data array for a single case by tiling the base rows until the
 * per-case variant target is reached, offsetting Pos per tile so loci stay
 * distinct across replicas.
 */
function buildCaseRows(baseRows, posIndex, target) {
  const rows = new Array(target)
  const baseCount = baseRows.length
  for (let i = 0; i < target; i++) {
    const base = baseRows[i % baseCount]
    const tile = Math.floor(i / baseCount)
    const row = base.slice()
    row[posIndex] = base[posIndex] + tile * REPLICA_POS_OFFSET
    rows[i] = row
  }
  return rows
}

function manifestMatches() {
  if (!existsSync(MANIFEST_PATH)) return false
  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch {
    return false
  }
  if (manifest.totalCases !== TARGET_CASES) return false
  // A changed base fixture (e.g. a repaired row layout) must regenerate the cases
  if (manifest.baseFixtureSha256 !== baseFixtureSha256()) return false
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== TARGET_CASES) return false
  const total = manifest.totalVariants
  if (typeof total !== 'number') return false
  if (total < VARIANT_BOUNDS[0] || total > VARIANT_BOUNDS[1]) return false
  // Confirm every declared case file still exists on disk.
  return manifest.cases.every(
    (entry) => typeof entry.filePath === 'string' && existsSync(join(REPO_ROOT, entry.filePath))
  )
}

function baseFixtureSha256() {
  return createHash('sha256').update(readFileSync(BASE_FIXTURE)).digest('hex')
}

function relFromRoot(absPath) {
  return absPath.slice(REPO_ROOT.length + 1)
}

function main() {
  if (manifestMatches()) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    process.stdout.write(
      `[perf-100case] up to date: ${manifest.totalCases} cases, ${manifest.totalVariants} variants — no-op\n`
    )
    return
  }

  mkdirSync(OUT_DIR, { recursive: true })

  const { header, baseRows, posIndex } = readBaseFixture()

  const cases = []
  let totalVariants = 0

  for (let c = 0; c < TARGET_CASES; c++) {
    const caseId = `perf-case-${String(c + 1).padStart(3, '0')}`
    const rows = buildCaseRows(baseRows, posIndex, PER_CASE_VARIANTS)
    const payload = { [caseId]: { header, data: rows } }
    const json = JSON.stringify(payload)
    const gz = gzipSync(Buffer.from(json, 'utf8'))
    const absPath = join(OUT_DIR, `${caseId}.json.gz`)
    writeFileSync(absPath, gz)

    totalVariants += rows.length
    cases.push({ id: caseId, filePath: relFromRoot(absPath), variantCount: rows.length })
  }

  if (totalVariants < VARIANT_BOUNDS[0] || totalVariants > VARIANT_BOUNDS[1]) {
    throw new Error(
      `Total variant count ${totalVariants} is outside bounds [${VARIANT_BOUNDS[0]}, ${VARIANT_BOUNDS[1]}]`
    )
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    totalVariants,
    baseFixtureSha256: baseFixtureSha256(),
    cases
  }
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')

  process.stdout.write(
    `[perf-100case] generated ${cases.length} cases, ${totalVariants} variants -> ${relFromRoot(OUT_DIR)}\n`
  )
}

main()
