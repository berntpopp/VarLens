import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'
import {
  EXPECTED_GENES,
  EXPECTED_NON_AUTOSOMAL,
  projectGenes,
  seedSqlite,
  type Sample
} from './support/burden-fixture'


describe('AssociationDataBuilder', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)

    // Insert 6 cases
    const now = Date.now()
    for (let i = 1; i <= 6; i++) {
      db.prepare(
        "INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at) VALUES (?, ?, '/test', 100, 0, ?)"
      ).run(i, `case${i}`, now)
    }

    // Cases 1-3: Group A (have BRCA1 variants)
    // Cases 4-6: Group B (no BRCA1 variants, some TP53 variants)

    // Case 1: BRCA1 het variant
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (1, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 0.001, 25.0, '0/1')"
    ).run()

    // Case 2: BRCA1 het variant (same)
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (2, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 0.001, 25.0, '0/1')"
    ).run()

    // Case 3: BRCA1 hom variant
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (3, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 0.001, 25.0, '1/1')"
    ).run()

    // Case 4: TP53 variant only
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (4, 'chr17', 7579472, 'C', 'T', 'TP53', 'missense_variant', 0.0001, 30.0, '0/1')"
    ).run()

    // Case 5: no qualifying variants
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (5, 'chr1', 100, 'A', 'T', NULL, NULL, 0.5, 5.0, '0/1')"
    ).run()
  })

  it('builds contingency data for two groups', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3], [4, 5, 6], {}, []).genes

    expect(genes.length).toBeGreaterThan(0)

    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')
    expect(brca1).toBeDefined()
    expect(brca1!.groupA_carrier_count).toBe(3) // all 3 cases have BRCA1
    expect(brca1!.groupB_carrier_count).toBe(0) // no group B cases have BRCA1
    expect(brca1!.groupA_non_carrier_count).toBe(0)
    expect(brca1!.groupB_non_carrier_count).toBe(3)
  })

  it('applies gnomad_af filter', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3], [4, 5, 6], { gnomad_af_max: 0.0005 }, []).genes

    // BRCA1 has gnomad_af=0.001, should be filtered out
    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')
    expect(brca1).toBeUndefined()

    // TP53 has gnomad_af=0.0001, should remain
    const tp53 = genes.find((g) => g.gene_symbol === 'TP53')
    expect(tp53).toBeDefined()
  })

  it('builds per-sample dosage arrays', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3], [4, 5, 6], {}, []).genes

    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')!
    expect(brca1.samples.length).toBe(6) // all 6 cases

    // Case 3 should have dosage 2 (hom)
    const case3Sample = brca1.samples.find((s) => s.group === 1 && s.dosages[0] === 2)
    expect(case3Sample).toBeDefined()
  })

  it('returns empty for no qualifying variants', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1], [2], { cadd_min: 100 }, []).genes
    expect(genes).toHaveLength(0)
  })
})

