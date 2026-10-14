import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHpoFromFiles } from '../../../../src/main/services/phenotype/hpo-build-worker-client'
import { updateHpoData } from '../../../../src/main/services/phenotype/hpo-data-update'
import { readHpoDataStatus } from '../../../../src/main/services/phenotype/hpo-similarity-db'
import { HPO_DATA_CONFIG } from '../../../../src/shared/config/hpo-data.config'
import { GENES_TO_PHENOTYPE, HP_JSON, PHENOTYPE_HPOA } from '../../../shared/phenotype/hpo-fixture'

const FILES: Record<string, string> = {
  'hp.json': HP_JSON,
  'phenotype.hpoa': PHENOTYPE_HPOA,
  'genes_to_phenotype.txt': GENES_TO_PHENOTYPE
}
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

function releaseFetch(tag: string, digests: Record<string, string> = {}) {
  return vi.fn(async (url: string) => {
    if (url === HPO_DATA_CONFIG.latestReleaseUrl) {
      return Response.json({
        tag_name: tag,
        assets: Object.keys(FILES).map((name) => ({
          name,
          browser_download_url: `https://dl/${tag}/${name}`,
          digest: digests[name] ?? `sha256:${sha(FILES[name])}`
        }))
      })
    }
    const name = url.split('/').pop() ?? ''
    return new Response(FILES[name], { status: name in FILES ? 200 : 404 })
  })
}

let dir: string
let dbPath: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hpo-update-'))
  dbPath = join(dir, 'hpo_similarity.db')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const deps = (fetch: ReturnType<typeof releaseFetch>, online = true) => ({
  fetch,
  isOnline: () => online,
  dbPath,
  build: async (request: Parameters<typeof buildHpoFromFiles>[0]) => buildHpoFromFiles(request)
})

describe('updateHpoData', () => {
  it('downloads, verifies, builds and atomically installs the latest release', async () => {
    const result = await updateHpoData(deps(releaseFetch('v2026-09-01')))
    expect(result).toMatchObject({
      success: true,
      status: { installed: true, version: 'v2026-09-01' }
    })
    expect(readdirSync(dir)).toEqual(['hpo_similarity.db'])
  })

  it('is a no-op when the installed release is current', async () => {
    await updateHpoData(deps(releaseFetch('v2026-09-01')))
    const fetch = releaseFetch('v2026-09-01')
    const result = await updateHpoData(deps(fetch))
    expect(result.message).toMatch(/up to date/)
    expect(fetch).toHaveBeenCalledTimes(1)
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

  it('falls back to the pinned tag without digests when the API is unavailable', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === HPO_DATA_CONFIG.latestReleaseUrl) return new Response('', { status: 403 })
      return new Response(FILES[url.split('/').pop() ?? ''])
    })
    const result = await updateHpoData(deps(fetch as never))
    expect(result.status.version).toBe(HPO_DATA_CONFIG.defaultTag)
    expect(fetch).toHaveBeenCalledWith(
      `${HPO_DATA_CONFIG.downloadBaseUrl}/${HPO_DATA_CONFIG.defaultTag}/hp.json`,
      expect.anything()
    )
  })
})
