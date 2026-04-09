# Multi-Variant Type Import — Phases 1-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SV/CNV/STR import support with import-time BED/quality filtering, targeting ONT wf-human-variation pipeline output.

**Architecture:** Extend the existing VCF import pipeline with variant-type routing and extension tables. New modules (BED filter, caller detector, type detector, extension parsers) plug into the existing VcfStrategy streaming loop. Schema migration adds extension tables + new variant columns. Cohort summary rebuild updated for variant_type + genome_build grouping.

**Tech Stack:** TypeScript, better-sqlite3-multiple-ciphers, Kysely (query builder), Vitest (tests), existing VCF parser pipeline.

**Spec:** `.planning/specs/2026-04-09-multi-variant-type-import-design.md`

**Test data:** ONT P2 adaptive sampling files at `/home/bernt-popp/Downloads/OneDrive_1_4-9-2026/` — `wf_sv.vcf.gz` (319 SVs, Sniffles2), `wf_cnv.vcf.gz` (101 CNVs, Spectre), `wf_str.vcf.gz` (16 STRs, Straglr)

---

## File Inventory

### New Files

| File | Responsibility |
|---|---|
| `src/main/import/vcf/bed-filter.ts` | BED region interval loading + O(log n) overlap check |
| `src/main/import/vcf/import-filters.ts` | ImportFilters type definition |
| `src/main/import/vcf/variant-type-detector.ts` | Detect variant_type from VCF record content |
| `src/main/import/vcf/caller-detector.ts` | Detect caller from VCF header, provide smart defaults |
| `src/main/import/vcf/extension-parsers.ts` | Extract SV/CNV/STR fields into extension table rows |
| `tests/import/vcf/bed-filter.test.ts` | BED filter unit tests |
| `tests/import/vcf/variant-type-detector.test.ts` | Variant type detection unit tests |
| `tests/import/vcf/caller-detector.test.ts` | Caller detection unit tests |
| `tests/import/vcf/extension-parsers.test.ts` | Extension parser unit tests |
| `tests/import/vcf/import-filters-integration.test.ts` | Integration tests for filtered import |
| `tests/test-data/vcf/synthetic-sv.vcf` | Synthetic SV test VCF |
| `tests/test-data/vcf/synthetic-cnv.vcf` | Synthetic CNV test VCF |
| `tests/test-data/vcf/synthetic-str.vcf` | Synthetic STR test VCF |
| `tests/test-data/vcf/test-regions.bed` | Synthetic BED file for filter tests |

### Modified Files

| File | Change |
|---|---|
| `src/main/database/migrations.ts` | New migration v25: extension tables, case_import_files, variant columns |
| `src/shared/types/database-schema.ts` | Kysely types for new tables |
| `src/shared/types/database.ts` | Variant, CaseImportFile interfaces |
| `src/main/import/vcf/types.ts` | Extended VcfMappedVariant, extension row types |
| `src/main/import/vcf/VcfMapper.ts` | Route variant_type, attach extension rows |
| `src/main/import/vcf/VcfStrategy.ts` | Import filter gates in streaming loop |
| `src/main/import/vcf/vcf-header-parser.ts` | Enhanced genome build detection |
| `src/main/database/VariantRepository.ts` | Extended insertBatch for extension tables |
| `src/main/database/CaseRepository.ts` | case_import_files insert/query |
| `src/main/workers/import-pipeline.ts` | Extension table insert statements |
| `src/shared/sql/cohort-summary-rebuild.ts` | variant_type + genome_build in GROUP BY |

---

## Task 1: Synthetic Test Data Files

**Files:**
- Create: `tests/test-data/vcf/synthetic-sv.vcf`
- Create: `tests/test-data/vcf/synthetic-cnv.vcf`
- Create: `tests/test-data/vcf/synthetic-str.vcf`
- Create: `tests/test-data/vcf/test-regions.bed`

These test files are used by all subsequent tasks. Create them first.

- [ ] **Step 1: Create synthetic SV VCF (Sniffles2-like)**

```
tests/test-data/vcf/synthetic-sv.vcf
```

```vcf
##fileformat=VCFv4.2
##source=Sniffles2_2.6.3
##contig=<ID=chr1,length=248956422>
##contig=<ID=chr2,length=242193529>
##contig=<ID=chr22,length=50818468>
##ALT=<ID=INS,Description="Insertion">
##ALT=<ID=DEL,Description="Deletion">
##ALT=<ID=DUP,Description="Duplication">
##ALT=<ID=INV,Description="Inversion">
##ALT=<ID=BND,Description="Breakend; Translocation">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype quality">
##FORMAT=<ID=DR,Number=1,Type=Integer,Description="Number of reference reads">
##FORMAT=<ID=DV,Number=1,Type=Integer,Description="Number of variant reads">
##FORMAT=<ID=PS,Number=1,Type=Integer,Description="Phase-block">
##FORMAT=<ID=ID,Number=1,Type=String,Description="Individual SV ID">
##FILTER=<ID=GT,Description="Genotype filter">
##FILTER=<ID=SUPPORT_MIN,Description="Minimum read support">
##INFO=<ID=PRECISE,Number=0,Type=Flag,Description="Precise breakpoints">
##INFO=<ID=IMPRECISE,Number=0,Type=Flag,Description="Imprecise breakpoints">
##INFO=<ID=SVTYPE,Number=1,Type=String,Description="Type of structural variant">
##INFO=<ID=SVLEN,Number=1,Type=Integer,Description="Length of the SV">
##INFO=<ID=END,Number=1,Type=Integer,Description="End position">
##INFO=<ID=SUPPORT,Number=1,Type=Integer,Description="Number of reads supporting the SV">
##INFO=<ID=COVERAGE,Number=.,Type=Float,Description="Coverage near breakpoints">
##INFO=<ID=STRAND,Number=1,Type=String,Description="Strand of SV">
##INFO=<ID=STDEV_LEN,Number=1,Type=Float,Description="Std dev of SV length">
##INFO=<ID=STDEV_POS,Number=1,Type=Float,Description="Std dev of SV position">
##INFO=<ID=VAF,Number=1,Type=Float,Description="Variant allele fraction">
##INFO=<ID=ANN,Number=.,Type=String,Description="Functional annotations: 'Allele | Annotation | Annotation_Impact | Gene_Name | Gene_ID | Feature_Type | Feature_ID | Transcript_BioType | Rank | HGVS.c | HGVS.p | cDNA.pos / cDNA.length | CDS.pos / CDS.length | AA.pos / AA.length | Distance | ERRORS / WARNINGS / INFO' ">
#CHROM	POS	ID	REF	ALT	QUAL	FILTER	INFO	FORMAT	SAMPLE1
chr1	1000000	Sniffles2.DEL.1	N	<DEL>	60	PASS	PRECISE;SVTYPE=DEL;SVLEN=-5000;END=1005000;SUPPORT=15;COVERAGE=20,18,22,19,21;STRAND=+-;STDEV_LEN=10.5;STDEV_POS=3.2;VAF=0.75;ANN=<DEL>|exon_loss_variant|HIGH|GENE1|GENE1|transcript|NM_001.1|protein_coding|3/10|c.100_500del||||||	GT:GQ:DR:DV:PS:ID	0/1:40:5:15:1000000:Sniffles2.DEL.1
chr1	2000000	Sniffles2.INS.2	C	CAAAAAAAAAA	45	PASS	PRECISE;SVTYPE=INS;SVLEN=10;END=2000000;SUPPORT=12;COVERAGE=15,14,16;STRAND=+;STDEV_LEN=1.5;STDEV_POS=0;VAF=0.6	GT:GQ:DR:DV:PS:ID	1/1:50:0:12:0:Sniffles2.INS.2
chr22	29000000	Sniffles2.DUP.3	N	<DUP>	30	PASS	IMPRECISE;SVTYPE=DUP;SVLEN=20000;END=29020000;SUPPORT=8;COVERAGE=10,25,12;STRAND=+;STDEV_LEN=50.0;STDEV_POS=100.0;VAF=0.4	GT:GQ:DR:DV:PS:ID	0/1:20:12:8:0:Sniffles2.DUP.3
chr2	5000000	Sniffles2.INV.4	N	<INV>	15	SUPPORT_MIN	IMPRECISE;SVTYPE=INV;SVLEN=8000;END=5008000;SUPPORT=3;COVERAGE=5,4,6;STRAND=++;STDEV_LEN=200.0;STDEV_POS=150.0;VAF=0.2	GT:GQ:DR:DV:PS:ID	0/1:5:12:3:0:Sniffles2.INV.4
chr1	9000000	Sniffles2.BND.5	N	]chr2:3000000]N	20	PASS	PRECISE;SVTYPE=BND;SUPPORT=10;STRAND=+-;VAF=0.5	GT:GQ:DR:DV:PS:ID	0/1:30:10:10:0:Sniffles2.BND.5
```

- [ ] **Step 2: Create synthetic CNV VCF (Spectre-like)**

```
tests/test-data/vcf/synthetic-cnv.vcf
```

