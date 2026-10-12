/**
 * Genome build detection from VCF header lines (and optionally the maximum
 * POS seen per contig). Pure; every build-specific value comes from
 * src/shared/config/genome-builds.config.ts.
 *
 * Ranking: contig lengths are definitive, header tags strong, positions only
 * exclude, and chr-vs-bare naming is never evidence.
 */
import {
  BUILD_COPY,
  GENOME_BUILD_CONFIG,
  type GenomeBuildConfig,
  type GenomeBuildDef
} from '../config/genome-builds.config'

export type BuildConfidence = 'definitive' | 'strong' | 'conflict' | 'none'

export interface BuildEvidence {
  /** Build id the evidence is about ('' when it names none). */
  build: string
  source: string
  /** Shown verbatim. */
  detail: string
}

export interface BuildDetection {
  suggested: string | null
  confidence: BuildConfidence
  evidence: BuildEvidence[]
  excluded: BuildEvidence[]
  /** Set by {@link combineBuildDetections} when files suggest different builds. */
  mixedFiles?: Array<{ fileName: string; build: string }>
}

const LENGTHS = 'Contig lengths'
const POSITIONS = 'Positions'
const MITO = 'M'

/** Strip `chr`, fold MT/M to one mito key; naming carries no build evidence. */
function contigKey(id: string): string {
  const bare = id.replace(/^chr/i, '')
  return /^(m|mt)$/i.test(bare) ? MITO : bare.toUpperCase()
}

function expectedLengths(build: GenomeBuildDef, key: string): number[] {
  if (key === MITO) return Object.values(build.mito.lengths)
  const length = build.contigs[key]
  return length === undefined ? [] : [length]
}

/** An alias counts when not preceded by [a-z0-9] and not followed by a digit. */
function namesAlias(line: string, alias: string): boolean {
  let from = 0
  for (;;) {
    const at = line.indexOf(alias, from)
    if (at < 0) return false
    const before = at === 0 ? '' : line[at - 1]
    const after = line[at + alias.length] ?? ''
    if (!/[a-z0-9]/.test(before) && !/[0-9]/.test(after)) return true
    from = at + 1
  }
}

interface LengthTally {
  matches: number
  primaryMatches: number
  mismatch: BuildEvidence | null
}

function tallyLengths(
  headerLines: readonly string[],
  builds: readonly GenomeBuildDef[]
): { tallies: Map<string, LengthTally>; checked: number } {
  const tallies = new Map<string, LengthTally>(
    builds.map((b) => [b.id, { matches: 0, primaryMatches: 0, mismatch: null }])
  )
  let checked = 0
  for (const line of headerLines) {
    if (!line.startsWith('##contig=')) continue
    const id = /[<,]ID=([^,>]+)/.exec(line)?.[1]
    const lengthText = /[<,]length=(\d+)/.exec(line)?.[1]
    if (id === undefined || lengthText === undefined) continue
    const key = contigKey(id)
    const length = Number(lengthText)
    let known = false
    for (const build of builds) {
      const expected = expectedLengths(build, key)
      if (expected.length === 0) continue
      known = true
      const tally = tallies.get(build.id)!
      if (expected.includes(length)) {
        tally.matches++
        if (key !== MITO) tally.primaryMatches++
      } else if (tally.mismatch === null) {
        const detail = BUILD_COPY.lengthMismatch(id, length, expected[0])
        tally.mismatch = { build: build.id, source: LENGTHS, detail }
      }
    }
    if (known) checked++
  }
  return { tallies, checked }
}

function tagEvidence(headerLines: readonly string[], config: GenomeBuildConfig): BuildEvidence[] {
  const found: BuildEvidence[] = []
  for (const line of headerLines) {
    const source = config.tagSources.find((s) => line.startsWith(s.prefix))
    if (source === undefined) continue
    const lower = line.toLowerCase()
    if (config.liftoverMarkers.some((marker) => lower.includes(marker))) continue
    for (const build of config.builds) {
      const alias = build.aliases.find((a) => namesAlias(lower, a))
      if (alias !== undefined && !found.some((e) => e.build === build.id)) {
        found.push({ build: build.id, source: source.label, detail: alias })
      }
    }
  }
  return found
}

