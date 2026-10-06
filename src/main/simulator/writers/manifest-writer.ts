/**
 * Writers for cohort manifest and samples.txt files.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CohortManifest, GeneratedSampleResult, SimulatorOptions } from '../types'

export function writeCohortFiles(
  results: GeneratedSampleResult[],
  options: SimulatorOptions,
  masterSeed: number,
  outDir: string
): { samplesTxtPath: string; manifestJsonPath: string } {
  // 1. samples.txt (list of sample IDs, one per line)
  const samplesTxtPath = join(outDir, 'samples.txt')
  const samplesContent = results.map((r) => r.sample.lims_id).join('\n') + '\n'
  writeFileSync(samplesTxtPath, samplesContent, 'utf8')

  // 2. manifest.json
  const totalVariants = results.reduce((sum, r) => sum + r.variantCount, 0)
  const manifest: CohortManifest = {
    generator: 'VarLens-Synthetic-Simulator',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    masterSeed,
    preset: options.preset || 'custom',
    totalSamples: results.length,
    totalVariants,
    formats: options.formats,
    gzipped: options.gzip ?? false,
    samples: results.map((r) => ({
      limsId: r.sample.lims_id,
      personId: r.sample.person_id,
      analysisId: r.sample.analysis_id,
      variantCount: r.variantCount,
      seed: r.seed,
      files: r.generatedFiles
    }))
  }

  const manifestJsonPath = join(outDir, 'manifest.json')
  writeFileSync(manifestJsonPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  return { samplesTxtPath, manifestJsonPath }
}
