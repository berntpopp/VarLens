---
name: varlens-vcf-import
description: Use when extending or debugging VarLens VCF import — mapping a new INFO field to a DB column, changing annotation parsing (VEP CSQ or SnpEff ANN), touching multi-allelic splitting, genotype/sample handling, SV/CNV/STR extension fields, or anything under src/main/import/vcf/. Also use before assuming which column holds the impact level vs the Sequence Ontology term.
metadata:
  version: "1.0.0"
  updated: "2026-07-06"
---

# VarLens VCF import pipeline

## Overview

VCF import in `src/main/import/vcf/` is deliberately modular. One raw data line flows
through a fixed pipeline and ends as zero-or-more rows in the **unified `variants`
table** — the same table JSON imports write. Understand the flow before editing any stage:

```
vcf-header-parser  → sample names, INFO/FORMAT defs, annotation type (csq|ann), CSQ subfields
vcf-line-parser    → one VcfRawRecord (pure string parsing)
vcf-allele-splitter→ multi-allelic → biallelic, respecting Number=A/R/G semantics, remaps GT
vcf-annotation-parser → extract CSQ/ANN, pick best transcript, map to AnnotationResult
vcf-genotype-parser → per-sample GT/GQ/DP/AD (+ computed AB)
info-field-registry → mapped INFO fields → typed columns; everything else → info_json
VcfMapper          → orchestrates all of the above into VcfMappedVariant rows
VcfStrategy        → streams the file, drives the mapper, batches inserts
```

Both VCF and JSON imports converge at `VariantRepository.insertBatch()` — the single
`insertInto('variants')` (plus child inserts into `variant_transcripts`,
`variant_sv`/`variant_cnv`/`variant_str`). Postgres mirrors the column list in
`src/main/storage/postgres/postgres-import-columns.ts`.

## ⚠️ The consequence / func trap (read before touching mapping)

The two most confusable columns. On the **`variants`** table:

- **`consequence` = IMPACT level** — `HIGH` | `MODERATE` | `LOW` | `MODIFIER`
- **`func` = Sequence Ontology term** — `missense_variant`, `stop_gained`, `splice_acceptor_variant`, …

The names are counter-intuitive, and `VcfMapper.ts` assigns them **crossed** relative
to the annotation object:

```ts
// VcfMapper.ts — the assignment that trips everyone up
consequence: annotation.impact,        // IMPACT level → column named "consequence"
func:        annotation.consequence,   // SO term      → column named "func"
```

`annotation.impact` comes from CSQ `IMPACT` / ANN field 2; `annotation.consequence`
comes from CSQ `Consequence` / ANN field 1 (`vcf-annotation-parser.ts`).

**Extra asymmetry:** on the child **`variant_transcripts`** table, the `consequence`
column holds the **SO term** — the opposite of the main-variant `consequence` column.
Don't assume a column named `consequence` means the same thing across tables.

This contract is locked by `tests/main/import/vcf/vcf-mapper.test.ts`
(`consequence === 'MODERATE'`, `func === 'missense_variant'`). If you "fix" a
perceived swap, that test will stop you — it is correct, not the bug.

## Recipe: map a new INFO field to a DB column

The registry (`info-field-registry.ts`) is data-driven. An entry:

```ts
{
  infoIds: ['gnomADe_AF', 'gnomADg_AF', 'AF'],   // INFO keys to match, in alias order
  column: 'gnomad_af',                            // target column on `variants`
  type: 'float',                                  // 'float' | 'integer' | 'string'
  csqField: 'gnomADe_AF',                         // optional CSQ subfield that also feeds it
  description: 'gnomAD population allele frequency'
}
```

1. **If the target column already exists** (`gnomad_af`, `cadd`, `clinvar` are the only
   defaults): add one entry to `DEFAULT_INFO_FIELD_MAPPINGS`. Done.
2. **If CSQ/ANN should also populate it and win over standalone INFO**: also add the
   column to `COLUMN_TO_ANNOTATION_FIELD` (annotation value takes priority; a non-null
   annotation value suppresses the registry value).
3. **If the column is genuinely new** (not just a new INFO alias for an existing column),
   this is a bigger change than a registry edit. You must also add the column to:
   `VariantInsertRow` (`src/shared/types/import-worker.ts`), the Kysely insert in
   `VariantRepository.insertBatch()`, the Postgres column list
   (`postgres-import-columns.ts`), and a migration. Treat that as a schema change, not
   an import tweak — and it spans the storage boundary, so plan it as a staged change.

Note: `CSQ` and `ANN` themselves are excluded from `info_json` — they're consumed by the
annotation parser and never stored raw.

## Multi-sample VCFs → one case per sample

`VcfStrategy` imports **exactly one sample per call** (reads
`selectedSamples[0]`). The fan-out to N cases happens in the **renderer**:
`ImportWizard.vue` loops selected samples and calls `api.import.start(path, caseName,
{ selectedSample })` once per sample; each call creates a distinct case. If you're
changing sample→case behavior, the loop is in the renderer, not the strategy.

## Testing

Test dir: `tests/main/import/vcf/`. Test data: `tests/test-data/vcf/` (GIAB Chinese
Trio, GRCh38 chr22, in plain / `.vep.` (CSQ) / `.snpeff.` (ANN) flavors, plus hand-written
`synthetic-*.vcf`). Regenerate GIAB data with `scripts/prepare-test-data.sh` — but the
synthetic files are checked in by hand and NOT regenerated.

- **New mapped INFO field** → unit-test `applyInfoFieldRegistry` following
  `info-field-registry.test.ts` (map-to-column, annotation-priority skip,
  unmapped→info_json, CSQ/ANN-excluded cases).
- **End-to-end** → follow `vcf-strategy.test.ts`: create a case, run `strategy.import`
  with `selectedSamples`, `SELECT * FROM variants`, assert the new column. If the fixture
  doesn't carry your INFO field, add a small synthetic `.vcf` with the field in its
  `##INFO` header and data lines rather than editing the GIAB fixtures.

Run tests on the Node ABI — see `varlens-native-rebuild` (`make rebuild-node` first).

## Common mistakes

- **"Fixing" the consequence/func assignment.** It is intentional. See the trap above.
- **Adding a registry entry for a column that doesn't exist.** A new column is a schema
  change across four files + a migration + both storage backends, not a one-line registry edit.
- **Editing `VcfStrategy` to handle multiple samples.** The per-sample fan-out is in the
  renderer's `ImportWizard.vue`.
- **Regenerating test data to add a fixture.** `prepare-test-data.sh` rebuilds only the
  GIAB-derived files. Add a checked-in synthetic `.vcf` for bespoke cases.