```vcf
##fileformat=VCFv4.2
##source=Spectre
##contig=<ID=chr1,length=248956422>
##contig=<ID=chr22,length=50818468>
##ALT=<ID=DEL,Description="Deletion">
##ALT=<ID=DUP,Description="Duplication">
##INFO=<ID=END,Number=1,Type=Integer,Description="End position">
##INFO=<ID=SVLEN,Number=1,Type=Integer,Description="Length of the SV">
##INFO=<ID=SVTYPE,Number=1,Type=String,Description="Type of CNV">
##INFO=<ID=CN,Number=1,Type=Integer,Description="Copy number">
##INFO=<ID=ANN,Number=.,Type=String,Description="Functional annotations: 'Allele | Annotation | Annotation_Impact | Gene_Name | Gene_ID | Feature_Type | Feature_ID | Transcript_BioType | Rank | HGVS.c | HGVS.p | cDNA.pos / cDNA.length | CDS.pos / CDS.length | AA.pos / AA.length | Distance | ERRORS / WARNINGS / INFO' ">
##INFO=<ID=CLNSIG,Number=.,Type=String,Description="ClinVar significance">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
##FORMAT=<ID=HO,Number=2,Type=Float,Description="Homozygosity proportion">
##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype quality">
##FORMAT=<ID=CN,Number=1,Type=Integer,Description="Copy number">
##FORMAT=<ID=ID,Number=1,Type=String,Description="Population ID">
##PredictedSexChromosomeKaryotype=XX
#CHROM	POS	ID	REF	ALT	QUAL	FILTER	INFO	FORMAT	SAMPLE1
chr1	5000000	Spectre.DEL.1	N	<DEL>	.	PASS	END=5500000;SVLEN=500000;SVTYPE=DEL;CN=1;ANN=<DEL>|exon_loss_variant|HIGH|GENE_A|GENE_A|transcript|NM_002.1|protein_coding|2/5|c.50_300del||||||;CLNSIG=Pathogenic	GT:HO:GQ:CN:ID	0/1:0.45,0.55:30:1:Spectre.DEL.1
chr1	10000000	Spectre.DUP.2	N	<DUP>	.	PASS	END=10200000;SVLEN=200000;SVTYPE=DUP;CN=3;ANN=<DUP>|duplication|MODERATE|GENE_B|GENE_B|transcript|NM_003.1|protein_coding|1/8|c.-5000_*10000dup||||||	GT:HO:GQ:CN:ID	0/1:0.3,0.7:25:3:Spectre.DUP.2
chr22	29500000	Spectre.DEL.3	N	<DEL>	.	PASS	END=29600000;SVLEN=100000;SVTYPE=DEL;CN=0	GT:HO:GQ:CN:ID	1/1:0.0,1.0:40:0:Spectre.DEL.3
```

- [ ] **Step 3: Create synthetic STR VCF (Straglr-like)**

```
tests/test-data/vcf/synthetic-str.vcf
```

```vcf
##fileformat=VCFv4.1
##source=strglr_1.4.5
##reference=file://GRCh38.fasta
##contig=<ID=chr1,length=248956422>
##contig=<ID=chr14,length=107043718>
##contig=<ID=chr21,length=46709983>
##INFO=<ID=END,Number=1,Type=Integer,Description="End position">
##INFO=<ID=REF,Number=1,Type=Integer,Description="Reference copy number">
##INFO=<ID=REPID,Number=1,Type=String,Description="Repeat identifier">
##INFO=<ID=VARID,Number=1,Type=String,Description="Variant identifier">
##INFO=<ID=RL,Number=1,Type=Integer,Description="Reference length in bp">
##INFO=<ID=RU,Number=1,Type=String,Description="Repeat unit">
##INFO=<ID=SVTYPE,Number=1,Type=String,Description="Type of structural variant">
##INFO=<ID=STR_STATUS,Number=A,Type=String,Description="Repeat expansion status">
##INFO=<ID=STR_NORMAL_MAX,Number=1,Type=Integer,Description="Max normal repeats">
##INFO=<ID=STR_PATHOLOGIC_MIN,Number=1,Type=Integer,Description="Min pathologic repeats">
##INFO=<ID=Disease,Number=1,Type=String,Description="Associated disorder">
##INFO=<ID=InheritanceMode,Number=1,Type=String,Description="Mode of inheritance">
##INFO=<ID=DisplayRU,Number=1,Type=String,Description="Display repeat unit">
##INFO=<ID=HGNCId,Number=1,Type=Integer,Description="HGNC gene id">
##INFO=<ID=RankScore,Number=1,Type=String,Description="Rank score">
##INFO=<ID=SourceDisplay,Number=1,Type=String,Description="Source display">
##INFO=<ID=Source,Number=1,Type=String,Description="Source">
##INFO=<ID=SourceId,Number=1,Type=String,Description="Source id">
##FILTER=<ID=LowDepth,Description="Low depth">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
##FORMAT=<ID=SO,Number=1,Type=String,Description="Support type">
##FORMAT=<ID=REPCN,Number=1,Type=String,Description="Repeat copy number">
##FORMAT=<ID=REPCI,Number=1,Type=String,Description="Confidence interval">
##FORMAT=<ID=ADSP,Number=1,Type=String,Description="Spanning reads">
##FORMAT=<ID=ADFL,Number=1,Type=String,Description="Flanking reads">
##FORMAT=<ID=ADIR,Number=1,Type=String,Description="In-repeat reads">
##FORMAT=<ID=LC,Number=1,Type=Float,Description="Locus coverage">
##ALT=<ID=STR24,Description="Allele of 24 repeat units">
##ALT=<ID=STR15,Description="Allele of 15 repeat units">
##ALT=<ID=STR17,Description="Allele of 17 repeat units">
##ALT=<ID=STR50,Description="Allele of 50 repeat units">
#CHROM	POS	ID	REF	ALT	QUAL	FILTER	INFO	FORMAT	SAMPLE1
chr14	92071010	.	C	<STR24>,<STR15>	.	PASS	SVTYPE=DUP;END=92071042;REF=11;RL=33;RU=CTG;REPID=ATXN3;VARID=ATXN3;STR_STATUS=normal,normal;STR_NORMAL_MAX=44;STR_PATHOLOGIC_MIN=60;RankScore=1:10;HGNCId=7106;InheritanceMode=AD;DisplayRU=CAG;SourceDisplay=GeneReviews;Source=GeneReviews;SourceId=NBK535148;Disease=MJD	GT:SO:REPCN:REPCI:ADSP:ADFL:ADIR:LC	1/2:SPANNING/SPANNING:24/15:24-24/15-15:1/1:0/0:0/0:3
chr21	43776444	.	C	<STR50>	.	PASS	SVTYPE=DUP;END=43776479;REF=5;RL=36;RU=GCGGGGC;REPID=CSTB;VARID=CSTB;STR_STATUS=full_mutation;STR_NORMAL_MAX=3;STR_PATHOLOGIC_MIN=30;RankScore=1:20;HGNCId=2482;InheritanceMode=AR;DisplayRU=CCCCGCCCCGCG;SourceDisplay=GeneReviews;Source=GeneReviews;SourceId=NBK535148;Disease=EPM1	GT:SO:REPCN:REPCI:ADSP:ADFL:ADIR:LC	1/1:SPANNING/SPANNING:50/50:48-52/48-52:5/5:0/0:0/0:12
chr1	149390803	.	G	<STR17>	.	LowDepth	SVTYPE=DUP;END=149390841;REF=13;RL=39;RU=GGC;REPID=NOTCH2NLC;VARID=NOTCH2NLC;STR_STATUS=normal;STR_NORMAL_MAX=38;STR_PATHOLOGIC_MIN=66;RankScore=1:10;HGNCId=53924;InheritanceMode=AD;DisplayRU=CGG;SourceDisplay=GeneReviews;Source=GeneReviews;SourceId=NBK535148;Disease=NIID	GT:SO:REPCN:REPCI:ADSP:ADFL:ADIR:LC	1/1:SPANNING/SPANNING:17/17:17-17/17-17:0.5/0.5:0/0:0/0:2
```

- [ ] **Step 4: Create test BED file**

```
tests/test-data/vcf/test-regions.bed
```

```bed
chr1	999000	1010000
chr1	5000000	5600000
chr22	29000000	29100000
chr22	29400000	29700000
```

- [ ] **Step 5: Commit test data**

```bash
git add tests/test-data/vcf/synthetic-sv.vcf tests/test-data/vcf/synthetic-cnv.vcf tests/test-data/vcf/synthetic-str.vcf tests/test-data/vcf/test-regions.bed
git commit -m "test: add synthetic SV/CNV/STR VCF and BED test data for multi-variant type import"
```

---

## Task 2: BED Region Filter Module

**Files:**
- Create: `src/main/import/vcf/bed-filter.ts`
- Test: `tests/import/vcf/bed-filter.test.ts`

- [ ] **Step 1: Write failing tests for BED filter**

```typescript
// tests/import/vcf/bed-filter.test.ts
import { describe, it, expect } from 'vitest'
import { BedFilter } from '../../../src/main/import/vcf/bed-filter'
import path from 'path'

const BED_PATH = path.join(__dirname, '../../test-data/vcf/test-regions.bed')

describe('BedFilter', () => {
  describe('loadFromFile', () => {
    it('loads intervals from a BED file', () => {
      const filter = BedFilter.fromFile(BED_PATH, 0)
      expect(filter.intervalCount()).toBe(4)
    })

    it('applies padding to intervals', () => {
      const filter = BedFilter.fromFile(BED_PATH, 100)
      // chr1:999000-1010000 with ±100 → 998900-1010100
      expect(filter.contains('chr1', 998950)).toBe(true)
      expect(filter.contains('chr1', 998850)).toBe(false)
    })
  })

  describe('contains (point query)', () => {
    const filter = BedFilter.fromFile(BED_PATH, 0)

    it('returns true for position inside interval', () => {
      expect(filter.contains('chr1', 1000000)).toBe(true)
    })

    it('returns false for position outside all intervals', () => {
      expect(filter.contains('chr1', 2000000)).toBe(false)
    })

    it('returns true at interval start (inclusive)', () => {
      // BED is 0-based half-open, convert to 1-based: start+1
      expect(filter.contains('chr1', 999001)).toBe(true)
    })

    it('returns true at interval end (inclusive, 1-based)', () => {
      expect(filter.contains('chr1', 1010000)).toBe(true)
    })

    it('returns false for unknown chromosome', () => {
      expect(filter.contains('chr99', 1000000)).toBe(false)
    })
  })

  describe('containsRange (interval query for SV/CNV)', () => {
    const filter = BedFilter.fromFile(BED_PATH, 0)

    it('returns true when SV overlaps a BED region', () => {
      // SV at chr1:990000-1005000 overlaps chr1:999000-1010000
      expect(filter.containsRange('chr1', 990000, 1005000)).toBe(true)
    })

    it('returns false when SV is entirely outside', () => {
      expect(filter.containsRange('chr1', 2000000, 2100000)).toBe(false)
    })

    it('returns true when SV fully contains a BED region', () => {
      expect(filter.containsRange('chr1', 900000, 1100000)).toBe(true)
    })
  })

  describe('empty filter', () => {
    it('contains() always returns true when no BED loaded', () => {
      const filter = BedFilter.empty()
      expect(filter.contains('chr1', 12345)).toBe(true)
      expect(filter.containsRange('chr1', 100, 200)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/import/vcf/bed-filter.test.ts`
