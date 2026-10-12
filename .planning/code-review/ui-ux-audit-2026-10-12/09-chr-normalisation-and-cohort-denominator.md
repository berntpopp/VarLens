# 09 · Chromosome naming and the cohort frequency denominator

Design decision for items 21 (C-P2-6 + E-15) and 22 (C-P2-7) of `08d-ponytail-desktop-cohort-import.md`.
Observed bugs are in `04-cohort-import-settings.md` (C-P2-6, C-P2-7). Code read at `bfd3d80e`.
Code was read only. Nothing here is implemented.

**Short answer**

1. **Chromosome names.** Store each chromosome in the form the build's reference sequence dictionary uses. For GRCh38 that is `chr1…chr22, chrX, chrY, chrM`. For GRCh37 it is `1…22, X, Y, MT`. Only the 25 primary chromosomes are renamed. Every other contig, and hg19 `chrM`, is stored as it came in. One shared helper does this at import, for query input and for BED/panel intervals. A one-way migration on both backends rewrites only the rows that are not in canonical form, then recomputes the derived tables.
2. **Denominator.** Show a *carrier frequency*, not an AF. It is the number of carriers divided by the ready cases **of the same build that hold at least one call of the same variant class**. The classes are small (SNV+indel), SV, CNV and STR. The case view and the cohort view use one shared expression. This expression already has an index on both backends (`idx_variants_case_type`), so no new table is needed.

---

## Part 1 · Chromosome naming

### 1.1 Standards (summary)

| Topic | What the standard says | Consequence for VarLens |
|---|---|---|
| VCF 4.3/4.4/4.5 | `CHROM` is a reference-sequence identifier. It must match a `##contig=<ID=…>` line and has a restricted character set. The spec does **not** treat `chr1` and `1` as aliases [1]. | The names are opaque strings. Equating them is our own decision, and only safe for the primary chromosomes. |
| GRCh38 conventions | The Broad/NCBI "GRCh38 no-alt analysis set" (GATK bundle, DRAGEN, gnomAD v3/v4 VCFs, GIAB) uses `chr1`, `chrM`. Ensembl/GRC FASTA uses `1`, `MT`. Hail's GRCh38 reference uses `chr*`, and its own `contig_recoding` example maps `1→chr1` [2]. Our own fixture says `assembly=human_GRCh38_no_alt_analysis_set` with `chr1`. | `chr*` is the de facto GRCh38 form. |
| GRCh37 vs hg19 | b37/1000G/gnomAD v2 use `1`, `MT`. UCSC hg19 uses `chr1`, `chrM`. | The primary chromosomes are identical sequences under both namings. |
| **Mitochondrion** | hg19 `chrM` = NC_001807 (Yoruba, 16,571 bp, positions shifted, more than 40 differences). GRCh37 `MT` = rCRS NC_012920 (16,569 bp). UCSC later added rCRS as `chrMT` in hg19.p13.plusMT. Bioconductor changed `seqlevelsStyle` so that it no longer maps hg19 `chrM→MT` [3][4][5]. In GRCh38, `chrM` = `MT` = rCRS. | Under GRCh37, `chrM` **must not** be merged with `MT`. Under GRCh38 they are the same sequence. |
| Alt/decoy/HLA/unplaced | GRCh38: `chr1_KI270706v1_random`, `chrUn_…`, `*_alt`, `chrEBV`, `HLA-A*01:01:01:01`. Ensembl/GenBank style: `KI270706.1`. GRCh37: `GL000192.1` vs `chr1_gl000192_random`. The only correct mapping is the NCBI assembly report alias columns (Sequence-Name / GenBank / RefSeq / UCSC-style-name) [6]. | Out of scope. Store these verbatim. They are rare in clinical exports and already rank as "other" (`OTHER_CONTIG_RANK`). |
| RefSeq / HGVS | HGVS g. uses accessions (`NC_000001.11:g.`). The version encodes the build (`.10` = GRCh37, `.11` = GRCh38). | Possible later: map `NC_0000NN.(10\|11)`. Not seen in any input today, so skipped. |
| GA4GH VRS / refget | Sequences are identified by digest (`SQ.…`). SeqRepo resolves aliases such as `GRCh38:1`, `refseq:NC_000001.11`. VRS IDs "collapse trivial differences in reference naming" [7]. | This is the principled end state. It is overkill for a local tool. Our helper is the cheap equivalent for the primary assembly. |

