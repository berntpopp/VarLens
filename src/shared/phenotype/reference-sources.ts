/**
 * Pure parsers of the CNV/STR reference downloads (CNV/STR spec §3, §5.1):
 * ClinGen dosage TSVs, the STRchive loci JSON and the Mondo OBO `xref`s.
 * Each throws on a changed format or a file under its row floor, so the
 * caller can keep the previously installed copy of that source.
 */
import type {
  DosageGene,
  DosageRegion,
  DosageScore,
  StrLocus,
  StrLocusSpan
} from '../types/locus-reference'

const SCORES = new Set([0, 1, 2, 3, 30, 40])

/** ClinGen score cell: 0–3, 30, 40; anything else ("Not yet evaluated", blank) is null. */
function dosageScore(cell: string | undefined): DosageScore {
  const n = Number(cell)
  return cell !== undefined && cell.trim() !== '' && SCORES.has(n) ? (n as DosageScore) : null
}

const SCORE_COLUMNS = ['Haploinsufficiency Score', 'Triplosensitivity Score'] as const

/**
 * Data rows of a ClinGen curation TSV as column-name records. The header is the
 * last `#` line; every column the caller reads must be named exactly.
 */
function clingenRows(
  text: string,
  what: string,
  columns: readonly string[],
  minRows: number
): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/)
  const comments = lines.filter((l) => l.startsWith('#'))
  const header: string[] = (comments[comments.length - 1] ?? '').slice(1).split('\t')
  for (const column of columns) {
    if (!header.includes(column)) {
      throw new Error(`ClinGen ${what} header changed: no column "${column}"`)
    }
  }
  const rows = lines
    .filter((l) => l.trim() !== '' && !l.startsWith('#'))
    .map((l) => {
      const cells = l.split('\t')
      return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))
    })
  if (rows.length < minRows) {
    throw new Error(`ClinGen ${what} has ${rows.length} rows, fewer than ${minRows}`)
  }
  return rows
}

/**
 * `ClinGen_gene_curation_list_*.tsv`. ClinGen names genes by NCBI Gene id; they are
 * keyed by HGNC id (never by symbol) through `entrezToHgnc`; unmapped genes are dropped.
 */
export function parseClingenGenes(
  text: string,
  entrezToHgnc: ReadonlyMap<string, string>,
  minRows: number
): DosageGene[] {
  const rows = clingenRows(text, 'gene list', ['Gene Symbol', 'Gene ID', ...SCORE_COLUMNS], minRows)
  const genes: DosageGene[] = []
  for (const row of rows) {
    const hgncId = entrezToHgnc.get(row['Gene ID'].trim())
    if (hgncId === undefined) continue
    genes.push({
      hgncId,
      symbol: row['Gene Symbol'].trim(),
      hi: dosageScore(row[SCORE_COLUMNS[0]]),
      ts: dosageScore(row[SCORE_COLUMNS[1]])
    })
  }
  return genes
}

const LOCATION = /^chr([0-9]{1,2}|X|Y):(\d+)-(\d+)$/
const DISEASE_ID = /\b(?:MONDO|OMIM|ORPHA):\d+\b/g

/**
 * `ClinGen_region_curation_list_<build>.tsv`. Disease ids stay as given (mostly
 * MONDO); the builder maps them to OMIM/ORPHA. Regions without a placed
 * location ("tbd") are dropped. `chr` has no `chr` prefix, as in gene_reference.db.
 */
export function parseClingenRegions(text: string, build: string, minRows: number): DosageRegion[] {
  const columns = [
    'ISCA ID',
    'ISCA Region Name',
    'Genomic Location',
    ...SCORE_COLUMNS,
    'Haploinsufficiency Disease ID',
    'Triplosensitivity Disease ID'
  ]
  const regions: DosageRegion[] = []
  for (const row of clingenRows(text, `region list ${build}`, columns, minRows)) {
    const location = LOCATION.exec(row['Genomic Location'].trim())
    if (location === null) continue
    regions.push({
      iscaId: row['ISCA ID'].trim(),
      build,
      chr: location[1],
      start: Number(location[2]),
      end: Number(location[3]),
      label: row['ISCA Region Name'].trim(),
      hi: dosageScore(row[SCORE_COLUMNS[0]]),
      ts: dosageScore(row[SCORE_COLUMNS[1]]),
      lossDiseases: row['Haploinsufficiency Disease ID'].match(DISEASE_ID) ?? [],
      gainDiseases: row['Triplosensitivity Disease ID'].match(DISEASE_ID) ?? []
    })
  }
  return regions
}

/** A parsed STRchive locus; `mondo` ids name its disease when it has no OMIM/Orphanet id. */
export interface StrchiveLocus extends StrLocus {
  mondo: string[]
}

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).map(String)
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
function span(start: unknown, stop: unknown): StrLocusSpan | null {
  const a = num(start)
  const b = num(stop)
  return a === null || b === null ? null : { start: a, stop: b }
}

/** `STRchive-loci-<tag>.json`: an array of loci; ids are prefixed (`OMIM:`, `ORPHA:`, `MONDO:`). */
export function parseStrchiveLoci(text: string): StrchiveLocus[] {
  const raw = JSON.parse(text) as unknown
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('STRchive loci: not a locus array')
  return raw.map((item: Record<string, unknown>) => {
    if (typeof item?.id !== 'string' || typeof item.gene !== 'string') {
      throw new Error('STRchive loci: a locus lacks its id or gene')
    }
    if (typeof item.chrom !== 'string') throw new Error(`STRchive locus ${item.id}: no chrom`)
    return {
      id: item.id,
      gene: item.gene,
      chrom: item.chrom.replace(/^chr/, ''),
      hg19: span(item.start_hg19, item.stop_hg19),
      hg38: span(item.start_hg38, item.stop_hg38),
      pathogenicMotifs: strings(item.pathogenic_motif_reference_orientation),
      benignMax: num(item.benign_max),
      intermediateMin: num(item.intermediate_min),
      intermediateMax: num(item.intermediate_max),
      pathogenicMin: num(item.pathogenic_min),
      inheritance: strings(item.inheritance),
      evidence: strings(item.evidence)[0] ?? null,
      onsetMin: num(item.typ_age_onset_min),
      onsetMax: num(item.typ_age_onset_max),
      diseases: {
        full: [
          ...strings(item.omim).map((id) => `OMIM:${id}`),
          ...strings(item.orphanet).map((id) => `ORPHA:${id}`)
        ]
      },
      mondo: strings(item.mondo).map((id) => `MONDO:${id}`)
    }
  })
}

const XREF = /^xref: (OMIM|Orphanet):(\d+) \{[^}]*source="MONDO:equivalentTo"/

/**
 * OMIM/ORPHA equivalents (`xref`s tagged `MONDO:equivalentTo`) of the wanted
 * MONDO ids only; the rest of the ~53 MB file is discarded.
 */
export function parseMondoXrefs(text: string, wanted: ReadonlySet<string>): Map<string, string[]> {
  if (!text.startsWith('format-version:') || !text.includes('\n[Term]')) {
    throw new Error('Mondo: not an OBO file')
  }
  const xrefs = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('id: ')) {
      const id = line.slice(4).trim()
      current = wanted.has(id) ? [] : null
      if (current !== null) xrefs.set(id, current)
    } else if (current !== null) {
      const m = XREF.exec(line)
      if (m !== null) current.push(`${m[1] === 'OMIM' ? 'OMIM' : 'ORPHA'}:${m[2]}`)
    }
  }
  return xrefs
}
