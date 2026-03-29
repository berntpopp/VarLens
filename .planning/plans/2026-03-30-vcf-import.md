# VCF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add native VCF import to VarLens with CSQ/ANN annotation parsing, multi-sample support, and configurable INFO field mapping.

**Architecture:** New VcfStrategy following existing ImportStrategy pattern. Streaming line-by-line parser (not JSON). Configurable INFO field registry maps known fields to typed columns, rest to info_json. Multi-sample VCFs create one case per selected sample.

**Tech Stack:** TypeScript, Vitest, SQLite (better-sqlite3), Node.js streams, Vuetify 3

**Design Spec:** `.planning/specs/2026-03-30-vcf-import-design.md`

---

## Parallelization Map

```
Task 1 (Schema migration + types) ──sequential──> Task 2 (VCF types)
                                                      │
                                          ┌───────────┼───────────┐
                                          ▼           ▼           ▼
                                     Task 3       Task 4       Task 5
                                    (Header)     (Line)      (Genotype)
                                          │           │           │
                                          │           ▼           │
                                          │       Task 6          │
                                          │     (Allele split)    │
                                          ▼           │           │
                                     Task 7           │           │
                                   (Annotation)       │           │
                                          │           │           │
                                     Task 8           │           │
                                   (Registry)         │           │
                                          │           │           │
                                          └───────────┼───────────┘
                                                      ▼
                                                  Task 9
                                                 (VcfMapper)
                                                      │
                                                      ▼
                                                  Task 10
                                            (VcfStrategy + detection)
                                                      │
                                              ┌───────┴───────┐
                                              ▼               ▼
                                          Task 11         Task 12
                                       (Worker integ.)  (Preview IPC)
                                                              │
                                                              ▼
                                                          Task 13
                                                       (Preview UI)
```

---

## Task 1: Schema Migration + Kysely Types

**Files:**
- Modify: `src/main/database/migrations.ts`
- Modify: `src/shared/types/database-schema.ts`
- Modify: `src/shared/types/import-worker.ts`
- Modify: `src/main/database/VariantRepository.ts`
- Modify: `src/main/database/CaseRepository.ts`
- Test: `tests/main/database/vcf-migration.test.ts`

### Step 1.1: Write the failing test

- [ ] Create `tests/main/database/vcf-migration.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'

describe('Migration v22: VCF columns', () => {
  let db: DatabaseType

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
  })

  afterEach(() => {
    db.close()
  })

  it('adds VCF columns to variants table', () => {
    runMigrations(db)

    const cols = db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('gq')
    expect(colNames).toContain('dp')
    expect(colNames).toContain('ad_ref')
    expect(colNames).toContain('ad_alt')
    expect(colNames).toContain('ab')
    expect(colNames).toContain('filter')
    expect(colNames).toContain('info_json')
    expect(colNames).toContain('source_format')
  })

  it('adds VCF columns to cases table', () => {
    runMigrations(db)

    const cols = db.prepare('PRAGMA table_info(cases)').all() as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('source_format')
    expect(colNames).toContain('sample_name')
  })

  it('creates partial index on info_json', () => {
    runMigrations(db)

    const indexes = db.prepare("PRAGMA index_list(variants)").all() as { name: string }[]
    const indexNames = indexes.map((i) => i.name)

    expect(indexNames).toContain('idx_variants_info_json')
  })

  it('existing data gets NULL in new columns', () => {
    // Run migrations up to v21 first
    runMigrations(db)

    // Insert a case and variant (pre-VCF)
    db.prepare(
      `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
       VALUES ('test', '/tmp/test.json.gz', 100, 1, 1234567890, 'GRCh38')`
    ).run()

    db.prepare(
      `INSERT INTO variants (case_id, chr, pos, ref, alt)
       VALUES (1, 'chr1', 100, 'A', 'G')`
    ).run()

    const variant = db.prepare('SELECT gq, dp, ad_ref, ad_alt, ab, filter, info_json, source_format FROM variants WHERE id = 1').get() as Record<string, unknown>

    expect(variant.gq).toBeNull()
    expect(variant.dp).toBeNull()
    expect(variant.ad_ref).toBeNull()
    expect(variant.ad_alt).toBeNull()
    expect(variant.ab).toBeNull()
    expect(variant.filter).toBeNull()
    expect(variant.info_json).toBeNull()
    expect(variant.source_format).toBeNull()
  })

  it('sets user_version to 22', () => {
    runMigrations(db)

    const result = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(result.user_version).toBe(22)
  })
})
```

### Step 1.2: Add migration v22 to migrations.ts

- [ ] Add the following block after the v21 migration in `src/main/database/migrations.ts`:

```typescript
  // ── Migration v22: VCF import columns (#42) ──
  if (currentVersion < 22) {
    // New columns on variants for VCF genotype/quality data
    const varCols = db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]
    const varColNames = new Set(varCols.map((c) => c.name))

    if (!varColNames.has('gq')) {
      db.exec('ALTER TABLE variants ADD COLUMN gq REAL')
    }
    if (!varColNames.has('dp')) {
      db.exec('ALTER TABLE variants ADD COLUMN dp INTEGER')
    }
    if (!varColNames.has('ad_ref')) {
      db.exec('ALTER TABLE variants ADD COLUMN ad_ref INTEGER')
    }
    if (!varColNames.has('ad_alt')) {
      db.exec('ALTER TABLE variants ADD COLUMN ad_alt INTEGER')
    }
    if (!varColNames.has('ab')) {
      db.exec('ALTER TABLE variants ADD COLUMN ab REAL')
    }
    if (!varColNames.has('filter')) {
      db.exec('ALTER TABLE variants ADD COLUMN filter TEXT')
    }
    if (!varColNames.has('info_json')) {
      db.exec('ALTER TABLE variants ADD COLUMN info_json TEXT')
    }
    if (!varColNames.has('source_format')) {
      db.exec('ALTER TABLE variants ADD COLUMN source_format TEXT')
    }

    // New columns on cases for VCF metadata
    const caseCols = db.prepare('PRAGMA table_info(cases)').all() as { name: string }[]
    const caseColNames = new Set(caseCols.map((c) => c.name))

    if (!caseColNames.has('source_format')) {
      db.exec('ALTER TABLE cases ADD COLUMN source_format TEXT')
    }
    if (!caseColNames.has('sample_name')) {
      db.exec('ALTER TABLE cases ADD COLUMN sample_name TEXT')
    }

    // Partial index for efficient queries on VCF-imported variants with INFO data
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_variants_info_json
        ON variants(case_id) WHERE info_json IS NOT NULL
    `)

    db.exec('PRAGMA user_version = 22')
  }
```

### Step 1.3: Update Kysely schema types

- [ ] Update `src/shared/types/database-schema.ts` — add new columns to `VariantsTable`:

```typescript
export interface VariantsTable {
  id: Generated<number>
  case_id: number
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  omim_mim_number: string | null
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt_num: string | null
  func: string | null
  qual: number | null
  hpo_sim_score: number | null
  transcript: string | null
  cdna: string | null
  aa_change: string | null
  hpo_match: string | null
  moi: string | null
  // VCF genotype/quality fields (nullable — only populated for VCF imports)
  gq: number | null
  dp: number | null
  ad_ref: number | null
  ad_alt: number | null
  ab: number | null
  filter: string | null
  info_json: string | null
  source_format: string | null
}
```

- [ ] Update `CasesTable` in the same file:

```typescript
export interface CasesTable {
  id: Generated<number>
  name: string
  file_path: string
  file_size: number
  variant_count: number
  created_at: number
  genome_build: string
  // VCF metadata (nullable — only populated for VCF imports)
  source_format: string | null
  sample_name: string | null
}
```

### Step 1.4: Update VariantInsertRow in import-worker types

- [ ] Update `src/shared/types/import-worker.ts` — extend `VariantInsertRow`:

```typescript
export interface VariantInsertRow {
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  omim_mim_number: string | null
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt_num: string | null
  func: string | null
  qual: number | null
  hpo_sim_score: number | null
  transcript: string | null
  cdna: string | null
  aa_change: string | null
  moi: string | null
  // VCF fields
  gq: number | null
  dp: number | null
  ad_ref: number | null
  ad_alt: number | null
  ab: number | null
  filter: string | null
  info_json: string | null
  source_format: string | null
}
```

- [ ] Update `VARIANT_INSERT_COLUMNS` in the same file:

```typescript
export const VARIANT_INSERT_COLUMNS = [
  'case_id',
  'chr',
  'pos',
  'ref',
  'alt',
  'gene_symbol',
  'omim_mim_number',
  'consequence',
  'gnomad_af',
  'cadd',
  'clinvar',
  'gt_num',
  'func',
  'qual',
  'hpo_sim_score',
  'transcript',
  'cdna',
  'aa_change',
  'moi',
  'gq',
  'dp',
  'ad_ref',
  'ad_alt',
  'ab',
  'filter',
  'info_json',
  'source_format'
] as const
```

### Step 1.5: Update VariantRepository.insertBatch to include new columns

- [ ] In `src/main/database/VariantRepository.ts`, update the `insertBatch` method's `this.kysely.insertInto('variants').values({...})` call to include the new columns:

```typescript
const result = this.execRun(
  this.kysely.insertInto('variants').values({
    case_id: caseId,
    chr: v.chr,
    pos: v.pos,
    ref: v.ref,
    alt: v.alt,
    gene_symbol: v.gene_symbol,
    omim_mim_number: v.omim_mim_number,
    consequence: v.consequence,
    gnomad_af: v.gnomad_af,
    cadd: v.cadd,
    clinvar: v.clinvar,
    gt_num: v.gt_num,
    func: v.func,
    qual: v.qual,
    hpo_sim_score: v.hpo_sim_score,
    transcript: v.transcript,
    cdna: v.cdna,
    aa_change: v.aa_change,
    moi: v.moi,
    gq: v.gq ?? null,
    dp: v.dp ?? null,
    ad_ref: v.ad_ref ?? null,
    ad_alt: v.ad_alt ?? null,
    ab: v.ab ?? null,
    filter: v.filter ?? null,
    info_json: v.info_json ?? null,
    source_format: v.source_format ?? null
  })
)
```

### Step 1.6: Update Variant type in database/types.ts

- [ ] Add the new fields to the `Variant` interface in `src/main/database/types.ts`:

```typescript
// Add after the moi field in the Variant interface:
  /** Genotype quality (VCF GQ) */
  gq: number | null
  /** Read depth (VCF DP) */
  dp: number | null
  /** Reference allele depth (VCF AD[0]) */
  ad_ref: number | null
  /** Alternate allele depth (VCF AD[1]) */
  ad_alt: number | null
  /** Allele balance: ad_alt / (ad_ref + ad_alt) */
  ab: number | null
  /** VCF FILTER field */
  filter: string | null
  /** Unmapped INFO fields as JSON */
  info_json: string | null
  /** Source format identifier */
  source_format: string | null
```

### Step 1.7: Run the test

```bash
npx vitest run tests/main/database/vcf-migration.test.ts
```

### Step 1.8: Commit

```
feat(db): add migration v22 for VCF import columns (#42)

Add gq, dp, ad_ref, ad_alt, ab, filter, info_json, source_format to variants table.
Add source_format, sample_name to cases table.
All nullable — zero impact on existing JSON-imported data.
```

---

## Task 2: VCF Types and Interfaces

**Files:**
- Create: `src/main/import/vcf/types.ts`
- Test: `tests/main/import/vcf/vcf-types.test.ts`

### Step 2.1: Write the type definition file

- [ ] Create `src/main/import/vcf/types.ts`:

```typescript
/**
 * VCF parser type definitions
 *
 * Core data structures for VCF parsing pipeline. These types flow through:
 * header-parser -> line-parser -> allele-splitter -> annotation-parser -> genotype-parser -> VcfMapper
 */

import type { TranscriptInsertRow } from '../../../shared/types/transcript'

// ── Header types ─────────────────────────────────────────────

/** VCF INFO field definition parsed from ## header */
export interface InfoFieldDef {
  id: string
  number: string // "0", "1", "A", "R", "G", "."
  type: 'Integer' | 'Float' | 'Flag' | 'Character' | 'String'
  description: string
}

/** VCF FORMAT field definition parsed from ## header */
export interface FormatFieldDef {
  id: string
  number: string
  type: 'Integer' | 'Float' | 'Character' | 'String'
  description: string
}

/** Contig definition from ##contig header line */
export interface ContigDef {
  id: string
  length?: number
}

/** Annotation type detected from VCF header */
export type AnnotationType = 'csq' | 'ann' | 'none'

/** Parsed VCF header — produced by vcf-header-parser */
export interface VcfHeader {
  /** VCF version string, e.g. "VCFv4.2" */
  fileformat: string
  /** Sample names from #CHROM line (columns 10+) */
  samples: string[]
  /** INFO field definitions keyed by ID */
  infoDefs: Map<string, InfoFieldDef>
  /** FORMAT field definitions keyed by ID */
  formatDefs: Map<string, FormatFieldDef>
  /** Contig definitions keyed by ID */
  contigs: Map<string, ContigDef>
  /** Auto-detected annotation type */
  annotationType: AnnotationType
  /** CSQ Format subfield names (only if annotationType === 'csq') */
  csqFields: string[] | null
  /** Detected genome build from ##reference or ##contig lines */
  genomeBuild: string | null
  /** Raw header lines (for genome build detection) */
  rawHeaderLines: string[]
}

// ── Line parser types ────────────────────────────────────────

/** Raw VCF data record — one line parsed into structured fields */
export interface VcfRawRecord {
  /** Chromosome */
  chrom: string
  /** 1-based position */
  pos: number
  /** Variant ID (rs number) or null if "." */
  id: string | null
  /** Reference allele */
  ref: string
  /** Alternate alleles (split on comma) */
  alt: string[]
  /** Quality score or null if "." */
  qual: number | null
  /** FILTER value — "PASS" or semicolon-separated filter names */
  filter: string
  /** Raw INFO key-value pairs (unparsed string values) */
  info: Map<string, string>
  /** FORMAT field order, e.g. ["GT", "GQ", "DP", "AD"] */
  format: string[]
  /** Per-sample values keyed by sample name, values matching format order */
  samples: Map<string, string[]>
}

// ── Genotype types ───────────────────────────────────────────

/** Parsed genotype data for one sample at one site */
export interface GenotypeData {
  /** Genotype string, e.g. "0/1", "1/1", "./.", "1" (hemizygous) */
  gt: string
  /** Genotype quality */
  gq: number | null
  /** Read depth */
  dp: number | null
  /** Reference allele depth */
  adRef: number | null
  /** Alternate allele depth */
  adAlt: number | null
  /** Allele balance: adAlt / (adRef + adAlt) */
  ab: number | null
}

// ── Annotation types ─────────────────────────────────────────

/** Result of parsing CSQ or ANN annotations for one allele */
export interface AnnotationResult {
  /** Selected transcript values (copied to main variant row) */
  geneSymbol: string | null
  consequence: string | null
  impact: string | null
  transcript: string | null
  cdna: string | null
  aaChange: string | null
  gnomadAf: number | null
  cadd: number | null
  clinvar: string | null

  /** All transcripts for variant_transcripts table */
  transcripts: TranscriptInsertRow[]
}

// ── INFO field registry types ────────────────────────────────

/** Mapping from VCF INFO field IDs to VarLens variant columns */
export interface InfoFieldMapping {
  /** One or more INFO field IDs that map to this column (first match wins) */
  infoIds: string[]
  /** Target column on the variants table */
  column: string
  /** How to parse the raw string value */
  type: 'float' | 'integer' | 'string'
  /** Optional: which CSQ subfield also maps here (for deduplication) */
  csqField?: string
  /** Human-readable description */
  description: string
}

/** Result of applying the INFO field registry to one variant */
export interface InfoFieldResult {
  /** Mapped column values (column name -> parsed value) */
  mappedValues: Map<string, string | number | null>
  /** Unmapped fields assembled into a JSON object */
  infoJson: Record<string, string> | null
}

// ── VcfMapper output ─────────────────────────────────────────

/** A fully mapped variant ready for BatchAccumulator, including VCF-specific fields */
export interface VcfMappedVariant {
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  omim_mim_number: string | null
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt_num: string | null
  func: string | null
  qual: number | null
  hpo_sim_score: number | null
  transcript: string | null
  cdna: string | null
  aa_change: string | null
  hpo_match: string | null
  moi: string | null
  gq: number | null
  dp: number | null
  ad_ref: number | null
  ad_alt: number | null
  ab: number | null
  filter: string | null
  info_json: string | null
  source_format: string | null
  _transcripts?: TranscriptInsertRow[]
}

// ── VCF Preview types ────────────────────────────────────────

/** VCF preview result returned by the import:vcfPreview IPC channel */
export interface VcfPreviewResult {
  fileformat: string
  samples: string[]
  variantCountEstimate: number
  annotationType: AnnotationType
  detectedGenomeBuild: string | null
  infoFields: Array<{
    id: string
    type: string
    number: string
    description: string
    mapsToColumn: string | null
  }>
}

/** VCF-specific import options extending the base ImportOptions */
export interface VcfImportOptions {
  /** Which samples to import (from preview step) */
  selectedSamples: string[]
  /** User override of detected genome build */
  genomeBuild?: string
  /** Custom case names per sample (key = sample name, value = case name) */
  caseNames?: Map<string, string>
}
```

### Step 2.2: Write type validation tests

- [ ] Create `tests/main/import/vcf/vcf-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type {
  VcfHeader,
  VcfRawRecord,
  GenotypeData,
  AnnotationResult,
  InfoFieldMapping,
  VcfMappedVariant,
  VcfPreviewResult,
  VcfImportOptions
} from '../../../../src/main/import/vcf/types'

describe('VCF types', () => {
  it('VcfHeader can be constructed with all required fields', () => {
    const header: VcfHeader = {
      fileformat: 'VCFv4.2',
      samples: ['HG005', 'HG006', 'HG007'],
      infoDefs: new Map([
        ['CSQ', { id: 'CSQ', number: '.', type: 'String', description: 'VEP annotations' }]
      ]),
      formatDefs: new Map([
        ['GT', { id: 'GT', number: '1', type: 'String', description: 'Genotype' }]
      ]),
      contigs: new Map([['chr1', { id: 'chr1', length: 248956422 }]]),
      annotationType: 'csq',
      csqFields: ['Allele', 'Consequence', 'IMPACT', 'SYMBOL'],
      genomeBuild: 'GRCh38',
      rawHeaderLines: ['##fileformat=VCFv4.2']
    }

    expect(header.samples).toHaveLength(3)
    expect(header.annotationType).toBe('csq')
    expect(header.csqFields).toHaveLength(4)
  })

  it('VcfRawRecord can represent a multi-allelic site', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 20002000,
      id: 'rs456789',
      ref: 'A',
      alt: ['G', 'T'],
      qual: 95,
      filter: 'PASS',
      info: new Map([['CSQ', 'G|missense_variant|MODERATE|COMT']]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['HG005', ['0/1', '95', '50', '25,25,0']],
        ['HG006', ['0/2', '90', '48', '24,0,24']]
      ])
    }

    expect(record.alt).toHaveLength(2)
    expect(record.samples.size).toBe(2)
  })

  it('GenotypeData represents parsed genotype fields', () => {
    const gt: GenotypeData = {
      gt: '0/1',
      gq: 99,
      dp: 45,
      adRef: 22,
      adAlt: 23,
      ab: 23 / (22 + 23)
    }

    expect(gt.ab).toBeCloseTo(0.511, 2)
  })

  it('AnnotationResult can hold multiple transcripts', () => {
    const result: AnnotationResult = {
      geneSymbol: 'COMT',
      consequence: 'missense_variant',
      impact: 'MODERATE',
      transcript: 'ENST00000361682',
      cdna: 'c.322A>G',
      aaChange: 'p.Met108Val',
      gnomadAf: 0.35,
      cadd: 25.3,
      clinvar: 'Uncertain_significance',
      transcripts: [
        {
          transcript_id: 'ENST00000361682',
          gene_symbol: 'COMT',
          consequence: 'missense_variant',
          cdna: 'c.322A>G',
          aa_change: 'p.Met108Val',
          hpo_sim_score: null,
          moi: null,
          is_selected: 1
        },
        {
          transcript_id: 'ENST00000406888',
          gene_symbol: 'COMT',
          consequence: 'missense_variant',
          cdna: 'c.472A>G',
          aa_change: 'p.Met158Val',
          hpo_sim_score: null,
          moi: null,
          is_selected: 0
        }
      ]
    }

    expect(result.transcripts).toHaveLength(2)
    expect(result.transcripts[0].is_selected).toBe(1)
  })

  it('InfoFieldMapping configures field resolution', () => {
    const mapping: InfoFieldMapping = {
      infoIds: ['gnomADe_AF', 'gnomADg_AF', 'gnomAD_AF', 'AF'],
      column: 'gnomad_af',
      type: 'float',
      csqField: 'gnomADe_AF',
      description: 'gnomAD population allele frequency'
    }

    expect(mapping.infoIds).toContain('gnomADe_AF')
    expect(mapping.type).toBe('float')
  })

  it('VcfMappedVariant includes all VCF-specific fields', () => {
    const variant: VcfMappedVariant = {
      chr: 'chr22',
      pos: 20000100,
      ref: 'A',
      alt: 'G',
      gene_symbol: 'COMT',
      omim_mim_number: null,
      consequence: 'missense_variant',
      gnomad_af: 0.35,
      cadd: 25.3,
      clinvar: 'Uncertain_significance',
      gt_num: '0/1',
      func: 'MODERATE',
      qual: 99,
      hpo_sim_score: null,
      transcript: 'ENST00000361682',
      cdna: 'c.322A>G',
      aa_change: 'p.Met108Val',
      hpo_match: null,
      moi: null,
      gq: 99,
      dp: 45,
      ad_ref: 22,
      ad_alt: 23,
      ab: 0.511,
      filter: 'PASS',
      info_json: null,
      source_format: 'vcf'
    }

    expect(variant.source_format).toBe('vcf')
    expect(variant.gq).toBe(99)
  })

  it('VcfPreviewResult provides import dialog metadata', () => {
    const preview: VcfPreviewResult = {
      fileformat: 'VCFv4.2',
      samples: ['HG005', 'HG006', 'HG007'],
      variantCountEstimate: 2000,
      annotationType: 'csq',
      detectedGenomeBuild: 'GRCh38',
      infoFields: [
        {
          id: 'CSQ',
          type: 'String',
          number: '.',
          description: 'VEP annotations',
          mapsToColumn: null
        }
      ]
    }

    expect(preview.samples).toHaveLength(3)
    expect(preview.annotationType).toBe('csq')
  })

  it('VcfImportOptions carries sample selection', () => {
    const options: VcfImportOptions = {
      selectedSamples: ['HG005', 'HG007'],
      genomeBuild: 'GRCh38',
      caseNames: new Map([
        ['HG005', 'Patient A'],
        ['HG007', 'Patient B']
      ])
    }

    expect(options.selectedSamples).toHaveLength(2)
    expect(options.caseNames?.get('HG005')).toBe('Patient A')
  })
})
```

### Step 2.3: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-types.test.ts
```