describe('AssociationDataBuilder — Path 3 parity (shared helpers)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)

    const now = Date.now()
    // 6 cases: 1-3 = group A (BRCA1 carriers), 4-6 = group B
    for (let i = 1; i <= 6; i++) {
      db.prepare(
        "INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at) VALUES (?, ?, '/test', 100, 0, ?)"
      ).run(i, `case${i}`, now)
    }

    // Group A: BRCA1 SNV carriers
    // NOTE: acmg_best + cohort_frequency live on cohort_variant_summary, NOT variants,
    // so they're not part of the insert. Burden scope passes them through buildBaseWhere
    // but the aliased reference (v.acmg_best) would fail at query time — callers should
    // only use the parity fields they know exist on the base table.
    for (const caseId of [1, 2, 3]) {
      db.prepare(
        "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar, gnomad_af, cadd, variant_type, gt_num) VALUES (?, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 'missense_variant', 'Pathogenic', 0.001, 25.0, 'snv', '0/1')"
      ).run(caseId)
    }
  })

  it('regression: existing 4-filter burden still works after refactor', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build(
      [1, 2, 3],
      [4, 5, 6],
      {
        gnomad_af_max: 0.01,
        cadd_min: 20,
        consequences: ['missense_variant'],
        gene_list: ['BRCA1']
      },
      []
    )
    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')
    expect(brca1).toBeDefined()
    expect(brca1!.groupA_carrier_count).toBe(3)
    expect(brca1!.groupB_carrier_count).toBe(0)
    expect(brca1!.groupA_non_carrier_count).toBe(0)
    expect(brca1!.groupB_non_carrier_count).toBe(3)
  })

  it('accepts all new parity fields without error (cohort-summary-only fields are silently dropped)', () => {
    // acmg_classifications + max_internal_af map to columns (acmg_best,
    // cohort_frequency) that exist on cohort_variant_summary but NOT on the
    // base variants table. buildBaseWhere with scope='cohort-burden' silently
    // drops these fields, preserving type parity with Paths 1/2 while
    // avoiding runtime SQL errors against the variants table.
    const builder = new AssociationDataBuilder(db)
    expect(() =>
      builder.build(
        [1, 2, 3],
        [4, 5, 6],
        {
          clinvars: ['Pathogenic'],
          funcs: ['missense_variant'],
          acmg_classifications: ['Pathogenic'],
          max_internal_af: 0.1
        },
        []
      )
    ).not.toThrow()
  })

  it('silently drops cohort-summary-only fields for burden scope (no runtime error, no filter effect)', () => {
    // Setting acmg_classifications=['Benign'] must NOT filter BRCA1 out —
    // the field is dropped before reaching SQL. Only clinvars (which lives
    // on variants) should actually filter.
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build(
      [1, 2, 3],
      [4, 5, 6],
      {
        acmg_classifications: ['Benign'], // dropped
        max_internal_af: 0.0001, // dropped
        clinvars: ['Pathogenic'] // applied
      },
      []
    )
    // BRCA1 should still match because the dropped fields don't filter it out
    expect(genes.find((g) => g.gene_symbol === 'BRCA1')).toBeDefined()
  })

  it('applies clinvars + funcs filter through shared helper', () => {
    const builder = new AssociationDataBuilder(db)
    // Matching clinvar + func: BRCA1 should pass
    const genesMatching = builder.build(
      [1, 2, 3],
      [4, 5, 6],
      { clinvars: ['Pathogenic'], funcs: ['missense_variant'] },
      []
    )
    expect(genesMatching.find((g) => g.gene_symbol === 'BRCA1')).toBeDefined()

    // Non-matching clinvar: BRCA1 should be filtered out
    const genesNonMatching = builder.build([1, 2, 3], [4, 5, 6], { clinvars: ['Benign'] }, []).genes
    expect(genesNonMatching.find((g) => g.gene_symbol === 'BRCA1')).toBeUndefined()
  })

  it('extension filter on cnv.copy_number narrows to CNV variants via JOIN', () => {
    // Insert CNV variant for cases 1, 2, 3 (group A)
    for (const caseId of [1, 2, 3]) {
      db.prepare(
        "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, variant_type, gt_num) VALUES (?, 'chr17', 43000000, 'N', '<CNV>', 'MYCN', 'cnv', '0/1')"
      ).run(caseId)
      const variantRow = db
        .prepare("SELECT id FROM variants WHERE case_id = ? AND chr = 'chr17' AND pos = 43000000")
        .get(caseId) as { id: number }
      db.prepare('INSERT INTO variant_cnv (variant_id, copy_number) VALUES (?, 5)').run(
        variantRow.id
      )
    }

    const builder = new AssociationDataBuilder(db)
    // Extension filter: copy_number >= 3 should return only CNVs.
    // Because buildExtensionJoinClauses prepends variant_type='cnv' narrowing,
    // the BRCA1 SNV is excluded and only MYCN CNVs remain.
    const genes = builder.build(
      [1, 2, 3],
      [4, 5, 6],
      { column_filters: { 'cnv.copy_number': { operator: '>=', value: 3 } } },
      []
    )
    const mycn = genes.find((g) => g.gene_symbol === 'MYCN')
    expect(mycn).toBeDefined()
    expect(mycn!.groupA_carrier_count).toBe(3)
    expect(mycn!.groupB_carrier_count).toBe(0)

    // BRCA1 (SNV) should NOT appear because single-type narrowing restricts to CNVs
    expect(genes.find((g) => g.gene_symbol === 'BRCA1')).toBeUndefined()
  })

  it('no column_filters still works (no JOIN, clean SQL)', () => {
    const builder = new AssociationDataBuilder(db)
    expect(() => builder.build([1, 2, 3], [4, 5, 6], {}, [])).not.toThrow()
    const genes = builder.build([1, 2, 3], [4, 5, 6], {}, []).genes
    expect(genes.find((g) => g.gene_symbol === 'BRCA1')).toBeDefined()
  })
})