Expected: FAIL — module `bed-filter` not found

- [ ] **Step 3: Implement BED filter**

```typescript
// src/main/import/vcf/bed-filter.ts
import { readFileSync } from 'fs'
import { createGunzip } from 'zlib'
import { createReadStream } from 'fs'

interface Interval {
  start: number // 1-based inclusive
  end: number   // 1-based inclusive
}

/**
 * BED region filter with O(log n) overlap check per query.
 * BED format is 0-based half-open; internally stored as 1-based inclusive.
 */
export class BedFilter {
  private intervals: Map<string, Interval[]>
  private isEmpty: boolean

  private constructor(intervals: Map<string, Interval[]>, isEmpty: boolean) {
    this.intervals = intervals
    this.isEmpty = isEmpty
  }

  /** Create an empty filter that passes everything through */
  static empty(): BedFilter {
    return new BedFilter(new Map(), true)
  }

  /** Load intervals from a .bed or .bed.gz file with optional padding */
  static fromFile(filePath: string, padding: number): BedFilter {
    const content = filePath.endsWith('.gz')
      ? require('zlib').gunzipSync(readFileSync(filePath)).toString('utf-8')
      : readFileSync(filePath, 'utf-8')

    const intervals = new Map<string, Interval[]>()

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('track') || trimmed.startsWith('browser')) {
        continue
      }
      const parts = trimmed.split('\t')
      if (parts.length < 3) continue

      const chr = parts[0]
      // BED is 0-based half-open → convert to 1-based inclusive with padding
      const start = Math.max(1, parseInt(parts[1], 10) + 1 - padding)
      const end = parseInt(parts[2], 10) + padding

      if (!intervals.has(chr)) {
        intervals.set(chr, [])
      }
      intervals.get(chr)!.push({ start, end })
    }

    // Sort and merge overlapping intervals per chromosome
    for (const [chr, ivs] of intervals) {
      ivs.sort((a, b) => a.start - b.start || a.end - b.end)
      const merged: Interval[] = []
      for (const iv of ivs) {
        if (merged.length > 0 && iv.start <= merged[merged.length - 1].end + 1) {
          merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end)
        } else {
          merged.push({ ...iv })
        }
      }
      intervals.set(chr, merged)
    }

    return new BedFilter(intervals, false)
  }

  /** Total number of intervals loaded */
  intervalCount(): number {
    let count = 0
    for (const ivs of this.intervals.values()) {
      count += ivs.length
    }
    return count
  }

  /** Check if a 1-based position falls within any interval on this chromosome */
  contains(chr: string, pos: number): boolean {
    if (this.isEmpty) return true
    const ivs = this.intervals.get(chr)
    if (!ivs || ivs.length === 0) return false
    return this.binarySearchContains(ivs, pos)
  }

  /** Check if a range [start, end] (1-based inclusive) overlaps any interval */
  containsRange(chr: string, start: number, end: number): boolean {
    if (this.isEmpty) return true
    const ivs = this.intervals.get(chr)
    if (!ivs || ivs.length === 0) return false
    return this.binarySearchOverlaps(ivs, start, end)
  }

  private binarySearchContains(ivs: Interval[], pos: number): boolean {
    let lo = 0
    let hi = ivs.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (pos < ivs[mid].start) {
        hi = mid - 1
      } else if (pos > ivs[mid].end) {
        lo = mid + 1
      } else {
        return true
      }
    }
    return false
  }

  private binarySearchOverlaps(ivs: Interval[], start: number, end: number): boolean {
    // Find the first interval whose end >= start
    let lo = 0
    let hi = ivs.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (ivs[mid].end < start) {
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    // Check if this interval overlaps
    if (lo < ivs.length && ivs[lo].start <= end) {
      return true
    }
    return false
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/import/vcf/bed-filter.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/import/vcf/bed-filter.ts tests/import/vcf/bed-filter.test.ts
git commit -m "feat: add BED region filter module for import-time variant filtering"
```

---

## Task 3: Import Filters Type + Variant Type Detector

**Files:**
- Create: `src/main/import/vcf/import-filters.ts`
- Create: `src/main/import/vcf/variant-type-detector.ts`
- Test: `tests/import/vcf/variant-type-detector.test.ts`

- [ ] **Step 1: Create ImportFilters type**

```typescript
// src/main/import/vcf/import-filters.ts
import type { BedFilter } from './bed-filter'

/** Variant type discriminator */
export type VariantType = 'snv' | 'indel' | 'sv' | 'cnv' | 'str'

/** Import-time filters applied during VCF streaming */
export interface ImportFilters {
  bedFilter?: BedFilter
  bedPadding: number
  passOnly: boolean
  minQual: number | null
  minGq: number | null
  minDp: number | null
}

/** Default import filters — no filtering */
export const DEFAULT_IMPORT_FILTERS: ImportFilters = {
  bedPadding: 50,
  passOnly: false,
  minQual: null,
  minGq: null,
  minDp: null
}
```

- [ ] **Step 2: Write failing tests for variant type detector**

```typescript
// tests/import/vcf/variant-type-detector.test.ts
import { describe, it, expect } from 'vitest'
import { detectVariantType } from '../../../src/main/import/vcf/variant-type-detector'

describe('detectVariantType', () => {
  it('detects SNV from single-base REF/ALT', () => {
    expect(detectVariantType('A', 'T', new Map(), null)).toBe('snv')
  })

  it('detects indel from length difference', () => {
    expect(detectVariantType('AT', 'A', new Map(), null)).toBe('indel')
    expect(detectVariantType('A', 'ATG', new Map(), null)).toBe('indel')
  })

  it('detects SV from <DEL> symbolic ALT', () => {
    expect(detectVariantType('N', '<DEL>', new Map([['SVTYPE', 'DEL']]), null)).toBe('sv')
  })

  it('detects SV from <INS>', () => {
    expect(detectVariantType('N', '<INS>', new Map([['SVTYPE', 'INS']]), null)).toBe('sv')
  })

  it('detects SV from <INV>', () => {
    expect(detectVariantType('N', '<INV>', new Map([['SVTYPE', 'INV']]), null)).toBe('sv')
  })

  it('detects SV from breakend notation', () => {
    expect(detectVariantType('N', ']chr2:3000000]N', new Map([['SVTYPE', 'BND']]), null)).toBe('sv')
  })

  it('detects CNV from <DEL> when caller is Spectre', () => {
    expect(detectVariantType('N', '<DEL>', new Map([['SVTYPE', 'DEL']]), 'Spectre')).toBe('cnv')
  })

  it('detects CNV from <DUP> when caller is Spectre', () => {
    expect(detectVariantType('N', '<DUP>', new Map([['SVTYPE', 'DUP']]), 'Spectre')).toBe('cnv')
  })

  it('detects CNV from <CNV> symbolic ALT', () => {
    expect(detectVariantType('N', '<CNV>', new Map([['SVTYPE', 'CNV']]), null)).toBe('cnv')
  })

  it('detects STR from <STR*> symbolic ALT', () => {
    expect(detectVariantType('C', '<STR24>', new Map([['SVTYPE', 'DUP']]), null)).toBe('str')
  })

  it('detects STR from SVTYPE=STR', () => {
    expect(detectVariantType('N', '<DUP>', new Map([['SVTYPE', 'STR']]), null)).toBe('str')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/import/vcf/variant-type-detector.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement variant type detector**

```typescript
// src/main/import/vcf/variant-type-detector.ts
import type { VariantType } from './import-filters'

/**
 * Detect variant type from VCF record content.
 *
 * @param ref - REF allele
 * @param alt - Single ALT allele (already split from multi-allelic)
 * @param info - INFO field map
 * @param callerName - Detected caller name (null if unknown)
 */