### Step 2.4: Commit

```
feat(vcf): add VCF parser type definitions (#42)

Define VcfHeader, VcfRawRecord, GenotypeData, AnnotationResult,
InfoFieldMapping, VcfMappedVariant, and VcfPreviewResult types.
```

---

## Task 3: VCF Header Parser

**Depends on:** Task 2
**Can run in parallel with:** Tasks 4, 5

**Files:**
- Create: `src/main/import/vcf/vcf-header-parser.ts`
- Test: `tests/main/import/vcf/vcf-header-parser.test.ts`

### Step 3.1: Write the failing test

- [ ] Create `tests/main/import/vcf/vcf-header-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { parseVcfHeader, parseVcfHeaderFromLines } from '../../../../src/main/import/vcf/vcf-header-parser'

const SYNTHETIC_VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-unit-test.vcf')

describe('vcf-header-parser', () => {
  describe('parseVcfHeaderFromLines', () => {
    const headerLines = [
      '##fileformat=VCFv4.2',
      '##FILTER=<ID=PASS,Description="All filters passed">',
      '##FILTER=<ID=LowQual,Description="Low quality variant">',
      '##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature_type|Feature|BIOTYPE|EXON|INTRON|HGVSc|HGVSp|cDNA_position|CDS_position|Protein_position|Amino_acids|Codons|CANONICAL|MANE_SELECT|gnomADe_AF|CADD_PHRED|ClinVar_CLNSIG|SIFT|PolyPhen">',
      '##INFO=<ID=ANN,Number=.,Type=String,Description="Functional annotations: \'Allele | Annotation | Annotation_Impact | Gene_Name | Gene_ID | Feature_Type | Feature_ID | Transcript_BioType | Rank | HGVS.c | HGVS.p | cDNA.pos / cDNA.length | CDS.pos / CDS.length | AA.pos / AA.length | Distance | ERRORS / WARNINGS / INFO\'">',
      '##INFO=<ID=CLINVAR_CLNSIG,Number=.,Type=String,Description="ClinVar clinical significance">',
      '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
      '##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype Quality">',
      '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Read Depth">',
      '##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Allelic depths for the ref and alt alleles">',
      '##contig=<ID=chr1,length=248956422>',
      '##contig=<ID=chr22,length=50818468>',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005\tHG006\tHG007'
    ]

    it('parses fileformat version', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.fileformat).toBe('VCFv4.2')
    })

    it('extracts sample names from #CHROM line', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.samples).toEqual(['HG005', 'HG006', 'HG007'])
    })

    it('parses INFO field definitions', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.infoDefs.size).toBeGreaterThanOrEqual(3)

      const csq = header.infoDefs.get('CSQ')
      expect(csq).toBeDefined()
      expect(csq!.number).toBe('.')
      expect(csq!.type).toBe('String')

      const clinvar = header.infoDefs.get('CLINVAR_CLNSIG')
      expect(clinvar).toBeDefined()
      expect(clinvar!.type).toBe('String')
    })

    it('parses FORMAT field definitions', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.formatDefs.size).toBe(4)

      const gt = header.formatDefs.get('GT')
      expect(gt).toBeDefined()
      expect(gt!.type).toBe('String')

      const ad = header.formatDefs.get('AD')
      expect(ad).toBeDefined()
      expect(ad!.number).toBe('R')
    })

    it('parses contig definitions', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.contigs.size).toBe(2)
      expect(header.contigs.get('chr1')?.length).toBe(248956422)
    })

    it('detects CSQ annotation type when CSQ INFO field has Format in description', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      // Has both CSQ and ANN — CSQ takes priority
      expect(header.annotationType).toBe('csq')
    })

    it('extracts CSQ subfield names from description', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.csqFields).not.toBeNull()
      expect(header.csqFields).toContain('Allele')
      expect(header.csqFields).toContain('Consequence')
      expect(header.csqFields).toContain('IMPACT')
      expect(header.csqFields).toContain('SYMBOL')
      expect(header.csqFields).toContain('CANONICAL')
      expect(header.csqFields).toContain('MANE_SELECT')
      expect(header.csqFields).toContain('gnomADe_AF')
    })

    it('detects ANN when only ANN is present', () => {
      const annOnlyLines = headerLines.filter((l) => !l.includes('ID=CSQ'))
      const header = parseVcfHeaderFromLines(annOnlyLines)
      expect(header.annotationType).toBe('ann')
      expect(header.csqFields).toBeNull()
    })

    it('detects none when neither CSQ nor ANN present', () => {
      const noAnnotLines = headerLines.filter(
        (l) => !l.includes('ID=CSQ') && !l.includes('ID=ANN')
      )
      const header = parseVcfHeaderFromLines(noAnnotLines)
      expect(header.annotationType).toBe('none')
    })

    it('detects genome build from contig lengths', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.genomeBuild).toBe('GRCh38')
    })

    it('handles VCF without samples (sites-only)', () => {
      const sitesOnly = [
        '##fileformat=VCFv4.2',
        '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO'
      ]
      const header = parseVcfHeaderFromLines(sitesOnly)
      expect(header.samples).toEqual([])
      expect(header.annotationType).toBe('none')
    })
  })

  describe('parseVcfHeader (stream-based)', () => {
    it('parses the synthetic test VCF file', async () => {
      const result = await parseVcfHeader(SYNTHETIC_VCF)

      expect(result.header.fileformat).toBe('VCFv4.2')
      expect(result.header.samples).toEqual(['HG005', 'HG006', 'HG007'])
      expect(result.header.annotationType).toBe('csq')
      expect(result.header.csqFields).toContain('Allele')
      expect(result.header.genomeBuild).toBe('GRCh38')
      expect(result.firstDataLine).toBeTruthy()
      expect(result.firstDataLine).toContain('chr22')
    })
  })
})
```

### Step 3.2: Implement vcf-header-parser.ts

- [ ] Create `src/main/import/vcf/vcf-header-parser.ts`:

```typescript
/**
 * VCF header parser
 *
 * Parses ## meta lines and #CHROM header line from VCF files.
 * Extracts sample names, INFO/FORMAT definitions, contigs, and annotation type.
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { isGzipped } from '../stream-utils'
import { detectGenomeBuildFromVcfHeaders } from '../../services/GenomeBuildDetector'
import type {
  VcfHeader,
  InfoFieldDef,
  FormatFieldDef,
  ContigDef,
  AnnotationType
} from './types'

/** Parse result includes the header and optionally the first data line */
export interface VcfHeaderParseResult {
  header: VcfHeader
  firstDataLine: string | null
}

/**
 * Parse a structured field definition from a VCF ## header line.
 * Handles: ##INFO=<ID=X,Number=Y,Type=Z,Description="...">
 */
function parseStructuredLine(line: string): Record<string, string> | null {
  const match = line.match(/^##\w+=<(.+)>$/)
  if (!match) return null

  const result: Record<string, string> = {}
  const content = match[1]
  let i = 0

  while (i < content.length) {
    // Find key
    const eqIdx = content.indexOf('=', i)
    if (eqIdx === -1) break

    const key = content.substring(i, eqIdx)
    i = eqIdx + 1

    // Find value
    if (content[i] === '"') {
      // Quoted value — find closing quote (handle escaped quotes)
      i++ // skip opening quote
      let value = ''
      while (i < content.length) {
        if (content[i] === '\\' && i + 1 < content.length) {
          value += content[i + 1]
          i += 2
        } else if (content[i] === '"') {
          i++ // skip closing quote
          break
        } else {
          value += content[i]
          i++
        }
      }
      result[key] = value
      // Skip comma after value
      if (i < content.length && content[i] === ',') i++
    } else {
      // Unquoted value — find comma or end
      const commaIdx = content.indexOf(',', i)
      if (commaIdx === -1) {
        result[key] = content.substring(i)
        i = content.length
      } else {
        result[key] = content.substring(i, commaIdx)
        i = commaIdx + 1
      }
    }
  }

  return result
}

/**
 * Extract CSQ subfield names from the CSQ INFO description.
 * VEP CSQ descriptions contain "Format: Allele|Consequence|IMPACT|..."
 */
function extractCsqFields(description: string): string[] | null {
  const match = description.match(/Format:\s*(.+)/)
  if (!match) return null

  return match[1].split('|').map((f) => f.trim())
}

/**
 * Parse VCF header from an array of header lines (synchronous).
 * Used by both the stream-based parser and unit tests.
 */
export function parseVcfHeaderFromLines(lines: string[]): VcfHeader {
  let fileformat = ''
  const samples: string[] = []
  const infoDefs = new Map<string, InfoFieldDef>()
  const formatDefs = new Map<string, FormatFieldDef>()
  const contigs = new Map<string, ContigDef>()
  let csqFields: string[] | null = null
  const rawHeaderLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('##')) {
      rawHeaderLines.push(line)

      // ##fileformat=VCFv4.x
      if (line.startsWith('##fileformat=')) {
        fileformat = line.substring('##fileformat='.length).trim()
        continue
      }

      // ##INFO=<ID=...,Number=...,Type=...,Description="...">
      if (line.startsWith('##INFO=')) {
        const fields = parseStructuredLine(line)
        if (fields && fields.ID) {
          const def: InfoFieldDef = {
            id: fields.ID,
            number: fields.Number || '.',
            type: (fields.Type || 'String') as InfoFieldDef['type'],
            description: fields.Description || ''
          }
          infoDefs.set(def.id, def)

          // Check for CSQ Format subfield names
          if (def.id === 'CSQ' && def.description) {
            csqFields = extractCsqFields(def.description)
          }
        }
        continue
      }

      // ##FORMAT=<ID=...,Number=...,Type=...,Description="...">
      if (line.startsWith('##FORMAT=')) {
        const fields = parseStructuredLine(line)
        if (fields && fields.ID) {
          const def: FormatFieldDef = {
            id: fields.ID,
            number: fields.Number || '.',
            type: (fields.Type || 'String') as FormatFieldDef['type'],
            description: fields.Description || ''
          }
          formatDefs.set(def.id, def)
        }
        continue
      }

      // ##contig=<ID=...,length=...>
      if (line.startsWith('##contig=')) {
        const fields = parseStructuredLine(line)
        if (fields && fields.ID) {
          const contig: ContigDef = {
            id: fields.ID,
            length: fields.length ? parseInt(fields.length, 10) : undefined
          }
          contigs.set(contig.id, contig)
        }
        continue
      }
    } else if (line.startsWith('#CHROM')) {
      // #CHROM line — extract sample names from columns 10+
      const cols = line.split('\t')
      if (cols.length > 9) {
        for (let i = 9; i < cols.length; i++) {
          samples.push(cols[i].trim())
        }
      }
    }
  }

  // Detect annotation type: CSQ takes priority over ANN
  let annotationType: AnnotationType = 'none'
  if (infoDefs.has('CSQ') && csqFields !== null) {
    annotationType = 'csq'
  } else if (infoDefs.has('ANN')) {
    annotationType = 'ann'
  }

  // Detect genome build using existing GenomeBuildDetector
  const genomeBuild = detectGenomeBuildFromVcfHeaders(rawHeaderLines)

  return {
    fileformat,
    samples,
    infoDefs,
    formatDefs,
    contigs,
    annotationType,
    csqFields,
    genomeBuild,
    rawHeaderLines
  }
}

/**
 * Parse VCF header from a file path (streaming).
 * Reads lines until the first non-# line, then returns the header
 * and the first data line (so the caller doesn't miss it).
 */
export async function parseVcfHeader(filePath: string): Promise<VcfHeaderParseResult> {
  return new Promise((resolve, reject) => {
    const raw = createReadStream(filePath)
    const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw

    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    const headerLines: string[] = []
    let firstDataLine: string | null = null
    let resolved = false

    rl.on('line', (line: string) => {
      if (line.startsWith('#')) {
        headerLines.push(line)
      } else {
        // First non-header line
        firstDataLine = line
        resolved = true
        rl.close()
      }
    })

    rl.on('close', () => {
      if (!resolved) {
        resolved = true
      }
      try {
        const header = parseVcfHeaderFromLines(headerLines)
        resolve({ header, firstDataLine })
      } catch (error) {
        reject(error)
      }
    })

    rl.on('error', (error) => {
      if (!resolved) {
        resolved = true
        reject(error)
      }
    })

    stream.on('error', (error) => {
      if (!resolved) {
        resolved = true
        reject(error)
      }
    })
  })
}
```