How other tools handle it. None of them guesses silently: each uses an explicit alias table that is keyed to a reference.
- `bcftools annotate --rename-chrs map.txt` [8].
- GATK/Picard: the sequence dictionary must match, otherwise the tool fails.
- VEP `--synonyms` (tab file, either direction) [9].
- Hail `contig_recoding` [2].
- igv.js: alias file, with `chr` add/strip built in [10].
- UCSC `chromAlias`.
- gnomAD browser variant IDs use the bare form `1-55516888-G-GA`.

### 1.2 Current state in VarLens (file:line)

**Stored value is raw.**
- `src/main/import/vcf/VcfMapper.ts:158` sets `chr: rec.chrom`.
- `src/main/import/transforms/ObjectFormatMapper.ts:126` and `FieldMapper.ts:61` do the same.
- There is no normalisation anywhere in `src/main/import/` except the BED key.

Entry points (where the build is known):
- `mapVcfRecord`, called from `workers/import-pipeline.ts:424`, `workers/postgres-vcf-stream.ts:78` and `ipc/handlers/import-logic-append.ts:162`.
- `createMapperPipeline` (JSON), at `workers/import-mapper-pipeline.ts:27`, used from `import-pipeline.ts:323` and `postgres-import-worker.ts:99`.

**Locus keys that use the raw `chr`**

| Key | Where | Build in key? |
|---|---|---|
| `cohort_variant_summary` PK `(chr,pos,ref,alt,variant_type,genome_build)` | SQLite `migrations.ts:1497-1523`, PG `0010_cohort_summary.sql:33` | yes |
| `variant_frequency` PK `(chr,pos,ref,alt)` / PG unique `coord_hash` | `migrations.ts:1228-1236`, PG `0003_create_variants.sql:66-80,144` | **no** |
| `variant_annotations` UNIQUE `(chr,pos,ref,alt)` (global star, comment, ACMG) | `migrations.ts:90-104`, PG `0005_create_workflow_tables.sql:1-14` | **no** |
| `variants.coord_hash` (PG, STORED generated from `chr`) | `0003_create_variants.sql:39-47` | no |
| summary `variant_key = chr:pos:ref:alt`, joined to `variant_annotations` | `src/shared/sql/cohort-summary-rebuild.ts:47,79-80` | no |
| `case_variant_annotations`, `variant_tags` | keyed by `variant_id` | not affected |

**Normalisation copies (5 strip-`chr` copies plus 1 shared)**
- `services/api/VepApiClient.ts:35`: `normalizeChromosome`, with M→MT. It is also imported by `src/web/server/api-fixture-responses.ts:10`.
- `services/api/SpliceAIApiClient.ts:119`, `services/api/MyVariantApiClient.ts:129`, `ipc/handlers/spliceai.ts:47` and `ipc/handlers/myvariant.ts:50`: `replace(/^chr/i,'')` with no M→MT.
- `src/shared/utils/par-regions.ts:39`: `normalizeChr`.
- `src/main/import/vcf/bed-filter.ts:13`: `contigKey`. Its `ponytail:` comment says "move both to src/shared if a third caller appears". That has now happened.
- Shared and already correct for sorting: `src/shared/sql/chromosome-order.ts:38` `normalizeContigName`, and `chrRankSql` (lines 89-96). The rank already ignores the prefix and treats `M`=`MT`. **The rank values and the expression indexes do not change when the stored `chr` is rewritten.**

**"Does this case use `chr`?" probes.** Each one samples a single row, so they break on mixed data:
- `database/VariantRepository.ts:268-273` (`getChrPrefix`)
- `ipc/handlers/panelIntervalHelper.ts:82`
- `database/panel-interval-resolution.ts:103`
- `storage/postgres/postgres-panel-interval-resolver.ts:104,124`

They feed `src/shared/filters/panel-intervals.ts:84-88`. The panel BED export hard-codes `chr` in two copies, `ipc/handlers/panels-logic.ts:414` and `panels-session.ts:192`, which is wrong for b37 users.

**Search.** `database/search/cohort-search-emitter.ts:20-26` already queries both forms (`IN (?, 'chr'||?)`). With `M` it does not find `MT`.

**External links.** `renderer/src/utils/externalLinks.ts:75` substitutes `{chr}` raw.
- With `chr*` data, Franklin `chr{chr}` (`stores/externalLinksStore.ts:82`) yields `chrchr1`, which is a live bug.
- UCSC (`:54`) needs `chr*`.
- gnomAD (`:44`), ClinVar (`:63`), VarSome (`:72`), LitVar (`:101`) and Ensembl (`:129`) expect or accept the bare form.

**Data-model bonus finding.** `variant_frequency` and `variant_annotations` have no build in their key. Today a GRCh37 case and a GRCh38 case with the same `1:12345 A>G` share an internal-AF count and an ACMG call, even though they are different loci. With the per-build canonical form (Option B), GRCh38 primary chromosomes are always `chr*` and GRCh37 primary chromosomes are always bare. Those keys become build-disjoint with **no schema change**.

