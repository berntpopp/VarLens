/**
 * The genome build a file is imported under. Used by both import workers
 * (SQLite and PostgreSQL) so no path defaults to a build silently.
 *
 * Order: the build the user confirmed (`explicit`), else the build the VCF
 * header decides on its own, else the batch's "build for files without one"
 * (`fallback`). A header that points to more than one build fails the file.
 */
import {
  BUILD_COPY,
  GENOME_BUILDS,
  isImportableGenomeBuild
} from '../../../shared/config/genome-builds.config'
import { detectionBuild } from '../../../shared/genome/genome-build'
import { parseVcfHeader } from './vcf-header-parser'

function importable(build: string): string {
  if (isImportableGenomeBuild(build)) return build
  const known = GENOME_BUILDS.find((b) => b.id === build)
  throw new Error(
    known !== undefined
      ? BUILD_COPY.notImportable(known.label)
      : `Unsupported genome build: ${build}`
  )
}

export async function resolveImportGenomeBuild(request: {
  filePath: string
  isVcf: boolean
  explicit?: string
  fallback?: string
}): Promise<string> {
  if (request.explicit !== undefined) return importable(request.explicit)
  if (request.isVcf) {
    const { buildDetection } = (await parseVcfHeader(request.filePath)).header
    if (buildDetection.confidence === 'conflict') throw new Error(BUILD_COPY.skippedConflict)
    const build = detectionBuild(buildDetection)
    if (build !== null) return importable(build)
  }
  if (request.fallback !== undefined) return importable(request.fallback)
  throw new Error(BUILD_COPY.missingBuild)
}