### Step 3.3: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-header-parser.test.ts
```

### Step 3.4: Commit

```
feat(vcf): implement VCF header parser (#42)

Parse ## meta lines and #CHROM header to extract sample names,
INFO/FORMAT definitions, contigs, CSQ field order, and genome build.
Supports both synchronous (from lines) and streaming (from file) modes.
```

---

## Task 4: VCF Line Parser

**Depends on:** Task 2
**Can run in parallel with:** Tasks 3, 5

**Files:**
- Create: `src/main/import/vcf/vcf-line-parser.ts`
- Test: `tests/main/import/vcf/vcf-line-parser.test.ts`

### Step 4.1: Write the failing test

- [ ] Create `tests/main/import/vcf/vcf-line-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseVcfLine } from '../../../../src/main/import/vcf/vcf-line-parser'

const SAMPLE_NAMES = ['HG005', 'HG006', 'HG007']

describe('vcf-line-parser', () => {
  it('parses a simple SNV line', () => {
    const line = 'chr22\t20000100\trs123456\tA\tG\t99\tPASS\tCSQ=G|missense_variant\tGT:GQ:DP:AD\t0/1:99:45:22,23\t0/0:99:40:40,0\t0/0:99:38:38,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.chrom).toBe('chr22')
    expect(record.pos).toBe(20000100)
    expect(record.id).toBe('rs123456')
    expect(record.ref).toBe('A')
    expect(record.alt).toEqual(['G'])
    expect(record.qual).toBe(99)
    expect(record.filter).toBe('PASS')
    expect(record.info.get('CSQ')).toBe('G|missense_variant')
    expect(record.format).toEqual(['GT', 'GQ', 'DP', 'AD'])
    expect(record.samples.get('HG005')).toEqual(['0/1', '99', '45', '22,23'])
    expect(record.samples.get('HG006')).toEqual(['0/0', '99', '40', '40,0'])
  })

  it('parses multi-allelic ALT', () => {
    const line = 'chr22\t20002000\trs456789\tA\tG,T\t95\tPASS\tCSQ=data\tGT:GQ:DP:AD\t0/1:95:50:25,25,0\t0/2:90:48:24,0,24\t0/0:99:44:44,0,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.alt).toEqual(['G', 'T'])
    expect(record.samples.get('HG006')).toEqual(['0/2', '90', '48', '24,0,24'])
  })

  it('handles missing ID (".")', () => {
    const line = 'chr22\t20001000\t.\tATCG\tA\t78\tPASS\tCSQ=data\tGT:GQ:DP:AD\t1/1:78:30:0,30\t0/1:72:28:14,14\t0/1:75:32:16,16'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.id).toBeNull()
  })

  it('handles missing QUAL (".")', () => {
    const line = 'chr22\t100\t.\tA\tG\t.\tPASS\t.\tGT\t0/1\t0/0\t0/0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.qual).toBeNull()
  })

  it('handles missing INFO (".")', () => {
    const line = 'chr22\t100\trs1\tA\tG\t99\tPASS\t.\tGT\t0/1\t0/0\t0/0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.info.size).toBe(0)
  })

  it('parses multiple INFO fields', () => {
    const line = 'chr22\t20004000\trs567890\tT\tC\t88\tPASS\tANN=data;CLINVAR_CLNSIG=Likely_pathogenic;dbNSFP_CADD_phred=26.5\tGT:GQ:DP:AD\t0/1:88:44:22,22\t0/1:82:40:20,20\t0/0:95:46:46,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.info.get('ANN')).toBe('data')
    expect(record.info.get('CLINVAR_CLNSIG')).toBe('Likely_pathogenic')
    expect(record.info.get('dbNSFP_CADD_phred')).toBe('26.5')
  })

  it('handles FLAG INFO fields (no value)', () => {
    const line = 'chr22\t100\t.\tA\tG\t99\tPASS\tDB;AF=0.5\tGT\t0/1\t0/0\t0/0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.info.get('DB')).toBe('')
    expect(record.info.get('AF')).toBe('0.5')
  })

  it('handles non-PASS filter values', () => {
    const line = 'chr22\t20003000\t.\tC\tT\t45\tLowQual\tCSQ=data\tGT:GQ:DP:AD\t0/1:15:10:5,5\t0/0:30:12:12,0\t0/0:28:11:11,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.filter).toBe('LowQual')
  })

  it('handles sites-only VCF (no samples)', () => {
    const line = 'chr22\t100\trs1\tA\tG\t99\tPASS\tAF=0.5'
    const record = parseVcfLine(line, [])

    expect(record.chrom).toBe('chr22')
    expect(record.format).toEqual([])
    expect(record.samples.size).toBe(0)
  })

  it('handles deletion (REF longer than ALT)', () => {
    const line = 'chr22\t20001000\t.\tATCG\tA\t78\tPASS\tCSQ=data\tGT:GQ:DP:AD\t1/1:78:30:0,30\t0/1:72:28:14,14\t0/1:75:32:16,16'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.ref).toBe('ATCG')
    expect(record.alt).toEqual(['A'])
  })

  it('handles insertion (ALT longer than REF)', () => {
    const line = 'chr22\t20001500\t.\tG\tGACC\t72\tPASS\tCSQ=data\tGT:GQ:DP:AD\t0/1:72:36:18,18\t0/0:90:42:42,0\t0/0:88:40:40,0'
    const record = parseVcfLine(line, SAMPLE_NAMES)

    expect(record.ref).toBe('G')
    expect(record.alt).toEqual(['GACC'])
  })
})
```

### Step 4.2: Implement vcf-line-parser.ts

- [ ] Create `src/main/import/vcf/vcf-line-parser.ts`:

```typescript
/**
 * VCF line parser
 *
 * Parses a single VCF data line (tab-separated) into a VcfRawRecord.
 * Pure string operations — no complex parsing needed.
 */

import type { VcfRawRecord } from './types'

/**
 * Parse a single VCF data line into a raw record.
 *
 * @param line - Tab-separated VCF data line (non-header, non-comment)
 * @param sampleNames - Sample names from the VCF header (#CHROM line columns 10+)
 * @returns Parsed raw record
 */
export function parseVcfLine(line: string, sampleNames: string[]): VcfRawRecord {
  const cols = line.split('\t')

  // VCF has 8 fixed columns, optionally FORMAT + sample columns
  const chrom = cols[0]
  const pos = parseInt(cols[1], 10)
  const rawId = cols[2]
  const ref = cols[3]
  const rawAlt = cols[4]
  const rawQual = cols[5]
  const filter = cols[6]
  const rawInfo = cols[7]

  // Parse ID: "." means missing
  const id = rawId === '.' ? null : rawId

  // Parse ALT: comma-separated alleles
  const alt = rawAlt.split(',')

  // Parse QUAL: "." means missing
  const qual = rawQual === '.' || rawQual === undefined ? null : parseFloat(rawQual)

  // Parse INFO: semicolon-separated key=value pairs
  const info = new Map<string, string>()
  if (rawInfo !== '.' && rawInfo !== undefined && rawInfo !== '') {
    const infoParts = rawInfo.split(';')
    for (const part of infoParts) {
      const eqIdx = part.indexOf('=')
      if (eqIdx === -1) {
        // FLAG field (no value)
        info.set(part, '')
      } else {
        info.set(part.substring(0, eqIdx), part.substring(eqIdx + 1))
      }
    }
  }

  // Parse FORMAT and sample columns
  let format: string[] = []
  const samples = new Map<string, string[]>()

  if (cols.length > 8 && cols[8] !== undefined && cols[8] !== '') {
    format = cols[8].split(':')

    for (let i = 0; i < sampleNames.length; i++) {
      const sampleCol = cols[9 + i]
      if (sampleCol !== undefined) {
        samples.set(sampleNames[i], sampleCol.split(':'))
      }
    }
  }

  return {
    chrom,
    pos,
    id,
    ref,
    alt,
    qual,
    filter,
    info,
    format,
    samples
  }
}
```

### Step 4.3: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-line-parser.test.ts
```

### Step 4.4: Commit

```
feat(vcf): implement VCF line parser (#42)

Parse VCF data lines via tab/comma/semicolon splitting into VcfRawRecord.
Handles multi-allelic ALT, FLAG INFO fields, missing values, and sites-only VCFs.
```

---

## Task 5: VCF Genotype Parser

**Depends on:** Task 2
**Can run in parallel with:** Tasks 3, 4

**Files:**
- Create: `src/main/import/vcf/vcf-genotype-parser.ts`
- Test: `tests/main/import/vcf/vcf-genotype-parser.test.ts`

### Step 5.1: Write the failing test

- [ ] Create `tests/main/import/vcf/vcf-genotype-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseGenotype } from '../../../../src/main/import/vcf/vcf-genotype-parser'

describe('vcf-genotype-parser', () => {
  const FORMAT = ['GT', 'GQ', 'DP', 'AD']

  it('parses a heterozygous genotype', () => {
    const gt = parseGenotype(['0/1', '99', '45', '22,23'], FORMAT)

    expect(gt.gt).toBe('0/1')
    expect(gt.gq).toBe(99)
    expect(gt.dp).toBe(45)
    expect(gt.adRef).toBe(22)
    expect(gt.adAlt).toBe(23)
    expect(gt.ab).toBeCloseTo(23 / 45, 4)
  })

  it('parses a homozygous alt genotype', () => {
    const gt = parseGenotype(['1/1', '78', '30', '0,30'], FORMAT)

    expect(gt.gt).toBe('1/1')
    expect(gt.adRef).toBe(0)
    expect(gt.adAlt).toBe(30)
    expect(gt.ab).toBe(1.0)
  })

  it('parses a homozygous ref genotype', () => {
    const gt = parseGenotype(['0/0', '99', '40', '40,0'], FORMAT)

    expect(gt.gt).toBe('0/0')
    expect(gt.adRef).toBe(40)
    expect(gt.adAlt).toBe(0)
    expect(gt.ab).toBe(0)
  })

  it('handles missing genotype (./.)', () => {
    const gt = parseGenotype(['./.', '.', '.', '.'], FORMAT)

    expect(gt.gt).toBe('./.')
    expect(gt.gq).toBeNull()
    expect(gt.dp).toBeNull()
    expect(gt.adRef).toBeNull()
    expect(gt.adAlt).toBeNull()
    expect(gt.ab).toBeNull()
  })

  it('handles partial missing values (.:.:.:.) ', () => {
    const gt = parseGenotype(['.', '.', '.', '.'], FORMAT)

    expect(gt.gt).toBe('.')
    expect(gt.gq).toBeNull()
    expect(gt.dp).toBeNull()
    expect(gt.adRef).toBeNull()
    expect(gt.adAlt).toBeNull()
    expect(gt.ab).toBeNull()
  })

  it('handles hemizygous genotype (chrX male)', () => {
    const gt = parseGenotype(['1', '88', '30', '0,30'], FORMAT)

    expect(gt.gt).toBe('1')
    expect(gt.gq).toBe(88)
    expect(gt.dp).toBe(30)
    expect(gt.adRef).toBe(0)
    expect(gt.adAlt).toBe(30)
  })

  it('handles phased genotype', () => {
    const gt = parseGenotype(['0|1', '85', '42', '20,22'], FORMAT)

    expect(gt.gt).toBe('0|1')
    expect(gt.gq).toBe(85)
  })

  it('handles multi-allelic AD (takes first two by default)', () => {
    const gt = parseGenotype(['0/1', '95', '50', '25,25,0'], FORMAT)

    expect(gt.adRef).toBe(25)
    expect(gt.adAlt).toBe(25)
    expect(gt.ab).toBeCloseTo(0.5, 4)
  })

  it('handles FORMAT with only GT', () => {
    const gt = parseGenotype(['0/1'], ['GT'])

    expect(gt.gt).toBe('0/1')
    expect(gt.gq).toBeNull()
    expect(gt.dp).toBeNull()
    expect(gt.adRef).toBeNull()
    expect(gt.adAlt).toBeNull()
    expect(gt.ab).toBeNull()
  })

  it('handles FORMAT fields in non-standard order', () => {
    const gt = parseGenotype(['40', '0/1', '22,18', '92'], ['DP', 'GT', 'AD', 'GQ'])

    expect(gt.gt).toBe('0/1')
    expect(gt.dp).toBe(40)
    expect(gt.gq).toBe(92)
    expect(gt.adRef).toBe(22)
    expect(gt.adAlt).toBe(18)
  })

  it('computes AB as null when both AD values are 0', () => {
    const gt = parseGenotype(['0/0', '99', '0', '0,0'], FORMAT)

    expect(gt.ab).toBeNull()
  })

  it('specifies alt allele index for multi-allelic AD', () => {
    // AD = ref, alt1, alt2 — we want alt2 (index 2)
    const gt = parseGenotype(['0/2', '90', '48', '24,0,24'], FORMAT, 2)

    expect(gt.adRef).toBe(24)
    expect(gt.adAlt).toBe(24)
    expect(gt.ab).toBeCloseTo(0.5, 4)
  })
})
```

### Step 5.2: Implement vcf-genotype-parser.ts

- [ ] Create `src/main/import/vcf/vcf-genotype-parser.ts`:

```typescript
/**
 * VCF genotype parser
 *
 * Extracts per-sample GT/GQ/DP/AD fields from VCF FORMAT+sample columns.
 * Pure functions with no side effects.
 */

import type { GenotypeData } from './types'

/**
 * Parse genotype data from sample values using FORMAT field order.
 *
 * @param sampleValues - Colon-split values for one sample (e.g. ["0/1", "99", "45", "22,23"])
 * @param formatFields - FORMAT field order (e.g. ["GT", "GQ", "DP", "AD"])
 * @param altAlleleIndex - 1-based index of ALT allele for multi-allelic AD extraction (default 1)
 * @returns Parsed genotype data
 */
export function parseGenotype(
  sampleValues: string[],
  formatFields: string[],
  altAlleleIndex: number = 1
): GenotypeData {
  // Build index map for FORMAT fields
  const fieldIndex = new Map<string, number>()
  for (let i = 0; i < formatFields.length; i++) {
    fieldIndex.set(formatFields[i], i)
  }

  // Extract GT
  const gtIdx = fieldIndex.get('GT')
  const gt = gtIdx !== undefined && gtIdx < sampleValues.length ? sampleValues[gtIdx] : '.'

  // Extract GQ
  const gqIdx = fieldIndex.get('GQ')
  const gq = parseIntField(gqIdx, sampleValues)

  // Extract DP
  const dpIdx = fieldIndex.get('DP')
  const dp = parseIntField(dpIdx, sampleValues)

  // Extract AD (comma-separated: ref,alt1[,alt2,...])
  const adIdx = fieldIndex.get('AD')
  let adRef: number | null = null
  let adAlt: number | null = null

  if (adIdx !== undefined && adIdx < sampleValues.length) {
    const adStr = sampleValues[adIdx]
    if (adStr !== '.' && adStr !== '') {
      const adParts = adStr.split(',')
      if (adParts.length >= 2) {
        const refVal = parseInt(adParts[0], 10)
        const altVal = parseInt(adParts[altAlleleIndex] || adParts[1], 10)
        adRef = isNaN(refVal) ? null : refVal
        adAlt = isNaN(altVal) ? null : altVal
      }
    }
  }

  // Compute allele balance
  let ab: number | null = null
  if (adRef !== null && adAlt !== null) {
    const total = adRef + adAlt
    if (total > 0) {
      ab = adAlt / total
    }
  }

  return { gt, gq, dp, adRef, adAlt, ab }
}

/**
 * Parse an integer field from sample values.
 * Returns null for missing values (".") or invalid numbers.
 */
function parseIntField(
  fieldIdx: number | undefined,
  sampleValues: string[]
): number | null {
  if (fieldIdx === undefined || fieldIdx >= sampleValues.length) return null
  const val = sampleValues[fieldIdx]
  if (val === '.' || val === '') return null
  const parsed = parseInt(val, 10)
  return isNaN(parsed) ? null : parsed
}
```