function positionExclusions(
  maxPos: Readonly<Record<string, number>>,
  builds: readonly GenomeBuildDef[]
): BuildEvidence[] {
  const excluded: BuildEvidence[] = []
  for (const build of builds) {
    for (const [contig, pos] of Object.entries(maxPos)) {
      const lengths = expectedLengths(build, contigKey(contig))
      if (lengths.length > 0 && pos > Math.max(...lengths)) {
        const detail = BUILD_COPY.positionBeyond(contig, pos, Math.max(...lengths))
        excluded.push({ build: build.id, source: POSITIONS, detail })
        break
      }
    }
  }
  return excluded
}

/** Suggest a build from header evidence; the user confirms anything below definitive. */
export function detectGenomeBuild(
  headerLines: readonly string[],
  maxPos?: Readonly<Record<string, number>>,
  config: GenomeBuildConfig = GENOME_BUILD_CONFIG
): BuildDetection {
  const { tallies, checked } = tallyLengths(headerLines, config.builds)
  const excluded: BuildEvidence[] = [...tallies.values()].flatMap((t) =>
    t.mismatch === null ? [] : [t.mismatch]
  )
  excluded.push(...positionExclusions(maxPos ?? {}, config.builds))
  const excludedIds = new Set(excluded.map((e) => e.build))
  const lengthIds = new Set(excluded.filter((e) => e.source === LENGTHS).map((e) => e.build))

  const candidates = [...tallies].filter(([, t]) => t.matches > 0 && t.mismatch === null)
  const partial = [...tallies].filter(([, t]) => t.primaryMatches > 0 && t.mismatch !== null)
  // Positions exclude, they never suggest: tags for a position-excluded build drop out.
  const tags = tagEvidence(headerLines, config).filter(
    (e) => !excludedIds.has(e.build) || lengthIds.has(e.build)
  )
  const liftover = headerLines.some((line) => {
    const lower = line.toLowerCase()
    return config.liftoverMarkers.some((marker) => lower.includes(marker))
  })

  const evidence: BuildEvidence[] = []
  let suggested: string | null = null
  let confidence: BuildConfidence = 'none'

  if (candidates.length === 1) {
    const [id, tally] = candidates[0]
    suggested = id
    evidence.push({
      build: id,
      source: LENGTHS,
      detail: BUILD_COPY.lengthMatch(tally.matches, checked)
    })
    confidence = tags.every((e) => e.build === id) ? 'definitive' : 'conflict'
    evidence.push(...tags)
  } else if (partial.length > 0) {
    confidence = 'conflict'
    evidence.push(...tags)
  } else {
    if (checked > 0 && candidates.length === 0) {
      evidence.push({ build: '', source: LENGTHS, detail: BUILD_COPY.noLengthMatch })
    }
    const named = [...new Set(tags.map((e) => e.build))]
    if (named.length === 1) {
      suggested = named[0]
      confidence = 'strong'
    } else if (named.length > 1) {
      confidence = 'conflict'
    }
    evidence.unshift(...tags)
  }

  if (suggested !== null && (excludedIds.has(suggested) || liftover)) confidence = 'conflict'
  if (liftover)
    evidence.push({ build: '', source: 'Liftover', detail: BUILD_COPY.liftoverEvidence })
  return { suggested, confidence, evidence, excluded }
}

const RANK: Record<BuildConfidence, number> = { definitive: 3, strong: 2, conflict: 1, none: 0 }

/** One case, one build: combine the detections of every file (VCF previews) of a multi-file import. */
export function combineBuildDetections(
  files: ReadonlyArray<{ filePath: string; buildDetection: BuildDetection }>
): BuildDetection {
  const perFile = files.map((f) => ({
    fileName: f.filePath.split(/[\\/]/).pop() ?? f.filePath,
    detection: f.buildDetection
  }))
  const prefix = (fileName: string, list: BuildEvidence[]): BuildEvidence[] =>
    list.map((e) => ({ ...e, detail: `${fileName}: ${e.detail}` }))
  const evidence = perFile.flatMap((f) => prefix(f.fileName, f.detection.evidence))
  const excluded = perFile.flatMap((f) => prefix(f.fileName, f.detection.excluded))
  const withBuild = perFile.filter((f) => f.detection.suggested !== null)
  const builds = [...new Set(withBuild.map((f) => f.detection.suggested!))]

  if (builds.length > 1) {
    const mixedFiles = withBuild.map((f) => ({
      fileName: f.fileName,
      build: f.detection.suggested!
    }))
    return { suggested: null, confidence: 'conflict', evidence, excluded, mixedFiles }
  }
  const rated = perFile.filter((f) => f.detection.confidence !== 'none')
  if (rated.length === 0) return { suggested: null, confidence: 'none', evidence, excluded }
  let confidence = rated.reduce<BuildConfidence>(
    (low, f) => (RANK[f.detection.confidence] < RANK[low] ? f.detection.confidence : low),
    'definitive'
  )
  const suggested = builds[0] ?? null
  if (suggested === null || excluded.some((e) => e.build === suggested)) confidence = 'conflict'
  return { suggested, confidence, evidence, excluded }
}

