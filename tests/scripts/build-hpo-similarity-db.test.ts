import { createHash } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHpoDbCli } from '../../scripts/build-hpo-similarity-db'
import { HPO_DATA_CONFIG } from '../../src/shared/config/hpo-data.config'
import { GENES_TO_PHENOTYPE, HP_JSON, PHENOTYPE_HPOA } from '../shared/phenotype/hpo-fixture'

const FILES: Record<string, string> = {
  'hp.json': HP_JSON,
  'phenotype.hpoa': PHENOTYPE_HPOA,
  'genes_to_phenotype.txt': GENES_TO_PHENOTYPE
}
const digest = (name: string, bad: boolean): string =>
  `sha256:${bad ? '0'.repeat(64) : createHash('sha256').update(FILES[name]).digest('hex')}`

function stubNetwork(tag: string, badDigest = false) {
  const fetch = vi.fn(async (url: string) => {
    if (url.startsWith('https://api.github.com/')) {
      return Response.json({
        tag_name: tag,
        assets: Object.keys(FILES).map((name) => ({ name, digest: digest(name, badDigest) }))
      })
    }
    return new Response(FILES[url.split('/').pop() ?? ''])
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'hpo-cli-'))))
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

describe('build-hpo-similarity-db script', () => {
  it('builds the requested tag at --out through the shared update path', async () => {
    const fetch = stubNetwork('v2026-06-01')
    const out = join(dir, 'hpo.db')
    const result = await buildHpoDbCli(['--out', out, '--tag', 'v2026-06-01'], {})
    expect(result.status).toMatchObject({ installed: true, version: 'v2026-06-01' })
    expect(fetch).toHaveBeenCalledWith(
      `${HPO_DATA_CONFIG.releaseByTagUrl}/v2026-06-01`,
      expect.anything()
    )
  })

  it('downgrades only on an explicit --tag', async () => {
    const out = join(dir, 'hpo.db')
    stubNetwork('v2026-10-01')
    await buildHpoDbCli(['--out', out], {})
    stubNetwork('v2026-06-01')
    const result = await buildHpoDbCli(['--out', out, '--tag', 'v2026-06-01'], {})
    expect(result.status.version).toBe('v2026-06-01')
  })

  it('defaults the output to VARLENS_HPO_DB_PATH', async () => {
    stubNetwork('v2026-09-01')
    const out = join(dir, 'env.db')
    const result = await buildHpoDbCli([], { [HPO_DATA_CONFIG.envPath]: out })
    expect(result.status.installed).toBe(true)
  })

  it('rejects on a checksum mismatch or an invalid tag', async () => {
    stubNetwork('v2026-09-01', true)
    const out = join(dir, 'hpo.db')
    await expect(buildHpoDbCli(['--out', out], {})).rejects.toThrow(/Checksum mismatch/)
    await expect(buildHpoDbCli(['--out', out, '--tag', 'latest'], {})).rejects.toThrow(
      /Invalid HPO release tag/
    )
  })
})