### Step 5.3: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-genotype-parser.test.ts
```

### Step 5.4: Commit

```
feat(vcf): implement VCF genotype parser (#42)

Extract GT/GQ/DP/AD from FORMAT+sample columns with allele balance
computation. Handles missing values, hemizygous chrX, phased genotypes,
non-standard FORMAT order, and multi-allelic AD indexing.
```

---

## Task 6: VCF Allele Splitter

**Depends on:** Task 4 (uses VcfRawRecord)

**Files:**
- Create: `src/main/import/vcf/vcf-allele-splitter.ts`
- Test: `tests/main/import/vcf/vcf-allele-splitter.test.ts`

### Step 6.1: Write the failing test

- [ ] Create `tests/main/import/vcf/vcf-allele-splitter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { splitMultiAllelic } from '../../../../src/main/import/vcf/vcf-allele-splitter'
import type { VcfRawRecord, InfoFieldDef, FormatFieldDef } from '../../../../src/main/import/vcf/types'

function makeInfoDefs(defs: Partial<InfoFieldDef>[]): Map<string, InfoFieldDef> {
  const map = new Map<string, InfoFieldDef>()
  for (const d of defs) {
    const full: InfoFieldDef = {
      id: d.id || '',
      number: d.number || '.',
      type: d.type || 'String',
      description: d.description || ''
    }
    map.set(full.id, full)
  }
  return map
}

function makeFormatDefs(defs: Partial<FormatFieldDef>[]): Map<string, FormatFieldDef> {
  const map = new Map<string, FormatFieldDef>()
  for (const d of defs) {
    const full: FormatFieldDef = {
      id: d.id || '',
      number: d.number || '.',
      type: d.type || 'String',
      description: d.description || ''
    }
    map.set(full.id, full)
  }
  return map
}

describe('vcf-allele-splitter', () => {
  const infoDefs = makeInfoDefs([
    { id: 'CSQ', number: '.', type: 'String' },
    { id: 'AF', number: 'A', type: 'Float' },
    { id: 'AC', number: 'A', type: 'Integer' },
    { id: 'DB', number: '0', type: 'Flag' },
    { id: 'DP_INFO', number: '1', type: 'Integer' }
  ])

  const formatDefs = makeFormatDefs([
    { id: 'GT', number: '1', type: 'String' },
    { id: 'GQ', number: '1', type: 'Integer' },
    { id: 'DP', number: '1', type: 'Integer' },
    { id: 'AD', number: 'R', type: 'Integer' }
  ])

  it('passes through single-allelic records unchanged', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22', pos: 100, id: null, ref: 'A', alt: ['G'],
      qual: 99, filter: 'PASS',
      info: new Map([['DP_INFO', '50']]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([['S1', ['0/1', '99', '45', '22,23']]])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)
    expect(results).toHaveLength(1)
    expect(results[0].alt).toEqual(['G'])
    expect(results[0].samples.get('S1')).toEqual(['0/1', '99', '45', '22,23'])
  })

  it('splits biallelic from multi-allelic record', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22', pos: 200, id: 'rs1', ref: 'A', alt: ['G', 'T'],
      qual: 95, filter: 'PASS',
      info: new Map([
        ['AF', '0.1,0.2'],
        ['AC', '5,10'],
        ['DB', ''],
        ['DP_INFO', '50'],
        ['CSQ', 'G|missense,T|stop_gained']
      ]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['S1', ['0/1', '95', '50', '25,20,5']],
        ['S2', ['0/2', '90', '48', '24,0,24']]
      ])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)
    expect(results).toHaveLength(2)

    // First split: ALT=G (allele index 1)
    const r1 = results[0]
    expect(r1.alt).toEqual(['G'])
    expect(r1.info.get('AF')).toBe('0.1')        // Number=A: select index 0
    expect(r1.info.get('AC')).toBe('5')           // Number=A: select index 0
    expect(r1.info.get('DB')).toBe('')             // Number=0 (flag): copy
    expect(r1.info.get('DP_INFO')).toBe('50')     // Number=1: copy
    expect(r1.info.get('CSQ')).toBe('G|missense,T|stop_gained') // Number=.: copy as-is

    // Second split: ALT=T (allele index 2)
    const r2 = results[1]
    expect(r2.alt).toEqual(['T'])
    expect(r2.info.get('AF')).toBe('0.2')         // Number=A: select index 1
    expect(r2.info.get('AC')).toBe('10')          // Number=A: select index 1
  })

  it('remaps GT for multi-allelic splits', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22', pos: 200, id: null, ref: 'A', alt: ['G', 'T'],
      qual: 95, filter: 'PASS', info: new Map(),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['S1', ['0/1', '95', '50', '25,20,5']],
        ['S2', ['0/2', '90', '48', '24,0,24']],
        ['S3', ['1/2', '85', '40', '10,15,15']]
      ])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)

    // Split for ALT=G (original allele 1 -> new allele 1)
    expect(results[0].samples.get('S1')![0]).toBe('0/1')  // 0/1 stays 0/1
    expect(results[0].samples.get('S2')![0]).toBe('0/.')   // 0/2 -> 0/. (allele 2 not relevant)
    expect(results[0].samples.get('S3')![0]).toBe('1/.')   // 1/2 -> 1/.

    // Split for ALT=T (original allele 2 -> new allele 1)
    expect(results[1].samples.get('S1')![0]).toBe('0/.')   // 0/1 -> 0/. (allele 1 not relevant)
    expect(results[1].samples.get('S2')![0]).toBe('0/1')   // 0/2 -> 0/1
    expect(results[1].samples.get('S3')![0]).toBe('./1')   // 1/2 -> ./1
  })

  it('splits AD for multi-allelic records (Number=R)', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22', pos: 200, id: null, ref: 'A', alt: ['G', 'T'],
      qual: 95, filter: 'PASS', info: new Map(),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['S1', ['0/1', '95', '50', '25,20,5']]
      ])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)

    // Split for ALT=G: AD should be ref,alt1 = 25,20
    expect(results[0].samples.get('S1')![3]).toBe('25,20')

    // Split for ALT=T: AD should be ref,alt2 = 25,5
    expect(results[1].samples.get('S1')![3]).toBe('25,5')
  })

  it('handles triallelic with three ALT alleles', () => {
    const record: VcfRawRecord = {
      chrom: 'chr1', pos: 500, id: null, ref: 'A', alt: ['G', 'T', 'C'],
      qual: 80, filter: 'PASS',
      info: new Map([['AF', '0.1,0.2,0.05']]),
      format: ['GT'],
      samples: new Map([['S1', ['1/3']]])
    }

    const results = splitMultiAllelic(record, infoDefs, formatDefs)
    expect(results).toHaveLength(3)
    expect(results[0].alt).toEqual(['G'])
    expect(results[1].alt).toEqual(['T'])
    expect(results[2].alt).toEqual(['C'])
    expect(results[0].info.get('AF')).toBe('0.1')
    expect(results[2].info.get('AF')).toBe('0.05')

    // GT 1/3: for ALT=G (allele 1) -> 1/., for ALT=C (allele 3) -> ./1
    expect(results[0].samples.get('S1')![0]).toBe('1/.')
    expect(results[2].samples.get('S1')![0]).toBe('./1')
  })
})
```

### Step 6.2: Implement vcf-allele-splitter.ts

- [ ] Create `src/main/import/vcf/vcf-allele-splitter.ts`:

```typescript
/**
 * VCF allele splitter
 *
 * Decomposes multi-allelic VCF records into biallelic records,
 * respecting VCF Number semantics for INFO and FORMAT fields.
 */

import type { VcfRawRecord, InfoFieldDef, FormatFieldDef } from './types'

/**
 * Split a multi-allelic VcfRawRecord into one record per ALT allele.
 * Single-allelic records pass through unchanged (returned as a one-element array).
 *
 * @param record - Raw VCF record (may have multiple ALT alleles)
 * @param infoDefs - INFO field definitions from VCF header (for Number semantics)
 * @param formatDefs - FORMAT field definitions from VCF header (for Number semantics)
 * @returns Array of biallelic records (one per ALT allele)
 */
export function splitMultiAllelic(
  record: VcfRawRecord,
  infoDefs: Map<string, InfoFieldDef>,
  formatDefs: Map<string, FormatFieldDef>
): VcfRawRecord[] {
  // Single-allelic: pass through
  if (record.alt.length <= 1) {
    return [record]
  }

  const results: VcfRawRecord[] = []

  for (let altIdx = 0; altIdx < record.alt.length; altIdx++) {
    const splitRecord: VcfRawRecord = {
      chrom: record.chrom,
      pos: record.pos,
      id: record.id,
      ref: record.ref,
      alt: [record.alt[altIdx]],
      qual: record.qual,
      filter: record.filter,
      info: splitInfoFields(record.info, infoDefs, altIdx, record.alt.length),
      format: record.format,
      samples: splitSampleFields(record, formatDefs, altIdx)
    }
    results.push(splitRecord)
  }

  return results
}

/**
 * Split INFO fields according to their Number attribute.
 */
function splitInfoFields(
  info: Map<string, string>,
  infoDefs: Map<string, InfoFieldDef>,
  altIdx: number,
  altCount: number
): Map<string, string> {
  const result = new Map<string, string>()

  for (const [key, value] of info) {
    const def = infoDefs.get(key)
    const number = def?.number || '.'

    switch (number) {
      case '0': // Flag — copy to all
      case '1': // Single value — copy to all
        result.set(key, value)
        break

      case 'A': {
        // Per-ALT allele — select value at altIdx
        const parts = value.split(',')
        if (altIdx < parts.length) {
          result.set(key, parts[altIdx])
        } else {
          result.set(key, value)
        }
        break
      }

      case 'R': {
        // Per-allele (REF + ALTs) — keep REF (index 0) + current ALT
        const parts = value.split(',')
        if (parts.length > altIdx + 1) {
          result.set(key, `${parts[0]},${parts[altIdx + 1]}`)
        } else {
          result.set(key, value)
        }
        break
      }

      case 'G':
        // Per-genotype — complex, just copy as-is for now
        result.set(key, value)
        break

      default:
        // "." or unknown — copy as-is (CSQ/ANN handled by annotation parser)
        result.set(key, value)
        break
    }
  }

  return result
}

/**
 * Split per-sample FORMAT fields, remapping GT and splitting Number=R fields.
 */
function splitSampleFields(
  record: VcfRawRecord,
  formatDefs: Map<string, FormatFieldDef>,
  altIdx: number
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const originalAltAllele = altIdx + 1 // 1-based allele number in GT

  for (const [sampleName, values] of record.samples) {
    const newValues = [...values]

    for (let fIdx = 0; fIdx < record.format.length; fIdx++) {
      const field = record.format[fIdx]
      if (fIdx >= values.length) break

      if (field === 'GT') {
        newValues[fIdx] = remapGenotype(values[fIdx], originalAltAllele)
        continue
      }

      const def = formatDefs.get(field)
      const number = def?.number || '.'

      if (number === 'R') {
        // Per-allele (REF + ALTs) — keep REF + current ALT
        const parts = values[fIdx].split(',')
        if (parts.length > altIdx + 1) {
          newValues[fIdx] = `${parts[0]},${parts[altIdx + 1]}`
        }
      } else if (number === 'A') {
        // Per-ALT — select value at altIdx
        const parts = values[fIdx].split(',')
        if (altIdx < parts.length) {
          newValues[fIdx] = parts[altIdx]
        }
      }
      // Number=1, 0, ., G: keep as-is
    }

    result.set(sampleName, newValues)
  }

  return result
}

/**
 * Remap a GT string for a specific ALT allele.
 * - The target allele (originalAltAllele) becomes 1
 * - REF (0) stays 0
 * - All other alleles become "." (missing)
 *
 * @param gt - Original GT string (e.g. "0/2", "1/2")
 * @param originalAltAllele - 1-based allele number to keep (e.g. 2 for second ALT)
 * @returns Remapped GT string (e.g. "0/1", "1/.")
 */
function remapGenotype(gt: string, originalAltAllele: number): string {
  // Determine separator
  const separator = gt.includes('|') ? '|' : '/'
  const alleles = gt.split(/[/|]/)

  const remapped = alleles.map((a) => {
    if (a === '.') return '.'
    const num = parseInt(a, 10)
    if (isNaN(num)) return '.'
    if (num === 0) return '0'
    if (num === originalAltAllele) return '1'
    return '.'
  })

  return remapped.join(separator)
}
```

### Step 6.3: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-allele-splitter.test.ts
```

### Step 6.4: Commit

```
feat(vcf): implement multi-allelic allele splitter (#42)

Decompose multi-allelic VCF records into biallelic records with
Number-aware INFO/FORMAT field splitting. Remaps GT so target allele
becomes 1, REF stays 0, others become missing. Splits AD (Number=R)
and AF (Number=A) correctly per allele.
```

---

## Task 7: VCF Annotation Parser

**Depends on:** Task 3 (uses VcfHeader for CSQ field order)

**Files:**
- Create: `src/main/import/vcf/vcf-annotation-parser.ts`
- Test: `tests/main/import/vcf/vcf-annotation-parser.test.ts`

### Step 7.1: Write the failing test

- [ ] Create `tests/main/import/vcf/vcf-annotation-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseAnnotation } from '../../../../src/main/import/vcf/vcf-annotation-parser'
import type { VcfHeader } from '../../../../src/main/import/vcf/types'

function makeHeader(overrides: Partial<VcfHeader> = {}): VcfHeader {
  return {
    fileformat: 'VCFv4.2',
    samples: [],
    infoDefs: new Map(),
    formatDefs: new Map(),
    contigs: new Map(),
    annotationType: 'none',
    csqFields: null,
    genomeBuild: null,
    rawHeaderLines: [],
    ...overrides
  }
}

describe('vcf-annotation-parser', () => {
  describe('CSQ parsing', () => {
    const csqFields = [
      'Allele', 'Consequence', 'IMPACT', 'SYMBOL', 'Gene',
      'Feature_type', 'Feature', 'BIOTYPE', 'EXON', 'INTRON',
      'HGVSc', 'HGVSp', 'cDNA_position', 'CDS_position',
      'Protein_position', 'Amino_acids', 'Codons', 'CANONICAL',
      'MANE_SELECT', 'gnomADe_AF', 'CADD_PHRED', 'ClinVar_CLNSIG',
      'SIFT', 'PolyPhen'
    ]
    const header = makeHeader({ annotationType: 'csq', csqFields })

    it('extracts fields from a single CSQ transcript', () => {
      const info = new Map([
        ['CSQ', 'T|synonymous_variant|LOW|COMT|ENSG00000093010|Transcript|ENST00000361682|protein_coding|2/6|.|ENST00000361682.4:c.186C>T|ENSP00000354346.4:p.Ala62=|336|186|62|A|gcC/gcT|YES|NM_000754.4|0.12|11.2||tolerated(0.8)|benign(0.05)']
      ])

      const result = parseAnnotation(info, header, 'T')

      expect(result.geneSymbol).toBe('COMT')
      expect(result.consequence).toBe('synonymous_variant')
      expect(result.impact).toBe('LOW')
      expect(result.transcript).toBe('ENST00000361682')
      expect(result.cdna).toBe('ENST00000361682.4:c.186C>T')
      expect(result.aaChange).toBe('ENSP00000354346.4:p.Ala62=')
      expect(result.gnomadAf).toBeCloseTo(0.12, 4)
      expect(result.cadd).toBeCloseTo(11.2, 1)
      expect(result.clinvar).toBeNull() // empty field
      expect(result.transcripts).toHaveLength(1)
      expect(result.transcripts[0].is_selected).toBe(1)
    })

    it('selects MANE Select transcript over others', () => {
      // First transcript is MANE_SELECT + CANONICAL, second is not
      const info = new Map([
        ['CSQ', 'G|missense_variant|MODERATE|COMT|ENSG00000093010|Transcript|ENST00000361682|protein_coding|3/6|.|c.322A>G|p.Met108Val|472|322|108|M/V|Atg/Gtg|YES|NM_000754.4||25.3|Uncertain_significance|deleterious(0.01)|probably_damaging(0.95),G|missense_variant|MODERATE|COMT|ENSG00000093010|Transcript|ENST00000406888|protein_coding|4/7|.|c.472A>G|p.Met158Val|622|472|158|M/V|Atg/Gtg|||0.35|24.8|||']
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result.transcripts).toHaveLength(2)
      // MANE_SELECT transcript should be selected
      expect(result.transcript).toBe('ENST00000361682')
      expect(result.transcripts[0].is_selected).toBe(1)
      expect(result.transcripts[1].is_selected).toBe(0)
    })

    it('filters annotations by allele', () => {
      // Two annotations: one for G, one for T. We want only G.
      const info = new Map([
        ['CSQ', 'G|missense_variant|MODERATE|COMT|E1|Transcript|T1|protein_coding||||||||||||||||,T|stop_gained|HIGH|COMT|E1|Transcript|T2|protein_coding||||||||||||||||']
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result.transcripts).toHaveLength(1)
      expect(result.geneSymbol).toBe('COMT')
    })

    it('handles empty CSQ value', () => {
      const info = new Map([['CSQ', '']])

      const result = parseAnnotation(info, header, 'G')

      expect(result.geneSymbol).toBeNull()
      expect(result.transcripts).toHaveLength(0)
    })

    it('selects HIGH impact over MODERATE when no MANE/canonical', () => {
      const info = new Map([
        ['CSQ', 'G|missense_variant|MODERATE|GENE1|E1|Transcript|T1|protein_coding|||c.1A>G|p.X1Y||||||||||||||,G|stop_gained|HIGH|GENE1|E1|Transcript|T2|protein_coding|||c.2A>G|p.X2*||||||||||||||']
      ])

      const result = parseAnnotation(info, header, 'G')
      expect(result.transcript).toBe('T2')
      expect(result.impact).toBe('HIGH')
    })
  })

  describe('ANN parsing', () => {
    const header = makeHeader({ annotationType: 'ann' })

    it('extracts fields from ANN annotation', () => {
      const info = new Map([
        ['ANN', 'C|missense_variant|MODERATE|SNAP29|ENSG00000099940|transcript|ENST00000215730.5|protein_coding|4/7|c.310T>C|p.Ser104Pro|310/1089|310/828|104/275||']
      ])

      const result = parseAnnotation(info, header, 'C')

      expect(result.geneSymbol).toBe('SNAP29')
      expect(result.consequence).toBe('missense_variant')
      expect(result.impact).toBe('MODERATE')
      expect(result.transcript).toBe('ENST00000215730.5')
      expect(result.cdna).toBe('c.310T>C')
      expect(result.aaChange).toBe('p.Ser104Pro')
      expect(result.transcripts).toHaveLength(1)
    })

    it('handles multi-annotation ANN with allele filtering', () => {
      const info = new Map([
        ['ANN', 'G|missense_variant|MODERATE|LZTR1|E1|transcript|T1|protein_coding|12/19|c.1360C>G|p.Leu454Val|1360/2622|1360/2466|454/821||,G|upstream_gene_variant|MODIFIER|SLC25A1|E2|transcript|T2|protein_coding|||||||1234||']
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result.transcripts).toHaveLength(2)
      // MODERATE should be selected over MODIFIER
      expect(result.transcript).toBe('T1')
      expect(result.geneSymbol).toBe('LZTR1')
    })

    it('handles compound annotations (frameshift&splice_region)', () => {
      const info = new Map([
        ['ANN', 'G|frameshift_variant&splice_region_variant|HIGH|LZTR1|E1|transcript|T1|protein_coding|8/19|c.720_721del|p.Ala241fs|720/2622|720/2466|241/821||']
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result.consequence).toBe('frameshift_variant&splice_region_variant')
      expect(result.impact).toBe('HIGH')
    })
  })

  describe('unannotated VCF', () => {
    const header = makeHeader({ annotationType: 'none' })

    it('returns all nulls for unannotated VCF', () => {
      const info = new Map([['AF', '0.5']])
      const result = parseAnnotation(info, header, 'G')

      expect(result.geneSymbol).toBeNull()
      expect(result.consequence).toBeNull()
      expect(result.transcripts).toHaveLength(0)
    })
  })
})
```

### Step 7.2: Implement vcf-annotation-parser.ts

