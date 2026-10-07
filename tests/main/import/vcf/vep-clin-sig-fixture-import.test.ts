// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { VcfStrategy } from '../../../../src/main/import/vcf/VcfStrategy'
import {
  resetUnrankedClinvar,
  takeUnrankedClinvar
} from '../../../../src/main/import/unranked-clinvar'
import { clinvarRank } from '../../../../src/shared/config/severity.config'

/**
 * End to end through the real VCF pipeline on SQLite. The repository's VEP
 * fixture was written by VEP v115.2 (cache 115) with a recorded command line
 * that sets neither `--clin_sig_allele 0` nor `--no_check_alleles`, so its
 * CSQ `CLIN_SIG` is allele-specific and may feed `clinvar`.
 */
const VEP_FIXTURE = resolve(__dirname, '../../../test-data/vcf/trio-region.vep.vcf.gz')
const SAMPLE = 'HG007'

const CSQ_FORMAT = 'Allele|Consequence|IMPACT|SYMBOL|CLIN_SIG|ClinVar_CLNSIG'
const VCF_WITH_BOTH_SOURCES = [
  '##fileformat=VCFv4.2',
  '##VEP="v115.2" API="v115" cache="/opt/vep/.vep/homo_sapiens/115_GRCh38"',
  "##VEP-command-line='vep --cache --offline --vcf --custom clinvar.vcf.gz,ClinVar,vcf,exact,0,CLNSIG'",
  '##contig=<ID=chr22,length=50818468>',
  `##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: ${CSQ_FORMAT}">`,
  '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
  ['#CHROM', 'POS', 'ID', 'REF', 'ALT', 'QUAL', 'FILTER', 'INFO', 'FORMAT', 'S1'].join('\t'),
  [
    'chr22',
    '1000',
    '.',
    'A',
    'G',
    '50',
    'PASS',
    'CSQ=G|missense_variant|MODERATE|GENE1|benign|Pathogenic/Likely_pathogenic',
    'GT',
    '0/1'
  ].join('\t'),
  [
    'chr22',
    '2000',
    '.',
    'C',
    'T',
    '50',
    'PASS',
    'CSQ=T|missense_variant|MODERATE|GENE1|likely_benign|',
    'GT',
    '0/1'
  ].join('\t'),
  ''
].join('\n')

interface ClinvarRow {
  pos: number
  ref: string
  alt: string
  clinvar: string | null
}

describe('VEP CLIN_SIG fallback through the real import pipeline', () => {
  let db: DatabaseService
  let scratch: string

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    scratch = mkdtempSync(join(tmpdir(), 'varlens-clin-sig-'))
  })

  afterEach(() => {
    db.close()
    rmSync(scratch, { recursive: true, force: true })
  })

  async function importVcf(filePath: string, sample: string): Promise<ClinvarRow[]> {
    const caseId = db.cases.createCase(`case-${sample}`, filePath, 1000)
    await new VcfStrategy().import(
      filePath,
      { caseName: `case-${sample}` },
      { db, formatInfo: { format: 'vcf', caseKey: '' }, caseId, startTime: Date.now() },
      { selectedSamples: [sample] }
    )
    return db.database
      .prepare('SELECT pos, ref, alt, clinvar FROM variants WHERE case_id = ? ORDER BY pos, alt')
      .all(caseId) as ClinvarRow[]
  }

  it('populates clinvar from CLIN_SIG for the repository VEP fixture', async () => {
    const rows = await importVcf(VEP_FIXTURE, SAMPLE)
    const withClinvar = rows.filter((r) => r.clinvar !== null && r.clinvar !== '')
    const valueAt = (pos: number): string | null | undefined =>
      rows.find((r) => r.pos === pos)?.clinvar

    expect(rows).toHaveLength(1809)
    expect(withClinvar).toHaveLength(45)
    expect(withClinvar.filter((r) => r.clinvar === 'Benign')).toHaveLength(42)
    // chr22:29539391 T>C and chr22:30020105 G>A — CLIN_SIG=uncertain_significance
    expect(valueAt(29539391)).toBe('Uncertain_significance')
    expect(valueAt(30020105)).toBe('Uncertain_significance')
    // chr22:29671939 C>T — CLIN_SIG=benign&benign/likely_benign (multi-valued)
    expect(valueAt(29671939)).toBe('Benign|Benign/Likely_benign')
  })

  it('ranks every CLIN_SIG value of the fixture and reports none as unrecognised (#469)', async () => {
    resetUnrankedClinvar()
    await importVcf(VEP_FIXTURE, SAMPLE)
    const unranked = takeUnrankedClinvar()
    const ranks = db.database
      .prepare(
        `SELECT clinvar, clinvar_rank AS rank, COUNT(*) AS n FROM variants
         WHERE clinvar IS NOT NULL AND clinvar != '' GROUP BY clinvar, clinvar_rank ORDER BY n DESC, clinvar`
      )
      .all() as Array<{ clinvar: string; rank: number; n: number }>

    expect(ranks).toEqual([
      { clinvar: 'Benign', rank: clinvarRank('Benign'), n: 42 },
      { clinvar: 'Uncertain_significance', rank: clinvarRank('Uncertain_significance'), n: 2 },
      // multi-valued: the most severe component (the Benign/Likely_benign aggregate) decides
      {
        clinvar: 'Benign|Benign/Likely_benign',
        rank: clinvarRank('Benign|Benign/Likely_benign'),
        n: 1
      }
    ])
    expect(ranks.every((row) => row.rank > 0)).toBe(true)
    expect(ranks.map((row) => row.rank)).toEqual([2, 11, 3])
    expect(unranked).toBeUndefined()
  })

  it('leaves a ClinVar_CLNSIG value untouched when CLIN_SIG is present too', async () => {
    const file = join(scratch, 'both-sources.vcf')
    writeFileSync(file, VCF_WITH_BOTH_SOURCES)

    const rows = await importVcf(file, 'S1')

    expect(rows.map((r) => [r.pos, r.clinvar])).toEqual([
      // ClinVar_CLNSIG wins, verbatim; CLIN_SIG (benign) is ignored
      [1000, 'Pathogenic/Likely_pathogenic'],
      // no ClinVar_CLNSIG for this variant: CLIN_SIG is the fallback
      [2000, 'Likely_benign']
    ])
  })
})
