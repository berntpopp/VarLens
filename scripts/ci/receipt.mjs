import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { git } from './process.mjs'

export const hashValue = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')
export async function digestPath(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return hashValue(['link', readlinkSync(path)])
  if (stat.isDirectory()) {
    const children = []
    for (const name of readdirSync(path).sort())
      children.push([name, await digestPath(join(path, name))])
    return hashValue(children)
  }
  const hash = createHash('sha256')
  hash.update(String(stat.mode & 0o777))
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function digestPaths(cwd, paths) {
  const result = {}
  for (const path of [...new Set(paths)].sort()) result[path] = await digestPath(join(cwd, path))
  return result
}
export function readReceipt(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
export function writeReceipt(path, receipt) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(receipt, null, 2), { mode: 0o600 })
  renameSync(temporary, path)
}
export async function matchesReceipt(receipt, inputs, { cwd = process.cwd() } = {}) {
  if (!receipt || hashValue(receipt.inputs) !== hashValue(inputs)) return false
  if (!Array.isArray(receipt.stages) || receipt.stages.length !== inputs.stages.length) return false
  if (
    receipt.stages.some(
      (stage, index) => stage.id !== inputs.stages[index] || stage.status !== 'passed'
    )
  )
    return false
  if (!receipt.outputs || typeof receipt.outputs !== 'object') return false
  if (
    inputs.requiredOutputs &&
    hashValue(Object.keys(receipt.outputs).sort()) !==
      hashValue([...new Set(inputs.requiredOutputs)].sort())
  )
    return false
  try {
    return (
      hashValue(receipt.outputs) === hashValue(await digestPaths(cwd, Object.keys(receipt.outputs)))
    )
  } catch {
    return false
  }
}
// Generated public-data fixtures are deliberate runtime inputs. Permit exactly
// the repository's known generated files, and bind their bytes into each pass.
export const GENERATED_FIXTURES = Object.freeze(
  [
    'bed/test-regions.bed',
    'json/columnar-unwrapped-format.json.gz',
    'json/from-vcf/synthetic-unit-test.columnar.json',
    'json/from-vcf/synthetic-unit-test.object.json',
    'json/from-vcf/synthetic-unit-test.simple.json',
    'json/object-format.json',
    'json/simple-format.json',
    'longread/DEMO.wf_cnv.vcf',
    'longread/DEMO.wf_snp.vcf',
    'longread/DEMO.wf_str.vcf',
    'longread/DEMO.wf_sv.vcf',
    'vcf/synthetic-unit-test.vcf',
    'vcf/trio-region.snpeff.vcf.gz',
    'vcf/trio-region.vcf.gz',
    'vcf/trio-region.vep.vcf.gz',
    'zip/json-batch.zip'
  ].map((path) => `tests/.cache/public-data/generated/${path}`)
)
const KNOWN_FIXTURES = new Set(GENERATED_FIXTURES)
function ignoredSourceInputs(cwd) {
  const paths = git(
    [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '-z',
      '--',
      'src',
      'tests',
      'scripts',
      'resources',
      'docs',
      '.github',
      '.githooks',
      'build',
      ':(top,glob)*',
      ':(exclude)tests/web-smoke/node_modules',
      ':(exclude)docs/.vitepress/dist',
      ':(exclude)docs/.vitepress/cache',
      ':(exclude)tests/web-smoke/artifacts'
    ],
    { cwd }
  )
    .split('\0')
    .filter(Boolean)
  const relevant = paths.filter(
    (path) =>
      path.includes('/') ||
      /\.(?:[cm]?[jt]s|json|ya?ml|html)$/.test(path) ||
      /^(?:Makefile|Dockerfile|\.(?:nvmrc|npmrc|prettierrc|prettierignore|dockerignore|gitleaks.*|env(?:\.production)?(?:\.local)?))$/.test(
        path
      )
  )
  const fixtures = relevant.filter((path) => KNOWN_FIXTURES.has(path)).sort()
  return {
    ignoredInputs: relevant.filter((path) => !KNOWN_FIXTURES.has(path)),
    generatedFixtures: fixtures.map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(join(cwd, path)))
        .digest('hex')
    ])
  }
}
export function snapshotSource(cwd = process.cwd()) {
  return {
    commit: git(['rev-parse', 'HEAD'], { cwd }),
    tree: git(['rev-parse', 'HEAD^{tree}'], { cwd }),
    status: git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd }),
    ...ignoredSourceInputs(cwd)
  }
}
export function assertCleanSnapshot(snapshot) {
  if (snapshot.ignoredInputs?.length)
    throw new Error(
      `Ignored source inputs cannot certify a clean commit: ${snapshot.ignoredInputs.join(', ')}. Remove the ignore rule or move these inputs aside.`
    )
  if (snapshot.status)
    throw new Error(
      'Push readiness requires a clean tracked and untracked worktree. Commit or move the listed changes, then run make preflight.'
    )
}
export function assertUnchanged(before, after) {
  assertCleanSnapshot(after)
  if (hashValue(before) !== hashValue(after))
    throw new Error('Source changed during preflight; no passing receipt was written.')
}
/** Commit, tree, status and ignored inputs must match; fixture bytes are compared separately. */
export function assertSameSource(before, after) {
  assertUnchanged({ ...before, generatedFixtures: null }, { ...after, generatedFixtures: null })
}
export function assertNoLocalEnv(cwd) {
  // Vite auto-loads these even when the parent environment is sanitized.
  for (const directory of ['', 'src/renderer', 'src/web', 'docs', '.cache/docs-site']) {
    for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      if (existsSync(join(cwd, directory, name)))
        throw new Error(
          `Preflight refuses auto-loaded environment file ${join(directory, name)}. Move it aside for isolated verification.`
        )
    }
  }
}