- [ ] Create `src/main/import/vcf/vcf-annotation-parser.ts`:

```typescript
/**
 * VCF annotation parser
 *
 * Extracts CSQ (VEP) and ANN (SnpEff) annotations from VCF INFO fields.
 * Selects the "best" transcript and maps to VarLens fields.
 */

import type { VcfHeader, AnnotationResult } from './types'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'

/** Impact severity order for transcript selection */
const IMPACT_ORDER: Record<string, number> = {
  HIGH: 4,
  MODERATE: 3,
  LOW: 2,
  MODIFIER: 1
}

/**
 * Parse annotations from VCF INFO fields.
 * Auto-dispatches to CSQ or ANN parser based on header annotation type.
 *
 * @param info - Raw INFO key-value pairs from VcfRawRecord
 * @param header - Parsed VCF header with annotation type info
 * @param altAllele - The ALT allele to filter annotations for
 * @returns Annotation result with selected transcript and all transcripts
 */
export function parseAnnotation(
  info: Map<string, string>,
  header: VcfHeader,
  altAllele: string
): AnnotationResult {
  if (header.annotationType === 'csq' && header.csqFields !== null) {
    return parseCsq(info, header.csqFields, altAllele)
  }

  if (header.annotationType === 'ann') {
    return parseAnn(info, altAllele)
  }

  return emptyResult()
}

// ── CSQ (VEP) Parser ─────────────────────────────────────────

interface CsqTranscript {
  fields: Map<string, string>
  allele: string
}

function parseCsq(
  info: Map<string, string>,
  csqFieldNames: string[],
  altAllele: string
): AnnotationResult {
  const csqRaw = info.get('CSQ')
  if (!csqRaw || csqRaw === '') return emptyResult()

  // Split annotations by comma, then each by pipe
  const annotations = csqRaw.split(',')
  const parsed: CsqTranscript[] = []

  for (const ann of annotations) {
    if (ann === '') continue
    const parts = ann.split('|')
    const fields = new Map<string, string>()

    for (let i = 0; i < csqFieldNames.length && i < parts.length; i++) {
      if (parts[i] !== '') {
        fields.set(csqFieldNames[i], parts[i])
      }
    }

    const allele = fields.get('Allele') || ''
    parsed.push({ fields, allele })
  }

  // Filter by allele: VEP uses the ALT base for SNVs, "-" for deletions, inserted seq for insertions
  const filtered = parsed.filter((t) => matchesAllele(t.allele, altAllele))

  if (filtered.length === 0) return emptyResult()

  // Build TranscriptInsertRows
  const transcripts: TranscriptInsertRow[] = filtered.map((t) => ({
    transcript_id: t.fields.get('Feature') || '',
    gene_symbol: t.fields.get('SYMBOL') || null,
    consequence: t.fields.get('Consequence') || null,
    cdna: t.fields.get('HGVSc') || null,
    aa_change: t.fields.get('HGVSp') || null,
    hpo_sim_score: null,
    moi: null,
    is_selected: 0
  }))

  // Select best transcript
  const bestIdx = selectBestTranscript(filtered, 'csq')
  if (bestIdx >= 0 && bestIdx < transcripts.length) {
    transcripts[bestIdx].is_selected = 1
  }

  const best = bestIdx >= 0 ? filtered[bestIdx] : null

  // Parse numeric fields from the best transcript
  const gnomadAfStr = best?.fields.get('gnomADe_AF') || best?.fields.get('gnomADg_AF') || null
  const caddStr = best?.fields.get('CADD_PHRED') || null
  const clinvarStr = best?.fields.get('ClinVar_CLNSIG') || null

  return {
    geneSymbol: best?.fields.get('SYMBOL') || null,
    consequence: best?.fields.get('Consequence') || null,
    impact: best?.fields.get('IMPACT') || null,
    transcript: best?.fields.get('Feature') || null,
    cdna: best?.fields.get('HGVSc') || null,
    aaChange: best?.fields.get('HGVSp') || null,
    gnomadAf: gnomadAfStr ? parseFloat(gnomadAfStr) : null,
    cadd: caddStr ? parseFloat(caddStr) : null,
    clinvar: clinvarStr || null,
    transcripts
  }
}

// ── ANN (SnpEff) Parser ──────────────────────────────────────

// Fixed ANN field indices (SnpEff standard 16-field format)
const ANN_ALLELE = 0
const ANN_ANNOTATION = 1
const ANN_IMPACT = 2
const ANN_GENE_NAME = 3
// const ANN_GENE_ID = 4
// const ANN_FEATURE_TYPE = 5
const ANN_FEATURE_ID = 6
const ANN_BIOTYPE = 7
// const ANN_RANK = 8
const ANN_HGVSC = 9
const ANN_HGVSP = 10
// const ANN_CDNA_POS = 11
// const ANN_CDS_POS = 12
// const ANN_AA_POS = 13
// const ANN_DISTANCE = 14
// const ANN_ERRORS = 15

interface AnnTranscript {
  parts: string[]
  allele: string
}

function parseAnn(
  info: Map<string, string>,
  altAllele: string
): AnnotationResult {
  const annRaw = info.get('ANN')
  if (!annRaw || annRaw === '') return emptyResult()

  const annotations = annRaw.split(',')
  const parsed: AnnTranscript[] = []

  for (const ann of annotations) {
    if (ann === '') continue
    const parts = ann.split('|')
    const allele = parts[ANN_ALLELE] || ''
    parsed.push({ parts, allele })
  }

  // Filter by allele
  const filtered = parsed.filter((t) => matchesAllele(t.allele, altAllele))

  if (filtered.length === 0) return emptyResult()

  // Build TranscriptInsertRows
  const transcripts: TranscriptInsertRow[] = filtered.map((t) => ({
    transcript_id: t.parts[ANN_FEATURE_ID] || '',
    gene_symbol: t.parts[ANN_GENE_NAME] || null,
    consequence: t.parts[ANN_ANNOTATION] || null,
    cdna: t.parts[ANN_HGVSC] || null,
    aa_change: t.parts[ANN_HGVSP] || null,
    hpo_sim_score: null,
    moi: null,
    is_selected: 0
  }))

  // Select best transcript
  const bestIdx = selectBestTranscriptAnn(filtered)
  if (bestIdx >= 0 && bestIdx < transcripts.length) {
    transcripts[bestIdx].is_selected = 1
  }

  const best = bestIdx >= 0 ? filtered[bestIdx] : null

  return {
    geneSymbol: best?.parts[ANN_GENE_NAME] || null,
    consequence: best?.parts[ANN_ANNOTATION] || null,
    impact: best?.parts[ANN_IMPACT] || null,
    transcript: best?.parts[ANN_FEATURE_ID] || null,
    cdna: best?.parts[ANN_HGVSC] || null,
    aaChange: best?.parts[ANN_HGVSP] || null,
    gnomadAf: null, // ANN doesn't include gnomAD — handled by INFO field registry
    cadd: null,      // ANN doesn't include CADD — handled by INFO field registry
    clinvar: null,   // ANN doesn't include ClinVar — handled by INFO field registry
    transcripts
  }
}

// ── Shared helpers ───────────────────────────────────────────

/**
 * Check if an annotation allele matches the target ALT allele.
 * VEP CSQ uses the VCF ALT bases for SNVs, "-" for deletions, inserted bases for insertions.
 * SnpEff ANN uses the full ALT allele string.
 */
function matchesAllele(annAllele: string, altAllele: string): boolean {
  if (annAllele === altAllele) return true
  // VEP deletion notation: "-" matches when ALT is shorter than REF
  if (annAllele === '-') return true
  // VEP insertion: the annotation Allele is the inserted bases (ALT minus first base)
  if (altAllele.length > 1 && annAllele === altAllele.substring(1)) return true
  return false
}

/**
 * Select the best CSQ transcript using priority:
 * MANE Select > Canonical > highest IMPACT > first protein_coding
 */
function selectBestTranscript(transcripts: CsqTranscript[], _type: 'csq'): number {
  if (transcripts.length === 0) return -1

  let bestIdx = 0
  let bestScore = -1

  for (let i = 0; i < transcripts.length; i++) {
    const t = transcripts[i]
    let score = 0

    // MANE_SELECT presence: highest priority
    const mane = t.fields.get('MANE_SELECT')
    if (mane && mane !== '') score += 1000

    // CANONICAL=YES
    const canonical = t.fields.get('CANONICAL')
    if (canonical === 'YES') score += 100

    // Impact severity
    const impact = t.fields.get('IMPACT') || 'MODIFIER'
    score += (IMPACT_ORDER[impact] || 0) * 10

    // protein_coding biotype preference
    const biotype = t.fields.get('BIOTYPE')
    if (biotype === 'protein_coding') score += 5

    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  return bestIdx
}

/**
 * Select the best ANN transcript using priority:
 * highest IMPACT > protein_coding biotype > first
 */
function selectBestTranscriptAnn(transcripts: AnnTranscript[]): number {
  if (transcripts.length === 0) return -1

  let bestIdx = 0
  let bestScore = -1

  for (let i = 0; i < transcripts.length; i++) {
    const t = transcripts[i]
    let score = 0

    const impact = t.parts[ANN_IMPACT] || 'MODIFIER'
    score += (IMPACT_ORDER[impact] || 0) * 10

    const biotype = t.parts[ANN_BIOTYPE] || ''
    if (biotype === 'protein_coding') score += 5

    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  return bestIdx
}

function emptyResult(): AnnotationResult {
  return {
    geneSymbol: null,
    consequence: null,
    impact: null,
    transcript: null,
    cdna: null,
    aaChange: null,
    gnomadAf: null,
    cadd: null,
    clinvar: null,
    transcripts: []
  }
}
```

### Step 7.3: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-annotation-parser.test.ts
```

### Step 7.4: Commit

```
feat(vcf): implement CSQ and ANN annotation parser (#42)

Extract VEP CSQ and SnpEff ANN annotations from VCF INFO fields.
Select best transcript via MANE Select > Canonical > highest IMPACT.
Filter annotations by allele for correct multi-allelic handling.
Map gene_symbol, consequence, cdna, aa_change, gnomad_af, cadd, clinvar.
```

---

## Task 8: INFO Field Registry

**Depends on:** Task 2 (uses InfoFieldMapping type)

**Files:**
- Create: `src/main/import/vcf/info-field-registry.ts`
- Test: `tests/main/import/vcf/info-field-registry.test.ts`

### Step 8.1: Write the failing test

- [ ] Create `tests/main/import/vcf/info-field-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_INFO_FIELD_MAPPINGS,
  applyInfoFieldRegistry,
  getFieldColumnMapping
} from '../../../../src/main/import/vcf/info-field-registry'
import type { AnnotationResult } from '../../../../src/main/import/vcf/types'

