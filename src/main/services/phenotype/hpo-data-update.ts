/**
 * Download + install of the HPO release files behind `hpo_resnik` (#600).
 * Files land in `<db>.download`, are checked against the GitHub
 * asset `digest` (or the pinned digests; no digest → refused), preprocessed into
 * `<db>.tmp` and atomically renamed over the DB. Any failure leaves the
 * installed data untouched.
 */
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { HPO_DATA_CONFIG, type HpoAssetKey } from '../../../shared/config/hpo-data.config'
import type { HpoDataUpdateResult } from '../../../shared/types/hpo-data'
import type { HpoBuildRequest } from './hpo-build-worker-client'
import { assertUsableHpoDb, readHpoDataStatus } from './hpo-similarity-db'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface HpoUpdateDeps {
  fetch: Fetch
  isOnline: () => boolean
  dbPath: string
  build: (request: HpoBuildRequest) => Promise<void>
  /** A specific release instead of the latest (headless build). */
  tag?: string
}

interface GithubRelease {
  tag_name?: unknown
  assets?: Array<{ name: string; digest?: string | null }>
}

/** asset file name → expected sha256 hex; every asset must have one (fail closed). */
type ReleaseDigests = Record<string, string>

const ASSET_KEYS = Object.keys(HPO_DATA_CONFIG.assets) as HpoAssetKey[]
const ASSET_NAMES = Object.values(HPO_DATA_CONFIG.assets)
const SHA256 = /^sha256:([0-9a-f]{64})$/

/**
 * Release tag + asset digests from the API (latest, or `wanted`); the pinned
 * release if the API is unreachable and no other tag was asked for. Only the tag and digests are taken from the response:
 * download URLs are always built from the fixed HPO release base.
 */
async function resolveRelease(
  fetch: Fetch,
  wanted?: string
): Promise<{ tag: string; digests: ReleaseDigests }> {
  if (wanted !== undefined && !HPO_DATA_CONFIG.tagPattern.test(wanted)) {
    throw new Error(`Invalid HPO release tag: ${wanted}`)
  }
  const url =
    wanted === undefined
      ? HPO_DATA_CONFIG.latestReleaseUrl
      : `${HPO_DATA_CONFIG.releaseByTagUrl}/${wanted}`
  const latest = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000)
  })
    .then(async (r) => (r.ok ? ((await r.json()) as GithubRelease) : null))
    .catch(() => null)
  if (latest === null) {
    const pinned = HPO_DATA_CONFIG.defaultRelease
    if (wanted === undefined || wanted === pinned.tag) return { ...pinned }
    throw new Error(`HPO release ${wanted} could not be resolved`)
  }
  const tag = latest.tag_name
  if (typeof tag !== 'string' || !HPO_DATA_CONFIG.tagPattern.test(tag) || (wanted ?? tag) !== tag) {
    throw new Error('HPO release API returned an unexpected tag')
  }
  const digests: ReleaseDigests = {}
  for (const name of ASSET_NAMES) {
    const digest = SHA256.exec(latest.assets?.find((a) => a.name === name)?.digest ?? '')?.[1]
    if (digest === undefined)
      throw new Error(`HPO release ${tag} lacks a sha256 digest for ${name}`)
    digests[name] = digest
  }
  return { tag, digests }
}

/** Response body, refused once it exceeds `maxDownloadBytes`. */
async function readCapped(response: Response, name: string): Promise<Buffer> {
  const max = HPO_DATA_CONFIG.maxDownloadBytes
  if (Number(response.headers.get('content-length') ?? 0) > max || response.body === null) {
    throw new Error(`Download of ${name} refused: missing body or larger than ${max} bytes`)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength
    if (total > max) throw new Error(`Download of ${name} exceeds ${max} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function download(
  fetch: Fetch,
  tag: string,
  name: string,
  expectedSha256: string,
  path: string
): Promise<string> {
  const response = await fetch(`${HPO_DATA_CONFIG.downloadBaseUrl}/${tag}/${name}`, {
    signal: AbortSignal.timeout(HPO_DATA_CONFIG.requestTimeoutMs)
  })
  if (!response.ok) throw new Error(`Download of ${name} failed: HTTP ${response.status}`)
  const bytes = await readCapped(response, name)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expectedSha256) {
    throw new Error(
      `Checksum mismatch for ${name}: expected sha256:${expectedSha256}, got sha256:${sha256}`
    )
  }
  writeFileSync(path, bytes)
  return sha256
}

/**
 * Windows refuses to replace a file another handle holds open (a shortlist run
 * reading the DB), so retry the atomic rename for up to ~10 s before failing;
 * a failure still leaves the installed data untouched.
 */
export async function replaceFile(
  from: string,
  to: string,
  rename: (from: string, to: string) => void = renameSync
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Interprocess lock on one destination (app and headless CLI share the
 * `.download` / `.tmp` staging paths). A lock whose PID is gone is taken over.
 * ponytail: PID-only liveness; a reused PID keeps a stale lock until it is removed by hand.
 */
function acquireLock(dbPath: string): () => void {
  const path = `${dbPath}.lock`
  mkdirSync(dirname(dbPath), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx' })
      return () => rmSync(path, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const pid = Number(readFileSync(path, 'utf8'))
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
        throw new Error(`An HPO data update is already running (PID ${pid}, ${path})`, {
          cause: error
        })
      }
      rmSync(path, { force: true })
    }
  }
  throw new Error(`Could not lock ${path}`)
}

export async function updateHpoData(deps: HpoUpdateDeps): Promise<HpoDataUpdateResult> {
  const current = readHpoDataStatus(deps.dbPath)
  if (!deps.isOnline()) {
    return { success: false, message: 'Offline: HPO data left unchanged.', status: current }
  }
  const release = await resolveRelease(deps.fetch, deps.tag)
  if (current.installed && !current.needsUpdate && current.version === release.tag) {
    return { success: true, message: `HPO data ${release.tag} is up to date.`, status: current }
  }
  // Tags are vYYYY-MM-DD, so string order is release order; only an explicit tag or
  // unusable installed data (older builder) downgrades.
  if (
    deps.tag === undefined &&
    !current.needsUpdate &&
    current.version !== null &&
    current.version > release.tag
  ) {
    const message = `Installed HPO data ${current.version} is newer than ${release.tag}; left unchanged.`
    return { success: true, message, status: current }
  }
  const unlock = acquireLock(deps.dbPath)
  try {
    return await install(deps, release)
  } finally {
    unlock()
  }
}

async function install(
  deps: HpoUpdateDeps,
  release: { tag: string; digests: ReleaseDigests }
): Promise<HpoDataUpdateResult> {
  // Fixed name, cleared first: a crash mid-download leaves no orphaned ~80 MB dirs behind.
  const tmpDir = `${deps.dbPath}.download`
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
  const outPath = `${deps.dbPath}.tmp`
  try {
    const files = {} as Record<HpoAssetKey, string>
    const sha256: Record<string, string> = {}
    for (const key of ASSET_KEYS) {
      const name = HPO_DATA_CONFIG.assets[key]
      files[key] = join(tmpDir, name)
      sha256[name] = await download(
        deps.fetch,
        release.tag,
        name,
        release.digests[name],
        files[key]
      )
    }
    await deps.build({ files, meta: { release: release.tag, sha256 }, outPath })
    assertUsableHpoDb(outPath)
    await replaceFile(outPath, deps.dbPath)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(outPath, { force: true })
  }
  const status = readHpoDataStatus(deps.dbPath)
  return { success: true, message: `HPO data ${release.tag} installed.`, status }
}
