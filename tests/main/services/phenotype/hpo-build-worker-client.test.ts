import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  hpoWorkerPath,
  runHpoBuild
} from '../../../../src/main/services/phenotype/hpo-build-worker-client'

const request = {
  files: { ontology: 'x', annotations: 'y', genes: 'z' },
  meta: { release: 'v2026-09-01', sha256: {} },
  outPath: 'never-written.db'
}

describe('hpo build worker path', () => {
  it('anchors to the main bundle, not to the chunk this module is bundled into', () => {
    expect(hpoWorkerPath(join('/app', 'out', 'main', 'index.js'))).toBe(
      join('/app', 'out', 'main', 'hpo-build-worker.js')
    )
    expect(hpoWorkerPath(undefined)).toBeNull()
  })

  it('fails explicitly in Electron when the worker bundle is missing', async () => {
    await expect(
      runHpoBuild(request, join('/nowhere', 'hpo-build-worker.js'), true)
    ).rejects.toThrow(/worker bundle missing/)
  })
})