### 1.3 Options

| | A · One bare form (`1`, `MT`) | **B · Per-build reference form** (GRCh38 `chr1`/`chrM`, GRCh37 `1`/`MT`) | C · Normalise only at query time |
|---|---|---|---|
| Matches | Ensembl, gnomAD IDs, VEP, ClinVar VCF, b37 | Each build's analysis-set FASTA / sequence dictionary (Hail's convention) | — |
| Migration rows rewritten | Practically **every GRCh38 row** (most modern data is `chr*`). On PG: 10k exomes ≈ 10⁹ row rewrites, plus `coord_hash` and `search_document` recomputes, WAL and bloat | Only rows in the minority style per build. Typically 0. A mixed lab: the mixed cases only | 0 |
| hg19 `chrM` | Must be special-cased (cannot become `MT`) | Natural: GRCh37 keeps `chrM` verbatim | Same problem in every expression |
| Build-less keys (`variant_frequency`, `variant_annotations`) | Still collide across builds | Become build-disjoint for primary chromosomes | Still collide |
| Index impact | none (rank is prefix-insensitive) | none | Breaks: `canon(chr)=?` is not sargable on `idx_*_chr_rank`, the keyset or the summary PK (08d #22) |
| Helper needs build | Only for mito | Yes (always known at import; for cohort input, expand to both forms) | Yes, everywhere |
| What users see | GRCh38 users lose their `chr` | Unchanged for the majority | Unchanged, but the summary still splits |

**Recommendation: B.** It makes the smallest data change. It is correct for mito. It also fixes the cross-build bleed in the two build-less tables for free. A is cleaner on paper, but it would force a near-total rewrite of the largest table at web scale for no clinical gain. C is the root cause of the bug, not a fix.

### 1.4 The helper (one file, replaces five copies)

`src/shared/utils/contig.ts` (about 30 lines). It is worker-safe because it has no imports beyond `chromosome-order.ts`.

```ts
import { normalizeContigName } from '../sql/chromosome-order'
const PRIMARY = new Set([...Array.from({ length: 22 }, (_, i) => String(i + 1)), 'X', 'Y'])

/** Stored form: the build's reference-dictionary name for the 25 primary contigs; anything else verbatim. */
export function canonicalContig(chr: string, build: 'GRCh37' | 'GRCh38'): string {
  const n = normalizeContigName(chr.trim())
  if (PRIMARY.has(n)) return build === 'GRCh38' ? `chr${n}` : n
  if (build === 'GRCh38' && (n === 'M' || n === 'MT')) return 'chrM'
  if (build === 'GRCh37' && n === 'MT') return 'MT' // rCRS; hg19 `chrM` is NC_001807 and stays verbatim
  return chr
}

/** Ensembl/GRC form for APIs and links (VEP, SpliceAI, MyVariant, gnomAD, ClinVar, Ensembl). */
export function bareContig(chr: string): string {
  const n = normalizeContigName(chr)
  return n === 'M' ? 'MT' : n
}
```

- `ponytail:` alt, decoy and unplaced contigs plus `NC_` accessions stay verbatim. Upgrade to the NCBI assembly-report alias table if a lab imports them.
- `bareContig` replaces `VepApiClient.normalizeChromosome` (keep it re-exported for the VEP cache key `vep:v2:…`, so the cache stays valid), plus the SpliceAI and MyVariant copies (×2 each), `par-regions.normalizeChr` and `bed-filter.contigKey`.
- Known limit: `bareContig('chrM')` on GRCh37 hg19 data maps to rCRS `MT`, so a VEP or link lookup would use shifted positions. The API clients do not get the build passed in today. Leave a `ponytail:` comment and pass the build later if mito queries matter.

**Call sites to change**

| Site | Change |
|---|---|
| Import | `mapVcfRecord(…, genomeBuild)` and `createMapperPipeline(…, genomeBuild)` apply `canonicalContig` once per row. That is 5 call sites, all of which already have the case build. |
| BED import filter (`bed-filter.ts`) | Key both sides with `canonicalContig(x, build)`. |
| Panels / region files | `buildPaddedPanelIntervals(coords, pad, build)` emits `canonicalContig(coords.chromosome, build)`. **Delete** the 4 single-row prefix probes and `getChrPrefix`. Region-file entries are stored raw (a region file has no build) and are canonicalised when resolved against the case. |
| Panel BED export (2 copies) | Use `canonicalContig(…, build)`. Leave the dedupe of the two copies out of scope. |
| Exact-variant filter (`core-filters.ts` `applyExactVariantMatch`, PG `PostgresVariantReadRepository.ts:245`) | Canonicalise `filter.chr` with the case build. |
| Cohort search (`cohort-search-emitter.ts:22-26`) | Keep the two-form `IN`. It covers both builds. Add `M`↔`MT`/`chrM`. |
| External links (`externalLinks.ts:75`) | `{chr}` = `bareContig(chr)`. Add `{chr_ucsc}` = `'chr' + (bare === 'MT' ? 'M' : bare)`. Change the UCSC template to `{chr_ucsc}`. This fixes Franklin `chrchr1`. User templates that already write `chr{chr}` keep working. |
| Display / export | Show and export the stored value. There is no preference setting and no `original_chr` column. The value equals the build's reference dictionary, which is exactly what re-annotation tools want. Anyone who needs the other style can use `bcftools annotate --rename-chrs`. |

### 1.5 Migration (SQLite v46, PG `0029`)

**Principle.** The migration is data-driven and idempotent. It rewrites only the `(build, chr)` pairs where `canonicalContig(chr, build) !== chr`. The pairs are computed in JS from the shared helper, so no SQL duplicate of the mapping exists. If no pair exists, nothing happens. That is the expected case for most databases.

**Step 0. Discover.** List the distinct names per build. This needs no full scan:
- SQLite: `SELECT DISTINCT c.genome_build, v.chr FROM variants v JOIN cases c ON c.id = v.case_id`, served by the `idx_variants_chr_*` index.
- PG: `SELECT DISTINCT genome_build, chr FROM cohort_variant_summary` UNION the cases that have not been summarised yet (`variants_all` per case, via `idx_variants_case_chr_rank`).

Build `pairs = [(build, from, to)]`. If `pairs` is empty, record the version and stop.

**Step 1. Backup (SQLite only, and only when `pairs` is not empty).** `db.backup(<db>.pre-v46.bak)`. This is the rollback. The migration is a one-way data change: the original style is not kept, by design.

**Step 2. `variant_annotations` merge.** This runs before the variants are rewritten, because this table is user-authored and is the only place where data could be lost. For each pair, the row `(from,pos,ref,alt)` is handled by case:

```sql
-- (a) No target row yet: move or copy.
--  Move when no variant of ANOTHER build still uses the old name; otherwise COPY,
--  because before this migration the row applied to both builds' loci.
INSERT INTO variant_annotations (chr,pos,ref,alt,global_comment,starred,acmg_classification,acmg_evidence,created_at,updated_at)
SELECT :to, pos, ref, alt, global_comment, starred, acmg_classification, acmg_evidence, created_at, :now
FROM variant_annotations s WHERE s.chr = :from
ON CONFLICT (chr,pos,ref,alt) DO UPDATE SET            -- (b) both exist → merge
  starred        = MAX(variant_annotations.starred, excluded.starred),           -- PG: GREATEST
  global_comment = NULLIF(TRIM(COALESCE(variant_annotations.global_comment,'') ||
                   CASE WHEN excluded.global_comment IS NOT NULL
                         AND excluded.global_comment <> COALESCE(variant_annotations.global_comment,'')
                        THEN char(10)||char(10)||excluded.global_comment ELSE '' END), ''),
  -- ACMG: keep the newer classification and evidence; the other one is written
  -- to audit_log (entity = annotation, action = 'contig-merge') together with
  -- the removed key, so no classification disappears silently.
  acmg_classification = CASE WHEN excluded.updated_at > variant_annotations.updated_at
                             THEN excluded.acmg_classification ELSE variant_annotations.acmg_classification END,
  acmg_evidence       = CASE WHEN excluded.updated_at > variant_annotations.updated_at
                             THEN excluded.acmg_evidence ELSE variant_annotations.acmg_evidence END,
  updated_at = :now;
DELETE FROM variant_annotations WHERE chr = :from AND :move = 1;
```

Write the `audit_log` rows with a `SELECT` before the upsert, for every key where both rows have an ACMG classification and the two differ. In practice this happens only when the same lab classified the same locus twice under two names.

**Step 3. `variants`.** Rewrite the rows. `case_variant_annotations` and `variant_tags` follow automatically, because they are keyed by `variant_id`.

```sql
-- SQLite: one transaction (desktop DBs are at most a few million rows).
UPDATE variants SET chr = :to
WHERE chr = :from AND case_id IN (SELECT id FROM cases WHERE genome_build = :build);
-- FTS: the variants_fts content follows the existing update triggers. If FTS is
-- external-content without triggers, rebuild once: INSERT INTO variants_fts(variants_fts) VALUES('rebuild').

-- PG: TS migration step (like fillClinvarSeverityLookup in definitions.ts), one
-- transaction PER CASE so row locks are short and a crash resumes (the WHERE makes it idempotent).
UPDATE "s"."variants_all" SET chr = $to
WHERE case_id = $case AND chr = $from;   -- uses idx_variants_case_chr_rank; coord_hash and search_document regenerate
```

The PG loop goes over `SELECT DISTINCT case_id FROM variants_all WHERE chr = ANY($froms)` in batches of 50 cases. It logs progress through `mainLogger`. The web server can stay up: readers see each case either before or after its rewrite, never half of one, because each case is one transaction.

**Step 4. `variant_frequency`.** Recompute exactly for the affected keys. A plain upsert-sum would double-count a case that held both names.
- SQLite: `recomputeAllFrequencies()` already exists (`VariantFrequencyService.ts:105`). It is cheap on desktop.
- PG: delete the rows whose `chr` is in `froms`. Then recompute the `:to` keys with `INSERT … SELECT chr,pos,ref,alt,COUNT(DISTINCT case_id) FROM variants WHERE chr = ANY($tos) AND (chr,pos,ref,alt) IN (affected) GROUP BY … ON CONFLICT (coord_hash) DO UPDATE SET case_count = excluded.case_count`.

**Step 5. Summaries.** Rebuild with the machinery that already exists, so there is no new aggregation SQL:
- SQLite: `REBUILD_VARIANT_SUMMARY_SQL` plus the gene-burden rebuild, run through the existing rebuild worker.
- PG: enqueue a full rebuild into `cohort_summary_rebuild_requests` (0024). This uses the chunked rebuild (`cohort-summary-rebuild-chunks.ts`) under `cohort-summary-lock.ts`. Then invalidate `cohort_column_meta` for `chr`.

**Step 6. Record the version.** The migration is idempotent, so a re-run finds `pairs = []` and does nothing.

**Lock duration**
- SQLite: one write transaction. That is seconds for a few million rows, and the app shows its existing migration splash.
- PG: per-case transactions only. The summary rebuild runs in the background with the existing "summary stale" banner.

**Tests** (both backends; the PG tests run in the `web-gate-postgres` suite)
1. Shared helper table test, 25 primary contigs × 2 builds: `chrM`/GRCh37 stays verbatim, `chrUn_x` stays verbatim, `Chr1`/`CHRX` are handled, trim works, and `bareContig` gives `chrM → MT`.
2. Import: a GRCh38 file with `1` and another with `chr1` give one cohort row with 2 carriers (the 08d #22 acceptance test). A GRCh37 file with `chr1` is stored as `1`.
3. Migration: a seeded mixed DB gives the expected rows, frequencies and summary. A second run is a no-op. An annotation collision gives a merged star and comment, the newer ACMG, and an `audit_log` row. A cross-build annotation is copied, not moved.
4. Panel: a GRCh37 bare case and a GRCh38 `chr` case both filter correctly with no prefix probe. Panel BED export is bare for GRCh37.
5. Links: Franklin gives `chr1-…` for both stored forms. UCSC gives `chrM` for MT.

---

## Part 2 · Cohort frequency denominator

### 2.1 Standards (summary)

- **AC/AN (gnomAD).** AN is the number of *called* alleles at the site. That needs explicit hom-ref calls (joint calling, or gVCF). In XY samples, non-PAR X and Y sites contribute 1 allele, and any ALT there is hemizygous. PAR sites count as autosomal [11][12]. **VarLens stores only carrier rows.** `VcfMapper.ts:70,91-97` drops `0/0` and `./.` for small variants. So VarLens cannot tell "not carried" from "not called", and cannot compute AN or AF.
- **Carrier, genotype and allele frequency.** Carrier frequency is the share of individuals with at least one ALT. Genotype frequency is the share per genotype class. Allele frequency is AC/AN. With variant sites only, the honest metric is the **carrier frequency over cases that had data**, and only as an upper-bound proxy.
- **In-house frequency in other tools.**
  - seqr shows callset AC/AF ("seqr frequency"). It can call this an AF because callsets are joint-called and include hom-ref. (From working knowledge; I did not re-check this.)
  - Emedgene, Franklin and VarSome Clinical expose an internal or "lab" frequency or a "seen in N cases" count, used for recurrence and artefact filtering.
  - Franklin documents applying BA1 from an internal DB only when there are at least 1,000 individuals and the frequency is above 5% [13][14]. This is vendor policy, not ClinGen policy.
- **ACMG/AMP 2015 and ClinGen SVI.** Frequency criteria (BA1, BS1, PM2) refer to *control/general population* data. Founder populations need care. SVI excludes founder groups such as FIN and ASJ from the BA1 population, and keeps a BA1 exception list [15][16]. A VarLens cohort is a cohort of **patients**. Recurrence there can mean a pathogenic founder or hotspot variant just as easily as a benign or artefactual one. **Local frequency must not drive BA1, BS1 or PM2.** It is a triage signal only: recurrent across unrelated cases means it is probably an artefact or a local polymorphism, and should be reviewed.
- **Assay mix.** A panel case has no data off-target, so it is not a "non-carrier" there. The same goes for WES outside the capture or callable BED, and for an SV-only case at an SNV site. Without callable-region BEDs the denominator includes non-callable cases, so the carrier frequency is an **underestimate of carrier frequency among callable cases**.
- **Variant classes.** SNV and indel callers share a callset. SV, CNV and STR come from different callers with different sensitivity, and SV identity really needs overlap matching (reciprocal overlap), not an exact key. Exact-key SV "carriers" are a lower bound.
- **Related individuals.** Trio members share variants. A family of three can triple the count.
- **Build mixing.** A GRCh37 coordinate and a GRCh38 coordinate are different loci. Numerator and denominator must use the same build.

### 2.2 What VarLens computes today

| Surface | Numerator | Denominator | Code |
|---|---|---|---|
| Cohort "Cohort Freq" (SQLite) | `carrier_count` = cases with ≥1 row at `(chr,pos,ref,alt,variant_type,build)`, any GT | ready cases **of the build, all variant types** | `database/cohort-frequency-sql.ts:27,33-35`, `shared/sql/cohort-summary-rebuild.ts:62-75` |
| Cohort (PG) | same | visible cases of the build, all types | `storage/postgres/postgres-cohort-summary-query.ts:58-68` |
| Case "Internal AF" (SQLite) | `variant_frequency.case_count` = cases at `(chr,pos,ref,alt)` **across builds and types** | **all** ready cases, all builds | `database/variant-filter/base-query-and-joins.ts:20-33`, `core-filters.ts:12-27,74-95`, `VariantFrequencyService.ts:16-27` |
| Case "Internal AF" (PG) | same (`coord_hash`) | all visible cases | `storage/postgres/PostgresVariantReadRepository.ts:225-233,259` |
| Cohort count pill | filtered rows | `unique_variants`, all types | `renderer/src/components/cohort/CohortFilterBar.vue:4` |

**Defects**

1. The denominator mixes variant types (C-P2-6, E-15).
2. **Case and cohort disagree.** The case view divides by all builds and its numerator mixes builds. This breaks the case↔cohort parity rule.
3. It is labelled an "AF" although it is a carrier fraction.
4. SV, CNV and STR rows with no-call GT are imported (`VcfMapper.ts:94-96`), so they count as carriers.
5. Hemizygous calls (`'1'`) fall in neither `het_count` nor `hom_count`, so Het + Hom < Carriers with no explanation.

Already right: the "Rare, not recurrent" preset filters by **carrier count** (`maxCarriers: 3`, PG `0028`). That is the robust recurrence filter for small cohorts.

### 2.3 Options

| | A · Keep all cases per build (status quo) | **B · Cases with data of the same class and build** | C · B plus callable-region / assay awareness |
|---|---|---|---|
| Definition | carriers / ready cases (build) | carriers / ready cases (build) holding ≥1 call of the class (small = snv+indel, sv, cnv, str) | carriers / cases whose target or callable BED covers the position |
| Correct for SV-only or STR-only cases | no | yes | yes |
| Panel vs exome mix | no | no (labelled) | yes |
| Cost | 0 | One tiny `GROUP BY` subquery over `cases`, with EXISTS probes into the **existing** `idx_variants_case_type` (SQLite `migrations.ts:1711`, PG `0003:136`). About 10k cases × 4 classes means about 40k index seeks, a few ms. No new table, no migration. | A per-case callable BED store, an interval join per row, and import UX for BEDs. Large. |
| Recommendation | — | **DO** | Not now. Revisit when labs import capture BEDs (`case_data_info.region_filter` exists but is free text). |

Rejected: storing a per-case type list. `case_import_files` (`migrations.ts:1464`) has `variant_type`, but only the desktop multi-file import writes it (`import-logic.ts:321,401`). PG and JSON imports never do.

### 2.4 Recommended definition and SQL

**Carrier frequency** = carriers ÷ ready cases of the same genome build that contain at least one call of the same variant class.

**Shared fragment.** Put it in `src/shared/sql/`, because it is valid on both dialects. It replaces `COHORT_BUILD_TOTALS_JOIN` and `summaryBuildTotalsJoin`:

```sql
LEFT JOIN (
  SELECT c.genome_build AS build, t.vclass, COUNT(*) AS total
  FROM cases c
  CROSS JOIN (SELECT 'small' AS vclass UNION ALL SELECT 'sv' UNION ALL SELECT 'cnv' UNION ALL SELECT 'str') t
  WHERE c.import_status = 'ready'            -- PG: the visible `cases` view, no predicate
    AND EXISTS (SELECT 1 FROM variants v WHERE v.case_id = c.id
                AND v.variant_type IN (CASE t.vclass WHEN 'small' THEN 'snv' ELSE t.vclass END,
                                       CASE t.vclass WHEN 'small' THEN 'indel' ELSE t.vclass END))
  GROUP BY c.genome_build, t.vclass
) bt ON bt.build = cvs.genome_build
    AND bt.vclass = CASE WHEN cvs.variant_type IN ('snv','indel') THEN 'small' ELSE cvs.variant_type END
```

- Cohort: `COHORT_FREQUENCY_SQL` and `SUMMARY_FREQUENCY_SQL` stay the same, because they already divide by `bt.total`.
- `cohortSortExpression`'s single-build shortcut (sort by `carrier_count`) stays valid only when a single **type** is also selected. Add that condition (one line).
- **Case view.** Replace the build-less scalar `(SELECT COUNT(*) FROM cases …)` in `base-query-and-joins.ts:29`, `core-filters.ts:18-24` and PG `:225` with the same subquery, keyed by the case's build and the row's class. The case and cohort figures then match by construction.
- Case-view numerator: `variant_frequency` still mixes builds where both builds use the same names. With Part 1 Option B, GRCh37 and GRCh38 primary chromosomes no longer share names, so this goes away without a schema change. If B is not adopted, read `cohort_variant_summary.carrier_count` instead. Check that summary is fresh on PG first.
- Index caveat: while a SQLite import has the secondary `variants` indexes dropped, the EXISTS falls back to `idx_variants_case_id`. Cohort reads during an import are already flagged stale.

**Not now (named, skipped)**
- Family dedup through `analysis_groups` (counting one carrier per family). The tooltip states the limit instead.
- SV overlap matching.
- Callable-region denominators.
- AF/AN.
- A sex-aware AN.

### 2.5 Hemizygous X in males

- Carrier frequency counts a hemizygous male once. That is correct for a *carrier* metric, so no AN maths is needed.
- Show the remainder: Het / Hom / **Hemi**, where hemi = `carrier_count − het_count − hom_count`, which is display-only. The existing `isInPAR` (`par-regions.ts`) explains PAR rows.
- Do not "correct" `1/1` on male non-PAR X into hemi in the cohort. That is a calling-convention question (diploid callers emit `1/1`), and changing it here would diverge from the case view.

### 2.6 UI copy

| Place | Copy |
|---|---|
| Column header (case and cohort) | **Cohort carrier freq.** (was "Cohort Freq" / "Internal AF") |
| Cell | `3.5 %` with `12 / 340` in secondary text, or in the tooltip on narrow layouts |
| Tooltip | "12 of 340 GRCh38 cases with SNV/indel data carry this variant. This is not an allele frequency: cases without a call are counted as not carrying it, cases whose assay does not cover this position are included, and related individuals are counted separately. Use it to spot recurrent or artefactual calls, not for ACMG BA1/BS1/PM2." |
| SV/CNV/STR tooltip addition | "Exact breakpoint matches only. Overlapping calls with different breakpoints are counted as different variants." |
| Filter label | "Max cohort carrier frequency". Keep "Max carriers" as the primary recurrence filter. |
| Count pill (08d #21 "now") | `CohortFilterBar.vue:4`: total `null` when a type tab is active. Later: per-type `unique_variants`. |
| Docs (`docs/`) | One FAQ entry: "How is the cohort carrier frequency calculated?" It repeats the tooltip and explains why it is not gnomAD-comparable. |

---

## Risks

1. **The chr migration is one-way.**
   - SQLite: mitigated by the pre-migration backup.
   - PG: depends on the operator's backup. The release notes must say this.
   - Merging annotations can join two comments, and keeps the newer ACMG with an audit entry.
2. **The mito edge.** GRCh37 `chrM` (hg19) keeps its own name. Its external links and VEP calls may still hit rCRS (see the `ponytail:` note).
3. **The import contract changes.** A GRCh38 bare-named VCF is now *displayed* as `chr1`. Users may notice this. Add a release-note line and an import-summary line: "Chromosome names normalised to the GRCh38 reference (chr1…)".
4. **A wrong declared build gives wrong names.** For example, a GRCh37 file declared as GRCh38 gets the `chr` prefix. Build detection (`I-P2-3`) becomes slightly more load-bearing. That is already a trust issue with its own fix.
5. **Denominator subquery cost on PG at 10k cases.** It is cheap thanks to the index, but it runs per query. If profiling shows otherwise, wrap it in the existing column-meta cache. Do not add a table up front.
6. **Behaviour change in filters.** Frequencies rise wherever SV-only or STR-only cases existed, so saved `max_internal_af` presets match fewer variants. Mention this in the release notes.
7. **Out of scope, flagged.** `variant_annotations` and `variant_frequency` have no build column. Part 1 Option B makes them disjoint for primary contigs. Alt contigs that are named identically across builds still collide, but that is negligible.

## Implementation size

| Change | Size | PR |
|---|---|---|
| Shared `contig.ts` and table test; delete 5 copies and 4 prefix probes | +45 / −60 | 1 |
| Import call sites (5), BED filter, panels, panel BED export, exact filter, search M/MT, links `{chr}`/`{chr_ucsc}` | +40 / −25 | 1 |
| Migration SQLite v46 (own module, `migrations.ts` is 2,008 lines) and PG `0029` TS step; tests on both backends | +220 | 2 (own spec: user data) |
| Denominator fragment, both views, both backends; sort shortcut; tests on both backends | +60 / −20 | 3 |
| UI header, tooltip, Hemi remainder, pill null, FAQ | +40 | 3 |

The total is about +400 / −105 across 3 PRs. PR 1 and PR 3 are independent. PR 2 depends on PR 1. PR 1 fixes all new imports immediately, and PR 2 fixes existing data.

## Sources

1. VCF spec and contig-name discussion. hts-specs: https://github.com/samtools/hts-specs (VCFv4.3–4.5 §1.4.7). Issue https://github.com/samtools/hts-specs/issues/89
2. Hail `import_vcf` `contig_recoding` and the GRCh38 `chr` contigs: https://hail.is/docs/0.2/methods/impex.html
3. UCSC hg19 README (chrM NC_001807, chrMT in p13.plusMT): https://hgdownload.soe.ucsc.edu/goldenPath/hg19/bigZips/README.txt
4. Bioc-devel, BSgenome/`seqlevelsStyle` chrM vs MT: https://r-mailing-lists.thecoatlessprofessor.com/lists/bioc-devel/msg/msg-a0c06286094e
5. Ensembl dev list, hg19 vs GRCh37: https://lists.ensembl.org/pipermail/dev_ensembl.org/2012-February/002173.html
6. NCBI GRCh38.p14 assembly report (alias columns): https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/001/405/GCF_000001405.40_GRCh38.p14/GCF_000001405.40_GRCh38.p14_assembly_report.txt
7. GA4GH VRS computed identifiers and refget: https://vrs.ga4gh.org/en/2.0/conventions/computed_identifiers.html and https://vrs.ga4gh.org/en/2.0/conventions/required_data.html
8. bcftools annotate `--rename-chrs`: https://samtools.github.io/bcftools/bcftools.html#annotate. Usage example: https://biostars.org/p/9569915
9. VEP `--synonyms`: https://lists.ensembl.org/pipermail/dev_ensembl.org/2017-February/007296.html. Also https://github.com/Ensembl/ensembl-vep/issues/1570
10. igv.js reference genome aliasing: https://igv.org/doc/igvjs/Reference-Genome/ and https://igv.org/doc/desktop/FileFormats/Genomes/
11. gnomAD hemizygous counts: https://discuss.gnomad.broadinstitute.org/t/interpretation-of-homozygous-and-hemizygous-counts-on-gnomad-variants/299
12. Lessons from gnomAD (AN depends on the calling dataset): https://arxiv.org/pdf/2107.11458
13. Franklin frequency rules (PM2/BS1/BS2/BA1): https://help.genoox.com/en/articles/6881015-frequency-rules-pm2-bs1-bs2-ba1
14. Emedgene ACMG criteria evaluation: https://help.connected.illumina.com/emedgene/emedgene-analyze-manual/variant_page/evidence_section/individual-acmg-criteria-evaluation
15. Ghosh et al. 2018, ClinGen SVI BA1 recommendation: https://pmc.ncbi.nlm.nih.gov/articles/PMC6188666
16. Specification of frequency criteria for secondary-findings genes (2025): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12458940/
- Richards et al. 2015, ACMG/AMP standards (frequency criteria use population and control data): https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753