/** The build a detection decides on its own: definitive or strong only. */
export function detectionBuild(detection: BuildDetection): string | null {
  return detection.confidence === 'definitive' || detection.confidence === 'strong'
    ? detection.suggested
    : null
}

/** Import must not start: a recognised but non-importable build, or one case of mixed builds. */
export function isBuildImportBlocked(
  detection: BuildDetection,
  builds: readonly GenomeBuildDef[] = GENOME_BUILD_CONFIG.builds
): boolean {
  const build = builds.find((b) => b.id === detection.suggested)
  return (build !== undefined && !build.importable) || (detection.mixedFiles?.length ?? 0) > 1
}

/** One-line "why" shown under the build control. */
export function describeBuildDetection(
  detection: BuildDetection,
  builds: readonly GenomeBuildDef[] = GENOME_BUILD_CONFIG.builds
): string {
  const { suggested, confidence, evidence, excluded } = detection
  const build = builds.find((b) => b.id === suggested)
  if (build !== undefined && !build.importable) return BUILD_COPY.notImportable(build.label)
  if (detection.mixedFiles !== undefined && detection.mixedFiles.length > 1) {
    const [a, b] = [
      detection.mixedFiles[0],
      detection.mixedFiles.find((f) => f.build !== detection.mixedFiles![0].build)!
    ]
    return BUILD_COPY.mixedFiles(a.fileName, a.build, b.fileName, b.build)
  }
  const first = evidence[0]
  if (confidence === 'definitive' && suggested !== null) {
    return BUILD_COPY.definitive(suggested, first.detail)
  }
  if (confidence === 'strong' && first !== undefined) {
    return BUILD_COPY.strong(first.source, first.detail)
  }
  if (confidence === 'conflict' && suggested !== null) {
    const other = evidence.find((e) => e.build !== '' && e.build !== suggested)
    if (other !== undefined && first?.source === LENGTHS) {
      return BUILD_COPY.conflictSuggested(suggested, other.source, other.build)
    }
    const hit = excluded.find((e) => e.build === suggested)
    if (hit !== undefined) return BUILD_COPY.excludedSuggestion(suggested, hit.detail)
    return BUILD_COPY.liftover(suggested)
  }
  if (confidence === 'conflict') {
    const named = [...new Set(evidence.map((e) => e.build).filter((id) => id !== ''))]
    return named.length > 1 ? BUILD_COPY.conflictNone(named) : BUILD_COPY.none
  }
  return BUILD_COPY.none
}

/**
 * Re-check a stored case's build (for the follow-up migration of mislabelled
 * cases). VarLens stores no VCF header, so the caller supplies the header
 * re-read from `case_import_files.file_path` when the file still exists, and
 * the stored max POS per chromosome (which can only exclude a build).
 */
export function redetectStoredCaseBuild(input: {
  genomeBuild: string
  headerLines: readonly string[]
  maxPos?: Readonly<Record<string, number>>
}): {
  stored: string
  detected: string | null
  confidence: BuildConfidence
  storedExcluded: boolean
  disagrees: boolean
} {
  const detection = detectGenomeBuild(input.headerLines, input.maxPos)
  const detected = detectionBuild(detection)
  const storedExcluded = detection.excluded.some((e) => e.build === input.genomeBuild)
  return {
    stored: input.genomeBuild,
    detected,
    confidence: detection.confidence,
    storedExcluded,
    disagrees: storedExcluded || (detected !== null && detected !== input.genomeBuild)
  }
}
