import { createHash } from 'crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHpoFromFiles } from '../../../../src/main/services/phenotype/hpo-build-worker-client'
import { replaceFile, updateHpoData } from '../../../../src/main/services/phenotype/hpo-data-update'
import { readHpoDataStatus } from '../../../../src/main/services/phenotype/hpo-similarity-db'
import { HPO_DATA_CONFIG } from '../../../../src/shared/config/hpo-data.config'
import { GENES_TO_PHENOTYPE, HP_JSON, PHENOTYPE_HPOA } from '../../../shared/phenotype/hpo-fixture'
import {
  clingenGenes,
  clingenRegions,
  ENTREZ_TO_HGNC,
  MONDO_OBO,
  STRCHIVE_LOCI
} from '../../../shared/phenotype/locus-fixture'

const FILES: Record<string, string> = {
  'hp.json': HP_JSON,
  'phenotype.hpoa': PHENOTYPE_HPOA,
  'genes_to_phenotype.txt': GENES_TO_PHENOTYPE
}
const { clingen, strchive, mondo } = HPO_DATA_CONFIG.locusSources
const LOCUS_FILES: Record<string, string> = {
  [clingen.genes]: clingenGenes(),
  [clingen.regions.GRCh37]: clingenRegions(),
  [clingen.regions.GRCh38]: clingenRegions(),
  'STRchive-loci-v2.28.0.json': STRCHIVE_LOCI,
  'mondo.obo': MONDO_OBO
}
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const release = (tag: string, files: Record<string, string>, digests: Record<string, string>) =>
  Response.json({
    tag_name: tag,
    assets: Object.keys(files).map((name) => ({
      name,
      browser_download_url: `https://evil.example/${name}`,
      digest: name in digests ? digests[name] : `sha256:${sha(files[name])}`
    }))
  })

/** HPO release `tag` plus the locus sources; `missing` file names answer 404. */
function releaseFetch(tag: string, digests: Record<string, string> = {}, missing: string[] = []) {
  return vi.fn(async (url: string) => {
    if (url === HPO_DATA_CONFIG.latestReleaseUrl) return release(tag, FILES, digests)
    if (url === strchive.latestReleaseUrl) return release('v2.28.0', LOCUS_FILES, digests)
    if (url === mondo.latestReleaseUrl) return release('v2026-10-06', LOCUS_FILES, digests)
    const name = url.split('/').pop() ?? ''
    const body = missing.includes(name) ? undefined : (FILES[name] ?? LOCUS_FILES[name])
    return new Response(body, { status: body === undefined ? 404 : 200 })
  })
}

let dir: string
let dbPath: string
let geneRefDir: string
let geneRefPath: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hpo-update-'))
  dbPath = join(dir, 'hpo_similarity.db')
  geneRefDir = mkdtempSync(join(tmpdir(), 'hpo-update-generef-'))
  geneRefPath = join(geneRefDir, 'gene_reference.db')
  const db = new Database(geneRefPath)
  db.exec('CREATE TABLE genes (hgnc_id TEXT PRIMARY KEY, entrez_id TEXT)')
  const insert = db.prepare('INSERT INTO genes VALUES (?, ?)')
  for (const [entrez, hgnc] of ENTREZ_TO_HGNC) insert.run(hgnc, entrez)
  db.close()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(geneRefDir, { recursive: true, force: true })
})

const deps = (fetch: ReturnType<typeof releaseFetch>, online = true) => ({
  fetch,
  isOnline: () => online,
  dbPath,
  geneRefPath,
  build: async (request: Parameters<typeof buildHpoFromFiles>[0]) => buildHpoFromFiles(request)
})