export function detectVariantType(
  ref: string,
  alt: string,
  info: Map<string, string>,
  callerName: string | null
): VariantType {
  const svtype = info.get('SVTYPE')

  // Symbolic ALT alleles
  if (alt.startsWith('<')) {
    // STR: <STRn> symbolic or SVTYPE=STR
    if (alt.startsWith('<STR') || svtype === 'STR') return 'str'

    // CNV: <CNV> symbolic or SVTYPE=CNV
    if (alt.startsWith('<CNV') || svtype === 'CNV') return 'cnv'

    // DEL/DUP: caller disambiguates CNV vs SV
    if (alt === '<DEL>' || alt === '<DUP>') {
      const cnvCallers = ['Spectre', 'DRAGEN_CNV', 'CNVkit', 'ExomeDepth', 'GATK_gCNV']
      if (callerName && cnvCallers.some((c) => callerName.includes(c))) {
        return 'cnv'
      }
      return 'sv'
    }

    // Other symbolic: INS, INV, BND
    return 'sv'
  }

  // Breakend notation
  if (alt.includes('[') || alt.includes(']')) return 'sv'

  // Sequence ALT: SNV vs indel
  if (ref.length === 1 && alt.length === 1) return 'snv'
  return 'indel'
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/import/vcf/variant-type-detector.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/import/vcf/import-filters.ts src/main/import/vcf/variant-type-detector.ts tests/import/vcf/variant-type-detector.test.ts
git commit -m "feat: add import filters type and variant type detector"
```

---

## Task 4: Caller Detector

**Files:**
- Create: `src/main/import/vcf/caller-detector.ts`
- Test: `tests/import/vcf/caller-detector.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/import/vcf/caller-detector.test.ts
import { describe, it, expect } from 'vitest'
import { detectCaller } from '../../../src/main/import/vcf/caller-detector'

describe('detectCaller', () => {
  it('detects Sniffles2 with version', () => {
    const result = detectCaller(['##source=Sniffles2_2.6.3'])
    expect(result.name).toBe('Sniffles2')
    expect(result.version).toBe('2.6.3')
    expect(result.defaultVariantType).toBe('sv')
  })

  it('detects Spectre', () => {
    const result = detectCaller(['##source=Spectre'])
    expect(result.name).toBe('Spectre')
    expect(result.defaultVariantType).toBe('cnv')
    expect(result.defaultFilters.passOnly).toBe(false)
  })

  it('detects Straglr', () => {
    const result = detectCaller(['##source=strglr_1.4.5'])
    expect(result.name).toBe('Straglr')
    expect(result.defaultVariantType).toBe('str')
  })

  it('detects Clair3 with quality default', () => {
    const result = detectCaller(['##source=Clair3'])
    expect(result.name).toBe('Clair3')
    expect(result.defaultFilters.passOnly).toBe(true)
    expect(result.defaultFilters.minQual).toBe(2)
  })

  it('detects DRAGEN', () => {
    const result = detectCaller(['##source=DRAGEN_CNV'])
    expect(result.name).toBe('DRAGEN')
  })

  it('returns unknown for unrecognized caller', () => {
    const result = detectCaller(['##source=UnknownTool'])
    expect(result.name).toBe('unknown')
    expect(result.defaultFilters.passOnly).toBe(false)
  })

  it('handles missing ##source line', () => {
    const result = detectCaller(['##fileformat=VCFv4.2', '##contig=<ID=chr1>'])
    expect(result.name).toBe('unknown')
  })

  it('detects caller from ##command line as fallback', () => {
    const result = detectCaller([
      '##fileformat=VCFv4.2',
      '##command="/opt/bin/sniffles --input sample.bam"'
    ])
    expect(result.name).toBe('Sniffles2')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/import/vcf/caller-detector.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement caller detector**

```typescript
// src/main/import/vcf/caller-detector.ts
import type { VariantType, ImportFilters } from './import-filters'

export interface CallerInfo {
  name: string
  version: string | null
  defaultVariantType: VariantType
  defaultFilters: Partial<ImportFilters>
}

interface CallerPattern {
  pattern: RegExp
  name: string
  defaultVariantType: VariantType
  defaultFilters: Partial<ImportFilters>
}

const CALLER_PATTERNS: CallerPattern[] = [
  {
    pattern: /[Ss]niffles2?[_ ]?([\d.]+)?/,
    name: 'Sniffles2',
    defaultVariantType: 'sv',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /Spectre/i,
    name: 'Spectre',
    defaultVariantType: 'cnv',
    defaultFilters: { passOnly: false }
  },
  {
    pattern: /strglr[_ ]?([\d.]+)?/i,
    name: 'Straglr',
    defaultVariantType: 'str',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /Clair3[_ ]?([\d.]+)?/i,
    name: 'Clair3',
    defaultVariantType: 'snv',
    defaultFilters: { passOnly: true, minQual: 2 }
  },
  {
    pattern: /DeepVariant[_ ]?([\d.]+)?/i,
    name: 'DeepVariant',
    defaultVariantType: 'snv',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /DRAGEN[_ ]?([\d.]+)?/i,
    name: 'DRAGEN',
    defaultVariantType: 'snv',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /Manta[_ ]?([\d.]+)?/i,
    name: 'Manta',
    defaultVariantType: 'sv',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /ExpansionHunter[_ ]?([\d.]+)?/i,
    name: 'ExpansionHunter',
    defaultVariantType: 'str',
    defaultFilters: { passOnly: false }
  }
]

const UNKNOWN_CALLER: CallerInfo = {
  name: 'unknown',
  version: null,
  defaultVariantType: 'snv',
  defaultFilters: { passOnly: false }
}

/**
 * Detect variant caller from VCF header lines.
 * Checks ##source= first, then ##command= as fallback.
 */
export function detectCaller(headerLines: string[]): CallerInfo {
  // Check ##source= lines first (highest priority)
  for (const line of headerLines) {
    if (line.startsWith('##source=') || line.startsWith('##command=')) {
      const value = line.split('=', 2)[1]
      for (const cp of CALLER_PATTERNS) {
        const match = value.match(cp.pattern)
        if (match) {
          return {
            name: cp.name,
            version: match[1] ?? null,
            defaultVariantType: cp.defaultVariantType,
            defaultFilters: cp.defaultFilters
          }
        }
      }
    }
  }

  return UNKNOWN_CALLER
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/import/vcf/caller-detector.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/import/vcf/caller-detector.ts tests/import/vcf/caller-detector.test.ts
git commit -m "feat: add VCF caller auto-detection from header lines"
```

---

## Task 5: Extension Field Parsers (SV, CNV, STR)

**Files:**
- Create: `src/main/import/vcf/extension-parsers.ts`
- Test: `tests/import/vcf/extension-parsers.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/import/vcf/extension-parsers.test.ts
import { describe, it, expect } from 'vitest'
import { extractSvFields, extractCnvFields, extractStrFields } from '../../../src/main/import/vcf/extension-parsers'

describe('extractSvFields', () => {
  it('extracts Sniffles2 SV fields', () => {
    const info = new Map([
      ['SVTYPE', 'DEL'],
      ['SVLEN', '-5000'],
      ['END', '1005000'],
      ['SUPPORT', '15'],
      ['COVERAGE', '20,18,22,19,21'],
      ['STRAND', '+-'],
      ['STDEV_LEN', '10.5'],
      ['STDEV_POS', '3.2'],
      ['VAF', '0.75']
    ])
    info.set('PRECISE', '')
    const formatRaw = new Map([['DR', '5'], ['DV', '15']])
    const result = extractSvFields(info, formatRaw)
    expect(result.sv_is_precise).toBe(1)
    expect(result.support).toBe(15)
    expect(result.strand).toBe('+-')
    expect(result.stdev_len).toBeCloseTo(10.5)
    expect(result.vaf).toBeCloseTo(0.75)
    expect(result.dr).toBe(5)
    expect(result.dv).toBe(15)
  })

  it('handles IMPRECISE flag', () => {
    const info = new Map<string, string>()
    info.set('IMPRECISE', '')
    info.set('SVTYPE', 'INV')
    const result = extractSvFields(info, new Map())
    expect(result.sv_is_precise).toBe(0)
  })
})

describe('extractCnvFields', () => {
  it('extracts Spectre CNV fields', () => {
    const info = new Map([['CN', '1'], ['SVTYPE', 'DEL']])
    const formatRaw = new Map([['HO', '0.45,0.55'], ['GQ', '30'], ['CN', '1']])
    const result = extractCnvFields(info, formatRaw)
    expect(result.copy_number).toBe(1)
    expect(result.copy_number_quality).toBe(30)
    expect(result.homozygosity_ref).toBeCloseTo(0.45)
    expect(result.homozygosity_alt).toBeCloseTo(0.55)
  })

  it('prefers FORMAT/CN over INFO/CN', () => {
    const info = new Map([['CN', '3']])
    const formatRaw = new Map([['CN', '1']])
    const result = extractCnvFields(info, formatRaw)
    expect(result.copy_number).toBe(1)
  })
})

describe('extractStrFields', () => {
  it('extracts Straglr STR fields', () => {
    const info = new Map([
      ['REPID', 'ATXN3'],
      ['VARID', 'ATXN3'],
      ['RU', 'CTG'],
      ['DisplayRU', 'CAG'],
      ['REF', '11'],
      ['RL', '33'],
      ['STR_STATUS', 'normal,normal'],
      ['STR_NORMAL_MAX', '44'],
      ['STR_PATHOLOGIC_MIN', '60'],
      ['Disease', 'MJD'],
      ['InheritanceMode', 'AD'],
      ['RankScore', '1:10'],
      ['SourceDisplay', 'GeneReviews']
    ])
    const formatRaw = new Map([
      ['REPCN', '24/15'],
      ['REPCI', '24-24/15-15'],
      ['SO', 'SPANNING/SPANNING'],
      ['LC', '3']
    ])
    const result = extractStrFields(info, formatRaw)
    expect(result.repeat_id).toBe('ATXN3')
    expect(result.repeat_unit).toBe('CTG')
    expect(result.display_repeat_unit).toBe('CAG')
    expect(result.ref_copies).toBe(11)
    expect(result.alt_copies).toBe('24/15')
    expect(result.str_status).toBe('normal,normal')
    expect(result.normal_max).toBe(44)
    expect(result.pathologic_min).toBe(60)
    expect(result.disease).toBe('MJD')
    expect(result.inheritance_mode).toBe('AD')
    expect(result.locus_coverage).toBe(3)
    expect(result.support_type).toBe('SPANNING/SPANNING')
  })

  it('handles full_mutation status', () => {
    const info = new Map([['STR_STATUS', 'full_mutation'], ['REPID', 'CSTB']])
    const result = extractStrFields(info, new Map())
    expect(result.str_status).toBe('full_mutation')
    expect(result.repeat_id).toBe('CSTB')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/import/vcf/extension-parsers.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement extension parsers**

```typescript
// src/main/import/vcf/extension-parsers.ts

export interface SvExtensionRow {
  sv_is_precise: number
  cipos_left: number | null
  cipos_right: number | null
  ciend_left: number | null
  ciend_right: number | null
  support: number | null
  coverage: string | null
  strand: string | null
  stdev_len: number | null
  stdev_pos: number | null
  vaf: number | null
  dr: number | null
  dv: number | null
  pe_support: number | null
  sr_support: number | null
  event_id: string | null
  mate_id: string | null
}

export interface CnvExtensionRow {
  copy_number: number | null
  copy_number_quality: number | null
  homozygosity_ref: number | null
  homozygosity_alt: number | null
  sm: number | null
  bin_count: number | null
}

export interface StrExtensionRow {
  repeat_id: string | null
  variant_catalog_id: string | null
  repeat_unit: string | null
  display_repeat_unit: string | null
  ref_copies: number | null
  alt_copies: string | null
  repeat_length: number | null
  str_status: string | null
  normal_max: number | null
  pathologic_min: number | null
  disease: string | null
  inheritance_mode: string | null
  source_display: string | null
  rank_score: string | null
  locus_coverage: number | null
  support_type: string | null
  confidence_interval: string | null
}

function parseIntOrNull(val: string | undefined): number | null {
  if (val === undefined || val === '' || val === '.') return null
  const n = parseInt(val, 10)
  return Number.isNaN(n) ? null : n
}

function parseFloatOrNull(val: string | undefined): number | null {
  if (val === undefined || val === '' || val === '.') return null
  const n = parseFloat(val)
  return Number.isNaN(n) ? null : n
}

function parseCiInterval(val: string | undefined): [number | null, number | null] {
  if (!val) return [null, null]
  const parts = val.split(',')
  if (parts.length !== 2) return [null, null]
  return [parseIntOrNull(parts[0]), parseIntOrNull(parts[1])]
}

export function extractSvFields(
  info: Map<string, string>,
  formatRaw: Map<string, string>
): SvExtensionRow {
  const [ciposL, ciposR] = parseCiInterval(info.get('CIPOS'))
  const [ciendL, ciendR] = parseCiInterval(info.get('CIEND'))

  // PR/SR are Number=. with ref,alt counts — extract alt (index 1)
  const prParts = formatRaw.get('PR')?.split(',')
  const srParts = formatRaw.get('SR')?.split(',')

  return {
    sv_is_precise: info.has('PRECISE') ? 1 : 0,
    cipos_left: ciposL,
    cipos_right: ciposR,
    ciend_left: ciendL,
    ciend_right: ciendR,
    support: parseIntOrNull(info.get('SUPPORT')),
    coverage: info.get('COVERAGE') ?? null,
    strand: info.get('STRAND') ?? null,
    stdev_len: parseFloatOrNull(info.get('STDEV_LEN')),
    stdev_pos: parseFloatOrNull(info.get('STDEV_POS')),
    vaf: parseFloatOrNull(info.get('VAF')),
    dr: parseIntOrNull(formatRaw.get('DR')),
    dv: parseIntOrNull(formatRaw.get('DV')),
    pe_support: prParts && prParts.length >= 2 ? parseIntOrNull(prParts[1]) : null,
    sr_support: srParts && srParts.length >= 2 ? parseIntOrNull(srParts[1]) : null,
    event_id: info.get('EVENT') ?? null,
    mate_id: info.get('MATEID') ?? null
  }
}

export function extractCnvFields(
  info: Map<string, string>,
  formatRaw: Map<string, string>
): CnvExtensionRow {
  // FORMAT/CN takes priority over INFO/CN
  const cn = parseIntOrNull(formatRaw.get('CN')) ?? parseIntOrNull(info.get('CN'))

  // Spectre HO field: "ref_proportion,alt_proportion"
  let hoRef: number | null = null
  let hoAlt: number | null = null
  const hoVal = formatRaw.get('HO')
  if (hoVal) {
    const parts = hoVal.split(',')
    if (parts.length >= 2) {
      hoRef = parseFloatOrNull(parts[0])
      hoAlt = parseFloatOrNull(parts[1])
    }
  }

  return {
    copy_number: cn,
    copy_number_quality: parseIntOrNull(formatRaw.get('GQ')),
    homozygosity_ref: hoRef,
    homozygosity_alt: hoAlt,
    sm: parseFloatOrNull(formatRaw.get('SM')),
    bin_count: parseIntOrNull(formatRaw.get('BC'))
  }
}

export function extractStrFields(
  info: Map<string, string>,
  formatRaw: Map<string, string>
): StrExtensionRow {
  return {
    repeat_id: info.get('REPID') ?? null,
    variant_catalog_id: info.get('VARID') ?? null,
    repeat_unit: info.get('RU') ?? null,
    display_repeat_unit: info.get('DisplayRU') ?? null,
    ref_copies: parseFloatOrNull(info.get('REF')),
    alt_copies: formatRaw.get('REPCN') ?? null,
    repeat_length: parseIntOrNull(info.get('RL')),
    str_status: info.get('STR_STATUS') ?? null,
    normal_max: parseIntOrNull(info.get('STR_NORMAL_MAX')),
    pathologic_min: parseIntOrNull(info.get('STR_PATHOLOGIC_MIN')),
    disease: info.get('Disease') ?? null,
    inheritance_mode: info.get('InheritanceMode') ?? null,
    source_display: info.get('SourceDisplay') ?? null,
    rank_score: info.get('RankScore') ?? null,
    locus_coverage: parseFloatOrNull(formatRaw.get('LC')),
    support_type: formatRaw.get('SO') ?? null,
    confidence_interval: formatRaw.get('REPCI') ?? null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/import/vcf/extension-parsers.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/import/vcf/extension-parsers.ts tests/import/vcf/extension-parsers.test.ts
git commit -m "feat: add SV/CNV/STR extension field parsers"
```

---

## Task 6: Database Schema Migration (v25)

**Files:**
- Modify: `src/main/database/migrations.ts`
- Modify: `src/shared/types/database-schema.ts`
- Modify: `src/shared/types/database.ts`

This task adds the extension tables, case_import_files, and new variant columns. No tests — migration correctness is verified by the integration tests in Task 9.

- [ ] **Step 1: Add Kysely types for new tables to `database-schema.ts`**

Add after the existing `VariantTranscriptsTable` interface in `src/shared/types/database-schema.ts`:

```typescript
// ── Variant Extension Tables ──────────────────────────────

export interface VariantSvTable {
  variant_id: number
  sv_is_precise: number | null
  cipos_left: number | null
  cipos_right: number | null
  ciend_left: number | null
  ciend_right: number | null
  support: number | null
  coverage: string | null
  strand: string | null
  stdev_len: number | null
  stdev_pos: number | null
  vaf: number | null
  dr: number | null
  dv: number | null
  pe_support: number | null
  sr_support: number | null
  event_id: string | null
  mate_id: string | null
}

export interface VariantCnvTable {
  variant_id: number
  copy_number: number | null
  copy_number_quality: number | null
  homozygosity_ref: number | null
  homozygosity_alt: number | null
  sm: number | null
  bin_count: number | null
}

export interface VariantStrTable {
  variant_id: number
  repeat_id: string | null
  variant_catalog_id: string | null
  repeat_unit: string | null
  display_repeat_unit: string | null
  ref_copies: number | null
  alt_copies: string | null
  repeat_length: number | null
  str_status: string | null
  normal_max: number | null
  pathologic_min: number | null
  disease: string | null
  inheritance_mode: string | null
  source_display: string | null
  rank_score: string | null
  locus_coverage: number | null
  support_type: string | null
  confidence_interval: string | null
}

export interface CaseImportFilesTable {
  id: Generated<number>
  case_id: number
  file_path: string
  file_size: number
  variant_type: string
  caller: string | null
  variant_count: number
  annotation_format: string | null
  imported_at: number
}
```

Also add the new tables to the `Database` interface (find it in the same file):

```typescript
variant_sv: VariantSvTable
variant_cnv: VariantCnvTable
variant_str: VariantStrTable
case_import_files: CaseImportFilesTable
```

- [ ] **Step 2: Add extension table interfaces to `database.ts`**

Add after the existing `Variant` interface in `src/shared/types/database.ts`:

```typescript
/** Variant type discriminator */
export type VariantType = 'snv' | 'indel' | 'sv' | 'cnv' | 'str'

/** Case import file provenance record */
export interface CaseImportFile {
  id: number
  case_id: number
  file_path: string
  file_size: number
  variant_type: string
  caller: string | null
  variant_count: number
  annotation_format: string | null
  imported_at: number
}
```

Add new optional fields to the existing `Variant` interface:

```typescript
  /** Variant type discriminator: snv, indel, sv, cnv, str */
  variant_type?: string
  /** End position for SV/CNV/STR */
  end_pos?: number | null
  /** SV type: DEL, DUP, INV, INS, BND */
  sv_type?: string | null
  /** SV length (SVLEN) */
  sv_length?: number | null
  /** Detected caller name */
  caller?: string | null
```

- [ ] **Step 3: Add migration v25 to `migrations.ts`**

Add the migration function at the end of the migrations array in `src/main/database/migrations.ts`. Find the current latest version number and the migration registration pattern, then add:

```typescript
  // ── v25: Multi-variant type support (SV/CNV/STR) ──
  {
    version: 25,
    up(db: Database): void {
      // 1. New columns on variants table
      const varCols = db.pragma('table_info(variants)') as Array<{ name: string }>
      if (!varCols.some((c) => c.name === 'variant_type')) {
        db.exec("ALTER TABLE variants ADD COLUMN variant_type TEXT NOT NULL DEFAULT 'snv'")
        db.exec('ALTER TABLE variants ADD COLUMN end_pos INTEGER')
        db.exec('ALTER TABLE variants ADD COLUMN sv_type TEXT')
        db.exec('ALTER TABLE variants ADD COLUMN sv_length INTEGER')
        db.exec('ALTER TABLE variants ADD COLUMN caller TEXT')
      }

      // 2. Classify existing variants by REF/ALT length
      db.exec(`
        UPDATE variants SET variant_type =
          CASE
            WHEN length(ref) = 1 AND length(alt) = 1 THEN 'snv'
            ELSE 'indel'
          END
        WHERE variant_type = 'snv'
      `)

      // 3. Indexes on new columns
      db.exec('CREATE INDEX IF NOT EXISTS idx_variants_type ON variants(variant_type)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_variants_type_case ON variants(variant_type, case_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_variants_end_pos ON variants(chr, end_pos) WHERE end_pos IS NOT NULL')

      // 4. SV extension table
      db.exec(`
        CREATE TABLE IF NOT EXISTS variant_sv (
          variant_id INTEGER PRIMARY KEY,
          sv_is_precise INTEGER,
          cipos_left INTEGER, cipos_right INTEGER,
          ciend_left INTEGER, ciend_right INTEGER,
          support INTEGER, coverage TEXT, strand TEXT,
          stdev_len REAL, stdev_pos REAL, vaf REAL,
          dr INTEGER, dv INTEGER,
          pe_support INTEGER, sr_support INTEGER,
          event_id TEXT, mate_id TEXT,
          FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
        )
      `)

      // 5. CNV extension table
      db.exec(`
        CREATE TABLE IF NOT EXISTS variant_cnv (
          variant_id INTEGER PRIMARY KEY,
          copy_number INTEGER, copy_number_quality INTEGER,
          homozygosity_ref REAL, homozygosity_alt REAL,
          sm REAL, bin_count INTEGER,
          FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
        )
      `)
      db.exec('CREATE INDEX IF NOT EXISTS idx_cnv_copy_number ON variant_cnv(copy_number)')

      // 6. STR extension table
      db.exec(`
        CREATE TABLE IF NOT EXISTS variant_str (
          variant_id INTEGER PRIMARY KEY,
          repeat_id TEXT, variant_catalog_id TEXT,
          repeat_unit TEXT, display_repeat_unit TEXT,
          ref_copies REAL, alt_copies TEXT,
          repeat_length INTEGER,
          str_status TEXT, normal_max INTEGER, pathologic_min INTEGER,
          disease TEXT, inheritance_mode TEXT,
          source_display TEXT, rank_score TEXT,
          locus_coverage REAL, support_type TEXT, confidence_interval TEXT,
          FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
        )
      `)
      db.exec('CREATE INDEX IF NOT EXISTS idx_str_repeat_id ON variant_str(repeat_id)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_str_disease ON variant_str(disease)')

      // 7. Case import files provenance table
      db.exec(`
        CREATE TABLE IF NOT EXISTS case_import_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          case_id INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          variant_type TEXT NOT NULL,
          caller TEXT,
          variant_count INTEGER NOT NULL DEFAULT 0,
          annotation_format TEXT,
          imported_at INTEGER NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        )
      `)
      db.exec('CREATE INDEX IF NOT EXISTS idx_case_import_files_case ON case_import_files(case_id)')

      // 8. Add variant_type + genome_build to cohort summary tables
      const cvsCols = db.pragma('table_info(cohort_variant_summary)') as Array<{ name: string }>
      if (cvsCols.length > 0 && !cvsCols.some((c) => c.name === 'variant_type')) {
        db.exec("ALTER TABLE cohort_variant_summary ADD COLUMN variant_type TEXT NOT NULL DEFAULT 'snv'")
        db.exec("ALTER TABLE cohort_variant_summary ADD COLUMN genome_build TEXT NOT NULL DEFAULT 'GRCh38'")
      }

      const gbsCols = db.pragma('table_info(gene_burden_summary)') as Array<{ name: string }>
      if (gbsCols.length > 0 && !gbsCols.some((c) => c.name === 'genome_build')) {
        db.exec("ALTER TABLE gene_burden_summary ADD COLUMN genome_build TEXT NOT NULL DEFAULT 'GRCh38'")
      }

      // 9. Full rebuild of cohort summaries (not backfill defaults)
      // Only if the tables have data — rebuild derives variant_type from variants table
      const hasData = db.prepare('SELECT COUNT(*) as c FROM cohort_variant_summary').get() as { c: number }
      if (hasData && hasData.c > 0) {
        // Mark stale — the CohortSummaryService will rebuild on next access
        db.exec("INSERT OR REPLACE INTO cohort_summary_meta (key, value) VALUES ('is_stale', '1')")
      }
    }
  }
```

- [ ] **Step 4: Update VariantsTable in `database-schema.ts` with new columns**

Add to the existing `VariantsTable` interface in `src/shared/types/database-schema.ts`:

```typescript
  variant_type: string
  end_pos: number | null
  sv_type: string | null
  sv_length: number | null
  caller: string | null
```

- [ ] **Step 5: Commit**

```bash
git add src/main/database/migrations.ts src/shared/types/database-schema.ts src/shared/types/database.ts
git commit -m "feat: add migration v25 for multi-variant type schema (SV/CNV/STR extension tables)"
```

---

## Task 7: Extend VcfMappedVariant Type + VcfMapper Integration

**Files:**
- Modify: `src/main/import/vcf/types.ts`
- Modify: `src/main/import/vcf/VcfMapper.ts`

- [ ] **Step 1: Extend VcfMappedVariant in `types.ts`**

Add to the `VcfMappedVariant` interface in `src/main/import/vcf/types.ts` (after the existing fields, before the closing `}`):

```typescript
  /** Variant type discriminator */
  variant_type: string
  /** End position for SV/CNV/STR */
  end_pos: number | null
  /** SV type: DEL, DUP, INV, INS, BND */
  sv_type: string | null
  /** SV length */
  sv_length: number | null
  /** Detected caller name */
  caller: string | null
  /** SV extension data (only for sv variant_type) */
  _sv?: import('./extension-parsers').SvExtensionRow
  /** CNV extension data (only for cnv variant_type) */
  _cnv?: import('./extension-parsers').CnvExtensionRow
  /** STR extension data (only for str variant_type) */
  _str?: import('./extension-parsers').StrExtensionRow
```

- [ ] **Step 2: Update VcfMapper to detect type and extract extension fields**

In `src/main/import/vcf/VcfMapper.ts`, add imports at the top:

```typescript
import { detectVariantType } from './variant-type-detector'
import { extractSvFields, extractCnvFields, extractStrFields } from './extension-parsers'
```

Then in the `mapVcfRecord` function, after the existing field assembly (the object literal that builds the VcfMappedVariant), add variant_type detection and extension extraction. Find the object literal that starts with `chr: rec.chrom` and add these fields:

```typescript
      // After existing fields like source_format, before _transcripts
      variant_type: detectVariantType(rec.ref, altAllele, rec.info, callerName),
      end_pos: parseIntOrNull(rec.info.get('END')),
      sv_type: rec.info.get('SVTYPE') ?? null,
      sv_length: parseIntOrNull(rec.info.get('SVLEN')),
      caller: callerName,
```

After building the mapped variant object, add extension field extraction:

```typescript
      // Attach extension data based on variant type
      const vt = mapped.variant_type
      if (vt === 'sv') {
        mapped._sv = extractSvFields(rec.info, sampleRawValues)
      } else if (vt === 'cnv') {
        mapped._cnv = extractCnvFields(rec.info, sampleRawValues)
      } else if (vt === 'str') {
        mapped._str = extractStrFields(rec.info, sampleRawValues)
      }
```

Note: `callerName` needs to be passed into `mapVcfRecord`. Add it as a new parameter:

```typescript
export function mapVcfRecord(
  record: VcfRawRecord,
  header: VcfHeader,
  sampleName: string,
  registry: InfoFieldMapping[],
  callerName: string | null = null  // NEW parameter
): VcfMappedVariant[]
```

And `sampleRawValues` is a `Map<string, string>` built from the FORMAT fields and sample values. Add a helper to extract raw FORMAT values into a Map for extension parsers to use:

```typescript
      // Build raw FORMAT values map for extension parsers
      const sampleRawValues = new Map<string, string>()
      if (rec.format && sampleValues) {
        for (let i = 0; i < rec.format.length; i++) {
          if (sampleValues[i] !== undefined) {
            sampleRawValues.set(rec.format[i], sampleValues[i])
          }
        }
      }
```

Also need the `parseIntOrNull` helper — import from extension-parsers or add locally:

```typescript
function parseIntOrNull(val: string | undefined): number | null {
  if (val === undefined || val === '' || val === '.') return null
  const n = parseInt(val, 10)
  return Number.isNaN(n) ? null : n
}
```

- [ ] **Step 3: Update VcfStrategy to pass callerName to mapVcfRecord**

In `src/main/import/vcf/VcfStrategy.ts`, add import:

```typescript
import { detectCaller } from './caller-detector'
```

After header parsing (line ~76 where `parseVcfHeaderFromLines` is called), detect the caller:

```typescript
      const callerInfo = detectCaller(header.rawHeaderLines)
      const callerName = callerInfo.name !== 'unknown' ? callerInfo.name : null
```

Then update the `mapVcfRecord` call (line ~85) to pass callerName:

```typescript
      const mapped = mapVcfRecord(record, header, activeSample, DEFAULT_INFO_FIELD_MAPPINGS, callerName)
```

- [ ] **Step 4: Commit**

```bash
git add src/main/import/vcf/types.ts src/main/import/vcf/VcfMapper.ts src/main/import/vcf/VcfStrategy.ts
git commit -m "feat: integrate variant type detection and extension field extraction into VCF mapper"
```

---

## Task 8: Extend VariantRepository.insertBatch for Extension Tables

**Files:**
- Modify: `src/main/database/VariantRepository.ts`
- Modify: `src/main/workers/import-pipeline.ts`

- [ ] **Step 1: Update VariantRepository.insertBatch**

In `src/main/database/VariantRepository.ts`, update the `insertBatch` method to:

1. Include new columns in the variant INSERT
2. After inserting each variant, insert extension row if present

Add the new columns to the Kysely insert statement (after `source_format`):

```typescript
        variant_type: v.variant_type ?? 'snv',
        end_pos: v.end_pos ?? null,
        sv_type: v.sv_type ?? null,
        sv_length: v.sv_length ?? null,
        caller: v.caller ?? null,
```

After the transcript insertion block (the `if (v._transcripts ...)` block), add extension table inserts:

```typescript
      // Insert extension table row if present
      const variantId = result.lastInsertRowid as number

      if ((v as any)._sv) {
        this.execRun(
          this.kysely.insertInto('variant_sv').values({
            variant_id: variantId,
            ...(v as any)._sv
          })
        )
      } else if ((v as any)._cnv) {
        this.execRun(
          this.kysely.insertInto('variant_cnv').values({
            variant_id: variantId,
            ...(v as any)._cnv
          })
        )
      } else if ((v as any)._str) {
        this.execRun(
          this.kysely.insertInto('variant_str').values({
            variant_id: variantId,
            ...(v as any)._str
          })
        )
      }
```

- [ ] **Step 2: Update import-pipeline.ts worker**

In `src/main/workers/import-pipeline.ts`, update the `insertVariantStmt` SQL to include the new columns:

Add to the INSERT statement's column list and VALUES placeholders:

```sql
variant_type, end_pos, sv_type, sv_length, caller
```

Add prepared statements for extension tables:

```typescript
    const insertSvStmt = db.prepare(`
      INSERT INTO variant_sv (variant_id, sv_is_precise, cipos_left, cipos_right,
        ciend_left, ciend_right, support, coverage, strand, stdev_len, stdev_pos,
        vaf, dr, dv, pe_support, sr_support, event_id, mate_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertCnvStmt = db.prepare(`
      INSERT INTO variant_cnv (variant_id, copy_number, copy_number_quality,
        homozygosity_ref, homozygosity_alt, sm, bin_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const insertStrStmt = db.prepare(`
      INSERT INTO variant_str (variant_id, repeat_id, variant_catalog_id,
        repeat_unit, display_repeat_unit, ref_copies, alt_copies, repeat_length,
        str_status, normal_max, pathologic_min, disease, inheritance_mode,
        source_display, rank_score, locus_coverage, support_type, confidence_interval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
```

In the `insertBatch` transaction, after inserting each variant and its transcripts, add:

```typescript
        if (v._sv) {
          const s = v._sv
          insertSvStmt.run(variantId, s.sv_is_precise, s.cipos_left, s.cipos_right,
            s.ciend_left, s.ciend_right, s.support, s.coverage, s.strand,
            s.stdev_len, s.stdev_pos, s.vaf, s.dr, s.dv, s.pe_support,
            s.sr_support, s.event_id, s.mate_id)
        } else if (v._cnv) {
          const c = v._cnv
          insertCnvStmt.run(variantId, c.copy_number, c.copy_number_quality,
            c.homozygosity_ref, c.homozygosity_alt, c.sm, c.bin_count)
        } else if (v._str) {
          const t = v._str
          insertStrStmt.run(variantId, t.repeat_id, t.variant_catalog_id,
            t.repeat_unit, t.display_repeat_unit, t.ref_copies, t.alt_copies,
            t.repeat_length, t.str_status, t.normal_max, t.pathologic_min,
            t.disease, t.inheritance_mode, t.source_display, t.rank_score,
            t.locus_coverage, t.support_type, t.confidence_interval)
        }
```

- [ ] **Step 3: Commit**

```bash
git add src/main/database/VariantRepository.ts src/main/workers/import-pipeline.ts
git commit -m "feat: extend insertBatch to write SV/CNV/STR extension table rows"
```

---

## Task 9: VcfStrategy Import Filter Integration

**Files:**
- Modify: `src/main/import/vcf/VcfStrategy.ts`

- [ ] **Step 1: Add import filter gates to the streaming loop**

In `src/main/import/vcf/VcfStrategy.ts`, add imports:

```typescript
import type { ImportFilters } from './import-filters'
import { BedFilter } from './bed-filter'
```

Update the `import` method signature to accept filters:

```typescript
  async import(
    filePath: string,
    options: ImportOptions,
    context: StrategyContext,
    vcfOptions?: VcfImportOptions,
    importFilters?: ImportFilters  // NEW parameter
  ): Promise<ImportResult>
```

In the streaming loop, after `parseVcfLine` but before `mapVcfRecord`, add the filter gates:

```typescript
        // ── Import-time filter gates ──
        if (importFilters) {
          // FILTER check
          if (importFilters.passOnly && record.filter !== 'PASS' && record.filter !== '.') {
            continue
          }

          // QUAL check
          if (importFilters.minQual !== null && record.qual !== null && record.qual < importFilters.minQual) {
            continue
          }

          // BED region check
          if (importFilters.bedFilter) {
            const endPos = record.info.get('END')
            if (endPos) {
              // SV/CNV: check range overlap
              if (!importFilters.bedFilter.containsRange(record.chrom, record.pos, parseInt(endPos, 10))) {
                continue
              }
            } else {
              // SNV/indel: check point
              if (!importFilters.bedFilter.contains(record.chrom, record.pos)) {
                continue
              }
            }
          }
        }
```

After `mapVcfRecord` and before adding to batch, add genotype quality checks:

```typescript
        // Post-mapping genotype quality filter
        if (importFilters) {
          mappedVariants = mappedVariants.filter((v) => {
            if (importFilters.minGq !== null && v.gq !== null && v.gq < importFilters.minGq) return false
            if (importFilters.minDp !== null && v.dp !== null && v.dp < importFilters.minDp) return false
            return true
          })
        }
```

- [ ] **Step 2: Commit**

```bash
git add src/main/import/vcf/VcfStrategy.ts
git commit -m "feat: add import-time BED/quality filter gates to VCF streaming loop"
```

---

## Task 10: Integration Tests with Synthetic Test Data

**Files:**
- Create: `tests/import/vcf/import-filters-integration.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// tests/import/vcf/import-filters-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import path from 'path'
import { parseVcfHeaderFromLines } from '../../../src/main/import/vcf/vcf-header-parser'
import { mapVcfRecord } from '../../../src/main/import/vcf/VcfMapper'
import { parseVcfLine } from '../../../src/main/import/vcf/vcf-line-parser'
import { detectCaller } from '../../../src/main/import/vcf/caller-detector'
import { detectVariantType } from '../../../src/main/import/vcf/variant-type-detector'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../../../src/main/import/vcf/info-field-registry'
import { BedFilter } from '../../../src/main/import/vcf/bed-filter'
import { readFileSync } from 'fs'

const SV_VCF = path.join(__dirname, '../../test-data/vcf/synthetic-sv.vcf')
const CNV_VCF = path.join(__dirname, '../../test-data/vcf/synthetic-cnv.vcf')
const STR_VCF = path.join(__dirname, '../../test-data/vcf/synthetic-str.vcf')
const BED_FILE = path.join(__dirname, '../../test-data/vcf/test-regions.bed')

function parseVcfFile(filePath: string) {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const headerLines = lines.filter((l) => l.startsWith('#'))
  const dataLines = lines.filter((l) => !l.startsWith('#') && l.trim())
  const header = parseVcfHeaderFromLines(headerLines)
  const callerInfo = detectCaller(headerLines)
  const callerName = callerInfo.name !== 'unknown' ? callerInfo.name : null
  const sampleName = header.samples[0]

  const variants = []
  for (const line of dataLines) {
    const record = parseVcfLine(line, header.samples)
    if (!record) continue
    const mapped = mapVcfRecord(record, header, sampleName, DEFAULT_INFO_FIELD_MAPPINGS, callerName)
    variants.push(...mapped)
  }
  return { header, callerInfo, variants }
}

describe('SV VCF import (Sniffles2)', () => {
  it('detects Sniffles2 caller', () => {
    const { callerInfo } = parseVcfFile(SV_VCF)
    expect(callerInfo.name).toBe('Sniffles2')
    expect(callerInfo.version).toBe('2.6.3')
  })

  it('parses all SV variants with correct types', () => {
    const { variants } = parseVcfFile(SV_VCF)
    expect(variants.length).toBeGreaterThanOrEqual(4) // at least DEL, INS, DUP, BND (INV filtered as 0/1 with low qual)
    const types = variants.map((v) => v.variant_type)
    expect(types).toContain('sv')
  })

  it('extracts SV extension fields', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const del = variants.find((v) => v.sv_type === 'DEL')
    expect(del).toBeDefined()
    expect(del!._sv).toBeDefined()
    expect(del!._sv!.support).toBe(15)
    expect(del!._sv!.dr).toBe(5)
    expect(del!._sv!.dv).toBe(15)
    expect(del!._sv!.sv_is_precise).toBe(1)
    expect(del!._sv!.vaf).toBeCloseTo(0.75)
  })

  it('extracts end_pos and sv_length', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const del = variants.find((v) => v.sv_type === 'DEL')
    expect(del!.end_pos).toBe(1005000)
    expect(del!.sv_length).toBe(-5000)
  })

  it('parses ANN annotations on SVs', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const del = variants.find((v) => v.sv_type === 'DEL')
    expect(del!.gene_symbol).toBe('GENE1')
    expect(del!.consequence).toBeTruthy()
  })
})

describe('CNV VCF import (Spectre)', () => {
  it('detects Spectre caller', () => {
    const { callerInfo } = parseVcfFile(CNV_VCF)
    expect(callerInfo.name).toBe('Spectre')
  })

  it('classifies variants as cnv', () => {
    const { variants } = parseVcfFile(CNV_VCF)
    expect(variants.every((v) => v.variant_type === 'cnv')).toBe(true)
  })

  it('extracts CNV extension fields', () => {
    const { variants } = parseVcfFile(CNV_VCF)
    const del = variants.find((v) => v.sv_type === 'DEL')
    expect(del!._cnv).toBeDefined()
    expect(del!._cnv!.copy_number).toBe(1)
    expect(del!._cnv!.homozygosity_ref).toBeCloseTo(0.45)
    expect(del!._cnv!.homozygosity_alt).toBeCloseTo(0.55)
  })

  it('extracts ClinVar from SnpSift annotation', () => {
    const { variants } = parseVcfFile(CNV_VCF)
    const del = variants.find((v) => v.sv_type === 'DEL' && v.clinvar)
    expect(del).toBeDefined()
    expect(del!.clinvar).toContain('Pathogenic')
  })
})

describe('STR VCF import (Straglr)', () => {
  it('detects Straglr caller', () => {
    const { callerInfo } = parseVcfFile(STR_VCF)
    expect(callerInfo.name).toBe('Straglr')
  })

  it('classifies variants as str', () => {
    const { variants } = parseVcfFile(STR_VCF)
    expect(variants.every((v) => v.variant_type === 'str')).toBe(true)
  })

  it('extracts STR extension fields', () => {
    const { variants } = parseVcfFile(STR_VCF)
    const atxn3 = variants.find((v) => v._str?.repeat_id === 'ATXN3')
    expect(atxn3).toBeDefined()
    expect(atxn3!._str!.repeat_unit).toBe('CTG')
    expect(atxn3!._str!.disease).toBe('MJD')
    expect(atxn3!._str!.inheritance_mode).toBe('AD')
    expect(atxn3!._str!.normal_max).toBe(44)
    expect(atxn3!._str!.pathologic_min).toBe(60)
  })

  it('handles full_mutation status', () => {
    const { variants } = parseVcfFile(STR_VCF)
    const cstb = variants.find((v) => v._str?.repeat_id === 'CSTB')
    expect(cstb).toBeDefined()
    expect(cstb!._str!.str_status).toBe('full_mutation')
  })
})

describe('BED filter integration', () => {
  it('filters SV variants by BED region', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const bedFilter = BedFilter.fromFile(BED_FILE, 0)

    // BED has chr1:999000-1010000 and chr22:29000000-29100000
    const filtered = variants.filter((v) => {
      if (v.end_pos) {
        return bedFilter.containsRange(v.chr, v.pos, v.end_pos)
      }
      return bedFilter.contains(v.chr, v.pos)
    })

    // chr1:1000000 DEL (end 1005000) overlaps chr1:999000-1010000 ✓
    // chr22:29000000 DUP (end 29020000) overlaps chr22:29000000-29100000 ✓
    // chr1:2000000 INS — outside ✗
    // chr2:5000000 INV — outside ✗
    expect(filtered.length).toBe(2)
  })

  it('applies padding to BED regions', () => {
    const { variants } = parseVcfFile(SV_VCF)
    const bedFilter = BedFilter.fromFile(BED_FILE, 1000000) // large padding

    const filtered = variants.filter((v) => {
      if (v.end_pos) {
        return bedFilter.containsRange(v.chr, v.pos, v.end_pos)
      }
      return bedFilter.contains(v.chr, v.pos)
    })

    // With 1M padding, chr1:999000-1010000 becomes chr1:0-2010000
    // This now includes chr1:2000000 INS
    expect(filtered.length).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run tests/import/vcf/import-filters-integration.test.ts`
Expected: All tests PASS (after rebuilding for Node: `npm run rebuild:node`)

- [ ] **Step 3: Commit**

```bash
git add tests/import/vcf/import-filters-integration.test.ts
git commit -m "test: add integration tests for SV/CNV/STR import with BED filtering"
```

---

## Task 11: Cohort Summary Rebuild with variant_type + genome_build

**Files:**
- Modify: `src/shared/sql/cohort-summary-rebuild.ts`

- [ ] **Step 1: Update REBUILD_VARIANT_SUMMARY_SQL**

In `src/shared/sql/cohort-summary-rebuild.ts`, update the rebuild SQL to include `variant_type` and `genome_build`:

1. Add `variant_type, genome_build` to the INSERT column list
2. Add `v.variant_type` and `c.genome_build` to the SELECT (requires JOIN to cases)
3. Add both to GROUP BY
4. Change the frequency denominator to be per-build

Replace the `REBUILD_VARIANT_SUMMARY_SQL` constant with:

```typescript
export const REBUILD_VARIANT_SUMMARY_SQL = `
  DELETE FROM cohort_variant_summary;
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, gene_symbol, cdna, aa_change,
    consequence, func, clinvar, gnomad_af, cadd,
    transcript, omim_mim_number,
    carrier_count, het_count, hom_count,
    cohort_frequency, has_star, has_comment, acmg_best,
    variant_key, variant_type, genome_build
  )
  SELECT
    d.chr, d.pos, d.ref, d.alt,
    d.gene_symbol, d.cdna, d.aa_change,
    d.consequence, d.func, d.clinvar, d.gnomad_af, d.cadd,
    d.transcript, d.omim_mim_number,
    d.carrier_count, d.het_count, d.hom_count,
    CAST(d.carrier_count AS REAL) / (SELECT COUNT(*) FROM cases WHERE genome_build = d.genome_build),
    CASE WHEN va.starred = 1 THEN 1 ELSE 0 END,
    CASE WHEN va.global_comment IS NOT NULL AND va.global_comment != '' THEN 1 ELSE 0 END,
    va.acmg_classification,
    d.chr || ':' || d.pos || ':' || d.ref || ':' || d.alt,
    d.variant_type, d.genome_build
  FROM (
    WITH deduped AS (
      SELECT v.chr, v.pos, v.ref, v.alt, v.case_id,
        v.variant_type, c.genome_build,
        MAX(v.gene_symbol) AS gene_symbol, MAX(v.cdna) AS cdna,
        MAX(v.aa_change) AS aa_change, MAX(v.consequence) AS consequence,
        MAX(v.func) AS func, MAX(v.clinvar) AS clinvar,
        MAX(v.gnomad_af) AS gnomad_af, MAX(v.cadd) AS cadd,
        MAX(v.transcript) AS transcript, MAX(v.omim_mim_number) AS omim_mim_number,
        MAX(v.gt_num) AS gt_num
      FROM variants v
      JOIN cases c ON c.id = v.case_id
      GROUP BY v.chr, v.pos, v.ref, v.alt, v.case_id, v.variant_type, c.genome_build
    )
    SELECT chr, pos, ref, alt, variant_type, genome_build,
      MAX(gene_symbol) AS gene_symbol, MAX(cdna) AS cdna,
      MAX(aa_change) AS aa_change, MAX(consequence) AS consequence,
      MAX(func) AS func, MAX(clinvar) AS clinvar,
      MAX(gnomad_af) AS gnomad_af, MAX(cadd) AS cadd,
      MAX(transcript) AS transcript, MAX(omim_mim_number) AS omim_mim_number,
      COUNT(*) AS carrier_count,
      SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
      SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count
    FROM deduped
    GROUP BY chr, pos, ref, alt, variant_type, genome_build
  ) d
  LEFT JOIN variant_annotations va
    ON va.chr = d.chr AND va.pos = d.pos AND va.ref = d.ref AND va.alt = d.alt;
`
```

Also update `INCREMENTAL_ADD_SQL` to include `variant_type` and `genome_build`:

```typescript
export const INCREMENTAL_ADD_SQL = `
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, gene_symbol, cdna, aa_change,
    consequence, func, clinvar, gnomad_af, cadd,
    transcript, omim_mim_number,
    carrier_count, het_count, hom_count,
    cohort_frequency, has_star, has_comment, acmg_best,
    variant_key, variant_type, genome_build
  )
  SELECT
    v.chr, v.pos, v.ref, v.alt,
    MAX(v.gene_symbol), MAX(v.cdna), MAX(v.aa_change),
    MAX(v.consequence), MAX(v.func), MAX(v.clinvar),
    MAX(v.gnomad_af), MAX(v.cadd), MAX(v.transcript), MAX(v.omim_mim_number),
    1,
    CASE WHEN MAX(v.gt_num) IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END,
    CASE WHEN MAX(v.gt_num) IN ('1/1','1|1') THEN 1 ELSE 0 END,
    0.0, 0, 0, NULL,
    v.chr || ':' || v.pos || ':' || v.ref || ':' || v.alt,
    v.variant_type, c.genome_build
  FROM variants v
  JOIN cases c ON c.id = v.case_id
  WHERE v.case_id = ?
  GROUP BY v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build
  ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET
    carrier_count = cohort_variant_summary.carrier_count + 1,
    het_count = cohort_variant_summary.het_count + excluded.het_count,
    hom_count = cohort_variant_summary.hom_count + excluded.hom_count;
`
```

Update `RECOMPUTE_ALL_FREQUENCIES_SQL` to be per-build:

```typescript
export const RECOMPUTE_ALL_FREQUENCIES_SQL = `
  UPDATE cohort_variant_summary
  SET cohort_frequency = CAST(carrier_count AS REAL) /
    (SELECT COUNT(*) FROM cases WHERE genome_build = cohort_variant_summary.genome_build);
`
```

Update `REBUILD_GENE_BURDEN_SQL` to include `genome_build`:

```typescript
export const REBUILD_GENE_BURDEN_SQL = `
  DELETE FROM gene_burden_summary;
  INSERT INTO gene_burden_summary (
    gene_symbol, variant_count, unique_variant_count,
    affected_case_count, updated_at, genome_build
  )
  SELECT
    v.gene_symbol,
    COUNT(*) AS variant_count,
    COUNT(DISTINCT v.chr || ':' || v.pos || ':' || v.ref || ':' || v.alt) AS unique_variant_count,
    COUNT(DISTINCT v.case_id) AS affected_case_count,
    CAST(strftime('%s', 'now') AS INTEGER),
    c.genome_build
  FROM variants v
  JOIN cases c ON c.id = v.case_id
  WHERE v.gene_symbol IS NOT NULL AND v.gene_symbol != ''
  GROUP BY v.gene_symbol, c.genome_build;
`
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm run rebuild:node && npx vitest run`
Expected: All existing tests PASS (cohort tests may need the unique constraint updated — the ON CONFLICT clause references `chr, pos, ref, alt` but the new composite key includes `variant_type` and `genome_build`; if the table definition needs updating, handle it in the migration)

- [ ] **Step 3: Commit**

```bash
git add src/shared/sql/cohort-summary-rebuild.ts
git commit -m "feat: update cohort summary rebuild SQL with variant_type and genome_build grouping"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] BED region filter with padding (Task 2)
- [x] Quality pre-filters (Task 3 types, Task 9 integration)
- [x] Variant type detection (Task 3)
- [x] Caller detection (Task 4)
- [x] Extension field parsers — SV/CNV/STR (Task 5)
- [x] Schema migration with extension tables + case_import_files (Task 6)
- [x] VcfMappedVariant extension (Task 7)
- [x] VariantRepository.insertBatch extension (Task 8)
- [x] VcfStrategy filter integration (Task 9)
- [x] Integration tests with synthetic data (Task 10)
- [x] Cohort summary with variant_type + genome_build (Task 11)
- [ ] Multi-file import session in ImportService — DEFERRED to Phase 2b (requires frontend import dialog changes to select case + multiple files; backend is ready with case_import_files table)
- [ ] Frontend type tabs, build selector — Phase 3 (separate plan)
- [ ] Import UX wizard — Phase 4 (separate plan)
- [ ] DRAGEN/Nirvana — Phase 5 (separate plan)

**2. Placeholder scan:** No TBDs, TODOs, or "implement later" found. All code blocks are complete.

**3. Type consistency:** `VariantType`, `ImportFilters`, `SvExtensionRow`, `CnvExtensionRow`, `StrExtensionRow`, `CallerInfo` — all consistently named and used across tasks. `VcfMappedVariant` extended consistently between Task 7 (type definition) and Task 8 (insertBatch usage). `detectVariantType` signature matches between Task 3 (definition) and Task 7 (usage in VcfMapper).