describe('AssociationDataBuilder — eligible sites (#520)', () => {
  let db: Database.Database
  let ids: Record<Sample, number>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    ids = seedSqlite(db)
  })

  const build = (filters = {}) =>
    new AssociationDataBuilder(db).build([ids.S1, ids.S2], [ids.S3, ids.S4], filters, [])

  it('uses autosomal sites with a known call in every sample and counts the rest', () => {
    // chrX, chrY, chrM/MT and unplaced contigs never enter; `2` and `chr1` both do.
    const built = build()
    expect(projectGenes(built.genes)).toEqual(EXPECTED_GENES)
    expect(built.non_autosomal_variants).toBe(EXPECTED_NON_AUTOSOMAL)
  })

  it('1/. stays one copy and 0/. no copy; neither excludes its site', () => {
    // chr1:500 is the third used site of GENE1: S2 1/., S3 0/.
    const gene1 = build().genes[0]
    expect(gene1.samples.map((s) => s.dosages[2])).toEqual([0, 1, 0, 0])
    // 1 ALT copy of 8 called alleles: two rows of 2, two samples without a row.
    expect(gene1.samples[0].variant_mafs[2]).toBe(1 / 8)
  })

  it('a gene list on chrX comes back empty with a reason', () => {
    const built = build({ gene_list: ['GENEX'] })
    expect(built.genes).toEqual([])
    // chrX:500 and X:510 qualify and are left out.
    expect(built.non_autosomal_variants).toBe(2)
  })

  it('a column filter selects sites; it does not turn a carrier into a reference sample', () => {
    // S2's homozygous call at chr1:100 has quality 5: the filter must not drop it.
    const built = build({
      column_filters: { qual: { operator: '>=', value: 20, includeEmpty: false } }
    })
    expect(projectGenes(built.genes)).toEqual(EXPECTED_GENES)
    expect(built.genes[0].samples[1].dosages[0]).toBe(2)
  })

  it('0/1 (quality 99) with 1/1 (quality 2) does not select the homozygote', () => {
    const gene1 = build().genes[0]
    expect(gene1.sites_excluded.conflicting_calls).toBe(1)
    // chr1:300 is in no sample's dosages: S2 keeps only chr1:100 (2) and chr1:500 (1).
    expect(gene1.samples[1].dosages).toEqual([2, 0, 1])
  })

  it('rejects a selection with more than one genome build', () => {
    db.prepare("UPDATE cases SET genome_build = 'GRCh37' WHERE id = ?").run(ids.S4)
    expect(() => build()).toThrow(
      'Mixed genome builds: the selected cases use GRCh37 and GRCh38. ' +
        'Run the burden test on cases of one genome build.'
    )
    // A case of another build that is not selected does not block the run.
    expect(() =>
      new AssociationDataBuilder(db).build([ids.S1], [ids.S2, ids.S3], {}, [])
    ).not.toThrow()
  })

  it('binds the case ids once per query: 20,000 selected cases stay under the SQLite parameter limit', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => i + 1000)
    expect(() => new AssociationDataBuilder(db).build(many, [ids.S1], {}, [])).not.toThrow()
  })
})