describe('updateHpoData', () => {
  it('downloads, verifies, builds and atomically installs the latest release', async () => {
    const result = await updateHpoData(deps(releaseFetch('v2026-09-01')))
    expect(result).toMatchObject({
      success: true,
      message: 'HPO data v2026-09-01 installed.',
      status: { installed: true, version: 'v2026-09-01' }
    })
    expect(result.status.sources).toEqual({
      hpo: 'v2026-09-01',
      clingen: new Date().toISOString().slice(0, 10),
      strchive: 'v2.28.0',
      mondo: 'v2026-10-06'
    })
    expect(readdirSync(dir)).toEqual(['hpo_similarity.db'])
  })

  it('keeps the installed STRchive when its digest mismatches, and warns', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    const bad = { 'STRchive-loci-v2.28.0.json': `sha256:${'0'.repeat(64)}` }
    const result = await updateHpoData(deps(releaseFetch('v2026-10-01', bad)))
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/STRchive: Checksum mismatch .*; kept v2\.28\.0/)
    expect(result.status).toMatchObject({
      version: 'v2026-10-01',
      sources: { strchive: 'v2.28.0' }
    })
  })

  it('keeps the installed ClinGen when its download fails', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    const fetch = releaseFetch('v2026-10-01', {}, [clingen.regions.GRCh37])
    const result = await updateHpoData(deps(fetch))
    expect(result.message).toMatch(/ClinGen: Download of .* failed: HTTP 404; kept /)
    expect(result.status.sources?.clingen).toBeDefined()
    expect(readdirSync(dir)).toEqual(['hpo_similarity.db'])
  })

  it('rebuilds a current HPO release while a locus source is missing', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01', {}, ['mondo.obo'])))
    expect(readHpoDataStatus(dbPath).sources).not.toHaveProperty('mondo')
    const result = await updateHpoData(deps(releaseFetch('v2026-09-01')))
    expect(result.message).toMatch(/installed/)
    expect(result.status.sources?.mondo).toBe('v2026-10-06')
  })

  it('fails the update when HPO itself fails, whatever the locus sources do', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    await expect(updateHpoData(deps(releaseFetch('v2026-10-01', {}, ['hp.json'])))).rejects.toThrow(
      /hp.json failed: HTTP 404/
    )
    expect(readHpoDataStatus(dbPath).version).toBe('v2026-09-01')
  })

  it('is a no-op when the installed release is current', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    const fetch = releaseFetch('v2026-09-01')
    const result = await updateHpoData(deps(fetch))
    expect(result.message).toMatch(/up to date/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('repairs a damaged installed file', async () => {
    writeFileSync(dbPath, 'garbage '.repeat(500))
    const result = await updateHpoData(deps(releaseFetch('v2026-09-01')))
    expect(result.status).toMatchObject({ installed: true, needsUpdate: false })
  })

  it('rebuilds the same release when the installed DB came from an older builder', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    const db = new Database(dbPath)
    db.prepare("UPDATE meta SET value = '1' WHERE key = 'builder_version'").run()
    db.close()
    const result = await updateHpoData(deps(releaseFetch('v2026-09-01')))
    expect(result.message).toMatch(/installed/)
    expect(result.status.needsUpdate).toBe(false)
  })

  it('refuses to publish an incomplete build and keeps the installed data', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    const empty = async ({ outPath }: { outPath: string }): Promise<void> => {
      const db = new Database(outPath)
      db.exec('CREATE TABLE meta (key TEXT, value TEXT); CREATE TABLE terms (id TEXT, ic REAL);')
      db.exec('CREATE TABLE gene_terms (gene_symbol TEXT); CREATE TABLE ancestors (term TEXT)')
      db.close()
    }
    await expect(
      updateHpoData({ ...deps(releaseFetch('v2026-10-01')), build: empty as never })
    ).rejects.toThrow(/incomplete database/)
    expect(readHpoDataStatus(dbPath).version).toBe('v2026-09-01')
    expect(readdirSync(dir)).toEqual(['hpo_similarity.db'])
  })

  it('keeps a newer installed release when the API falls back to the pinned one', async () => {
    await updateHpoData(deps(releaseFetch('v2026-10-01')))
    const fetch = vi.fn(async () => new Response('', { status: 403 }))
    const result = await updateHpoData(deps(fetch as never))
    expect(result.message).toMatch(/newer/)
    expect(result.status.version).toBe('v2026-10-01')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rebuilds from the pinned release when a newer installed release needs an update', async () => {
    await updateHpoData(deps(releaseFetch('v2026-10-01')))
    const db = new Database(dbPath)
    db.prepare("UPDATE meta SET value = '1' WHERE key = 'builder_version'").run()
    db.close()
    const fetch = vi.fn(async (url: string) => {
      if (url === HPO_DATA_CONFIG.latestReleaseUrl) return new Response('', { status: 403 })
      return new Response(FILES[url.split('/').pop() ?? ''])
    })
    // Unusable data must not be kept as "newer"; the toy files then fail the pinned digests.
    await expect(updateHpoData(deps(fetch as never))).rejects.toThrow(/Checksum mismatch/)
  })

  it('refuses to run while another live process holds the destination lock', async () => {
    writeFileSync(`${dbPath}.lock`, String(process.pid))
    await expect(updateHpoData(deps(releaseFetch('v2026-09-01')))).rejects.toThrow(
      /already running/
    )
    expect(existsSync(dbPath)).toBe(false)
  })

  it('takes over a stale lock and releases it afterwards', async () => {
    writeFileSync(`${dbPath}.lock`, '2147483646')
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    expect(readdirSync(dir)).toEqual(['hpo_similarity.db'])
  })

  it('rejects a checksum mismatch and keeps the installed data', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    const bad = releaseFetch('v2026-10-01', { 'phenotype.hpoa': `sha256:${'0'.repeat(64)}` })
    await expect(updateHpoData(deps(bad))).rejects.toThrow(/Checksum mismatch for phenotype.hpoa/)
    expect(readHpoDataStatus(dbPath).version).toBe('v2026-09-01')
    expect(readdirSync(dir)).toEqual(['hpo_similarity.db'])
  })

  it('offline keeps the old data and makes no request', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    const fetch = releaseFetch('v2026-10-01')
    const result = await updateHpoData(deps(fetch, false))
    expect(result).toMatchObject({ success: false, status: { version: 'v2026-09-01' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a failing download leaves no data and no temp files', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('network down')
    })
    await expect(updateHpoData(deps(fetch as never))).rejects.toThrow('network down')
    expect(existsSync(dbPath)).toBe(false)
    expect(readdirSync(dir)).toEqual([])
  })

  it('falls back to the pinned release and its pinned digests when the API is unavailable', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === HPO_DATA_CONFIG.latestReleaseUrl) return new Response('', { status: 403 })
      return new Response(FILES[url.split('/').pop() ?? ''])
    })
    // The toy files do not match the pinned real-release digests: fail closed.
    await expect(updateHpoData(deps(fetch as never))).rejects.toThrow(
      /Checksum mismatch for hp.json/
    )
    expect(fetch).toHaveBeenCalledWith(
      `${HPO_DATA_CONFIG.downloadBaseUrl}/${HPO_DATA_CONFIG.defaultRelease.tag}/hp.json`,
      expect.anything()
    )
    expect(readdirSync(dir)).toEqual([])
  })

  it('downloads only from the fixed release base, never an API-supplied URL', async () => {
    const fetch = releaseFetch('v2026-09-01')
    await updateHpoData(deps(fetch))
    const urls = fetch.mock.calls.map(([url]) => url).slice(1)
    expect(urls).toEqual([
      ...Object.keys(FILES).map((name) => `${HPO_DATA_CONFIG.downloadBaseUrl}/v2026-09-01/${name}`),
      `${clingen.baseUrl}/${clingen.genes}`,
      `${clingen.baseUrl}/${clingen.regions.GRCh37}`,
      `${clingen.baseUrl}/${clingen.regions.GRCh38}`,
      strchive.latestReleaseUrl,
      `${strchive.downloadBaseUrl}/v2.28.0/STRchive-loci-v2.28.0.json`,
      mondo.latestReleaseUrl,
      `${mondo.downloadBaseUrl}/v2026-10-06/mondo.obo`
    ])
  })

  it.each([
    ['an unexpected tag', '../../evil', {}],
    ['a missing digest', 'v2026-10-01', { 'hp.json': '' }]
  ])('refuses a release with %s', async (_label, tag, digests) => {
    await expect(updateHpoData(deps(releaseFetch(tag, digests)))).rejects.toThrow(
      /unexpected tag|lacks a sha256 digest/
    )
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses a download larger than the cap', async () => {
    const fetch = releaseFetch('v2026-09-01')
    const real = fetch.getMockImplementation()!
    fetch.mockImplementation(async (url: string) => {
      if (!url.endsWith('/hp.json')) return real(url)
      const big = String(HPO_DATA_CONFIG.maxDownloadBytes + 1)
      return new Response('x', { headers: { 'content-length': big } })
    })
    await expect(updateHpoData(deps(fetch))).rejects.toThrow(/refused/)
    expect(readdirSync(dir)).toEqual([])
  })

  it('replaceFile retries while Windows reports the target busy, then gives up on other errors', async () => {
    const busy = Object.assign(new Error('busy'), { code: 'EPERM' })
    const rename = vi.fn().mockImplementationOnce(() => {
      throw busy
    })
    await replaceFile('a', 'b', rename)
    expect(rename).toHaveBeenCalledTimes(2)

    const missing = Object.assign(new Error('gone'), { code: 'ENOENT' })
    const failing = vi.fn(() => {
      throw missing
    })
    await expect(replaceFile('a', 'b', failing)).rejects.toBe(missing)
    expect(failing).toHaveBeenCalledTimes(1)
  })
})
