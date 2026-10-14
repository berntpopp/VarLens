/**
 * Download + install of the HPO release files behind `hpo_resnik` (#600).
 * Files land in a temp dir next to the DB, are checked against the GitHub
 * asset `digest` when the API supplies one (fail closed), preprocessed into
 * `<db>.tmp` and atomically renamed over the DB. Any failure leaves the
 * installed data untouched.
 */
import { createHash } from 'crypto'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { HPO_DATA_CONFIG, type HpoAssetKey } from '../../../shared/config/hpo-data.config'
import type { HpoDataUpdateResult } from '../../../shared/types/hpo-data'
import type { HpoBuildRequest } from './hpo-build-worker-client'
import { readHpoDataStatus } from './hpo-similarity-db'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface HpoUpdateDeps {
  fetch: Fetch
  isOnline: () => boolean
  dbPath: string
  build: (request: HpoBuildRequest) => Promise<void>
}

interface ReleaseAsset {
  url: string
  /** `sha256:<hex>` when GitHub reports it. */
  digest?: string
}

interface GithubRelease {
  tag_name?: string
  assets?: Array<{ name: string; browser_download_url: string; digest?: string | null }>
}

const ASSET_KEYS = Object.keys(HPO_DATA_CONFIG.assets) as HpoAssetKey[]

/** Latest release from the API; the pinned tag (no digests) if the API is unreachable. */
async function resolveRelease(
  fetch: Fetch
): Promise<{ tag: string; assets: Record<HpoAssetKey, ReleaseAsset> }> {
  const latest = await fetch(HPO_DATA_CONFIG.latestReleaseUrl, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000)
  })
    .then(async (r) => (r.ok ? ((await r.json()) as GithubRelease) : null))
    .catch(() => null)
  if (latest?.tag_name !== undefined && latest.assets !== undefined) {
    const byName = new Map(latest.assets.map((a) => [a.name, a]))
    const assets = {} as Record<HpoAssetKey, ReleaseAsset>
    for (const key of ASSET_KEYS) {
      const asset = byName.get(HPO_DATA_CONFIG.assets[key])
      if (asset === undefined)
        throw new Error(`HPO release ${latest.tag_name} lacks ${HPO_DATA_CONFIG.assets[key]}`)
      assets[key] = { url: asset.browser_download_url, digest: asset.digest ?? undefined }
    }
    return { tag: latest.tag_name, assets }
  }
  const tag = HPO_DATA_CONFIG.defaultTag
  const assets = {} as Record<HpoAssetKey, ReleaseAsset>
  for (const key of ASSET_KEYS) {
    assets[key] = {
      url: `${HPO_DATA_CONFIG.downloadBaseUrl}/${tag}/${HPO_DATA_CONFIG.assets[key]}`
    }
  }
  return { tag, assets }
}

async function download(
  fetch: Fetch,
  name: string,
  asset: ReleaseAsset,
  path: string
): Promise<string> {
  const response = await fetch(asset.url, {
    signal: AbortSignal.timeout(HPO_DATA_CONFIG.requestTimeoutMs)
  })
  if (!response.ok) throw new Error(`Download of ${name} failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (asset.digest !== undefined && asset.digest !== `sha256:${sha256}`) {
    throw new Error(`Checksum mismatch for ${name}: expected ${asset.digest}, got sha256:${sha256}`)
  }
  writeFileSync(path, bytes)
  return sha256
}

export async function updateHpoData(deps: HpoUpdateDeps): Promise<HpoDataUpdateResult> {
  const current = readHpoDataStatus(deps.dbPath)
  if (!deps.isOnline()) {
    return { success: false, message: 'Offline: HPO data left unchanged.', status: current }
  }
  const release = await resolveRelease(deps.fetch)
  if (current.installed && current.version === release.tag) {
    return { success: true, message: `HPO data ${release.tag} is up to date.`, status: current }
  }

  const tmpDir = mkdtempSync(join(dirname(deps.dbPath), 'hpo-download-'))
  const outPath = `${deps.dbPath}.tmp`
  try {
    const files = {} as Record<HpoAssetKey, string>
    const sha256: Record<string, string> = {}
    for (const key of ASSET_KEYS) {
      const name = HPO_DATA_CONFIG.assets[key]
      files[key] = join(tmpDir, name)
      sha256[name] = await download(deps.fetch, name, release.assets[key], files[key])
    }
    await deps.build({ files, meta: { release: release.tag, sha256 }, outPath })
    renameSync(outPath, deps.dbPath)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(outPath, { force: true })
  }
  const status = readHpoDataStatus(deps.dbPath)
  return { success: true, message: `HPO data ${release.tag} installed.`, status }
}