describe('info-field-registry', () => {
  it('has default mappings for gnomad_af, cadd, clinvar', () => {
    const columns = DEFAULT_INFO_FIELD_MAPPINGS.map((m) => m.column)
    expect(columns).toContain('gnomad_af')
    expect(columns).toContain('cadd')
    expect(columns).toContain('clinvar')
  })

  it('maps gnomADe_AF to gnomad_af', () => {
    const info = new Map([['gnomADe_AF', '0.001']])
    const annotation: AnnotationResult = {
      geneSymbol: null, consequence: null, impact: null,
      transcript: null, cdna: null, aaChange: null,
      gnomadAf: null, cadd: null, clinvar: null, transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.mappedValues.get('gnomad_af')).toBeCloseTo(0.001, 6)
  })

  it('maps CLINVAR_CLNSIG to clinvar', () => {
    const info = new Map([['CLINVAR_CLNSIG', 'Pathogenic']])
    const annotation: AnnotationResult = {
      geneSymbol: null, consequence: null, impact: null,
      transcript: null, cdna: null, aaChange: null,
      gnomadAf: null, cadd: null, clinvar: null, transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.mappedValues.get('clinvar')).toBe('Pathogenic')
  })

  it('maps dbNSFP_CADD_phred to cadd', () => {
    const info = new Map([['dbNSFP_CADD_phred', '26.5']])
    const annotation: AnnotationResult = {
      geneSymbol: null, consequence: null, impact: null,
      transcript: null, cdna: null, aaChange: null,
      gnomadAf: null, cadd: null, clinvar: null, transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.mappedValues.get('cadd')).toBeCloseTo(26.5, 1)
  })

  it('annotation values take priority over INFO field values', () => {
    const info = new Map([['gnomADe_AF', '0.5']])
    const annotation: AnnotationResult = {
      geneSymbol: null, consequence: null, impact: null,
      transcript: null, cdna: null, aaChange: null,
      gnomadAf: 0.001, // CSQ already provided a value
      cadd: null, clinvar: null, transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    // CSQ value (0.001) should take priority — mapped value should not override
    expect(result.mappedValues.has('gnomad_af')).toBe(false)
  })

  it('unmapped INFO fields go to info_json', () => {
    const info = new Map([
      ['gnomADe_AF', '0.001'],     // mapped
      ['SOME_CUSTOM', 'value1'],   // unmapped
      ['ANOTHER_FIELD', 'value2']  // unmapped
    ])
    const annotation: AnnotationResult = {
      geneSymbol: null, consequence: null, impact: null,
      transcript: null, cdna: null, aaChange: null,
      gnomadAf: null, cadd: null, clinvar: null, transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.infoJson).not.toBeNull()
    expect(result.infoJson!['SOME_CUSTOM']).toBe('value1')
    expect(result.infoJson!['ANOTHER_FIELD']).toBe('value2')
    expect(result.infoJson!['gnomADe_AF']).toBeUndefined() // mapped, not in json
  })

  it('returns null info_json when all fields are mapped', () => {
    const info = new Map([['gnomADe_AF', '0.001']])
    const annotation: AnnotationResult = {
      geneSymbol: null, consequence: null, impact: null,
      transcript: null, cdna: null, aaChange: null,
      gnomadAf: null, cadd: null, clinvar: null, transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.infoJson).toBeNull()
  })

  it('skips CSQ and ANN fields from info_json', () => {
    const info = new Map([
      ['CSQ', 'huge|annotation|string'],
      ['ANN', 'another|annotation'],
      ['CUSTOM', 'keep']
    ])
    const annotation: AnnotationResult = {
      geneSymbol: null, consequence: null, impact: null,
      transcript: null, cdna: null, aaChange: null,
      gnomadAf: null, cadd: null, clinvar: null, transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.infoJson!['CSQ']).toBeUndefined()
    expect(result.infoJson!['ANN']).toBeUndefined()
    expect(result.infoJson!['CUSTOM']).toBe('keep')
  })

  it('getFieldColumnMapping returns preview-friendly mapping info', () => {
    const infoDefs = new Map([
      ['gnomADe_AF', { id: 'gnomADe_AF', number: 'A', type: 'Float' as const, description: 'gnomAD exome AF' }],
      ['CUSTOM', { id: 'CUSTOM', number: '1', type: 'String' as const, description: 'Custom field' }]
    ])

    const mappings = getFieldColumnMapping(infoDefs, DEFAULT_INFO_FIELD_MAPPINGS)

    const gnomad = mappings.find((m) => m.id === 'gnomADe_AF')
    expect(gnomad?.mapsToColumn).toBe('gnomad_af')

    const custom = mappings.find((m) => m.id === 'CUSTOM')
    expect(custom?.mapsToColumn).toBeNull()
  })
})
```

### Step 8.2: Implement info-field-registry.ts

- [ ] Create `src/main/import/vcf/info-field-registry.ts`:

```typescript
/**
 * Configurable INFO field registry
 *
 * Data-driven mapping from VCF INFO field IDs to VarLens variant columns.
 * Extensible for any VCF-based format (SNV, CNV, STR, SV) without code changes.
 */

import type { InfoFieldMapping, InfoFieldResult, AnnotationResult, InfoFieldDef } from './types'

/** Fields that are handled by the annotation parser and should not go to info_json */
const ANNOTATION_INFO_IDS = new Set(['CSQ', 'ANN'])

/** Default registry covering common annotation pipelines */
export const DEFAULT_INFO_FIELD_MAPPINGS: InfoFieldMapping[] = [
  {
    infoIds: ['gnomADe_AF', 'gnomADg_AF', 'gnomAD_AF', 'AF'],
    column: 'gnomad_af',
    type: 'float',
    csqField: 'gnomADe_AF',
    description: 'gnomAD population allele frequency'
  },
  {
    infoIds: ['CADD_phred', 'dbNSFP_CADD_phred', 'CADD_PHRED'],
    column: 'cadd',
    type: 'float',
    csqField: 'CADD_PHRED',
    description: 'CADD phred-scaled score'
  },
  {
    infoIds: ['CLNSIG', 'CLINVAR_CLNSIG', 'ClinVar_CLNSIG'],
    column: 'clinvar',
    type: 'string',
    csqField: 'ClinVar_CLNSIG',
    description: 'ClinVar clinical significance'
  }
]

/**
 * Column name to AnnotationResult field mapping for priority checking.
 * If the annotation parser already populated a column, the registry skips it.
 */
const COLUMN_TO_ANNOTATION_FIELD: Record<string, keyof AnnotationResult> = {
  gnomad_af: 'gnomadAf',
  cadd: 'cadd',
  clinvar: 'clinvar'
}

/**
 * Apply the INFO field registry to a variant's INFO fields.
 *
 * Resolution priority:
 * 1. CSQ/ANN annotation values (already set) — skip if annotation provided a value
 * 2. Standalone INFO fields matched by registry — map to typed column
 * 3. Unmapped INFO fields — store in info_json
 *
 * @param info - Raw INFO key-value pairs from VcfRawRecord
 * @param registry - Field mapping registry (default: DEFAULT_INFO_FIELD_MAPPINGS)
 * @param annotation - Annotation result (to check for already-populated columns)
 * @returns Mapped values and unmapped info_json
 */
export function applyInfoFieldRegistry(
  info: Map<string, string>,
  registry: InfoFieldMapping[],
  annotation: AnnotationResult
): InfoFieldResult {
  const mappedValues = new Map<string, string | number | null>()
  const mappedInfoIds = new Set<string>()
  const unmapped: Record<string, string> = {}

  // Build a reverse lookup: INFO ID -> mapping
  const infoIdToMapping = new Map<string, InfoFieldMapping>()
  for (const mapping of registry) {
    for (const infoId of mapping.infoIds) {
      infoIdToMapping.set(infoId, mapping)
    }
  }

  // Process each INFO field
  for (const [key, value] of info) {
    // Skip annotation fields (CSQ/ANN are handled separately)
    if (ANNOTATION_INFO_IDS.has(key)) continue

    const mapping = infoIdToMapping.get(key)

    if (mapping) {
      mappedInfoIds.add(key)

      // Check if the annotation parser already provided this column's value
      const annotationField = COLUMN_TO_ANNOTATION_FIELD[mapping.column]
      if (annotationField && annotation[annotationField] !== null) {
        // Annotation value takes priority — don't override
        continue
      }

      // Parse and map the value
      const parsed = parseInfoValue(value, mapping.type)
      if (parsed !== undefined) {
        mappedValues.set(mapping.column, parsed)
      }
    } else {
      // Unmapped — goes to info_json
      unmapped[key] = value
    }
  }

  const infoJson = Object.keys(unmapped).length > 0 ? unmapped : null

  return { mappedValues, infoJson }
}

/**
 * Parse a raw INFO value string to the specified type.
 */
function parseInfoValue(
  value: string,
  type: 'float' | 'integer' | 'string'
): string | number | null | undefined {
  if (value === '.' || value === '') return null

  switch (type) {
    case 'float': {
      const parsed = parseFloat(value)
      return isNaN(parsed) ? null : parsed
    }
    case 'integer': {
      const parsed = parseInt(value, 10)
      return isNaN(parsed) ? null : parsed
    }
    case 'string':
      return value
    default:
      return value
  }
}

/**
 * Get field-to-column mapping info for the VCF preview UI.
 * Shows which INFO fields map to which VarLens columns (or info_json).
 */
export function getFieldColumnMapping(
  infoDefs: Map<string, InfoFieldDef>,
  registry: InfoFieldMapping[] = DEFAULT_INFO_FIELD_MAPPINGS
): Array<{ id: string; type: string; number: string; description: string; mapsToColumn: string | null }> {
  // Build reverse lookup
  const infoIdToColumn = new Map<string, string>()
  for (const mapping of registry) {
    for (const infoId of mapping.infoIds) {
      infoIdToColumn.set(infoId, mapping.column)
    }
  }

  const result: Array<{
    id: string
    type: string
    number: string
    description: string
    mapsToColumn: string | null
  }> = []

  for (const [id, def] of infoDefs) {
    if (ANNOTATION_INFO_IDS.has(id)) continue

    result.push({
      id,
      type: def.type,
      number: def.number,
      description: def.description,
      mapsToColumn: infoIdToColumn.get(id) || null
    })
  }

  return result
}
```

### Step 8.3: Run the test

```bash
npx vitest run tests/main/import/vcf/info-field-registry.test.ts
```

### Step 8.4: Commit

```
feat(vcf): implement configurable INFO field registry (#42)

Data-driven mapping from VCF INFO IDs to VarLens columns. Covers
gnomad_af, cadd, clinvar with extensible registry. Annotation values
(CSQ/ANN) take priority over standalone INFO fields. Unmapped fields
stored as info_json.
```

---

## Task 9: VcfMapper — Orchestrate Parsers

**Depends on:** Tasks 3, 4, 5, 6, 7, 8

**Files:**
- Create: `src/main/import/vcf/VcfMapper.ts`
- Test: `tests/main/import/vcf/vcf-mapper.test.ts`

### Step 9.1: Write the failing test

- [ ] Create `tests/main/import/vcf/vcf-mapper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mapVcfRecord } from '../../../../src/main/import/vcf/VcfMapper'
import type { VcfRawRecord, VcfHeader, VcfMappedVariant } from '../../../../src/main/import/vcf/types'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../../../../src/main/import/vcf/info-field-registry'

function makeHeader(): VcfHeader {
  return {
    fileformat: 'VCFv4.2',
    samples: ['HG005', 'HG006', 'HG007'],
    infoDefs: new Map([
      ['CSQ', { id: 'CSQ', number: '.', type: 'String' as const, description: 'VEP Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature_type|Feature|BIOTYPE|EXON|INTRON|HGVSc|HGVSp|cDNA_position|CDS_position|Protein_position|Amino_acids|Codons|CANONICAL|MANE_SELECT|gnomADe_AF|CADD_PHRED|ClinVar_CLNSIG|SIFT|PolyPhen' }],
      ['CLINVAR_CLNSIG', { id: 'CLINVAR_CLNSIG', number: '.', type: 'String' as const, description: 'ClinVar' }]
    ]),
    formatDefs: new Map([
      ['GT', { id: 'GT', number: '1', type: 'String' as const, description: 'Genotype' }],
      ['GQ', { id: 'GQ', number: '1', type: 'Integer' as const, description: 'Genotype Quality' }],
      ['DP', { id: 'DP', number: '1', type: 'Integer' as const, description: 'Read Depth' }],
      ['AD', { id: 'AD', number: 'R', type: 'Integer' as const, description: 'Allelic depths' }]
    ]),
    contigs: new Map(),
    annotationType: 'csq',
    csqFields: [
      'Allele', 'Consequence', 'IMPACT', 'SYMBOL', 'Gene',
      'Feature_type', 'Feature', 'BIOTYPE', 'EXON', 'INTRON',
      'HGVSc', 'HGVSp', 'cDNA_position', 'CDS_position',
      'Protein_position', 'Amino_acids', 'Codons', 'CANONICAL',
      'MANE_SELECT', 'gnomADe_AF', 'CADD_PHRED', 'ClinVar_CLNSIG',
      'SIFT', 'PolyPhen'
    ],
    genomeBuild: 'GRCh38',
    rawHeaderLines: []
  }
}

describe('VcfMapper', () => {
  const header = makeHeader()

  it('maps a single-allelic CSQ-annotated variant', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 20000100,
      id: 'rs123456',
      ref: 'A',
      alt: ['G'],
      qual: 99,
      filter: 'PASS',
      info: new Map([
        ['CSQ', 'G|missense_variant|MODERATE|COMT|ENSG00000093010|Transcript|ENST00000361682|protein_coding|3/6|.|c.322A>G|p.Met108Val|472|322|108|M/V|Atg/Gtg|YES|NM_000754.4||25.3|Uncertain_significance|deleterious(0.01)|probably_damaging(0.95)']
      ]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['HG005', ['0/1', '99', '45', '22,23']],
        ['HG006', ['0/0', '99', '40', '40,0']],
        ['HG007', ['0/0', '99', '38', '38,0']]
      ])
    }

    const results = mapVcfRecord(record, header, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(1)
    const v = results[0]

    expect(v.chr).toBe('chr22')
    expect(v.pos).toBe(20000100)
    expect(v.ref).toBe('A')
    expect(v.alt).toBe('G')
    expect(v.gene_symbol).toBe('COMT')
    expect(v.consequence).toBe('missense_variant')
    expect(v.func).toBe('MODERATE')
    expect(v.transcript).toBe('ENST00000361682')
    expect(v.cdna).toBe('c.322A>G')
    expect(v.aa_change).toBe('p.Met108Val')
    expect(v.cadd).toBeCloseTo(25.3, 1)
    expect(v.clinvar).toBe('Uncertain_significance')
    expect(v.gt_num).toBe('0/1')
    expect(v.gq).toBe(99)
    expect(v.dp).toBe(45)
    expect(v.ad_ref).toBe(22)
    expect(v.ad_alt).toBe(23)
    expect(v.ab).toBeCloseTo(23 / 45, 4)
    expect(v.qual).toBe(99)
    expect(v.filter).toBe('PASS')
    expect(v.source_format).toBe('vcf')
    expect(v._transcripts).toBeDefined()
    expect(v._transcripts!.length).toBeGreaterThanOrEqual(1)
  })

  it('skips ref-homozygous variants for the selected sample', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22', pos: 100, id: null, ref: 'A', alt: ['G'],
      qual: 99, filter: 'PASS', info: new Map(),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['HG005', ['0/0', '99', '40', '40,0']]
      ])
    }

    const results = mapVcfRecord(record, header, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(0)
  })

  it('skips no-call variants (./.)', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22', pos: 100, id: null, ref: 'A', alt: ['G'],
      qual: 99, filter: 'PASS', info: new Map(),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['HG005', ['./.', '.', '.', '.']]
      ])
    }

    const results = mapVcfRecord(record, header, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(0)
  })

  it('splits multi-allelic into two mapped variants', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22', pos: 20002000, id: 'rs456789', ref: 'A', alt: ['G', 'T'],
      qual: 95, filter: 'PASS',
      info: new Map([
        ['CSQ', 'G|missense_variant|MODERATE|COMT|E1|Transcript|T1|protein_coding|||c.1A>G|p.I114V|||||YES|NM_000754.4|0.08|18.5||tolerated(0.3)|benign(0.1),T|missense_variant|MODERATE|COMT|E1|Transcript|T1|protein_coding|||c.1A>T|p.I114F|||||YES|NM_000754.4|0.02|23.7||deleterious(0.02)|possibly_damaging(0.8)']
      ]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['HG005', ['0/1', '95', '50', '25,25,0']],
        ['HG006', ['0/2', '90', '48', '24,0,24']]
      ])
    }

    // HG005 has 0/1: only ALT=G is relevant
    const resultsHG005 = mapVcfRecord(record, header, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)
    expect(resultsHG005).toHaveLength(1)
    expect(resultsHG005[0].alt).toBe('G')

    // HG006 has 0/2: only ALT=T is relevant
    const resultsHG006 = mapVcfRecord(record, header, 'HG006', DEFAULT_INFO_FIELD_MAPPINGS)
    expect(resultsHG006).toHaveLength(1)
    expect(resultsHG006[0].alt).toBe('T')
  })

  it('maps ANN-annotated variant with standalone INFO fields', () => {
    const annHeader: VcfHeader = {
      ...header,
      annotationType: 'ann',
      csqFields: null
    }

    const record: VcfRawRecord = {
      chrom: 'chr22', pos: 20004000, id: 'rs567890', ref: 'T', alt: ['C'],
      qual: 88, filter: 'PASS',
      info: new Map([
        ['ANN', 'C|missense_variant|MODERATE|SNAP29|ENSG00000099940|transcript|ENST00000215730.5|protein_coding|4/7|c.310T>C|p.Ser104Pro|310/1089|310/828|104/275||'],
        ['CLINVAR_CLNSIG', 'Likely_pathogenic'],
        ['dbNSFP_CADD_phred', '26.5'],
        ['dbNSFP_REVEL_score', '0.82']
      ]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([['HG005', ['0/1', '88', '44', '22,22']]])
    }

    const results = mapVcfRecord(record, annHeader, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(1)
    const v = results[0]
    expect(v.gene_symbol).toBe('SNAP29')
    expect(v.clinvar).toBe('Likely_pathogenic')
    expect(v.cadd).toBeCloseTo(26.5, 1)
    expect(v.info_json).not.toBeNull()
    const infoJson = JSON.parse(v.info_json!)
    expect(infoJson['dbNSFP_REVEL_score']).toBe('0.82')
  })

  it('handles unannotated VCF with only core fields', () => {
    const unannotatedHeader: VcfHeader = {
      ...header,
      annotationType: 'none',
      csqFields: null
    }

    const record: VcfRawRecord = {
      chrom: 'chr22', pos: 100, id: null, ref: 'A', alt: ['G'],
      qual: 50, filter: 'PASS',
      info: new Map([['AF', '0.1']]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([['HG005', ['0/1', '50', '20', '10,10']]])
    }

    const results = mapVcfRecord(record, unannotatedHeader, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(1)
    const v = results[0]
    expect(v.chr).toBe('chr22')
    expect(v.gt_num).toBe('0/1')
    expect(v.gene_symbol).toBeNull()
    expect(v.gnomad_af).toBeCloseTo(0.1, 4) // mapped from AF via registry
  })
})
```

### Step 9.2: Implement VcfMapper.ts

- [ ] Create `src/main/import/vcf/VcfMapper.ts`:

```typescript
/**
 * VCF Mapper
 *
 * Orchestrates all VCF parsers to transform VcfRawRecords into VarLens
 * Variant objects ready for the BatchAccumulator.
 */

import type {
  VcfRawRecord,
  VcfHeader,
  VcfMappedVariant,
  InfoFieldMapping
} from './types'
import { splitMultiAllelic } from './vcf-allele-splitter'
import { parseAnnotation } from './vcf-annotation-parser'
import { parseGenotype } from './vcf-genotype-parser'
import { applyInfoFieldRegistry } from './info-field-registry'

/**
 * Map a VcfRawRecord into zero or more VcfMappedVariant objects.
 *
 * Returns zero variants if the selected sample has no ALT allele (0/0 or ./.).
 * Returns one variant for single-allelic sites with a non-ref genotype.
 * Returns multiple variants for multi-allelic sites (one per ALT allele with a non-ref genotype).
 *
 * @param record - Raw VCF record
 * @param header - Parsed VCF header
 * @param sampleName - Which sample to extract genotype for
 * @param registry - INFO field mappings
 * @returns Array of mapped variants (may be empty)
 */
export function mapVcfRecord(
  record: VcfRawRecord,
  header: VcfHeader,
  sampleName: string,
  registry: InfoFieldMapping[]
): VcfMappedVariant[] {
  // Step 1: Split multi-allelic into biallelic records
  const splitRecords = splitMultiAllelic(record, header.infoDefs, header.formatDefs)

  const results: VcfMappedVariant[] = []

  for (let altIdx = 0; altIdx < splitRecords.length; altIdx++) {
    const rec = splitRecords[altIdx]

    // Step 2: Extract genotype for the selected sample
    const sampleValues = rec.samples.get(sampleName)
    if (!sampleValues) continue

    const gtIdx = rec.format.indexOf('GT')
    const gtFieldValue = gtIdx >= 0 && gtIdx < sampleValues.length ? sampleValues[gtIdx] : '.'

    // Skip ref-homozygous (0/0) and no-call (./.)
    if (isRefHomOrNoCall(gtFieldValue)) continue

    // Parse full genotype data (with altAlleleIndex=1 since already split)
    const genotype = parseGenotype(sampleValues, rec.format, 1)

    // Step 3: Parse annotation (CSQ or ANN)
    const altAllele = rec.alt[0]
    const annotation = parseAnnotation(rec.info, header, altAllele)

    // Step 4: Apply INFO field registry
    const infoResult = applyInfoFieldRegistry(rec.info, registry, annotation)

    // Step 5: Assemble the mapped variant
    const variant: VcfMappedVariant = {
      chr: rec.chrom,
      pos: rec.pos,
      ref: rec.ref,
      alt: altAllele,
      gene_symbol: annotation.geneSymbol,
      omim_mim_number: null,
      consequence: annotation.consequence,
      gnomad_af: annotation.gnomadAf ?? (infoResult.mappedValues.get('gnomad_af') as number | null) ?? null,
      cadd: annotation.cadd ?? (infoResult.mappedValues.get('cadd') as number | null) ?? null,
      clinvar: annotation.clinvar ?? (infoResult.mappedValues.get('clinvar') as string | null) ?? null,
      gt_num: genotype.gt,
      func: annotation.impact,
      qual: rec.qual,
      hpo_sim_score: null,
      transcript: annotation.transcript,
      cdna: annotation.cdna,
      aa_change: annotation.aaChange,
      hpo_match: null,
      moi: null,
      gq: genotype.gq,
      dp: genotype.dp,
      ad_ref: genotype.adRef,
      ad_alt: genotype.adAlt,
      ab: genotype.ab,
      filter: rec.filter,
      info_json: infoResult.infoJson ? JSON.stringify(infoResult.infoJson) : null,
      source_format: 'vcf',
      _transcripts: annotation.transcripts.length > 0 ? annotation.transcripts : undefined
    }

    results.push(variant)
  }

  return results
}

/**
 * Check if a GT field value represents ref-homozygous or no-call.
 */
function isRefHomOrNoCall(gt: string): boolean {
  // No-call variants
  if (gt === '.' || gt === './.' || gt === '.|.') return true

  // Split on / or |
  const alleles = gt.split(/[/|]/)

  // All alleles are 0 (ref-homozygous)
  if (alleles.every((a) => a === '0')) return true

  // All alleles are . (no-call)
  if (alleles.every((a) => a === '.')) return true

  return false
}
```

### Step 9.3: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-mapper.test.ts
```

### Step 9.4: Commit

```
feat(vcf): implement VcfMapper to orchestrate VCF parsing pipeline (#42)

Assemble VcfRawRecord -> allele split -> annotation -> genotype ->
INFO registry -> VcfMappedVariant. Skips ref-hom and no-call variants.
Handles CSQ, ANN, and unannotated VCFs with correct priority resolution.
```

---

## Task 10: VcfStrategy + Format Detection

**Depends on:** Task 9

**Files:**
- Create: `src/main/import/vcf/VcfStrategy.ts`
- Modify: `src/main/import/strategies/ImportStrategy.ts`
- Modify: `src/main/import/strategies/index.ts`
- Modify: `src/main/import/format-detection.ts`
- Test: `tests/main/import/vcf/vcf-strategy.test.ts`

### Step 10.1: Write the failing test

- [ ] Create `tests/main/import/vcf/vcf-strategy.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { VcfStrategy } from '../../../../src/main/import/vcf/VcfStrategy'
import { detectFormat } from '../../../../src/main/import/format-detection'
import type { ImportOptions } from '../../../../src/main/import/types'
import type { StrategyContext } from '../../../../src/main/import/strategies/ImportStrategy'

const SYNTHETIC_VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-unit-test.vcf')

describe('VcfStrategy', () => {
  let db: DatabaseService
  const strategy = new VcfStrategy()

  beforeEach(() => {
    db = new DatabaseService(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('has formatId "vcf"', () => {
    expect(strategy.formatId).toBe('vcf')
  })

  it('canHandle returns true for VCF format', () => {
    expect(strategy.canHandle({ format: 'vcf', caseKey: '' })).toBe(true)
  })

  it('canHandle returns false for JSON formats', () => {
    expect(strategy.canHandle({ format: 'columnar', caseKey: 'test' })).toBe(false)
    expect(strategy.canHandle({ format: 'object', caseKey: 'test' })).toBe(false)
    expect(strategy.canHandle({ format: 'simple', caseKey: 'test' })).toBe(false)
  })

  it('imports synthetic VCF for sample HG005', async () => {
    // Create case
    const caseId = db.cases.createCase('test-hg005', SYNTHETIC_VCF, 1000)

    const options: ImportOptions = {
      caseName: 'test-hg005'
    }

    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    const result = await strategy.import(SYNTHETIC_VCF, options, context, {
      selectedSamples: ['HG005'],
      genomeBuild: 'GRCh38'
    })

    expect(result.caseId).toBe(caseId)
    expect(result.variantCount).toBeGreaterThan(0)
    expect(result.errors).toEqual([])

    // Verify variants are in the database
    const variants = db.database.prepare('SELECT * FROM variants WHERE case_id = ?').all(caseId) as Array<Record<string, unknown>>
    expect(variants.length).toBe(result.variantCount)

    // Check that VCF-specific fields are populated
    const firstVariant = variants.find((v) => v.pos === 20000100) as Record<string, unknown> | undefined
    expect(firstVariant).toBeDefined()
    expect(firstVariant!.gt_num).toBe('0/1')
    expect(firstVariant!.gq).toBe(99)
    expect(firstVariant!.source_format).toBe('vcf')
    expect(firstVariant!.filter).toBe('PASS')
  })

  it('skips ref-hom variants for sample HG006', async () => {
    const caseId = db.cases.createCase('test-hg006', SYNTHETIC_VCF, 1000)

    const options: ImportOptions = { caseName: 'test-hg006' }
    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    const result = await strategy.import(SYNTHETIC_VCF, options, context, {
      selectedSamples: ['HG006'],
      genomeBuild: 'GRCh38'
    })

    // HG006 has fewer non-ref variants than HG005
    expect(result.variantCount).toBeGreaterThan(0)
    expect(result.skipped).toBeGreaterThan(0) // Some lines skipped as ref-hom
  })
})

describe('format-detection for VCF', () => {
  it('detects .vcf file as VCF format', async () => {
    const result = await detectFormat(SYNTHETIC_VCF)
    expect(result.format).toBe('vcf')
  })
})
```

### Step 10.2: Update FileFormat type

- [ ] Update `src/main/import/strategies/ImportStrategy.ts`:

```typescript
export type FileFormat = 'columnar' | 'object' | 'simple' | 'vcf'
```

### Step 10.3: Update format-detection.ts to detect VCF

- [ ] In `src/main/import/format-detection.ts`, add VCF detection at the top of `detectFormat()`:

```typescript
import { createReadStream, openSync, readSync, closeSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import type { Readable } from 'node:stream'
import type { FileFormat, FormatInfo } from './strategies/ImportStrategy'
import { createDecompressedStream, isGzipped } from './stream-utils'

/**
 * Check if a file is a VCF file by reading the first line.
 * VCF files start with "##fileformat=VCFv4"
 */
async function isVcfFile(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const raw = createReadStream(filePath, { start: 0, end: 1024 })
    const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw

    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let resolved = false

    rl.on('line', (line: string) => {
      if (!resolved) {
        resolved = true
        rl.close()
        resolve(line.startsWith('##fileformat=VCFv'))
      }
    })

    rl.on('close', () => {
      if (!resolved) {
        resolved = true
        resolve(false)
      }
    })

    rl.on('error', () => {
      if (!resolved) {
        resolved = true
        resolve(false)
      }
    })

    stream.on('error', () => {
      if (!resolved) {
        resolved = true
        resolve(false)
      }
    })
  })
}

export async function detectFormat(filePath: string): Promise<FormatInfo> {
  // Check for VCF first (before JSON detection)
  const ext = filePath.toLowerCase()
  if (ext.endsWith('.vcf') || ext.endsWith('.vcf.gz')) {
    const isVcf = await isVcfFile(filePath)
    if (isVcf) {
      return { format: 'vcf', caseKey: '' }
    }
  }

  // Also check files without VCF extension but with VCF magic line
  if (!ext.endsWith('.json') && !ext.endsWith('.json.gz') && !ext.endsWith('.gz')) {
    const isVcf = await isVcfFile(filePath)
    if (isVcf) {
      return { format: 'vcf', caseKey: '' }
    }
  }

  // Fall through to existing JSON detection...
```

Note: The rest of the existing `detectFormat` function remains unchanged. The VCF check is added as a new code path at the beginning, before the JSON detection logic.

### Step 10.4: Implement VcfStrategy.ts

- [ ] Create `src/main/import/vcf/VcfStrategy.ts`:

```typescript
/**
 * VCF import strategy
 *
 * Implements ImportStrategy for VCF (.vcf, .vcf.gz) files.
 * Streams line-by-line, parses headers, splits alleles, extracts annotations
 * and genotypes, then feeds into the existing BatchAccumulator pipeline.
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { isGzipped } from '../stream-utils'
import type { ImportOptions, ImportResult } from '../types'
import type { ImportStrategy, FormatInfo, StrategyContext } from '../strategies/ImportStrategy'
import type { VcfImportOptions, VcfMappedVariant } from './types'
import { parseVcfHeaderFromLines } from './vcf-header-parser'
import { parseVcfLine } from './vcf-line-parser'
import { mapVcfRecord } from './VcfMapper'
import { DEFAULT_INFO_FIELD_MAPPINGS } from './info-field-registry'

export class VcfStrategy implements ImportStrategy {
  readonly formatId = 'vcf' as const

  canHandle(formatInfo: FormatInfo): boolean {
    return formatInfo.format === 'vcf'
  }

  async import(
    filePath: string,
    options: ImportOptions,
    context: StrategyContext,
    vcfOptions?: VcfImportOptions
  ): Promise<ImportResult> {
    const { db, caseId, startTime } = context
    const batchSize = options.batchSize ?? 5000
    const sampleName = vcfOptions?.selectedSamples?.[0] || ''

    // Read file line by line
    const raw = createReadStream(filePath)
    const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    const headerLines: string[] = []
    let headerParsed = false
    let totalInserted = 0
    let totalSkipped = 0
    const errors: string[] = []

    // Batch buffer
    let batch: VcfMappedVariant[] = []

    // Drop FTS triggers for bulk insert performance
    db.variants.beginBulkInsert()

    try {
      for await (const line of rl) {
        // Check cancellation
        if (options.signal?.aborted) {
          errors.push('Import cancelled by user')
          break
        }

        // Header lines
        if (line.startsWith('#')) {
          headerLines.push(line)
          continue
        }

        // Parse header on first data line
        if (!headerParsed) {
          headerParsed = true
        }

        const header = parseVcfHeaderFromLines(headerLines)

        // Determine sample name if not provided
        const activeSample = sampleName || (header.samples.length > 0 ? header.samples[0] : '')
        if (activeSample === '') {
          errors.push('No sample found in VCF file')
          break
        }

        // Parse the data line
        try {
          const record = parseVcfLine(line, header.samples)
          const mapped = mapVcfRecord(record, header, activeSample, DEFAULT_INFO_FIELD_MAPPINGS)

          if (mapped.length === 0) {
            totalSkipped++
          } else {
            for (const variant of mapped) {
              batch.push(variant)
            }
          }

          // Flush batch when full
          if (batch.length >= batchSize) {
            db.variants.insertBatch(batch, caseId)
            totalInserted += batch.length
            batch = []

            if (options.onProgress) {
              options.onProgress({
                phase: 'inserting',
                count: totalInserted,
                elapsed: Date.now() - startTime,
                skipped: totalSkipped
              })
            }
          }
        } catch (lineError) {
          totalSkipped++
          if (errors.length < 10) {
            errors.push(`Line parse error at pos ${line.substring(0, 50)}: ${lineError}`)
          }
        }
      }

      // Parse header for remaining processing if we haven't yet
      // (handles edge case where file has only headers)

      // Flush remaining batch
      if (batch.length > 0) {
        db.variants.insertBatch(batch, caseId)
        totalInserted += batch.length
        batch = []
      }
    } finally {
      // Always restore FTS triggers and update case
      db.variants.finishBulkInsert(caseId, totalInserted)
    }

    const elapsed = Date.now() - startTime

    return {
      caseId,
      variantCount: totalInserted,
      skipped: totalSkipped,
      errors,
      elapsed
    }
  }
}
```

**Note:** The above implementation has a performance issue: it calls `parseVcfHeaderFromLines` on every data line. Let me fix that.

- [ ] Actually, the correct implementation moves header parsing outside the loop:

```typescript
/**
 * VCF import strategy
 *
 * Implements ImportStrategy for VCF (.vcf, .vcf.gz) files.
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { isGzipped } from '../stream-utils'
import type { ImportOptions, ImportResult } from '../types'
import type { ImportStrategy, FormatInfo, StrategyContext } from '../strategies/ImportStrategy'
import type { VcfImportOptions, VcfMappedVariant, VcfHeader } from './types'
import { parseVcfHeaderFromLines } from './vcf-header-parser'
import { parseVcfLine } from './vcf-line-parser'
import { mapVcfRecord } from './VcfMapper'
import { DEFAULT_INFO_FIELD_MAPPINGS } from './info-field-registry'

export class VcfStrategy implements ImportStrategy {
  readonly formatId = 'vcf' as const

  canHandle(formatInfo: FormatInfo): boolean {
    return formatInfo.format === 'vcf'
  }

  async import(
    filePath: string,
    options: ImportOptions,
    context: StrategyContext,
    vcfOptions?: VcfImportOptions
  ): Promise<ImportResult> {
    const { db, caseId, startTime } = context
    const batchSize = options.batchSize ?? 5000

    // Read file line by line
    const raw = createReadStream(filePath)
    const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    const headerLines: string[] = []
    let header: VcfHeader | null = null
    let activeSample = ''
    let totalInserted = 0
    let totalSkipped = 0
    const errors: string[] = []
    let batch: VcfMappedVariant[] = []

    // Drop FTS triggers for bulk insert performance
    db.variants.beginBulkInsert()

    try {
      for await (const line of rl) {
        // Check cancellation
        if (options.signal?.aborted) {
          errors.push('Import cancelled by user')
          break
        }

        // Collect header lines
        if (line.startsWith('#')) {
          headerLines.push(line)
          continue
        }

        // Parse header once, on the first data line
        if (header === null) {
          header = parseVcfHeaderFromLines(headerLines)
          activeSample = vcfOptions?.selectedSamples?.[0]
            || (header.samples.length > 0 ? header.samples[0] : '')

          if (activeSample === '') {
            errors.push('No sample found in VCF file')
            break
          }
        }

        // Parse the data line
        try {
          const record = parseVcfLine(line, header.samples)
          const mapped = mapVcfRecord(record, header, activeSample, DEFAULT_INFO_FIELD_MAPPINGS)

          if (mapped.length === 0) {
            totalSkipped++
          } else {
            for (const variant of mapped) {
              batch.push(variant)
            }
          }

          // Flush batch when full
          if (batch.length >= batchSize) {
            db.variants.insertBatch(batch, caseId)
            totalInserted += batch.length
            batch = []

            if (options.onProgress) {
              options.onProgress({
                phase: 'inserting',
                count: totalInserted,
                elapsed: Date.now() - startTime,
                skipped: totalSkipped
              })
            }
          }
        } catch (lineError) {
          totalSkipped++
          if (errors.length < 10) {
            errors.push(
              `Line parse error at pos ${line.substring(0, 50)}: ${lineError instanceof Error ? lineError.message : String(lineError)}`
            )
          }
        }
      }

      // Flush remaining batch
      if (batch.length > 0) {
        db.variants.insertBatch(batch, caseId)
        totalInserted += batch.length
      }
    } finally {
      // Always restore FTS triggers and update case
      db.variants.finishBulkInsert(caseId, totalInserted)
    }

    const elapsed = Date.now() - startTime

    return {
      caseId,
      variantCount: totalInserted,
      skipped: totalSkipped,
      errors,
      elapsed
    }
  }
}
```

### Step 10.5: Register VcfStrategy

- [ ] Update `src/main/import/strategies/index.ts`:

```typescript
/**
 * Import strategies - register all strategies on import
 */
export type { ImportStrategy, FormatInfo, StrategyContext, FileFormat } from './ImportStrategy'
export { StrategyRegistry, UnsupportedFormatError, importRegistry } from './StrategyRegistry'

// Import strategies to trigger self-registration
import './ColumnarStrategy'
import './ObjectStrategy'
import './SimpleStrategy'
import '../vcf/VcfStrategy'
```

- [ ] Add self-registration at the bottom of `VcfStrategy.ts`:

```typescript
import { importRegistry } from '../strategies/StrategyRegistry'

// Self-register on import
importRegistry.register(new VcfStrategy())
```

### Step 10.6: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-strategy.test.ts
```

### Step 10.7: Commit

```
feat(vcf): implement VcfStrategy and VCF format detection (#42)

Add VcfStrategy implementing ImportStrategy for .vcf/.vcf.gz files.
Stream line-by-line, parse header once, map variants via VcfMapper,
flush to DB via existing BatchAccumulator pattern. Update format
detection to check for VCF magic line before JSON detection.
Register VcfStrategy in the strategy index.
```

---

## Task 11: Import Worker Integration

**Depends on:** Task 10

**Files:**
- Modify: `src/main/workers/import-worker.ts`
- Modify: `src/shared/types/import-worker.ts`
- Test: `tests/main/import/vcf/vcf-worker-integration.test.ts`

### Step 11.1: Write the failing test

- [ ] Create `tests/main/import/vcf/vcf-worker-integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { VcfStrategy } from '../../../../src/main/import/vcf/VcfStrategy'
import type { ImportOptions } from '../../../../src/main/import/types'
import type { StrategyContext } from '../../../../src/main/import/strategies/ImportStrategy'

const SYNTHETIC_VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-unit-test.vcf')

describe('VCF import worker integration', () => {
  let db: DatabaseService

  beforeEach(() => {
    db = new DatabaseService(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('imports multiple samples sequentially (multi-sample workflow)', async () => {
    const strategy = new VcfStrategy()
    const samples = ['HG005', 'HG006', 'HG007']
    const caseIds: number[] = []
    const variantCounts: number[] = []

    for (const sample of samples) {
      const caseId = db.cases.createCase(`case-${sample}`, SYNTHETIC_VCF, 1000)
      caseIds.push(caseId)

      const options: ImportOptions = { caseName: `case-${sample}` }
      const context: StrategyContext = {
        db,
        formatInfo: { format: 'vcf', caseKey: '' },
        caseId,
        startTime: Date.now()
      }

      const result = await strategy.import(SYNTHETIC_VCF, options, context, {
        selectedSamples: [sample]
      })

      variantCounts.push(result.variantCount)
      expect(result.variantCount).toBeGreaterThan(0)
    }

    // Each sample should have different variant counts (different genotypes)
    // HG005 has the most non-ref variants in the synthetic data
    expect(variantCounts[0]).toBeGreaterThanOrEqual(variantCounts[1])

    // Verify each case has the right variant count in DB
    for (let i = 0; i < samples.length; i++) {
      const count = db.database
        .prepare('SELECT COUNT(*) as cnt FROM variants WHERE case_id = ?')
        .get(caseIds[i]) as { cnt: number }
      expect(count.cnt).toBe(variantCounts[i])
    }
  })

  it('populates variant_transcripts for CSQ-annotated variants', async () => {
    const strategy = new VcfStrategy()
    const caseId = db.cases.createCase('test-transcripts', SYNTHETIC_VCF, 1000)

    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    await strategy.import(SYNTHETIC_VCF, { caseName: 'test-transcripts' }, context, {
      selectedSamples: ['HG005']
    })

    // Check that variant_transcripts were created
    const transcripts = db.database
      .prepare(
        `SELECT vt.* FROM variant_transcripts vt
         JOIN variants v ON vt.variant_id = v.id
         WHERE v.case_id = ?`
      )
      .all(caseId) as Array<Record<string, unknown>>

    expect(transcripts.length).toBeGreaterThan(0)

    // Check that at least one is_selected = 1
    const selectedCount = transcripts.filter((t) => t.is_selected === 1).length
    expect(selectedCount).toBeGreaterThan(0)
  })

  it('handles cancellation via AbortSignal', async () => {
    const strategy = new VcfStrategy()
    const caseId = db.cases.createCase('test-cancel', SYNTHETIC_VCF, 1000)
    const controller = new AbortController()

    // Cancel immediately
    controller.abort()

    const context: StrategyContext = {
      db,
      formatInfo: { format: 'vcf', caseKey: '' },
      caseId,
      startTime: Date.now()
    }

    const result = await strategy.import(
      SYNTHETIC_VCF,
      { caseName: 'test-cancel', signal: controller.signal },
      context,
      { selectedSamples: ['HG005'] }
    )

    // Should complete with 0 variants (cancelled before processing)
    expect(result.errors).toContain('Import cancelled by user')
  })
})
```

### Step 11.2: Update import-worker.ts for VCF support

- [ ] Update `src/shared/types/import-worker.ts` to add VCF import options:

Add the following to the `FileImportRequest` interface:

```typescript
export interface FileImportRequest {
  filePath: string
  caseName: string
  isDuplicate: boolean
  duplicateStrategy: 'skip' | 'overwrite'
  /** VCF-specific: which samples to import */
  vcfSelectedSamples?: string[]
  /** VCF-specific: genome build override */
  vcfGenomeBuild?: string
}
```

- [ ] In `src/main/workers/import-worker.ts`, add VCF-specific import handling. After the existing format detection and pipeline setup, add a VCF code path:

The worker currently handles JSON formats via stream-json pipeline. For VCF, we need to detect the format and delegate to VcfStrategy instead. Add the following check after `detectFormat()`:

```typescript
// After: const formatInfo = await detectFormat(fileReq.filePath)
// Add VCF handling:
if (formatInfo.format === 'vcf') {
  const { VcfStrategy } = await import('../import/vcf/VcfStrategy')
  const strategy = new VcfStrategy()

  // Create VCF import context with raw db access
  // ... (see full implementation in the actual worker file)
}
```

The exact changes to the import worker are complex and depend on the existing worker structure. The key change is: when `formatInfo.format === 'vcf'`, use VcfStrategy directly instead of the JSON pipeline.

### Step 11.3: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-worker-integration.test.ts
```

### Step 11.4: Commit

```
feat(vcf): integrate VCF import with worker thread (#42)

Add VCF-specific fields to FileImportRequest. Import worker detects
VCF format and delegates to VcfStrategy. Multi-sample VCFs create
one case per selected sample via sequential passes.
```

---

## Task 12: VCF Preview IPC

**Depends on:** Task 10

**Files:**
- Modify: `src/main/ipc/handlers/import.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/import/vcf/vcf-preview-ipc.test.ts`

### Step 12.1: Write the failing test

- [ ] Create `tests/main/import/vcf/vcf-preview-ipc.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { getVcfPreview } from '../../../../src/main/import/vcf/vcf-preview'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../../../../src/main/import/vcf/info-field-registry'

const SYNTHETIC_VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-unit-test.vcf')

describe('vcf-preview', () => {
  it('returns preview result for synthetic VCF', async () => {
    const result = await getVcfPreview(SYNTHETIC_VCF)

    expect(result.fileformat).toBe('VCFv4.2')
    expect(result.samples).toEqual(['HG005', 'HG006', 'HG007'])
    expect(result.annotationType).toBe('csq')
    expect(result.detectedGenomeBuild).toBe('GRCh38')
    expect(result.variantCountEstimate).toBeGreaterThan(0)

    // Check INFO field mappings
    expect(result.infoFields).toBeInstanceOf(Array)
    const clinvar = result.infoFields.find((f) => f.id === 'CLINVAR_CLNSIG')
    expect(clinvar).toBeDefined()
    expect(clinvar!.mapsToColumn).toBe('clinvar')

    const revel = result.infoFields.find((f) => f.id === 'dbNSFP_REVEL_score')
    expect(revel).toBeDefined()
    expect(revel!.mapsToColumn).toBeNull() // not in default registry
  })
})
```

### Step 12.2: Implement vcf-preview.ts

- [ ] Create `src/main/import/vcf/vcf-preview.ts`:

```typescript
/**
 * VCF preview — lightweight metadata extraction for the import dialog.
 * Reads only headers + counts data lines without full parsing.
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { isGzipped } from '../stream-utils'
import { parseVcfHeaderFromLines } from './vcf-header-parser'
import { getFieldColumnMapping, DEFAULT_INFO_FIELD_MAPPINGS } from './info-field-registry'
import type { VcfPreviewResult } from './types'

/**
 * Get VCF file preview for the import dialog.
 * Reads headers for metadata and counts data lines for variant estimate.
 */
export async function getVcfPreview(filePath: string): Promise<VcfPreviewResult> {
  return new Promise((resolve, reject) => {
    const raw = createReadStream(filePath)
    const stream = isGzipped(filePath) ? raw.pipe(createGunzip()) : raw

    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    const headerLines: string[] = []
    let dataLineCount = 0
    let resolved = false

    rl.on('line', (line: string) => {
      if (line.startsWith('#')) {
        headerLines.push(line)
      } else {
        dataLineCount++
      }
    })

    rl.on('close', () => {
      if (resolved) return
      resolved = true

      try {
        const header = parseVcfHeaderFromLines(headerLines)
        const infoFields = getFieldColumnMapping(header.infoDefs, DEFAULT_INFO_FIELD_MAPPINGS)

        resolve({
          fileformat: header.fileformat,
          samples: header.samples,
          variantCountEstimate: dataLineCount,
          annotationType: header.annotationType,
          detectedGenomeBuild: header.genomeBuild,
          infoFields
        })
      } catch (error) {
        reject(error)
      }
    })

    rl.on('error', (error) => {
      if (!resolved) {
        resolved = true
        reject(error)
      }
    })

    stream.on('error', (error) => {
      if (!resolved) {
        resolved = true
        reject(error)
      }
    })
  })
}
```

### Step 12.3: Add IPC handler for import:vcfPreview

- [ ] In `src/main/ipc/handlers/import.ts`, add the new handler inside `registerImportHandlers`:

```typescript
  ipcMain.handle('import:vcfPreview', async (_event, filePath: string) => {
    return wrapHandler(async () => {
      const { getVcfPreview } = await import('../../import/vcf/vcf-preview')
      return getVcfPreview(filePath)
    })
  })
```

### Step 12.4: Update file dialog filter to include VCF files

- [ ] In `src/main/ipc/handlers/import.ts`, update the `import:selectFile` handler's dialog filter:

```typescript
filters: [
  { name: 'Variant Files', extensions: ['vcf', 'vcf.gz', 'json', 'json.gz', 'gz'] },
  { name: 'VCF Files', extensions: ['vcf', 'vcf.gz'] },
  { name: 'JSON Files', extensions: ['json', 'json.gz', 'gz'] },
  { name: 'All Files', extensions: ['*'] }
]
```

### Step 12.5: Update preload API

- [ ] In `src/preload/index.ts`, add the vcfPreview method to the import namespace:

```typescript
  import: {
    selectFile: () => ipcRenderer.invoke('import:selectFile'),

    start: (filePath: string, caseName: string) =>
      ipcRenderer.invoke('import:start', filePath, caseName),

    vcfPreview: (filePath: string) =>
      ipcRenderer.invoke('import:vcfPreview', filePath),

    // ... existing methods
  },
```

### Step 12.6: Run the test

```bash
npx vitest run tests/main/import/vcf/vcf-preview-ipc.test.ts
```

### Step 12.7: Commit

```
feat(vcf): add VCF preview IPC channel and file dialog filter (#42)

New import:vcfPreview channel returns file metadata (samples, annotation
type, genome build, INFO field mappings) for the import dialog preview.
File dialog now accepts .vcf and .vcf.gz files alongside JSON.
```

---

## Task 13: Import Wizard VCF Preview UI

**Depends on:** Task 12

**Files:**
- Create: `src/renderer/src/components/import/VcfPreviewStep.vue`
- Modify: `src/renderer/src/components/import/ImportWizard.vue`

### Step 13.1: Create VcfPreviewStep.vue

- [ ] Create `src/renderer/src/components/import/VcfPreviewStep.vue`:

```vue
<template>
  <div>
    <!-- Loading state -->
    <div v-if="loading" class="d-flex justify-center align-center pa-8">
      <v-progress-circular indeterminate color="primary" />
      <span class="ml-3 text-body-2">Analyzing VCF file...</span>
    </div>

    <!-- Error state -->
    <v-alert v-else-if="error" type="error" variant="tonal" class="mb-3">
      {{ error }}
    </v-alert>

    <!-- Preview content -->
    <div v-else-if="preview">
      <!-- File info -->
      <div class="text-caption text-medium-emphasis mb-2">File Information</div>
      <div class="d-flex flex-wrap ga-2 mb-4">
        <v-chip size="small" label variant="tonal" color="primary">
          {{ preview.fileformat }}
        </v-chip>
        <v-chip
          size="small"
          label
          variant="tonal"
          :color="annotationColor"
        >
          {{ annotationLabel }}
        </v-chip>
        <v-chip size="small" label variant="tonal">
          ~{{ preview.variantCountEstimate.toLocaleString() }} variants
        </v-chip>
      </div>

      <!-- Genome build -->
      <v-select
        v-model="selectedGenomeBuild"
        :items="genomeBuildOptions"
        label="Genome Build"
        variant="outlined"
        density="compact"
        class="mb-4"
        hint="Auto-detected from VCF header. Override if incorrect."
        persistent-hint
      />

      <!-- Sample selection -->
      <div class="text-caption text-medium-emphasis mb-2">
        Samples ({{ selectedSamples.length }}/{{ preview.samples.length }} selected)
      </div>
      <div v-if="preview.samples.length === 0" class="text-body-2 text-medium-emphasis mb-4">
        No samples found (sites-only VCF)
      </div>
      <div v-else class="mb-4">
        <div v-for="sample in preview.samples" :key="sample" class="d-flex align-center ga-2 mb-2">
          <v-checkbox
            :model-value="selectedSamples.includes(sample)"
            :label="sample"
            density="compact"
            hide-details
            @update:model-value="toggleSample(sample, $event)"
          />
          <v-text-field
            v-if="selectedSamples.includes(sample)"
            :model-value="caseNames.get(sample) || sample"
            label="Case name"
            variant="outlined"
            density="compact"
            hide-details
            class="flex-grow-1"
            @update:model-value="setCaseName(sample, $event)"
          />
        </div>
      </div>

      <!-- INFO field mappings (collapsible) -->
      <v-expansion-panels variant="accordion" class="mb-4">
        <v-expansion-panel>
          <v-expansion-panel-title class="text-body-2">
            INFO Fields ({{ preview.infoFields.length }})
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-table density="compact">
              <thead>
                <tr>
                  <th class="text-left">Field</th>
                  <th class="text-left">Type</th>
                  <th class="text-left">Maps To</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="field in preview.infoFields" :key="field.id">
                  <td class="text-body-2">{{ field.id }}</td>
                  <td class="text-body-2">{{ field.type }}({{ field.number }})</td>
                  <td>
                    <v-chip
                      v-if="field.mapsToColumn"
                      size="x-small"
                      color="success"
                      variant="tonal"
                      label
                    >
                      {{ field.mapsToColumn }}
                    </v-chip>
                    <v-chip
                      v-else
                      size="x-small"
                      color="grey"
                      variant="tonal"
                      label
                    >
                      info_json
                    </v-chip>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useApiService } from '../../composables/useApiService'
import { logService } from '../../services/LogService'
import type { VcfPreviewResult } from '../../../../main/import/vcf/types'

const props = defineProps<{
  filePath: string
}>()

const emit = defineEmits<{
  'preview-loaded': [preview: VcfPreviewResult]
  'selection-changed': [options: {
    selectedSamples: string[]
    genomeBuild: string
    caseNames: Map<string, string>
  }]
}>()

const { api } = useApiService()

const loading = ref(true)
const error = ref<string | null>(null)
const preview = ref<VcfPreviewResult | null>(null)

const selectedSamples = ref<string[]>([])
const selectedGenomeBuild = ref('GRCh38')
const caseNames = ref(new Map<string, string>())

const genomeBuildOptions = ['GRCh38', 'GRCh37']

const annotationLabel = computed(() => {
  if (!preview.value) return ''
  switch (preview.value.annotationType) {
    case 'csq': return 'VEP (CSQ)'
    case 'ann': return 'SnpEff (ANN)'
    case 'none': return 'Unannotated'
    default: return 'Unknown'
  }
})

const annotationColor = computed(() => {
  if (!preview.value) return 'grey'
  return preview.value.annotationType === 'none' ? 'grey' : 'success'
})

function toggleSample(sample: string, checked: unknown): void {
  if (checked) {
    if (!selectedSamples.value.includes(sample)) {
      selectedSamples.value.push(sample)
      if (!caseNames.value.has(sample)) {
        caseNames.value.set(sample, sample)
      }
    }
  } else {
    selectedSamples.value = selectedSamples.value.filter((s) => s !== sample)
  }
  emitSelection()
}

function setCaseName(sample: string, name: unknown): void {
  caseNames.value.set(sample, String(name))
  emitSelection()
}

function emitSelection(): void {
  emit('selection-changed', {
    selectedSamples: [...selectedSamples.value],
    genomeBuild: selectedGenomeBuild.value,
    caseNames: new Map(caseNames.value)
  })
}

watch(selectedGenomeBuild, () => {
  emitSelection()
})

onMounted(async () => {
  try {
    loading.value = true
    error.value = null

    const result = await api!.import.vcfPreview(props.filePath)
    preview.value = result as VcfPreviewResult

    // Default: select all samples
    selectedSamples.value = [...preview.value.samples]
    for (const sample of preview.value.samples) {
      caseNames.value.set(sample, sample)
    }

    // Set detected genome build
    if (preview.value.detectedGenomeBuild) {
      selectedGenomeBuild.value = preview.value.detectedGenomeBuild
    }

    emit('preview-loaded', preview.value)
    emitSelection()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    logService.error(`VCF preview failed: ${error.value}`, 'VcfPreviewStep')
  } finally {
    loading.value = false
  }
})
</script>
```

### Step 13.2: Update ImportWizard.vue

- [ ] Add VCF preview step to the wizard. The key changes:

1. Add a `vcfPreviewStep` state to track if we're in VCF preview mode
2. Update step labels to include VCF preview when applicable
3. Add the VCF preview step between Source and Review
4. Detect VCF files by extension and route to the VCF preview step

In `ImportWizard.vue`, update the `stepLabels` to be dynamic:

```typescript
const isVcfImport = ref(false)
const vcfFilePath = ref('')
const vcfSelectedSamples = ref<string[]>([])
const vcfGenomeBuild = ref('GRCh38')
const vcfCaseNames = ref(new Map<string, string>())

const stepLabels = computed(() => {
  if (isVcfImport.value) {
    return ['Source', 'VCF Preview', 'Review', 'Import', 'Summary']
  }
  return ['Source', 'Review', 'Import', 'Summary']
})
```

Add the VCF preview step template between step 1 and step 2:

```vue
      <!-- Step 2 (VCF only): VCF Preview -->
      <v-card-text v-else-if="isVcfImport && step === 2">
        <VcfPreviewStep
          :file-path="vcfFilePath"
          @preview-loaded="onVcfPreviewLoaded"
          @selection-changed="onVcfSelectionChanged"
        />
      </v-card-text>
```

Update the source selection to detect VCF files:

```typescript
async function selectSource(mode: ImportMode): Promise<void> {
  // ... existing logic

  // After file selection, check if it's a VCF file
  const filePath = selectedFilePaths.value[0]
  if (filePath && (filePath.endsWith('.vcf') || filePath.endsWith('.vcf.gz'))) {
    isVcfImport.value = true
    vcfFilePath.value = filePath
    step.value = 2 // Go to VCF Preview step
    return
  }

  // ... existing JSON path
}
```

Add event handlers:

```typescript
function onVcfPreviewLoaded(preview: VcfPreviewResult): void {
  // Store preview info for review step
}

function onVcfSelectionChanged(options: {
  selectedSamples: string[]
  genomeBuild: string
  caseNames: Map<string, string>
}): void {
  vcfSelectedSamples.value = options.selectedSamples
  vcfGenomeBuild.value = options.genomeBuild
  vcfCaseNames.value = options.caseNames
}
```

Update navigation buttons to account for the extra step:

```vue
<v-btn
  v-if="isVcfImport && step === 2"
  color="primary"
  variant="flat"
  size="small"
  :disabled="vcfSelectedSamples.length === 0"
  @click="startVcfImport"
>
  Import {{ vcfSelectedSamples.length }} {{ vcfSelectedSamples.length === 1 ? 'sample' : 'samples' }}
</v-btn>
```

Add the VCF import start function:

```typescript
import VcfPreviewStep from './VcfPreviewStep.vue'

async function startVcfImport(): Promise<void> {
  // Transition to progress step
  const progressStep = isVcfImport.value ? 4 : 3
  step.value = progressStep

  // Import each selected sample as a separate case
  for (const sample of vcfSelectedSamples.value) {
    const caseName = vcfCaseNames.value.get(sample) || sample

    try {
      const result = await api!.import.start(vcfFilePath.value, caseName)
      // Handle result...
    } catch (err) {
      // Handle error...
    }
  }

  // Move to summary
  step.value = progressStep + 1
}
```

### Step 13.3: Commit

```
feat(vcf): add VCF preview step to import wizard UI (#42)

New VcfPreviewStep.vue component shows file metadata, annotation type,
genome build selector, per-sample checkboxes with case naming, and
INFO field mapping preview. ImportWizard detects VCF files and routes
to the preview step before import.
```

---

## Summary

This plan implements VCF import across 13 tasks:

| Task | Description | Dependencies | New Files | Modified Files |
|------|-------------|-------------|-----------|----------------|
| 1 | Schema migration v22 + Kysely types | None | 1 test | 5 source files |
| 2 | VCF types and interfaces | None | 1 type file, 1 test | None |
| 3 | VCF header parser | Task 2 | 1 source, 1 test | None |
| 4 | VCF line parser | Task 2 | 1 source, 1 test | None |
| 5 | VCF genotype parser | Task 2 | 1 source, 1 test | None |
| 6 | VCF allele splitter | Task 4 | 1 source, 1 test | None |
| 7 | VCF annotation parser | Task 3 | 1 source, 1 test | None |
| 8 | INFO field registry | Task 2 | 1 source, 1 test | None |
| 9 | VcfMapper orchestrator | Tasks 3-8 | 1 source, 1 test | None |
| 10 | VcfStrategy + detection | Task 9 | 1 source, 1 test | 3 source files |
| 11 | Import worker integration | Task 10 | 1 test | 2 source files |
| 12 | VCF preview IPC | Task 10 | 1 source, 1 test | 2 source files |
| 13 | Import wizard VCF preview UI | Task 12 | 1 Vue component | 1 Vue component |

**Total: 10 new source files, 11 test files, ~11 modified files**

All code follows existing patterns (ImportStrategy, BatchAccumulator, Kysely types, Vitest).
All tests can be run with `npm run rebuild:node && npx vitest run tests/main/import/vcf/`.
