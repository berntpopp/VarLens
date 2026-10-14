# Real VEP-annotated CNV/SV import check (2026-10-14)

Refs #600. Local-only run: one patient's annotation-workflow output
(`*.cnv.vep.vcf.gz`, `*.sv.vep.vcf.gz`; VEP 115.2, GRCh38) imported through
`streamInsertVcf` (the SQLite import pipeline) with the bundled gene reference,
into a scratch DB outside the repo. Aggregates only; no sample ids,
coordinates or genotypes. AnnotSV sidecars are not read by VarLens.

## Root-cause finding: CSQ was dropped for every symbolic ALT

VEP writes a symbolic ALT's CSQ `Allele` as its SO class (`<DUP>` →
`duplication`, `<DEL>` → `deletion`). `csqAlleleSpellings` only knew the ALT
string, so no CSQ entry matched and the record imported as if unannotated.

| CNV file (101 records) | before fix | after fix |
|---|---|---|
| gene from CSQ | 0 | 100 |
| gene from fallback (`gene-fallback.ts`) | 100 | 0 |
| `consequence` (IMPACT) set | 0 | 101 |
| `func` (SO term) set | 0 | 101 |
| `variant_transcripts` rows | 0 | 9344 |

SV file (319 records): mostly sequence-resolved Sniffles calls, so only the one
symbolic `<DUP>` changed (CSQ gene 279 → 280, consequence 316 → 317).

Fix: `src/main/import/vcf/vcf-csq-allele.ts` also accepts VEP's SO name for
`<DEL|DUP|INS|INV|CNV…>`.

## After the fix

| | CNV | SV |
|---|---|---|
| rows imported / skipped | 101 / 0 | 319 / 0 |
| `variant_type` | cnv 101 (all `<DUP>`) | sv 319 (DEL 155, INS 161, DUP 1, BND 2) |
| with gene | 100 (all from CSQ) | 290 (280 CSQ, 10 fallback) |
| consequence = IMPACT | HIGH 91, MODIFIER 10 | MODIFIER 312, HIGH 4, MODERATE 1, null 2 |
| func = SO term (top) | transcript_amplification 89 | intron_variant 190 |
| `end_pos` / `sv_type` / `sv_length` | 101 / 101 / 101 | 317 / 319 / 317 (BND have no END/SVLEN) |
| `variant_cnv.copy_number` / `copy_number_quality` | 101 / 101 | n/a |
| `variant_cnv.homozygosity_*` | 0 (see gaps) | n/a |
| `variant_sv` rows | n/a | 319 |

## Multi-gene CNVs

- One gene is picked per row by `selectBestTranscript`
  (MANE Select +1000 > CANONICAL +100 > IMPACT×10 > protein_coding +5).
- All overlapped genes survive in `variant_transcripts` (one row per CSQ
  transcript, `gene_symbol` per row). Distinct genes per CNV: 1 → 8, 2 → 14,
  3 → 27, 4 → 19, 5 → 12, 6–9 → 15, ≥10 → 5 (92/101 multi-gene; counts include
  up/downstream genes within VEP's 5 kb window).
- `info_json` holds no CSQ; 23 rows keep SnpEff `LOF`/`NMD` gene lists.

## Gaps (not fixed here)

1. **Pick rule favours MANE over severity.** 10/101 CNVs select a MODIFIER MANE
   transcript although a HIGH `transcript_amplification` transcript exists; 1
   selects a `downstream_gene_variant` gene. Smallest fix: for SV/CNV records rank
   IMPACT above MANE in `selectBestTranscript` (SNV ranking unchanged).
2. **Phenotype scoring sees one gene.** `GeneContextBuilder` /
   `hpoResnik(row.gene_symbol)` score only the picked gene, so the other genes of
   92/101 CNVs never reach HPO scoring. Smallest fix, no schema change: for SV/CNV
   rows take the max `hpoResnik` over the row's distinct
   `variant_transcripts.gene_symbol` (overlapping consequences only).
3. **Spectre `HO` is a single value** (`0.0`) despite `Number=2`, so
   `extractCnvFields` stores no homozygosity. Which side one value means is not
   documented; left as is.
