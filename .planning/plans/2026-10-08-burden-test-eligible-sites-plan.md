# Burden Test: Eligible Sites, Missing Calls and Minor Allele Frequency (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict the gene burden test to autosomal sites of one genome build where every selected sample has a known call, weight by minor allele frequency, and report per gene how many sites were used and excluded and per run how many qualifying variants are not on an autosome.

**Architecture:** Both `AssociationDataBuilder`s (SQLite, PostgreSQL) run the same two-step SQL: a CTE selects qualifying site keys with all filters, then every stored row of the selected cases at those keys is read without row filters. The shared `src/main/statistics/contingency.ts` turns those rows into the matrix: it carries a missing dosage, drops incomplete sites for all samples, and counts exclusions. Nothing is imputed, and there is no schema change.

**Tech Stack:** TypeScript 6, `better-sqlite3-multiple-ciphers`, `pg`, Vitest, Vue 3.5 + Vuetify 4.

**Spec:** `.planning/specs/2026-10-08-burden-test-eligible-sites.md` — **phase 1 only** (section "Phase 1 design", items 1-8). Issue #520; also closes the "association filters accepted then dropped" item of #510.

**Runs in parallel with two other plans** (cohort row identity #503; max carrier cases filter #455). Files this plan shares with them:

| File | What this plan changes | Merge note |
| --- | --- | --- |
| `src/shared/types/ipc-schemas.ts` | Deletes two lines inside `AssociationConfigSchema.filters` (`:732-733`) | Line-local; rebase is trivial |
| `src/main/database/variant-where-builder.ts` | **Not touched** | `buildBaseWhere` and `BaseFilterInput` stay as they are |
| `src/web/server/routes/cohort.ts`, `src/main/workers/db-worker-dispatch.ts`, `src/main/ipc/handlers/cohort*.ts` | **Not touched** | On the cohort row identity plan's list; this plan needs none of them |

Other files this plan touches that the sibling plans might also open: `src/shared/sql/chromosome-order.ts` (one added export), `.planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md`, `docs/features/cohort-analysis.md`.

## Global Constraints

- Phase 1 only. Do not implement chrX (phase 2) or a callable mask. Do not touch `src/shared/utils/par-regions.ts`.
- Do not change the genotype resolver used outside the association test: `src/shared/utils/genotype.ts` and `src/shared/sql/genotype-dosage.ts` stay unchanged.
- No schema change, no migration.
- Both backends in every behaviour change; the two builders return the same matrix and the same exclusion counts.
- Exclusion reason identifiers, exactly: `missing_call`, `conflicting_calls`, `no_called_alleles`. Run-level field: `non_autosomal_variants`.
- The shipped genotype classes stay: an assumed het (`1/.`, `./1`) is dosage 1 and never excludes its site; a reference half-call (`0/.`) is dosage 0 with two called alleles. Missing is only the unknown class (`./.`, NULL, other text) or duplicate rows that disagree in dosage.
- The duplicate rule is for the association test only. The cohort summary and the carrier list keep "highest dosage" (#516).
- Result view and export state, exactly: `Samples without a stored call are treated as reference. Use data called and filtered the same way for both groups.` No checkbox.
- Eligible sites are autosomes 1-22 only. chrX, chrY, MT and every other contig are excluded.
- No `console.*`. Source files stay under 600 lines, functions under about 80 lines.
- Never lower a coverage, lint or typecheck threshold.
- Before each commit run `npx prettier --write` and `npx eslint` on the files the task touched (test code in this plan is not pre-wrapped to the 100-column limit).
- Conventional Commits. End each commit message with the `Co-Authored-By` trailer the session supplies.
- `make rebuild-node` once before the first Vitest run in this worktree.
- Each task ends with typecheck and the default test suite green. The PostgreSQL-gated tests (`VARLENS_RUN_POSTGRES_E2E=1`) are green again after Task 5, not after Task 4.

## Decisions taken from the code (read before starting)

1. **Chromosome naming.** `VcfMapper.ts:158` stores `chr: rec.chrom` verbatim, so `chr1` and `1` both occur. Autosomes are selected with the existing `chrRankSql()` (`src/shared/sql/chromosome-order.ts:66`), which ignores the prefix and its case and ranks 1..22 as 1..22. `inheritance-sql.ts:42` has `NON_AUTOSOME_RANKS`, but it keeps unplaced contigs (rank 100), so it is not reused.
2. **Missing dosage comes from SQL.** `gtDosageSql` returns `NULL` for every call outside the carrier and reference classes. SQLite passes that `null` through today; the Postgres builder turns it into 0 (`PostgresAssociationDataBuilder.ts:138`). The builders now both carry the `NULL` (row type `number | null`, and that one line). `gtDosageSql` also gives `NULL` for a reference half-call (`0/.`, `./0`, `0|.`, `.|0`), which the spec keeps as dosage 0 with two called alleles. `contingency.ts` therefore reads a `NULL` dosage as 0 when `calledAlleleCount(gt_num) > 0` and as missing otherwise. That reuses the shipped function and changes neither `genotype.ts` nor `genotype-dosage.ts`. An assumed het (`1/.`, `./1`) is dosage 1 in SQL already.
3. **Duplicate rows.** A case's rows at one site agree when every row has the same dosage (a missing dosage counts as a value). Otherwise the call is missing. `./.` twice is one missing call, not a conflict.
4. **One site set per gene.** Site eligibility is judged on all selected samples (both groups), so Fisher and the burden score use the same sites and swapping the group labels cannot change them. A conflict outranks a missing call when both occur at one site.
5. **Sites used.** `GeneAssociationResult.n_variants` already is the number of sites in the matrix. It stays, and now means "sites used". The new field is `sites_excluded`.
6. **A gene with no usable site** stays in the results with `n_variants: 0`, no Fisher p-value and the existing `ZERO_BURDEN` warning. It does not enter the FDR correction.
7. **Covariates.** `burden.ts:10` keeps dropping incomplete samples at test time. The frequency loop in `contingency.ts` now runs over the same complete-covariate samples, so weights describe them. Fisher still counts every sample.
8. **Non-autosomal count.** Both builders' `build()` now returns `{ genes, non_autosomal_variants }`. The count is a second query with the same filters and `NOT (autosome)`, counting distinct `chr:pos:ref:alt`. The alternative, a second builder method, would need a new db-worker task and touch `db-worker-dispatch.ts` and `db-task.ts`, which the cohort row identity plan edits; the dispatch line passes the builder's result through unchanged.
9. **Mixed genome builds** throw `InvalidParametersError` (`src/main/ipc/errors.ts:11`) from a shared pure check both builders call. It survives the worker boundary (`worker-error-codec.ts:38`), `wrapHandler` shows its `userMessage`, and the web dispatcher maps its code to HTTP 400. No route change.
10. **SQLite parameters.** Case ids are bound once, in a `picked` CTE that both steps read. The bundled SQLite allows 32766 bound parameters; binding the ids twice would halve the usable cohort size.
11. **`gnomad_af` on the row** is selected by both builders and never read by `contingency.ts`. The weight uses the frequency among the analysed samples. This plan leaves the column in the row type.
12. **Golden references** (`tests/fixtures/golden/*.json`) hold numbers only: Fisher tables, p-value lists, burden vectors, and weights for `maf` 0.001 to 0.5. They contain no chromosome and no genotype call, and `min(p, 1 - p)` is the identity up to 0.5. Nothing is regenerated; `scripts/generate-golden-references.py` is not run.
13. **Mock API.** `src/renderer/src/mocks/mockApi.ts:708` returns `results: []` and no gene result. Task 7 adds `non_autosomal_variants: 0` to it.

## Review Focus

1. **Every site of a gene is excluded** — the gene is listed with 0 sites, its exclusion counts and no p-value, and it does not change other genes' q-values. Test: Task 2.
2. **Chromosome spelling** — `1` and `chr1` are both autosomes; `X`, `chrX`, `chrY`, `chrM`, `MT` and `chrUn_…` never enter a result and are all counted in `non_autosomal_variants`. Test: Task 4 fixture.
3. **A carrier's row names another gene or none** (annotation differs between files) — the sample is still read as a carrier of the site. Test: Task 4 fixture (S4 at `chr1:100`).
4. **No sample has complete covariates** — every site is `no_called_alleles`; the run reports it and does not divide by zero. Test: Task 3.
5. **Large case lists on SQLite** — 20,000 selected cases do not hit "too many SQL variables". Test: Task 4.

Not covered by a test, to be checked in review: query time of the collect step on a large database. It joins on `(chr, pos, ref, alt)` (`idx_variants_chr_pos_ref_alt` on SQLite, migration `0009_idx_variants_coords.sql` on PostgreSQL) and reads the rows of all cases at each selected site before it filters by case.

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `src/main/statistics/weights.ts` | Weight on `min(p, 1 - p)` |
| `src/main/statistics/types.ts` | `SiteExclusionReason`, `SiteExclusionCounts`, `sites_excluded` on both gene types; `AssociationBuildResult`; `non_autosomal_variants` on `AssociationResults`; `VariantFilters` without the two dropped fields |
| `src/main/statistics/finalize.ts`, `AssociationEngine.ts`, `src/main/ipc/handlers/association-logic.ts`, `src/web/server/association/web-association-runs.ts` | Pass `non_autosomal_variants` from the builder to the run result |
| `src/main/statistics/contingency.ts` | Missing dosage, duplicate-row agreement, complete-site rule, exclusion counts, frequency over tested samples, `assertSingleGenomeBuild`, `hasCompleteCovariates` |
| `src/main/statistics/gene-tests.ts` | Passes `sites_excluded` on; no Fisher test without a site |
| `src/main/statistics/burden.ts` | Uses `hasCompleteCovariates` |
| `src/shared/sql/chromosome-order.ts` | New `autosomeSql()` |
| `src/main/database/AssociationDataBuilder.ts` | Build check, autosomes, select-then-collect, non-autosomal count (SQLite) |
| `src/main/storage/postgres/PostgresAssociationDataBuilder.ts` | The same on PostgreSQL |
| `src/shared/types/ipc-schemas.ts` | `AssociationConfigSchema` without the two dropped fields |
| `src/renderer/src/utils/association-results.ts` (new) | The stated sentence, excluded-site labels, TSV export text |
| `src/renderer/src/components/association/AssociationResultsTable.vue` | Shows the sentence and the excluded sites; exports through the util |
| `src/renderer/src/components/association/GeneBurdenView.vue` | Result type gains `sites_excluded` |
| `tests/main/database/support/burden-fixture.ts` (new) | One dataset and its expected matrix, used by the SQLite tests and the parity test |

---

### Task 1: Weight on the minor allele frequency

**Files:**
- Modify: `src/main/statistics/weights.ts:7-17`
- Test: `tests/main/statistics/weights.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeWeight(scheme: WeightScheme, maf: number, cadd: number | null): number` — unchanged signature; `maf` is the ALT allele frequency `p`, the weight is taken at `min(p, 1 - p)`.

- [ ] **Step 1: Write the failing test**

Add inside `describe('beta_maf', …)` in `tests/main/statistics/weights.test.ts`, after the golden loop:

```ts
    it('uses the minor allele frequency: p = 0.75 is weighted as 0.25 (#520)', () => {
      expect(computeWeight('beta_maf', 0.75, null)).toBe(computeWeight('beta_maf', 0.25, null))
      expect(computeWeight('beta_maf', 0.75, null)).toBeCloseTo(0.025084781938833345, 12)
      // A fixed ALT allele (p = 1) has no minor allele: same weight as p = 0.
      expect(computeWeight('beta_maf', 1, null)).toBe(computeWeight('beta_maf', 0, null))
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/statistics/weights.test.ts`
Expected: FAIL — `expected 8.88e-14 to be 0.02508…` (the weight is taken at 0.75).

- [ ] **Step 3: Write minimal implementation**

In `src/main/statistics/weights.ts` replace lines 4-11 (the doc comment through `betaWeight`):

```ts
/**
 * Variant weight from the ALT allele frequency `maf` among the analysed
 * samples and an optional CADD score. The Beta(1,25) weight is defined on the
 * minor allele frequency, so it is taken at min(p, 1 - p).
 */
export function computeWeight(scheme: WeightScheme, maf: number, cadd: number | null): number {
  if (scheme === 'uniform') return 1.0

  const minorAf = Math.max(1e-8, Math.min(maf, 1 - maf))
  const betaWeight = jStat.beta.pdf(minorAf, 1, 25)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/statistics/weights.test.ts`
Expected: PASS, including the seven golden weights (all at `maf` ≤ 0.5).

- [ ] **Step 5: Commit**

```bash
git add src/main/statistics/weights.ts tests/main/statistics/weights.test.ts
git commit -m "fix(statistics): burden weight uses the minor allele frequency (#520)"
```

---

### Task 2: Missing dosage, complete-site rule and exclusion counts

**Files:**
- Modify: `src/main/statistics/types.ts:48-56`, `:88-98`
- Modify: `src/main/statistics/contingency.ts` (whole file below; current lines 1-39 and 78-184 change, `buildCovariateMap` at 41-76 stays)
- Modify: `src/main/statistics/gene-tests.ts:1-30`
- Modify: `src/main/storage/postgres/PostgresAssociationDataBuilder.ts:137-138`
- Test: `tests/main/statistics/contingency.test.ts` (rewritten), `tests/main/database/conflicting-genotype-calls.test.ts:1-7`, `:50-51`

**Interfaces:**
- Consumes: `calledAlleleCount`, `genotypeCallKey` from `src/shared/utils/genotype.ts` (unchanged).
- Produces:
  - `type SiteExclusionReason = 'missing_call' | 'conflicting_calls' | 'no_called_alleles'`
  - `type SiteExclusionCounts = Record<SiteExclusionReason, number>`
  - `AssociationVariantRow.dosage: number | null`
  - `GeneContingencyData.sites_excluded: SiteExclusionCounts`
  - `GeneAssociationResult.sites_excluded: SiteExclusionCounts`; `n_variants` = sites used
  - `buildGeneContingencyData(rows: AssociationVariantRow[], groupA_ids: number[], groupB_ids: number[], covariateMap: Map<number, number[]>): GeneContingencyData[]` — unchanged signature

- [ ] **Step 1: Write the failing tests**

Replace `tests/main/statistics/contingency.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'

import {
  buildGeneContingencyData,
  type AssociationVariantRow
} from '../../../src/main/statistics/contingency'
import { computeGeneAssociation } from '../../../src/main/statistics/gene-tests'
import { genotypeZygosity, REF_GENOTYPES } from '../../../src/shared/utils/genotype'

const SITE = '1:100:A:T'
const OTHER_SITE = '1:200:C:G'
const NONE = { missing_call: 0, conflicting_calls: 0, no_called_alleles: 0 }

/** What gtDosageSql returns: 2 hom, 1 het or haploid, 0 reference, NULL for anything else. */
function sqlDosage(gt: string | null): number | null {
  const zygosity = genotypeZygosity(gt)
  if (zygosity !== null) return zygosity === 'hom' ? 2 : 1
  return gt !== null && (REF_GENOTYPES as readonly string[]).includes(gt) ? 0 : null
}

/** A stored row as both builders read it. */
const row = (case_id: number, gt_num: string | null, variant_key = SITE): AssociationVariantRow => ({
  gene_symbol: 'GENE1',
  case_id,
  variant_key,
  gt_num,
  dosage: sqlDosage(gt_num),
  gnomad_af: null,
  cadd: null
})

const build = (rows: AssociationVariantRow[], groupA: number[], groupB: number[]) =>
  buildGeneContingencyData(rows, groupA, groupB, new Map())[0]

const frequency = (rows: AssociationVariantRow[], groupA: number[], groupB: number[]): number =>
  build(rows, groupA, groupB).samples[0].variant_mafs[0]

describe('burden allele frequency counts called alleles (#517)', () => {
  it('a haploid ALT call is one allele of one: frequency 1', () => {
    expect(frequency([row(1, '1')], [1], [])).toBe(1)
  })

  it('a sample without a row is read as diploid reference', () => {
    // 1 ALT of 1 (haploid) + 2 (absent) alleles.
    expect(frequency([row(1, '1')], [1], [2])).toBeCloseTo(1 / 3)
  })

  it('an assumed het (1/.) is a diploid het', () => {
    expect(frequency([row(1, '1/.')], [1], [])).toBe(0.5)
  })

  it('a reference half-call (0/.) is two called alleles with no copy of this ALT', () => {
    expect(frequency([row(1, '0/.'), row(2, '0/1')], [1], [2])).toBe(1 / 4)
    expect(frequency([row(1, './0'), row(2, '0|1')], [1], [2])).toBe(1 / 4)
    expect(frequency([row(1, '1/.'), row(2, '0/0')], [1], [2])).toBe(1 / 4)
  })
})

describe('the shipped genotype classes stay (#520)', () => {
  it.each(['1/.', './1', '1|.', '.|1'])('an assumed het %s is dosage 1 and keeps its site', (gt) => {
    const gene = build([row(1, gt), row(2, '0/1')], [1], [2])
    expect(gene.sites_excluded).toEqual(NONE)
    expect(gene.samples.map((s) => s.dosages)).toEqual([[1], [1]])
    expect(gene).toMatchObject({ groupA_carrier_count: 1, groupB_carrier_count: 1 })
  })

  it.each(['0/.', './0', '0|.', '.|0'])('a reference half-call %s is dosage 0 and keeps its site', (gt) => {
    const gene = build([row(1, gt), row(2, '0/1')], [1], [2])
    expect(gene.sites_excluded).toEqual(NONE)
    expect(gene.samples.map((s) => s.dosages)).toEqual([[0], [1]])
  })

  it.each(['./.', '.|.', '.', null, 'not-a-genotype'])('an unknown call %j excludes its site', (gt) => {
    const gene = build([row(1, gt), row(2, '0/1')], [1], [2])
    expect(gene.sites_excluded).toEqual({ ...NONE, missing_call: 1 })
    expect(gene.samples.map((s) => s.dosages)).toEqual([[], []])
    expect(gene.groupB_carrier_count).toBe(0)
  })
})

describe('complete-site rule (#520)', () => {
  // SITE: case 1 het, plus one unknown call. OTHER_SITE: cases 2 and 4 het.
  const complete = [row(2, '0/1', OTHER_SITE), row(4, '0/1', OTHER_SITE)]

  for (const gt of ['./.', null]) {
    for (const [group, unknownCase] of [
      ['group A', 2],
      ['group B', 3]
    ] as const) {
      it(`an unknown call ${JSON.stringify(gt)} in ${group} excludes the site from burden and Fisher`, () => {
        const gene = build([row(1, '0/1'), row(unknownCase, gt), ...complete], [1, 2], [3, 4])

        expect(gene.sites_excluded).toEqual({ ...NONE, missing_call: 1 })
        // One site is left (OTHER_SITE); case 1's het at SITE is counted for nobody.
        expect(gene.samples.map((s) => s.dosages)).toEqual([[0], [1], [0], [1]])
        expect(gene.samples[0].variant_mafs).toEqual([2 / 8])
        expect(gene).toMatchObject({
          groupA_carrier_count: 1,
          groupA_non_carrier_count: 1,
          groupB_carrier_count: 1,
          groupB_non_carrier_count: 1
        })
      })
    }
  }

  it('swapping the group labels excludes the same sites', () => {
    const rows = [row(1, '0/1'), row(3, './.'), ...complete]
    const ab = build(rows, [1, 2], [3, 4])
    const ba = build(rows, [3, 4], [1, 2])

    expect(ba.sites_excluded).toEqual(ab.sites_excluded)
    expect(ba.samples[0].variant_mafs).toEqual(ab.samples[0].variant_mafs)
    expect(ba.groupA_carrier_count).toBe(ab.groupB_carrier_count)
    expect(ba.groupB_carrier_count).toBe(ab.groupA_carrier_count)
  })

  it('a gene whose every site is excluded is reported, not tested', () => {
    const gene = build([row(1, './.')], [1], [2])
    expect(gene.sites_excluded).toEqual({ ...NONE, missing_call: 1 })
    expect(gene.samples.map((s) => s.dosages)).toEqual([[], []])

    const result = computeGeneAssociation(gene, 'beta_maf')
    expect(result).toMatchObject({
      n_variants: 0,
      sites_excluded: { ...NONE, missing_call: 1 },
      groupA_carriers: 0,
      groupA_total: 1,
      groupB_total: 1
    })
    // No p-value: the gene must not enter the FDR correction with p = 1.
    expect(result.fisher.p_value).toBeNull()
    expect(result.logistic_burden.p_value).toBeNull()
  })
})

describe('duplicate rows of one case (#516, #520)', () => {
  it.each([
    [['0/1', '1/1']],
    [['1/.', '1/1']],
    [['./1', '0/.']],
    [['1', '0/0']],
    [['0/1', './.']],
    [['1/1', null]]
  ])('%j disagree in dosage: the call is missing, in either row order', (gts) => {
    for (const order of [gts, [...gts].reverse()]) {
      const gene = build(
        order.map((gt) => row(1, gt)),
        [1],
        []
      )
      expect(gene.sites_excluded).toEqual({ ...NONE, conflicting_calls: 1 })
      expect(gene.samples[0].dosages).toEqual([])
    }
  })

  it.each([
    [['0/1', '0|1'], 1],
    [['1/1', '1|1'], 2],
    [['0/1', '1/.'], 1],
    [['0/0', '0|0'], 0],
    [['0/0', '0/.'], 0]
  ])('%j agree: dosage %i, in either row order', (gts, dosage) => {
    for (const order of [gts, [...gts].reverse()]) {
      const gene = build(
        order.map((gt) => row(1, gt)),
        [1],
        []
      )
      expect(gene.sites_excluded).toEqual(NONE)
      expect(gene.samples[0].dosages).toEqual([dosage])
    }
  })

  it('two unknown rows are one missing call, not a conflict', () => {
    expect(build([row(1, './.'), row(1, null)], [1], []).sites_excluded).toEqual({
      ...NONE,
      missing_call: 1
    })
  })

  it('a conflict outranks a missing call at one site, whatever the sample order', () => {
    const rows = [row(1, './.'), row(2, '0/1'), row(2, '1/1')]
    const expected = { ...NONE, conflicting_calls: 1 }
    expect(build(rows, [1], [2]).sites_excluded).toEqual(expected)
    expect(build(rows, [2], [1]).sites_excluded).toEqual(expected)
  })
})
```

In `tests/main/database/conflicting-genotype-calls.test.ts` replace the header comment (lines 2-7) and the two association lines (50-51):

```ts
/**
 * Several rows of one case for one variant with different genotypes resolve
 * to ONE call — the highest dosage — in the cohort summary and the carrier
 * list, whatever the row order (#516). The burden test picks no winner: calls
 * that disagree in dosage are missing and the site is excluded (#520).
 * Decision record: .planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md.
 */
```

```ts
        const [gene] = new AssociationDataBuilder(service.database).build([caseId], [], {}, [])
        expect(gene.samples[0].dosages).toEqual([])
        expect(gene.sites_excluded).toEqual({
          missing_call: 0,
          conflicting_calls: 1,
          no_called_alleles: 0
        })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make rebuild-node && npx vitest run tests/main/statistics/contingency.test.ts tests/main/database/conflicting-genotype-calls.test.ts`
Expected: FAIL — `sites_excluded` is `undefined`; an unknown call leaves its site in the matrix; `0/1` + `1/1` gives `[2]`. The frequency tests and the assumed-het dosage already pass: those classes do not change.

- [ ] **Step 3: Write the implementation**

`src/main/statistics/types.ts` — add above `GeneContingencyData` (line 48) and extend both gene types:

```ts
/** Why a selected site is left out of a gene's burden score and Fisher table. */
export type SiteExclusionReason = 'missing_call' | 'conflicting_calls' | 'no_called_alleles'

/** Excluded sites of one gene, per reason. Every key is always present. */
export type SiteExclusionCounts = Record<SiteExclusionReason, number>

/** Per-gene data passed to worker threads */
export interface GeneContingencyData {
  gene_symbol: string
  groupA_carrier_count: number
  groupA_non_carrier_count: number
  groupB_carrier_count: number
  groupB_non_carrier_count: number
  sites_excluded: SiteExclusionCounts
  samples: SampleBurdenData[]
}
```

```ts
/** Combined result for one gene */
export interface GeneAssociationResult {
  gene_symbol: string
  /** Sites used: eligible sites with a known call in every selected sample. */
  n_variants: number
  sites_excluded: SiteExclusionCounts
  groupA_carriers: number
  groupB_carriers: number
  groupA_total: number
  groupB_total: number
  fisher: FisherResult
  logistic_burden: LogisticBurdenResult
}
```

`src/main/statistics/contingency.ts` — replace lines 1-39 (header, imports, row types):

```ts
/**
 * Backend-neutral half of association data building: turns the stored rows of
 * the selected cases at the qualifying sites into per-gene contingency data.
 * Shared by the SQLite AssociationDataBuilder (desktop) and the Postgres
 * builder (web), so both runtimes compute identical inputs.
 * Rules: .planning/specs/2026-10-08-burden-test-eligible-sites.md (phase 1).
 */
import { calledAlleleCount, genotypeCallKey } from '../../shared/utils/genotype'
import type {
  GeneContingencyData,
  SampleBurdenData,
  SiteExclusionCounts,
  SiteExclusionReason
} from './types'

export interface AssociationVariantRow {
  gene_symbol: string
  case_id: number
  variant_key: string
  /** The stored genotype `dosage` was read from. */
  gt_num: string | null
  /** gtDosageSql of `gt_num`: 2, 1, 0, or null for a call outside the carrier and reference classes. */
  dosage: number | null
  gnomad_af: number | null
  cadd: number | null
}

export interface CaseMetaRow {
  case_id: number
  sex: string | null
  age: number | null
}

export interface CaseMetricRow {
  case_id: number
  name: string
  numeric_value: number | null
}

type VariantCaseData = {
  gt_num: string | null
  dosage: number | null
  /** Rows of this case disagree in dosage: the call is missing. */
  conflict: boolean
  cadd: number | null
}
type CaseCalls = Map<number, VariantCaseData>
type GeneVariantMap = Map<string, Map<string, CaseCalls>>
/** A site the gene's tests use, with its ALT allele frequency among the tested samples. */
type Site = { calls: CaseCalls; frequency: number }
```

Keep `buildCovariateMap` (current lines 41-76) as it is. Replace everything from `function groupRows` (line 78) to the end of the file:

```ts
/**
 * The dosage of one stored row; null = missing. SQL gives NULL for every call
 * outside the carrier and reference classes. Of those, a reference half-call
 * (`0/.`) is two called alleles with no copy of this ALT, so it is 0. What is
 * left — `./.`, NULL, other text — is the unknown class.
 */
function rowDosage(row: AssociationVariantRow): number | null {
  return row.dosage ?? (calledAlleleCount(row.gt_num) > 0 ? 0 : null)
}

function groupRows(rows: AssociationVariantRow[]): GeneVariantMap {
  const geneMap: GeneVariantMap = new Map()
  for (const row of rows) {
    const dosage = rowDosage(row)
    if (!geneMap.has(row.gene_symbol)) geneMap.set(row.gene_symbol, new Map())
    const variantMap = geneMap.get(row.gene_symbol)!
    if (!variantMap.has(row.variant_key)) variantMap.set(row.variant_key, new Map())
    const calls = variantMap.get(row.variant_key)!
    const kept = calls.get(row.case_id)
    if (!kept) {
      calls.set(row.case_id, { gt_num: row.gt_num, dosage, conflict: false, cadd: row.cadd })
      continue
    }
    // Duplicate rows of one case: equal dosages agree (0/1 and 0|1). No row wins otherwise.
    // Association test only; the cohort summary keeps "highest dosage" (genotypeCallKey).
    if (kept.dosage !== dosage) kept.conflict = true
    // The greatest call key names the ploidy of an agreed call (frequency denominator).
    if (genotypeCallKey(row.gt_num) > genotypeCallKey(kept.gt_num)) kept.gt_num = row.gt_num
    kept.cadd ??= row.cadd
  }
  return geneMap
}

/**
 * Why a site cannot be used, judged on every selected sample so both groups
 * and both tests share one site set. A conflict outranks a missing call, so
 * the reason does not depend on the sample order.
 */
function siteExclusion(calls: CaseCalls, allIds: number[]): SiteExclusionReason | null {
  let missing = false
  for (const caseId of allIds) {
    const data = calls.get(caseId)
    if (!data) continue // no row: read as reference
    if (data.conflict) return 'conflicting_calls'
    if (data.dosage === null) missing = true
  }
  return missing ? 'missing_call' : null
}

/** ALT allele frequency among `ids`; null when they call no allele at all. */
function altAlleleFrequency(calls: CaseCalls, ids: number[]): number | null {
  let altCount = 0
  let calledAlleles = 0
  for (const caseId of ids) {
    const data = calls.get(caseId)
    altCount += data?.dosage ?? 0
    // No row: reference sites are not stored, so the sample is read as a diploid 0/0.
    calledAlleles += data ? calledAlleleCount(data.gt_num) : 2
  }
  return calledAlleles > 0 ? altCount / calledAlleles : null
}

function eligibleSites(
  variantMap: Map<string, CaseCalls>,
  allIds: number[],
  frequencyIds: number[]
): { sites: Site[]; sites_excluded: SiteExclusionCounts } {
  const sites: Site[] = []
  const sites_excluded: SiteExclusionCounts = {
    missing_call: 0,
    conflicting_calls: 0,
    no_called_alleles: 0
  }
  for (const calls of variantMap.values()) {
    const reason = siteExclusion(calls, allIds)
    const frequency = reason === null ? altAlleleFrequency(calls, frequencyIds) : null
    if (frequency === null) sites_excluded[reason ?? 'no_called_alleles']++
    else sites.push({ calls, frequency })
  }
  return { sites, sites_excluded }
}

function carrierCounts(
  sites: Site[],
  groupA_ids: number[],
  groupB_ids: number[]
): Pick<
  GeneContingencyData,
  | 'groupA_carrier_count'
  | 'groupA_non_carrier_count'
  | 'groupB_carrier_count'
  | 'groupB_non_carrier_count'
> {
  const carriers = new Set<number>()
  for (const { calls } of sites) {
    for (const [caseId, data] of calls) if ((data.dosage ?? 0) > 0) carriers.add(caseId)
  }
  const a = groupA_ids.filter((id) => carriers.has(id)).length
  const b = groupB_ids.filter((id) => carriers.has(id)).length
  return {
    groupA_carrier_count: a,
    groupA_non_carrier_count: groupA_ids.length - a,
    groupB_carrier_count: b,
    groupB_non_carrier_count: groupB_ids.length - b
  }
}

function meanCadd(calls: CaseCalls, allIds: number[]): number | null {
  let sum = 0
  let count = 0
  for (const caseId of allIds) {
    const cadd = calls.get(caseId)?.cadd
    if (cadd !== null && cadd !== undefined) {
      sum += cadd
      count++
    }
  }
  return count > 0 ? sum / count : null
}

function geneSamples(
  sites: Site[],
  allIds: number[],
  groupASet: Set<number>,
  covariateMap: Map<number, number[]>
): SampleBurdenData[] {
  // ALT allele frequency p; computeWeight takes the weight at min(p, 1 - p).
  const variantMafs = sites.map((site) => Math.max(site.frequency, 1e-8))
  const variantCadds = sites.map((site) => meanCadd(site.calls, allIds))
  return allIds.map((caseId) => ({
    group: groupASet.has(caseId) ? 1 : 0,
    dosages: sites.map((site) => site.calls.get(caseId)?.dosage ?? 0),
    variant_mafs: variantMafs,
    variant_cadds: variantCadds,
    covariate_values: covariateMap.get(caseId) ?? []
  }))
}

/**
 * Group the stored rows by gene → site → case and build the per-gene carrier
 * table plus per-sample burden inputs. A site with a missing dosage in any
 * selected sample is used for no sample; nothing is imputed.
 */
export function buildGeneContingencyData(
  rows: AssociationVariantRow[],
  groupA_ids: number[],
  groupB_ids: number[],
  covariateMap: Map<number, number[]>
): GeneContingencyData[] {
  const allIds = [...groupA_ids, ...groupB_ids]
  const groupASet = new Set(groupA_ids)
  const results: GeneContingencyData[] = []
  for (const [geneSymbol, variantMap] of groupRows(rows)) {
    const { sites, sites_excluded } = eligibleSites(variantMap, allIds, allIds)
    results.push({
      gene_symbol: geneSymbol,
      ...carrierCounts(sites, groupA_ids, groupB_ids),
      sites_excluded,
      samples: geneSamples(sites, allIds, groupASet, covariateMap)
    })
  }
  return results
}
```

`src/main/statistics/gene-tests.ts` — replace the whole file:

```ts
import { logisticBurdenTest } from './burden'
import { fisherExactTest } from './fisher'
import type {
  FisherResult,
  GeneAssociationResult,
  GeneContingencyData,
  WeightScheme
} from './types'

const NOT_TESTED: FisherResult = {
  p_value: null,
  odds_ratio: null,
  ci_lower: null,
  ci_upper: null
}

/**
 * Fisher's exact test + logistic burden test for one gene. Pure; runs in the
 * desktop statistics worker threads and in-process on the web server.
 */
export function computeGeneAssociation(
  gene: GeneContingencyData,
  weightScheme: WeightScheme
): GeneAssociationResult {
  const sitesUsed = gene.samples.length > 0 ? gene.samples[0].dosages.length : 0
  // No usable site is not a test: a Fisher p of 1 would count in the FDR correction.
  const fisher =
    sitesUsed === 0
      ? NOT_TESTED
      : fisherExactTest(
          gene.groupA_carrier_count,
          gene.groupB_carrier_count,
          gene.groupA_non_carrier_count,
          gene.groupB_non_carrier_count
        )
  const logistic = logisticBurdenTest(gene.samples, weightScheme)
  return {
    gene_symbol: gene.gene_symbol,
    n_variants: sitesUsed,
    sites_excluded: gene.sites_excluded,
    groupA_carriers: gene.groupA_carrier_count,
    groupB_carriers: gene.groupB_carrier_count,
    groupA_total: gene.groupA_carrier_count + gene.groupA_non_carrier_count,
    groupB_total: gene.groupB_carrier_count + gene.groupB_non_carrier_count,
    fisher,
    logistic_burden: logistic
  }
}
```

`src/main/storage/postgres/PostgresAssociationDataBuilder.ts` — replace lines 137-138:

```ts
      // NULL dosage is carried as it is; contingency.ts decides what is missing (rowDosage).
      dosage: toNumberOrNull(row.dosage),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/statistics tests/main/database/conflicting-genotype-calls.test.ts tests/main/database/association-data-builder.test.ts tests/main/database/split-genotype-zygosity.test.ts tests/main/ipc/handlers/association-logic.test.ts tests/web-gate/web-association-route.test.ts`
Expected: PASS. (`split-genotype-zygosity` is unchanged: its fixture has no unknown call among the stored rows.)

Run: `make typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/statistics/types.ts src/main/statistics/contingency.ts src/main/statistics/gene-tests.ts src/main/storage/postgres/PostgresAssociationDataBuilder.ts tests/main/statistics/contingency.test.ts tests/main/database/conflicting-genotype-calls.test.ts
git commit -m "fix(statistics): burden test excludes sites with a missing or conflicting call (#520)"
```

---

### Task 3: Choose the complete-covariate samples before frequencies and weights

**Files:**
- Modify: `src/main/statistics/contingency.ts` (`buildGeneContingencyData`, plus one export above `buildCovariateMap`)
- Modify: `src/main/statistics/burden.ts:1-10`
- Test: `tests/main/statistics/burden.test.ts`, `tests/main/statistics/contingency.test.ts`

**Interfaces:**
- Consumes: `eligibleSites(variantMap, allIds, frequencyIds)` from Task 2 (module-private).
- Produces: `hasCompleteCovariates(values: readonly (number | null)[]): boolean` exported from `contingency.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `describe('missing covariates (#499)', …)` in `tests/main/statistics/burden.test.ts`, after the last `it`:

```ts
  it('frequencies and weights describe the tested samples (#520)', () => {
    // Case 41: a homozygous carrier in group A whose age and metric were never recorded.
    const carrier41: AssociationVariantRow = {
      gene_symbol: 'GENE1',
      case_id: 41,
      variant_key: '1:100:A:T',
      gt_num: '1/1',
      dosage: 2,
      gnomad_af: null,
      cadd: null
    }
    const gene = (a: number[], metaRows: CaseMetaRow[], extra: AssociationVariantRow[] = []) => {
      const all = [...a, ...groupB]
      const covariates = buildCovariateMap(all, config.covariates, metaRows, metrics)
      return buildGeneContingencyData([...rowsFor(all), ...extra], a, groupB, covariates)[0]
    }

    const reference = gene(groupA, meta)
    const withMissing = gene(
      [...groupA, 41],
      [...meta, { case_id: 41, sex: null, age: null }],
      [carrier41]
    )

    expect(withMissing.samples[0].variant_mafs).toEqual(reference.samples[0].variant_mafs)
    expect(logisticBurdenTest(withMissing.samples, 'beta_maf').beta).toBe(
      logisticBurdenTest(reference.samples, 'beta_maf').beta
    )
    // Fisher's test needs no covariates and still counts the sample.
    expect(withMissing.groupA_carrier_count).toBe(reference.groupA_carrier_count + 1)
  })
```

Add to `describe('complete-site rule (#520)', …)` in `tests/main/statistics/contingency.test.ts`:

```ts
  it('a site no tested sample calls is excluded: no_called_alleles', () => {
    // Neither sample has its covariate, so nobody is left to compute a frequency from.
    const covariates = new Map([
      [1, [NaN]],
      [2, [NaN]]
    ])
    const [gene] = buildGeneContingencyData([row(1, '0/1')], [1], [2], covariates)
    expect(gene.sites_excluded).toEqual({ ...NONE, no_called_alleles: 1 })
    expect(gene.samples.map((s) => s.dosages)).toEqual([[], []])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/statistics/burden.test.ts tests/main/statistics/contingency.test.ts`
Expected: FAIL — `variant_mafs` differ (case 41 adds 2 ALT of 2 alleles); `no_called_alleles` is 0 and the site is still in the matrix.

- [ ] **Step 3: Write minimal implementation**

`src/main/statistics/contingency.ts` — add directly above the `buildCovariateMap` doc comment:

```ts
/** A sample enters the regression only when every selected covariate is present. */
export const hasCompleteCovariates = (values: readonly (number | null)[]): boolean =>
  values.every(Number.isFinite)
```

In `buildGeneContingencyData`, add after `const groupASet = …` and use it in the `eligibleSites` call:

```ts
  // Frequencies and weights describe the samples the regression tests (burden.ts).
  const testedIds = allIds.filter((id) => hasCompleteCovariates(covariateMap.get(id) ?? []))
```

```ts
    const { sites, sites_excluded } = eligibleSites(variantMap, allIds, testedIds)
```

`src/main/statistics/burden.ts` — replace lines 1-10:

```ts
import type { LogisticBurdenResult, SampleBurdenData, WeightScheme } from './types'
import { hasCompleteCovariates } from './contingency'
import { computeBurdenScore } from './weights'
import { logisticRegression, firthLogisticRegression } from './logistic'

export function logisticBurdenTest(
  samples: SampleBurdenData[],
  weightScheme: WeightScheme
): LogisticBurdenResult {
  // A sample lacking a selected covariate (NaN; null once serialised) must not enter the fit.
  // contingency.ts computes the frequencies over the same samples.
  const complete = samples.filter((s) => hasCompleteCovariates(s.covariate_values))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/statistics`
Expected: PASS, including the three existing `missing covariates (#499)` tests.

Run: `make typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/statistics/contingency.ts src/main/statistics/burden.ts tests/main/statistics/burden.test.ts tests/main/statistics/contingency.test.ts
git commit -m "fix(statistics): burden weights use the samples that are tested (#520)"
```

---

### Task 4: SQLite builder — one genome build, autosomes, select then collect, non-autosomal count

**Files:**
- Modify: `src/shared/sql/chromosome-order.ts` (add after `chrRankSql`, line 73)
- Modify: `src/main/statistics/types.ts` (`AssociationResults` at `:100-107`, new `AssociationBuildResult`)
- Modify: `src/main/statistics/contingency.ts` (add `assertSingleGenomeBuild`)
- Modify: `src/main/statistics/finalize.ts:14-26`, `:33-37`, `:67-73`
- Modify: `src/main/statistics/AssociationEngine.ts:1-6`, `:42-73`
- Modify: `src/main/database/AssociationDataBuilder.ts:1-92`
- Create: `tests/main/database/support/burden-fixture.ts`
- Test: `tests/main/database/association-data-builder.test.ts`, `tests/main/database/split-genotype-zygosity.test.ts:146-178`, `tests/main/database/conflicting-genotype-calls.test.ts:50`, `tests/main/statistics/integration.test.ts`

**Interfaces:**
- Consumes: `chrRankSql(column: string): string`; `gtDosageSql(column: string): string`; `sqlPlaceholders(count: number): string`; `InvalidParametersError(message: string, userMessage?: string)`.
- Produces:
  - `autosomeSql(column?: string): string` in `src/shared/sql/chromosome-order.ts`
  - `assertSingleGenomeBuild(builds: (string | null)[]): void` in `src/main/statistics/contingency.ts`
  - `interface AssociationBuildResult { genes: GeneContingencyData[]; non_autosomal_variants: number }`
  - `AssociationResults.non_autosomal_variants: number`
  - `emptyAssociationResults(config, warning, startedAt, nonAutosomalVariants = 0)` and `finalizeAssociationResults(rawResults, config, startedAt, nonAutosomalVariants = 0)`
  - `AssociationDataBuilder.build(groupA_ids, groupB_ids, filters, covariateNames): AssociationBuildResult` — **return type changes** from `GeneContingencyData[]`
  - Test fixture: `SAMPLES`, `BURDEN_ROWS`, `EXPECTED_GENES`, `EXPECTED_NON_AUTOSOMAL`, `projectGenes(genes)`, `seedSqlite(db): Record<Sample, number>`

The db-worker task `association:build` (`src/main/workers/db-worker-dispatch.ts:214-222`) returns whatever `build` returns. It is not edited.

- [ ] **Step 1: Write the fixture**

Create `tests/main/database/support/burden-fixture.ts`:

```ts
/**
 * One dataset for the burden-test eligibility rules (#520), stored the same
 * way on SQLite and PostgreSQL, and the matrix both builders must return.
 * Groups: A = S1, S2; B = S3, S4.
 */
import type Database from 'better-sqlite3-multiple-ciphers'

import type { GeneContingencyData } from '../../../../src/main/statistics/types'

export const SAMPLES = ['S1', 'S2', 'S3', 'S4'] as const
export type Sample = (typeof SAMPLES)[number]

export interface BurdenRow {
  sample: Sample
  chr: string
  pos: number
  ref: string
  alt: string
  gene: string | null
  gt: string | null
  /** The per-row call quality: the only per-sample numeric column on `variants`. */
  qual: number
}

const site =
  (chr: string, pos: number, ref: string, alt: string, gene: string | null) =>
  (sample: Sample, gt: string | null, qual = 50, rowGene: string | null = gene): BurdenRow => ({
    sample,
    chr,
    pos,
    ref,
    alt,
    gene: rowGene,
    gt,
    qual
  })

const complete = site('chr1', 100, 'A', 'G', 'GENE1')
const unknown = site('chr1', 200, 'C', 'T', 'GENE1')
const conflict = site('chr1', 300, 'G', 'A', 'GENE1')
const phased = site('chr1', 400, 'T', 'C', 'GENE1')
const halfCalls = site('chr1', 500, 'C', 'A', 'GENE1')
const bare = site('2', 800, 'A', 'C', 'GENE2')

export const BURDEN_ROWS: BurdenRow[] = [
  // chr1:100 — complete. S2's homozygous call has low quality; S4's row names no gene.
  complete('S1', '0/1'),
  complete('S2', '1/1', 5),
  complete('S4', '0/1', 50, null),
  // chr1:200 — an unknown call in group B.
  unknown('S1', '0/1'),
  unknown('S3', './.'),
  // chr1:300 — S2 called twice: 0/1 (quality 99) and 1/1 (quality 2).
  conflict('S2', '0/1', 99),
  conflict('S2', '1/1', 2),
  conflict('S4', '0/1'),
  // chr1:400 — S1 stored twice, unphased and phased: the same call.
  phased('S1', '0/1'),
  phased('S1', '0|1'),
  // chr1:500 — the shipped classes: assumed het (one copy), reference half-call (no copy).
  halfCalls('S2', '1/.'),
  halfCalls('S3', '0/.'),
  // An autosome stored without the chr prefix.
  bare('S3', '0/1'),
  // Never eligible in phase 1: chrX, chrY, MT and unplaced contigs, in both spellings.
  site('chrX', 500, 'G', 'A', 'GENEX')('S1', '1'),
  site('X', 510, 'G', 'A', 'GENEX')('S2', '0/1'),
  site('chrY', 600, 'G', 'A', 'GENEY')('S1', '1'),
  site('chrM', 700, 'G', 'A', 'GENEM')('S2', '1'),
  site('MT', 710, 'G', 'A', 'GENEM')('S3', '1'),
  site('chrUn_KI270742v1', 50, 'A', 'C', 'GENEU')('S1', '0/1')
]

/** Qualifying variants that are not on an autosome: the six sites of the last block. */
export const EXPECTED_NON_AUTOSOMAL = 6

/** What both builders return for groups A = [S1, S2], B = [S3, S4], with or without a `qual` filter. */
export const EXPECTED_GENES = [
  {
    gene_symbol: 'GENE1',
    // Sites used, in order: chr1:100, chr1:400, chr1:500. Samples S1..S4.
    dosages: [
      [1, 1, 0],
      [2, 0, 1],
      [0, 0, 0],
      [1, 0, 0]
    ],
    sites_excluded: { missing_call: 1, conflicting_calls: 1, no_called_alleles: 0 },
    groupA_carrier_count: 2,
    groupB_carrier_count: 1
  },
  {
    gene_symbol: 'GENE2',
    dosages: [[0], [0], [1], [0]],
    sites_excluded: { missing_call: 0, conflicting_calls: 0, no_called_alleles: 0 },
    groupA_carrier_count: 0,
    groupB_carrier_count: 1
  }
]

export function projectGenes(genes: GeneContingencyData[]): typeof EXPECTED_GENES {
  return genes.map((gene) => ({
    gene_symbol: gene.gene_symbol,
    dosages: gene.samples.map((sample) => sample.dosages),
    sites_excluded: gene.sites_excluded,
    groupA_carrier_count: gene.groupA_carrier_count,
    groupB_carrier_count: gene.groupB_carrier_count
  }))
}

/** Store the fixture in a migrated SQLite database; returns the case id per sample. */
export function seedSqlite(db: Database.Database): Record<Sample, number> {
  const ids = {} as Record<Sample, number>
  const addCase = db.prepare(
    "INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, '/burden.vcf', 0, 0, 0)"
  )
  for (const sample of SAMPLES) ids[sample] = Number(addCase.run(sample).lastInsertRowid)
  const addRow = db.prepare(
    'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, qual) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const r of BURDEN_ROWS) {
    addRow.run(ids[r.sample], r.chr, r.pos, r.ref, r.alt, r.gene, r.gt, r.qual)
  }
  return ids
}
```

- [ ] **Step 2: Write the failing tests**

In `tests/main/database/association-data-builder.test.ts` add to the imports:

```ts
import {
  EXPECTED_GENES,
  EXPECTED_NON_AUTOSOMAL,
  projectGenes,
  seedSqlite,
  type Sample
} from './support/burden-fixture'
```

Append at the end of the file:

```ts
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
```

`build()` now returns `{ genes, non_autosomal_variants }`. Update every existing reader of its result:

`tests/main/database/association-data-builder.test.ts` — append `.genes` to the `builder.build(…)` call whose result is assigned to `genes`, `genesMatching` or `genesNonMatching`, at lines 54, 68, 81, 93, 128-138, 191-196, 200, 222-227 and 240. For the multi-line calls the suffix goes after the closing parenthesis, for example lines 128-138:

```ts
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
    ).genes
```

Lines 155 and 174-183 belong to the two tests Task 6 deletes; line 174 also gets `.genes` so the file stays green until then. Line 239 (`expect(() => builder.build(…)).not.toThrow()`) needs no change.

`tests/main/statistics/integration.test.ts` — append `.genes` at lines 59, 77, 111, 122 and 132 (`const genes = builder.build(…).genes`). Line 172 keeps the whole result, because the mocked pool must return what the worker returns; rename and adapt lines 172-181 and 237:

```ts
    const built = builder.build([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], {}, [])

    // Mock DbPool
    const mockPoolRun = vi.fn().mockResolvedValue(built)
    const mockDbPool = {
      run: mockPoolRun
    } as unknown as import('../../../src/main/database/DbPool').DbPool

    // Mock WorkerPool (statistical tests)
    const mockResults: GeneAssociationResult[] = built.genes.map((g) => ({
```

```ts
    const mockPoolRun = vi.fn().mockResolvedValue({ genes: [], non_autosomal_variants: 0 })
```

Add to `describe('AssociationEngine with DbPool (off-thread build)', …)` in the same file:

```ts
  it('the run result carries the qualifying variants that are not on an autosome', async () => {
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num) VALUES (1, 'chrX', 5000, 'G', 'A', 'DMD', '1')"
    ).run()
    const mockWorkerRun = vi.fn().mockResolvedValue([])
    vi.resetModules()
    vi.doMock('../../../src/main/statistics/WorkerPool', () => {
      function WorkerPool() {
        return { run: mockWorkerRun, abort: vi.fn() }
      }
      return { WorkerPool }
    })
    const { AssociationEngine } = await import('../../../src/main/statistics/AssociationEngine')
    const config = {
      groupA_ids: [1, 2, 3, 4, 5],
      groupB_ids: [6, 7, 8, 9, 10],
      primary_test: 'fisher' as const,
      weight_scheme: 'uniform' as const,
      covariates: [],
      filters: {},
      max_threads: 2
    }

    const results = await new AssociationEngine(db, undefined, null).run(config)
    expect(results.non_autosomal_variants).toBe(1)

    // A run that finds only chrX variants is empty, and says how many it left out.
    const onlyX = await new AssociationEngine(db, undefined, null).run({
      ...config,
      filters: { gene_list: ['DMD'] }
    })
    expect(onlyX.results).toEqual([])
    expect(onlyX.warnings).toEqual(['No genes with qualifying variants'])
    expect(onlyX.non_autosomal_variants).toBe(1)
  })
```

`tests/main/database/conflicting-genotype-calls.test.ts:50`:

```ts
        const [gene] = new AssociationDataBuilder(service.database).build([caseId], [], {}, []).genes
```

`tests/main/database/split-genotype-zygosity.test.ts` — in `describe('association dosage', …)` (lines 146-179) the two readers become:

```ts
      const data = new AssociationDataBuilder(service.database)
        .build(ids.slice(0, 2), ids.slice(2), {}, [])
        .genes.find((g) => g.gene_symbol === gene)
```

```ts
      const gene = new AssociationDataBuilder(service.database)
        .build([ids[0], ids[3]], [ids[1], ids[2], ids[4]], {}, [])
        .genes.find((g) => g.gene_symbol === 'GENEA')
```

and the test at lines 176-178 (`a hemizygous call is one copy`) is replaced:

```ts
    it('chrX is not in the burden test (phase 1: autosomes only), and is counted', () => {
      const ids = SAMPLES.map((sample) => caseIds[sample])
      const built = new AssociationDataBuilder(service.database).build(
        ids.slice(0, 2),
        ids.slice(2),
        {},
        []
      )
      expect(built.genes.find((g) => g.gene_symbol === 'GENEA')).toBeDefined()
      expect(built.genes.find((g) => g.gene_symbol === 'GENEX')).toBeUndefined()
      // chrX:5000 G>A is the fixture's one non-autosomal variant.
      expect(built.non_autosomal_variants).toBe(1)
    })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/main/database/association-data-builder.test.ts tests/main/database/split-genotype-zygosity.test.ts tests/main/database/conflicting-genotype-calls.test.ts tests/main/statistics/integration.test.ts`
Expected: FAIL — `build(…).genes` is `undefined` (the builder still returns an array). (The 20,000-case test is a guard for the single binding; it fails here only for the same reason.)

- [ ] **Step 4: Write the implementation**

`src/shared/sql/chromosome-order.ts` — add after `chrRankSql` (line 73):

```ts
/** SQL condition: `column` names an autosome (1..22), with or without a `chr` prefix. */
export function autosomeSql(column = 'chr'): string {
  return `${chrRankSql(column)} <= 22`
}
```

`src/main/statistics/types.ts` — add above `/** Fisher's exact test result */`, and extend `AssociationResults`:

```ts
/** What an AssociationDataBuilder returns for one run. */
export interface AssociationBuildResult {
  genes: GeneContingencyData[]
  /** Qualifying variants left out because they are not on an autosome (1..22). */
  non_autosomal_variants: number
}
```

```ts
/** Final results with FDR correction applied */
export interface AssociationResults {
  results: GeneAssociationResultWithFDR[]
  primary_test: PrimaryTest
  config: AssociationConfig
  warnings: string[]
  /** Qualifying variants left out because they are not on an autosome (1..22). */
  non_autosomal_variants: number
  elapsed_ms: number
}
```

`src/main/statistics/contingency.ts` — add the import and, above `rowDosage`, the check:

```ts
import { InvalidParametersError } from '../ipc/errors'
```

```ts
/**
 * A run compares sites by chr:pos:ref:alt, which names one site only within
 * one genome build. `builds` are the distinct builds of the selected cases.
 */
export function assertSingleGenomeBuild(builds: (string | null)[]): void {
  const distinct = [...new Set(builds.map((build) => build ?? 'unknown'))].sort()
  if (distinct.length <= 1) return
  const message =
    `Mixed genome builds: the selected cases use ${distinct.join(' and ')}. ` +
    'Run the burden test on cases of one genome build.'
  throw new InvalidParametersError(message, message)
}
```

`src/main/statistics/finalize.ts` — both functions take the count as a fourth parameter (default 0) and put it in the result. `emptyAssociationResults` (lines 13-26):

```ts
/** Empty result set with one warning (no qualifying genes, or cancelled). */
export function emptyAssociationResults(
  config: AssociationConfig,
  warning: string,
  startedAt: number,
  nonAutosomalVariants = 0
): AssociationResults {
  return {
    results: [],
    primary_test: config.primary_test,
    config,
    warnings: [warning],
    non_autosomal_variants: nonAutosomalVariants,
    elapsed_ms: Date.now() - startedAt
  }
}
```

`finalizeAssociationResults` — signature (lines 33-37) and return (lines 67-73):

```ts
export function finalizeAssociationResults(
  rawResults: GeneAssociationResult[],
  config: AssociationConfig,
  startedAt: number,
  nonAutosomalVariants = 0
): AssociationResults {
```

```ts
  return {
    results,
    primary_test: config.primary_test,
    config,
    warnings,
    non_autosomal_variants: nonAutosomalVariants,
    elapsed_ms: Date.now() - startedAt
  }
```

`src/main/statistics/AssociationEngine.ts` — import `AssociationBuildResult` instead of `GeneContingencyData` (lines 1-6) and replace the body of `run` from step 1 to the end (lines 42-73):

```ts
import type {
  AssociationBuildResult,
  AssociationConfig,
  AssociationResults,
  GeneAssociationResult
} from './types'
```

```ts
    // 1. Build per-gene contingency data (off main thread when pool available)
    let built: AssociationBuildResult
    if (this.dbPool) {
      built = await this.dbPool.run<AssociationBuildResult>({
        type: 'association:build',
        params: [config.groupA_ids, config.groupB_ids, config.filters, config.covariates]
      })
    } else {
      const builder = new AssociationDataBuilder(this.db)
      built = builder.build(config.groupA_ids, config.groupB_ids, config.filters, config.covariates)
    }
    const { genes, non_autosomal_variants: skipped } = built

    if (genes.length === 0) {
      return emptyAssociationResults(config, 'No genes with qualifying variants', start, skipped)
    }

    // Check abort after the (potentially async) build step completes
    if (this.aborted) return emptyAssociationResults(config, 'Analysis cancelled', start, skipped)

    // 2. Run tests in parallel across worker threads
    this.pool = new WorkerPool(config.max_threads > 0 ? config.max_threads : undefined)
    let rawResults: GeneAssociationResult[]
    try {
      rawResults = await this.pool.run(genes, config.weight_scheme, this.onProgress)
    } finally {
      this.pool = null
    }

    if (this.aborted) return emptyAssociationResults(config, 'Analysis cancelled', start, skipped)

    // 3. Warnings, FDR correction and sorting (shared with the web runner)
    return finalizeAssociationResults(rawResults, config, start, skipped)
  }
```

`src/main/database/AssociationDataBuilder.ts` — replace lines 1-92 (imports through the end of `build`); `loadCovariates` stays:

```ts
import type Database from 'better-sqlite3-multiple-ciphers'
import type { AssociationBuildResult, VariantFilters } from '../statistics/types'
import {
  assertSingleGenomeBuild,
  buildCovariateMap,
  buildGeneContingencyData,
  type AssociationVariantRow,
  type CaseMetaRow,
  type CaseMetricRow
} from '../statistics/contingency'
import { autosomeSql } from '../../shared/sql/chromosome-order'
import { gtDosageSql } from '../../shared/sql/genotype-dosage'
import { sqlPlaceholders } from './sql-utils'
import { buildBaseWhere, type BaseFilterInput } from './variant-where-builder'
import { buildExtensionJoinClauses } from './variant-extension-registry'

/** The filters of a run as SQL on `variants v`, without the case and chromosome terms. */
interface SiteFilter {
  joins: string
  conditions: string[]
  params: (string | number)[]
}

export class AssociationDataBuilder {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  build(
    groupA_ids: number[],
    groupB_ids: number[],
    filters: VariantFilters,
    covariateNames: string[]
  ): AssociationBuildResult {
    const allIds = [...groupA_ids, ...groupB_ids]
    if (allIds.length === 0) return { genes: [], non_autosomal_variants: 0 }

    const placeholders = sqlPlaceholders(allIds.length)
    assertSingleGenomeBuild(
      this.db
        .prepare(`SELECT DISTINCT genome_build FROM cases WHERE id IN (${placeholders})`)
        .pluck()
        .all(...allIds) as (string | null)[]
    )

    const site = this.siteFilter(filters)
    const non_autosomal_variants = this.countNonAutosomalVariants(allIds, placeholders, site)
    const variantRows = this.loadVariantRows(allIds, placeholders, site)
    if (variantRows.length === 0) return { genes: [], non_autosomal_variants }

    const covariateMap =
      covariateNames.length > 0
        ? this.loadCovariates(allIds, covariateNames)
        : new Map<number, number[]>()
    return {
      genes: buildGeneContingencyData(variantRows, groupA_ids, groupB_ids, covariateMap),
      non_autosomal_variants
    }
  }

  private siteFilter(filters: VariantFilters): SiteFilter {
    // scope='cohort-burden' emits the gene_symbol IS NOT NULL + != '' invariants.
    const baseInput: BaseFilterInput = {
      gnomad_af_max: filters.gnomad_af_max,
      cadd_min: filters.cadd_min,
      consequences: filters.consequences,
      clinvars: filters.clinvars,
      funcs: filters.funcs,
      gene_list: filters.gene_list,
      column_filters: filters.column_filters
    }
    const base = buildBaseWhere(baseInput, { baseAlias: 'v', scope: 'cohort-burden' })
    // Extension (dotted) column_filters — direct JOIN mode (same as VariantFilterBuilder).
    const ext = buildExtensionJoinClauses(filters.column_filters ?? {}, 'v')
    return {
      joins: ext.joins,
      conditions: [base.sql, ext.whereClause].filter((sql) => sql !== ''),
      params: [...base.params, ...ext.params]
    }
  }

  /** Qualifying variants of the selected cases that are not on an autosome: reported, never tested. */
  private countNonAutosomalVariants(
    allIds: number[],
    placeholders: string,
    site: SiteFilter
  ): number {
    const where = [
      `v.case_id IN (${placeholders})`,
      `NOT (${autosomeSql('v.chr')})`,
      ...site.conditions
    ]
    return this.db
      .prepare(
        `
      SELECT COUNT(*) FROM (
        SELECT DISTINCT v.chr, v.pos, v.ref, v.alt
        FROM variants v
        ${site.joins}
        WHERE ${where.join(' AND ')}
      )
    `
      )
      .pluck()
      .get(...allIds, ...site.params) as number
  }

  /**
   * Select, then collect. `selected` holds the autosomal sites that pass every
   * filter in at least one selected case. The outer query then reads every
   * stored row of the selected cases at those sites without a row filter, so a
   * filter cannot turn a carrier into a reference sample. The case ids are
   * bound once (`picked`), which keeps the SQLite parameter count at one per case.
   */
  private loadVariantRows(
    allIds: number[],
    placeholders: string,
    site: SiteFilter
  ): AssociationVariantRow[] {
    const where = ['v.case_id IN (SELECT id FROM picked)', autosomeSql('v.chr'), ...site.conditions]
    return this.db
      .prepare(
        `
      WITH picked(id) AS (SELECT id FROM cases WHERE id IN (${placeholders})),
      selected AS (
        SELECT DISTINCT v.gene_symbol, v.chr, v.pos, v.ref, v.alt
        FROM variants v
        ${site.joins}
        WHERE ${where.join(' AND ')}
      )
      SELECT s.gene_symbol,
             r.case_id,
             r.chr || ':' || r.pos || ':' || r.ref || ':' || r.alt AS variant_key,
             r.gt_num,
             ${gtDosageSql('r.gt_num')} AS dosage,
             r.gnomad_af,
             r.cadd
      FROM selected s
      JOIN variants r ON r.chr = s.chr AND r.pos = s.pos AND r.ref = s.ref AND r.alt = s.alt
      WHERE r.case_id IN (SELECT id FROM picked)
      ORDER BY s.gene_symbol, r.chr, r.pos, r.ref, r.alt, r.case_id
    `
      )
      .all(...allIds, ...site.params) as AssociationVariantRow[]
  }
```

The two lines `acmg_classifications: filters.acmg_classifications` and `max_internal_af: filters.max_internal_af` (current lines 43-44) are gone from `baseInput`: `buildBaseWhere` dropped both in this scope, so no query changes.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/main/database/association-data-builder.test.ts tests/main/database/split-genotype-zygosity.test.ts tests/main/database/conflicting-genotype-calls.test.ts tests/main/statistics tests/main/workers/db-worker-dispatch.test.ts tests/main/ipc/handlers tests/web-gate/web-association-route.test.ts tests/shared`
Expected: PASS. The web runner still takes an array from its builder until Task 5 and reports `non_autosomal_variants: 0` through the default parameter.

Run: `make typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/sql/chromosome-order.ts src/main/statistics/types.ts src/main/statistics/contingency.ts src/main/statistics/finalize.ts src/main/statistics/AssociationEngine.ts src/main/database/AssociationDataBuilder.ts tests/main/database/support/burden-fixture.ts tests/main/database/association-data-builder.test.ts tests/main/database/split-genotype-zygosity.test.ts tests/main/database/conflicting-genotype-calls.test.ts tests/main/statistics/integration.test.ts
git commit -m "fix(statistics): burden test selects autosomal sites, then reads every stored call (#520)"
```

---

### Task 5: PostgreSQL builder, web run result and backend parity

**Files:**
- Modify: `src/main/storage/postgres/PostgresAssociationDataBuilder.ts:1-142`
- Modify: `src/main/ipc/handlers/association-logic.ts:13-18`, `:44-79`
- Modify: `src/web/server/association/web-association-runs.ts:12`, `:25-29`
- Create: `tests/main/storage/postgres-association-parity.test.ts`
- Test: `tests/main/storage/postgres-split-genotype-zygosity.test.ts:180-207`, `tests/main/ipc/handlers/association-logic.test.ts:58-59`, `:98-101`, `tests/web-gate/web-association-route.test.ts:42`, `:58-70`

**Interfaces:**
- Consumes: `autosomeSql(column?: string): string`; `assertSingleGenomeBuild(builds: (string | null)[]): void`; `AssociationBuildResult`; `emptyAssociationResults` / `finalizeAssociationResults` with the fourth parameter; fixture exports from Task 4.
- Produces:
  - `PostgresAssociationDataBuilder.build(groupA_ids, groupB_ids, filters, covariateNames): Promise<AssociationBuildResult>` — **return type changes**; same result as SQLite
  - `runAssociationInProcess(config, buildData: (config: AssociationConfig) => Promise<AssociationBuildResult>, options?)`
  - `AssociationRunContext.buildData: (config: AssociationConfig) => Promise<AssociationBuildResult>`
  - `toPostgresFragment` is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/storage/postgres-association-parity.test.ts`:

```ts
/**
 * The burden-test matrix on PostgreSQL is the matrix on SQLite: same sites,
 * same dosages, same frequencies, same exclusion counts (#520).
 * Fixture: tests/main/database/support/burden-fixture.ts.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1 against a real PostgreSQL.
 */
import { randomBytes } from 'node:crypto'

import Database from 'better-sqlite3-multiple-ciphers'
import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'
import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import type { VariantFilters } from '../../../src/main/statistics/types'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresAssociationDataBuilder } from '../../../src/main/storage/postgres/PostgresAssociationDataBuilder'
import {
  BURDEN_ROWS,
  EXPECTED_GENES,
  EXPECTED_NON_AUTOSOMAL,
  SAMPLES,
  projectGenes,
  seedSqlite,
  type Sample
} from '../database/support/burden-fixture'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const MIXED_BUILDS =
  'Mixed genome builds: the selected cases use GRCh37 and GRCh38. ' +
  'Run the burden test on cases of one genome build.'

describe.skipIf(!RUN)('burden test matrix: PostgreSQL equals SQLite', () => {
  let schema: string
  let pool: Pool
  let sqlite: Database.Database
  let sqliteIds: Record<Sample, number>
  const pgIds = {} as Record<Sample, number>

  beforeEach(async () => {
    sqlite = new Database(':memory:')
    initializeSchema(sqlite)
    runMigrations(sqlite)
    sqliteIds = seedSqlite(sqlite)

    schema = `varlens_test_burden_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    for (const sample of SAMPLES) {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, '/burden.vcf', 0, 0, 'GRCh38') RETURNING id`,
        [sample]
      )
      pgIds[sample] = Number(inserted.rows[0].id)
    }
    for (const r of BURDEN_ROWS) {
      await pool.query(
        `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num, qual)
         VALUES ($1, $2, $3, $4, $5, 'snv', $6, $7, $8)`,
        [pgIds[r.sample], r.chr, r.pos, r.ref, r.alt, r.gene, r.gt, r.qual]
      )
    }
  }, 60_000)

  afterEach(async () => {
    sqlite?.close()
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  }, 60_000)

  const groups = (ids: Record<Sample, number>): [number[], number[]] => [
    [ids.S1, ids.S2],
    [ids.S3, ids.S4]
  ]
  const onSqlite = (filters: VariantFilters = {}) =>
    new AssociationDataBuilder(sqlite).build(...groups(sqliteIds), filters, [])
  const onPostgres = (filters: VariantFilters = {}) =>
    new PostgresAssociationDataBuilder(pool, schema).build(...groups(pgIds), filters, [])

  it('returns the same matrix, exclusion counts and non-autosomal count', async () => {
    const pg = await onPostgres()
    expect(projectGenes(pg.genes)).toEqual(EXPECTED_GENES)
    expect(pg.non_autosomal_variants).toBe(EXPECTED_NON_AUTOSOMAL)
    // Whole objects: frequencies, CADD means and carrier counts included.
    expect(pg).toEqual(onSqlite())
  }, 60_000)

  it('a column filter selects sites and keeps every stored call, as on SQLite', async () => {
    const filters: VariantFilters = {
      column_filters: { qual: { operator: '>=', value: 20, includeEmpty: false } }
    }
    const pg = await onPostgres(filters)
    expect(projectGenes(pg.genes)).toEqual(EXPECTED_GENES)
    expect(pg).toEqual(onSqlite(filters))
  }, 60_000)

  it('a gene list on chrX is empty with the same count on both backends', async () => {
    const pg = await onPostgres({ gene_list: ['GENEX'] })
    expect(pg).toEqual({ genes: [], non_autosomal_variants: 2 })
    expect(pg).toEqual(onSqlite({ gene_list: ['GENEX'] }))
  }, 60_000)

  it('rejects mixed genome builds with the SQLite message', async () => {
    await pool.query(`UPDATE "${schema}".cases SET genome_build = 'GRCh37' WHERE id = $1`, [
      pgIds.S4
    ])
    sqlite.prepare("UPDATE cases SET genome_build = 'GRCh37' WHERE id = ?").run(sqliteIds.S4)

    await expect(onPostgres()).rejects.toThrow(MIXED_BUILDS)
    expect(() => onSqlite()).toThrow(MIXED_BUILDS)
  }, 60_000)
})

describe.skipIf(RUN)('burden test matrix: PostgreSQL equals SQLite (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and a PostgreSQL is reachable', () => {
    expect(RUN).toBe(false)
  })
})
```

In `tests/main/storage/postgres-split-genotype-zygosity.test.ts`, replace the body of the test `association dosage is one copy per split or half-called allele, as on SQLite` (lines 180-207):

```ts
  it('association dosage is one copy per split or half-called allele, as on SQLite', async () => {
    const ids = (map: Record<string, number>): number[] => SAMPLES.map((sample) => map[sample])

    const pg = await new PostgresAssociationDataBuilder(pool, schema).build(
      ids(pgIds).slice(0, 2),
      ids(pgIds).slice(2),
      {},
      []
    )
    const lite = new AssociationDataBuilder(sqlite.database).build(
      ids(sqliteIds).slice(0, 2),
      ids(sqliteIds).slice(2),
      {},
      []
    )
    expect(pg).toEqual(lite)
    // Variants in key order: chr1:1000 A>G, chr1:1000 A>T, chr1:2000 C>T; samples S1..S5.
    expect(pg.genes.find((g) => g.gene_symbol === 'GENEA')!.samples.map((s) => s.dosages)).toEqual([
      [1, 1, 1],
      [1, 0, 1],
      [2, 0, 0],
      [1, 1, 0],
      [0, 1, 1]
    ])
    // chrX is not in the burden test (phase 1: autosomes only); it is counted.
    expect(pg.genes.find((g) => g.gene_symbol === 'GENEX')).toBeUndefined()
    expect(pg.non_autosomal_variants).toBe(1)
  }, 60_000)
```

In `tests/main/ipc/handlers/association-logic.test.ts` the `buildData` callbacks return the build result. Replace lines 58-59 and the test at 98-101, and use `built` where the three tests pass `async () => genes()`:

```ts
const genes = () =>
  buildGeneContingencyData(rows(), CONFIG.groupA_ids, CONFIG.groupB_ids, new Map())
const built = async () => ({ genes: genes(), non_autosomal_variants: 3 })
```

```ts
    const result = await runAssociationInProcess(CONFIG, built, { batchSize: 1 })
```

```ts
    const result = await runAssociationInProcess(CONFIG, built, {
      batchSize: 1,
      onProgress,
      signal: controller.signal
    })
```

```ts
      runAssociationInProcess({ ...CONFIG, groupB_ids: [1] }, built)
```

```ts
  it('no qualifying genes → empty result with a warning and the non-autosomal count', async () => {
    const result = await runAssociationInProcess(CONFIG, async () => ({
      genes: [],
      non_autosomal_variants: 2
    }))
    expect(result.warnings).toEqual(['No genes with qualifying variants'])
    expect(result.non_autosomal_variants).toBe(2)
  })

  it('carries the non-autosomal count into a finished and a cancelled run', async () => {
    expect((await runAssociationInProcess(CONFIG, built)).non_autosomal_variants).toBe(3)
    const controller = new AbortController()
    controller.abort()
    const cancelled = await runAssociationInProcess(CONFIG, built, { signal: controller.signal })
    expect(cancelled.non_autosomal_variants).toBe(3)
  })
```

In the first test of that file the expected value also gets the count: `finalizeAssociationResults(genes().map(…), CONFIG, Date.now())` compares `.results` only and needs no change.

In `tests/web-gate/web-association-route.test.ts` replace line 42 and extend the first test (lines 58-70):

```ts
function harness(
  build = vi.fn(async () => ({ genes: sampleGenes(), non_autosomal_variants: 4 }))
) {
```

```ts
    const body = result as {
      results: Array<{ gene_symbol: string; q_value: number | null }>
      non_autosomal_variants: number
    }
    expect(body.results.map((r) => r.gene_symbol)).toEqual(['GENE1'])
    expect(body.results[0].q_value).not.toBeNull()
    expect(body.non_autosomal_variants).toBe(4)
```

and in the third test (line 85-88) the gated builder returns the same shape:

```ts
    const build = vi.fn(async () => {
      await gate
      return { genes: sampleGenes(), non_autosomal_variants: 0 }
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/ipc/handlers/association-logic.test.ts tests/web-gate/web-association-route.test.ts`
Expected: FAIL — `genes.length` of an object is `undefined`, so the runner reports "No genes with qualifying variants" and `non_autosomal_variants` is 0.

Start PostgreSQL (`make pg-up`) and use the URL of that container.

Run: `VARLENS_RUN_POSTGRES_E2E=1 VARLENS_PG_URL=<url> npx vitest run tests/main/storage/postgres-association-parity.test.ts tests/main/storage/postgres-split-genotype-zygosity.test.ts`
Expected: FAIL — PostgreSQL returns an array with `GENEM`, `GENEU`, `GENEX`, `GENEY`; no error for mixed builds.

Without a PostgreSQL: `npx vitest run tests/main/storage/postgres-association-parity.test.ts` runs only the `(skipped)` block and passes. Say so in the task report; the orchestrator's `make preflight-full` runs the gated tests.

- [ ] **Step 3: Write the implementation**

`src/main/storage/postgres/PostgresAssociationDataBuilder.ts` — replace the header comment and imports (lines 1-23):

```ts
/**
 * Postgres counterpart of the SQLite AssociationDataBuilder (desktop).
 *
 * Same two steps and the same filter semantics: the WHERE clause of the site
 * selection comes from the shared `buildBaseWhere` (scope `cohort-burden`)
 * and `buildExtensionJoinClauses` helpers, rewritten from SQLite
 * placeholders/collation to Postgres. Rows are grouped into per-gene
 * contingency data by the shared `contingency.ts`, so desktop and web feed
 * identical inputs to the statistical tests.
 */
import type { Pool } from 'pg'

import { buildBaseWhere, type BaseFilterInput } from '../../database/variant-where-builder'
import { buildExtensionJoinClauses } from '../../database/variant-extension-registry'
import {
  assertSingleGenomeBuild,
  buildCovariateMap,
  buildGeneContingencyData,
  type AssociationVariantRow,
  type CaseMetaRow,
  type CaseMetricRow
} from '../../statistics/contingency'
import type { AssociationBuildResult, VariantFilters } from '../../statistics/types'
import { autosomeSql } from '../../../shared/sql/chromosome-order'
import { gtDosageSql } from '../../../shared/sql/genotype-dosage'
import { quoteIdentifier } from './identifiers'

type Queryable = Pick<Pool, 'query'>

/** The filters of a run as Postgres SQL on `variants v`; `$1` is the case id array. */
interface SiteFilter {
  joins: string
  conditions: string[]
  /** `[caseIds, ...filter parameters]`, numbered from `$1`. */
  params: unknown[]
}
```

(`type Queryable` at line 25 already exists; keep one copy.)

Replace `build` and `loadVariantRows` (lines 64-142):

```ts
  async build(
    groupA_ids: number[],
    groupB_ids: number[],
    filters: VariantFilters,
    covariateNames: string[]
  ): Promise<AssociationBuildResult> {
    const allIds = [...groupA_ids, ...groupB_ids]
    if (allIds.length === 0) return { genes: [], non_autosomal_variants: 0 }

    const builds = await this.pool.query<{ genome_build: string | null }>(
      `SELECT DISTINCT genome_build FROM ${this.schemaName}."cases"
        WHERE id = ANY($1::bigint[])`,
      [allIds]
    )
    assertSingleGenomeBuild(builds.rows.map((row) => row.genome_build))

    const site = this.siteFilter(allIds, filters)
    const non_autosomal_variants = await this.countNonAutosomalVariants(site)
    const rows = await this.loadVariantRows(site)
    if (rows.length === 0) return { genes: [], non_autosomal_variants }

    const covariateMap =
      covariateNames.length > 0
        ? await this.loadCovariates(allIds, covariateNames)
        : new Map<number, number[]>()
    return {
      genes: buildGeneContingencyData(rows, groupA_ids, groupB_ids, covariateMap),
      non_autosomal_variants
    }
  }

  private siteFilter(allIds: number[], filters: VariantFilters): SiteFilter {
    const baseInput: BaseFilterInput = {
      gnomad_af_max: filters.gnomad_af_max,
      cadd_min: filters.cadd_min,
      consequences: filters.consequences,
      clinvars: filters.clinvars,
      funcs: filters.funcs,
      gene_list: filters.gene_list,
      column_filters: filters.column_filters
    }
    const base = buildBaseWhere(baseInput, { baseAlias: 'v', scope: 'cohort-burden' })
    const ext = buildExtensionJoinClauses(filters.column_filters ?? {}, 'v')

    const params: unknown[] = [allIds]
    const conditions: string[] = []
    let next = 2
    if (base.sql !== '') {
      const converted = toPostgresFragment(base.sql, next, this.schemaName)
      conditions.push(converted.sql)
      next = converted.next
      params.push(...base.params)
    }
    if (ext.whereClause !== '') {
      conditions.push(toPostgresFragment(ext.whereClause, next, this.schemaName).sql)
      params.push(...ext.params)
    }
    return {
      joins: toPostgresFragment(ext.joins, next, this.schemaName).sql,
      conditions,
      params
    }
  }

  /** Qualifying variants of the selected cases that are not on an autosome: reported, never tested. */
  private async countNonAutosomalVariants(site: SiteFilter): Promise<number> {
    const where = [
      'v.case_id = ANY($1::bigint[])',
      `NOT (${autosomeSql('v.chr')})`,
      ...site.conditions
    ]
    const result = await this.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT DISTINCT v.chr, v.pos, v.ref, v.alt
           FROM ${this.schemaName}."variants" v
           ${site.joins}
          WHERE ${where.join(' AND ')}
       ) non_autosomal`,
      site.params
    )
    return Number(result.rows[0].n)
  }

  /**
   * Select, then collect — the SQLite builder's two steps. `$1` (the case ids)
   * is used by both; the filter fragments are numbered from `$2`. The ORDER BY
   * is bytewise (`COLLATE "C"`), as SQLite orders TEXT, so both backends list
   * genes and sites in the same order.
   */
  private async loadVariantRows(site: SiteFilter): Promise<AssociationVariantRow[]> {
    const where = ['v.case_id = ANY($1::bigint[])', autosomeSql('v.chr'), ...site.conditions]
    const result = await this.pool.query<Record<string, unknown>>(
      `WITH selected AS (
         SELECT DISTINCT v.gene_symbol, v.chr, v.pos, v.ref, v.alt
           FROM ${this.schemaName}."variants" v
           ${site.joins}
          WHERE ${where.join(' AND ')}
       )
       SELECT s.gene_symbol,
              r.case_id,
              r.chr || ':' || r.pos::text || ':' || r.ref || ':' || r.alt AS variant_key,
              r.gt_num,
              ${gtDosageSql('r.gt_num')} AS dosage,
              r.gnomad_af,
              r.cadd
         FROM selected s
         JOIN ${this.schemaName}."variants" r
           ON r.chr = s.chr AND r.pos = s.pos AND r.ref = s.ref AND r.alt = s.alt
        WHERE r.case_id = ANY($1::bigint[])
        ORDER BY s.gene_symbol COLLATE "C", r.chr COLLATE "C", r.pos,
                 r.ref COLLATE "C", r.alt COLLATE "C", r.case_id`,
      site.params
    )

    return result.rows.map((row) => ({
      gene_symbol: String(row.gene_symbol),
      case_id: Number(row.case_id),
      variant_key: String(row.variant_key),
      gt_num: typeof row.gt_num === 'string' ? row.gt_num : null,
      // NULL dosage is carried as it is; contingency.ts decides what is missing (rowDosage).
      dosage: toNumberOrNull(row.dosage),
      gnomad_af: toNumberOrNull(row.gnomad_af),
      cadd: toNumberOrNull(row.cadd)
    }))
  }
```

`autosomeSql` and `gtDosageSql` contain no `?`, and neither passes through `toPostgresFragment`, so the placeholder numbering is unchanged. `toPostgresFragment` itself is not edited; its test in `association-logic.test.ts:104-117` stays.

`src/main/ipc/handlers/association-logic.ts` — import `AssociationBuildResult` instead of `GeneContingencyData` (lines 13-18) and replace `runAssociationInProcess` (lines 44-79):

```ts
import type {
  AssociationBuildResult,
  AssociationConfig,
  AssociationResults,
  GeneAssociationResult
} from '../../statistics/types'
```

```ts
export async function runAssociationInProcess(
  config: AssociationConfig,
  buildData: (config: AssociationConfig) => Promise<AssociationBuildResult>,
  options: InProcessAssociationOptions = {}
): Promise<AssociationResults> {
  const startedAt = Date.now()
  assertDisjointGroups(config)

  const { genes, non_autosomal_variants: skipped } = await buildData(config)
  if (genes.length === 0) {
    return emptyAssociationResults(config, 'No genes with qualifying variants', startedAt, skipped)
  }

  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE)
  const raw: GeneAssociationResult[] = []
  for (let i = 0; i < genes.length; i++) {
    if (options.signal?.aborted === true) {
      return emptyAssociationResults(config, 'Analysis cancelled', startedAt, skipped)
    }
    // A failing gene is skipped, as in the desktop worker (which logs and continues).
    try {
      raw.push(computeGeneAssociation(genes[i], config.weight_scheme))
    } catch {
      // intentionally skipped: one degenerate gene must not fail the run
    }
    if ((i + 1) % batchSize === 0 || i === genes.length - 1) {
      options.onProgress?.({ completed: i + 1, total: genes.length })
      await yieldToEventLoop()
    }
  }

  if (options.signal?.aborted === true) {
    return emptyAssociationResults(config, 'Analysis cancelled', startedAt, skipped)
  }
  return finalizeAssociationResults(raw, config, startedAt, skipped)
}
```

`src/web/server/association/web-association-runs.ts` — line 12 and the `buildData` member (line 28):

```ts
import type { AssociationBuildResult, AssociationConfig } from '../../../main/statistics/types'
```

```ts
  buildData: (config: AssociationConfig) => Promise<AssociationBuildResult>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `VARLENS_RUN_POSTGRES_E2E=1 VARLENS_PG_URL=<url> npx vitest run tests/main/storage/postgres-association-parity.test.ts tests/main/storage/postgres-split-genotype-zygosity.test.ts`
Expected: PASS.

Run: `npx vitest run tests/main/ipc/handlers/association-logic.test.ts tests/web-gate/web-association-route.test.ts && make typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/postgres/PostgresAssociationDataBuilder.ts src/main/ipc/handlers/association-logic.ts src/web/server/association/web-association-runs.ts tests/main/storage/postgres-association-parity.test.ts tests/main/storage/postgres-split-genotype-zygosity.test.ts tests/main/ipc/handlers/association-logic.test.ts tests/web-gate/web-association-route.test.ts
git commit -m "fix(postgres): burden test matrix matches SQLite: autosomes, select then collect (#520)"
```

---

### Task 6: Remove the two filters the burden scope never applied (#510)

What the code shows: `AssociationConfigPanel.vue` offers no ACMG and no internal-frequency control. `buildIpcParams` can serialise both, but the panel's own `createFilters()` state never sets them. After Tasks 4 and 5 no builder reads them. They remain in `FilterIpcParams`, `BaseFilterInput` and `buildBaseWhere` for the case and cohort views, which are not changed.

**Files:**
- Modify: `src/main/statistics/types.ts:24-46` (line numbers of `main`; the block is `VariantFilters` and its comment)
- Modify: `src/shared/types/ipc-schemas.ts:729-734`
- Create: `tests/shared/types/association-config-schema.test.ts`
- Test: `tests/main/database/association-data-builder.test.ts:113-118`, `:147-186`

**Interfaces:**
- Consumes: nothing.
- Produces: `VariantFilters` = `{ gnomad_af_max?, cadd_min?, consequences?, gene_list?, clinvars?, funcs?, column_filters? }`; `AssociationConfigSchema` strips `acmg_classifications` and `max_internal_af` (zod objects drop unknown keys).

- [ ] **Step 1: Write the failing test**

Create `tests/shared/types/association-config-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { AssociationConfigSchema } from '../../../src/shared/types/ipc-schemas'

describe('AssociationConfigSchema', () => {
  it('carries only filters the burden test applies (#510)', () => {
    const parsed = AssociationConfigSchema.parse({
      groupA_ids: [1],
      groupB_ids: [2],
      primary_test: 'fisher',
      weight_scheme: 'uniform',
      covariates: [],
      filters: {
        gnomad_af_max: 0.01,
        clinvars: ['Pathogenic'],
        acmg_classifications: ['Pathogenic'],
        max_internal_af: 0.1
      }
    })
    // The two cohort-summary filters were accepted and then dropped: they are not accepted now.
    expect(parsed.filters).toEqual({ gnomad_af_max: 0.01, clinvars: ['Pathogenic'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/types/association-config-schema.test.ts`
Expected: FAIL — `filters` still contains `acmg_classifications` and `max_internal_af`.

- [ ] **Step 3: Write minimal implementation**

`src/shared/types/ipc-schemas.ts` — replace lines 729-734 inside `AssociationConfigSchema`:

```ts
    // Filters the burden test applies to `variants` rows (FilterIpcParams subset).
    clinvars: z.array(z.string()).optional(),
    funcs: z.array(z.string()).optional(),
    column_filters: z.record(z.string(), ColumnFilterSchema).optional()
```

`src/main/statistics/types.ts` — replace lines 24-46:

```ts
/**
 * Variant-level filters that select the sites of an association run. Every
 * field is applied to `variants` rows by both AssociationDataBuilders; a
 * filter that needs the cohort summary (ACMG class, cohort frequency) is not
 * part of this contract.
 */
export interface VariantFilters {
  gnomad_af_max?: number
  cadd_min?: number
  consequences?: string[]
  gene_list?: string[]
  clinvars?: string[]
  funcs?: string[]
  // Flexible column filter map — dotted keys (e.g. 'cnv.copy_number') route
  // through the shared extension helpers.
  column_filters?: ColumnFiltersParam
}
```

`tests/main/database/association-data-builder.test.ts` — delete the two tests `accepts all new parity fields without error (cohort-summary-only fields are silently dropped)` and `silently drops cohort-summary-only fields for burden scope (no runtime error, no filter effect)` (lines 147-186), and the `NOTE:` comment block above the insert loop (lines 115-118). `tests/main/database/variant-where-builder.test.ts` is not changed: `buildBaseWhere` still drops both fields for the `cohort-burden` scope.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/types/association-config-schema.test.ts tests/main/database/association-data-builder.test.ts tests/main/database/variant-where-builder.test.ts tests/renderer/components/association tests/web-gate/web-association-route.test.ts`
Expected: PASS.

Run: `make typecheck`
Expected: exit 0 (no source file reads the two fields from `VariantFilters`).

- [ ] **Step 5: Commit**

```bash
git add src/main/statistics/types.ts src/shared/types/ipc-schemas.ts tests/shared/types/association-config-schema.test.ts tests/main/database/association-data-builder.test.ts
git commit -m "refactor(statistics): drop association filters that were accepted and never applied (#510)"
```

---

### Task 7: Result view and export state the assumption, the excluded sites and the non-autosomal count

**Files:**
- Create: `src/renderer/src/utils/association-results.ts`
- Modify: `src/renderer/src/components/association/AssociationResultsTable.vue:15-23`, `:76-89`, `:93-126`, `:136-163`, `:183-226`
- Modify: `src/renderer/src/components/association/GeneBurdenView.vue:85`, `:120-150`
- Modify: `src/renderer/src/mocks/mockApi.ts:708-713`
- Test: `tests/renderer/utils/association-results.test.ts` (new), `tests/renderer/components/association/AssociationResultsTable.test.ts` (new)

**Interfaces:**
- Consumes: the IPC result of `cohort:geneBurdenCompare` / `cohort:runAssociation`, whose rows now carry `sites_excluded: { missing_call: number; conflicting_calls: number; no_called_alleles: number }` (Task 2). The run result carries `non_autosomal_variants: number` (Tasks 4 and 5). Desktop and web return the same object; `VolcanoPlot.vue` and `ManhattanPlot.vue` read a subset and are not changed.
- Produces: `BURDEN_REFERENCE_NOTE: string`, `SitesExcluded`, `AssociationResultRow`, `excludedSiteCount(excluded: SitesExcluded): number`, `excludedSitesLabel(excluded: SitesExcluded): string`, `nonAutosomalNote(count: number): string | null`, `buildAssociationTsv(results: AssociationResultRow[], nonAutosomalVariants?: number): string`; `AssociationResultsTable` prop `nonAutosomalVariants?: number`.

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/utils/association-results.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  BURDEN_REFERENCE_NOTE,
  buildAssociationTsv,
  excludedSiteCount,
  excludedSitesLabel,
  nonAutosomalNote,
  type AssociationResultRow
} from '../../../src/renderer/src/utils/association-results'

const row: AssociationResultRow = {
  gene_symbol: 'GENE1',
  n_variants: 2,
  sites_excluded: { missing_call: 2, conflicting_calls: 1, no_called_alleles: 0 },
  groupA_carriers: 3,
  groupB_carriers: 1,
  groupA_total: 5,
  groupB_total: 5,
  fisher: { p_value: 0.04, odds_ratio: 6, ci_lower: null, ci_upper: null },
  logistic_burden: {
    p_value: 0.03,
    beta: 1.2,
    se: 0.5,
    ci_lower: 0.2,
    ci_upper: 2.2,
    used_firth: false
  },
  q_value: 0.08
}

describe('association result text', () => {
  it('states the assumption word for word', () => {
    expect(BURDEN_REFERENCE_NOTE).toBe(
      'Samples without a stored call are treated as reference. Use data called and filtered the same way for both groups.'
    )
  })

  it('sums and names the excluded sites', () => {
    expect(excludedSiteCount(row.sites_excluded)).toBe(3)
    expect(excludedSitesLabel(row.sites_excluded)).toBe(
      'Missing call: 2, conflicting calls: 1, no called alleles: 0'
    )
  })

  it('exports the assumption, the sites used and the excluded sites per reason', () => {
    const [note, header, line] = buildAssociationTsv([row]).split('\n')
    expect(note).toBe(`# ${BURDEN_REFERENCE_NOTE}`)
    expect(header.split('\t')).toEqual([
      'Gene',
      'Variants',
      'Cases_A',
      'Cases_B',
      'Fisher_OR',
      'Fisher_CI_Lower',
      'Fisher_CI_Upper',
      'Fisher_p',
      'Burden_beta',
      'Burden_SE',
      'Burden_p',
      'q_value',
      'Excluded_missing_call',
      'Excluded_conflicting_calls',
      'Excluded_no_called_alleles'
    ])
    expect(line.split('\t')).toEqual([
      'GENE1', '2', '3', '1', '6', '', '', '0.04', '1.2', '0.5', '0.03', '0.08', '2', '1', '0'
    ])
  })

  it('says how many qualifying variants are not on an autosome, in the view text and the export', () => {
    expect(nonAutosomalNote(0)).toBeNull()
    expect(nonAutosomalNote(1)).toBe(
      '1 qualifying variant was left out because it is not on chromosomes 1-22.'
    )
    expect(nonAutosomalNote(7)).toBe(
      '7 qualifying variants were left out because they are not on chromosomes 1-22.'
    )

    // An empty run on chrX still exports the reason.
    expect(buildAssociationTsv([], 7).split('\n').slice(0, 2)).toEqual([
      `# ${BURDEN_REFERENCE_NOTE}`,
      '# 7 qualifying variants were left out because they are not on chromosomes 1-22.'
    ])
    expect(buildAssociationTsv([row]).split('\n')).toHaveLength(3)
  })
})
```

Create `tests/renderer/components/association/AssociationResultsTable.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import AssociationResultsTable from '../../../../src/renderer/src/components/association/AssociationResultsTable.vue'
import { BURDEN_REFERENCE_NOTE } from '../../../../src/renderer/src/utils/association-results'

const vuetify = createVuetify({ components, directives })

const result = {
  gene_symbol: 'GENE1',
  n_variants: 2,
  sites_excluded: { missing_call: 2, conflicting_calls: 1, no_called_alleles: 0 },
  groupA_carriers: 3,
  groupB_carriers: 1,
  groupA_total: 5,
  groupB_total: 5,
  fisher: { p_value: 0.04, odds_ratio: 6, ci_lower: null, ci_upper: null },
  logistic_burden: {
    p_value: 0.03,
    beta: 1.2,
    se: 0.5,
    ci_lower: 0.2,
    ci_upper: 2.2,
    used_firth: false
  },
  q_value: 0.08
}

describe('AssociationResultsTable', () => {
  it('states the reference assumption and shows the excluded sites of each gene', () => {
    const wrapper = mount(AssociationResultsTable, {
      global: { plugins: [vuetify, createPinia()] },
      props: { results: [result], primaryTest: 'fisher' }
    })

    expect(wrapper.get('[data-testid="burden-reference-note"]').text()).toBe(BURDEN_REFERENCE_NOTE)
    const excluded = wrapper.get('[data-testid="sites-excluded"]')
    expect(excluded.text()).toBe('3')
    expect(excluded.attributes('title')).toBe(
      'Missing call: 2, conflicting calls: 1, no called alleles: 0'
    )
    expect(wrapper.find('[data-testid="burden-non-autosomal-note"]').exists()).toBe(false)
  })

  it('an empty result on chrX says why it is empty', () => {
    const wrapper = mount(AssociationResultsTable, {
      global: { plugins: [vuetify, createPinia()] },
      props: { results: [], primaryTest: 'fisher', nonAutosomalVariants: 2 }
    })
    expect(wrapper.get('[data-testid="burden-non-autosomal-note"]').text()).toBe(
      '2 qualifying variants were left out because they are not on chromosomes 1-22.'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/utils/association-results.test.ts tests/renderer/components/association/AssociationResultsTable.test.ts`
Expected: FAIL — `association-results` cannot be resolved; no `burden-reference-note` element.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/utils/association-results.ts`:

```ts
/**
 * Text of a gene burden result: the assumption every result states, the
 * excluded sites of a gene, and the TSV export.
 */

/** Shown with every result and written into every export. VarLens stores no callability. */
export const BURDEN_REFERENCE_NOTE =
  'Samples without a stored call are treated as reference. ' +
  'Use data called and filtered the same way for both groups.'

/** Sites left out of a gene, per reason (SiteExclusionCounts in src/main/statistics/types.ts). */
export interface SitesExcluded {
  missing_call: number
  conflicting_calls: number
  no_called_alleles: number
}

export interface AssociationResultRow {
  gene_symbol: string
  /** Sites used: eligible sites with a known call in every selected sample. */
  n_variants: number
  sites_excluded: SitesExcluded
  groupA_carriers: number
  groupB_carriers: number
  groupA_total: number
  groupB_total: number
  fisher: {
    p_value: number | null
    odds_ratio: number | null
    ci_lower: number | null
    ci_upper: number | null
  }
  logistic_burden: {
    p_value: number | null
    beta: number | null
    se: number | null
    ci_lower: number | null
    ci_upper: number | null
    used_firth: boolean
    warning?: string
  }
  q_value: number | null
}

export function excludedSiteCount(excluded: SitesExcluded): number {
  return excluded.missing_call + excluded.conflicting_calls + excluded.no_called_alleles
}

export function excludedSitesLabel(excluded: SitesExcluded): string {
  return (
    `Missing call: ${excluded.missing_call}, ` +
    `conflicting calls: ${excluded.conflicting_calls}, ` +
    `no called alleles: ${excluded.no_called_alleles}`
  )
}

/** Why a run can be smaller than the filters suggest, or empty; null when nothing was left out. */
export function nonAutosomalNote(count: number): string | null {
  if (count <= 0) return null
  return count === 1
    ? '1 qualifying variant was left out because it is not on chromosomes 1-22.'
    : `${count} qualifying variants were left out because they are not on chromosomes 1-22.`
}

const TSV_HEADER = [
  'Gene',
  'Variants',
  'Cases_A',
  'Cases_B',
  'Fisher_OR',
  'Fisher_CI_Lower',
  'Fisher_CI_Upper',
  'Fisher_p',
  'Burden_beta',
  'Burden_SE',
  'Burden_p',
  'q_value',
  'Excluded_missing_call',
  'Excluded_conflicting_calls',
  'Excluded_no_called_alleles'
]

/** The results as TSV. `#` comment lines first: the stated assumption, then the non-autosomal count. */
export function buildAssociationTsv(
  results: AssociationResultRow[],
  nonAutosomalVariants = 0
): string {
  const rows = results.map((r) =>
    [
      r.gene_symbol,
      r.n_variants,
      r.groupA_carriers,
      r.groupB_carriers,
      r.fisher.odds_ratio ?? '',
      r.fisher.ci_lower ?? '',
      r.fisher.ci_upper ?? '',
      r.fisher.p_value ?? '',
      r.logistic_burden.beta ?? '',
      r.logistic_burden.se ?? '',
      r.logistic_burden.p_value ?? '',
      r.q_value ?? '',
      r.sites_excluded.missing_call,
      r.sites_excluded.conflicting_calls,
      r.sites_excluded.no_called_alleles
    ].join('\t')
  )
  const skipped = nonAutosomalNote(nonAutosomalVariants)
  const comments = [BURDEN_REFERENCE_NOTE, ...(skipped === null ? [] : [skipped])]
  return [...comments.map((line) => `# ${line}`), TSV_HEADER.join('\t'), ...rows].join('\n')
}
```

`src/renderer/src/components/association/AssociationResultsTable.vue`:

Template — add between the toolbar `</div>` (line 22) and `<v-data-table` (line 24):

```vue
    <p class="text-caption text-medium-emphasis mb-2" data-testid="burden-reference-note">
      {{ BURDEN_REFERENCE_NOTE }}
    </p>
    <p
      v-if="skippedNote"
      class="text-caption text-medium-emphasis mb-2"
      data-testid="burden-non-autosomal-note"
    >
      {{ skippedNote }}
    </p>
```

Template — add after the `item.gene_symbol` slot (lines 35-37):

```vue
      <!-- Sites left out of this gene; the tooltip names the reasons -->
      <template #[`item.sites_excluded`]="{ item }">
        <span data-testid="sites-excluded" :title="excludedSitesLabel(item.sites_excluded)">
          {{ excludedSiteCount(item.sites_excluded) }}
        </span>
      </template>
```

Script — replace the imports and the local `AssociationResult` interface (lines 94-126):

```ts
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { mdiAlertCircleOutline, mdiDownload, mdiMagnify } from '@mdi/js'
import {
  BURDEN_REFERENCE_NOTE,
  buildAssociationTsv,
  excludedSiteCount,
  excludedSitesLabel,
  nonAutosomalNote,
  type AssociationResultRow
} from '../../utils/association-results'

const props = defineProps<{
  results: AssociationResultRow[]
  primaryTest: string
  /** Qualifying variants the run left out because they are not on an autosome. */
  nonAutosomalVariants?: number
}>()

const skippedNote = computed(() => nonAutosomalNote(props.nonAutosomalVariants ?? 0))
```

Script — in `headers`, add after the `n_variants` entry (line 138):

```ts
  { title: 'Excluded sites', key: 'sites_excluded', sortable: false, align: 'end' as const },
```

Script — replace `exportResults` (lines 183-226):

```ts
function exportResults(): void {
  const tsv = buildAssociationTsv(props.results, props.nonAutosomalVariants ?? 0)
  const blob = new Blob([tsv], { type: 'text/tab-separated-values' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gene_burden_results_${new Date().toISOString().split('T')[0]}.tsv`
  a.click()
  URL.revokeObjectURL(url)
}
```

`src/renderer/src/components/association/GeneBurdenView.vue` — in the local `AssociationResult` interface add after `n_variants: number` (line 122):

```ts
  sites_excluded: { missing_call: number; conflicting_calls: number; no_called_alleles: number }
```

in `AssociationResultsData` (lines 145-150) add:

```ts
  non_autosomal_variants: number
```

and pass it to the table (line 85):

```vue
        <AssociationResultsTable
          :results="results.results"
          :primary-test="results.primary_test"
          :non-autosomal-variants="results.non_autosomal_variants"
        />
```

`src/renderer/src/mocks/mockApi.ts` — the mock run result (lines 708-713) gets the field:

```ts
    runAssociation: async () => ({
      results: [],
      warnings: [],
      non_autosomal_variants: 0,
      elapsed_ms: 0,
      primary_test: 'fisher'
    }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/utils/association-results.test.ts tests/renderer/components/association`
Expected: PASS.

Run: `make typecheck`
Expected: exit 0 (`vue-tsc` accepts `results.results` of `GeneBurdenView` as `AssociationResultRow[]`).

- [ ] **Step 5: Check the view in the app**

Run: `make dev`. Open Cohort → Gene Burden, pick two groups, run. Confirm: the sentence is above the table in light and dark theme; a run with a chrX gene list shows an empty table and the line "… qualifying variants were left out because they are not on chromosomes 1-22."; the "Excluded sites" column shows a number with the three reasons on hover; Export writes a file whose first line starts with `# Samples without a stored call`. If the app cannot be opened in this environment, say so in the task report instead of claiming the view works.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/utils/association-results.ts src/renderer/src/components/association/AssociationResultsTable.vue src/renderer/src/components/association/GeneBurdenView.vue src/renderer/src/mocks/mockApi.ts tests/renderer/utils/association-results.test.ts tests/renderer/components/association/AssociationResultsTable.test.ts
git commit -m "feat(renderer): burden results state the reference assumption and the excluded sites (#520)"
```

---

### Task 8: Decision record, user documentation and verification

**Files:**
- Modify: `.planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md:54-86`
- Modify: `docs/features/cohort-analysis.md:29-36`

**Interfaces:**
- Consumes: the behaviour of Tasks 1-7.
- Produces: nothing for later tasks.

- [ ] **Step 1: Update the decision record**

In `.planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md`, replace the paragraph that starts `Several rows of one case for one variant` (lines 54-60):

```markdown
Several rows of one case for one variant with different genotypes resolve to **one call, the
highest dosage**: hom > het (incl. assumed) > hemizygous > reference > unknown, ties by the
bytewise greatest text. A called ALT is evidence; a reference or missing call on another row is
not evidence against it. Defined once — `genotypeCallKey` (TS) / `gtCallKeySql`, `resolvedGtSql`
(SQL) — and used by the cohort summary (rebuild and every incremental path) and the carrier list.
It replaced a text `MAX(gt_num)` (summary). SQLite **v43** / PostgreSQL **0027** flag a populated
summary stale again. **The association test departs from this shared rule (#520):** there, rows of
one case that disagree in dosage are a missing call and the site is excluded (below). The cohort
summary and the carrier list keep "highest dosage".
```

Replace the paragraph that starts `Burden allele frequency = ALT copies` (lines 62-67) with a new section:

```markdown
## Burden test (#520, phase 1)

Spec: `.planning/specs/2026-10-08-burden-test-eligible-sites.md`. Code:
`src/main/statistics/contingency.ts` and both `AssociationDataBuilder`s.

- **Sites:** autosomes 1-22 (`autosomeSql`), cases of one genome build
  (`assertSingleGenomeBuild`). The filters select sites; every stored row of the selected cases at
  a selected site is then read without a filter.
- **Dosage** per sample and site: 0, 1 or 2, or missing. The classes of the table above stay: an
  assumed het (`1/.`, `./1`) is one copy, and a reference half-call (`0/.`, `./0`) is no copy with
  two called alleles (`gtDosageSql` gives NULL for it; `rowDosage` in `contingency.ts` reads it as
  0 through `calledAlleleCount`). Missing is only the unknown class (`./.`, NULL, other text), or
  rows of one case that differ in dosage (`0/1` + `1/1`, `0/1` + `./.`). `0/1` + `0|1` agree.
  Genotype quality is not consulted.
- **Complete sites only:** a site with a missing dosage in any selected sample is used for no
  sample, in the burden score and in the Fisher table. Nothing is imputed. Each gene reports the
  sites used (`n_variants`) and `sites_excluded` by `missing_call`, `conflicting_calls` and
  `no_called_alleles`. The run reports `non_autosomal_variants`: qualifying variants on chrX,
  chrY, MT or another contig, so a chrX gene list is not empty without a reason.
- **Frequency** p = ALT copies / called alleles (`calledAlleleCount`: haploid 1, diploid 2, no
  row 2) among the samples with complete covariates. **Weight** = Beta(min(p, 1 − p); 1, 25).
```

Replace the `## Known limits` list (lines 69-80):

```markdown
## Known limits

- Burden test: a sample with no row is counted as two reference alleles, also at uncovered
  sites. VarLens stores no callability; every result and export says so. A callable-region mask
  is a separate spec.
- Burden test: autosomes only. chrX (phase 2 of the spec: sex, pseudoautosomal regions, male
  coding), chrY and MT are not tested.
- Burden test: `1` and `0/1` rows of one case agree in dosage and count as one copy; the ploidy
  disagreement is not detected.
- Cohort summary and carrier list: conflicting duplicate calls resolve to the highest dosage
  without looking at genotype quality, which biases toward ALT. The burden test excludes the same
  site, so a cohort row can show a homozygous carrier that the burden test does not count.
  `1` and `0/1` duplicates on chrX resolve to het by rank: a ploidy disagreement, not a dosage one.
- The SQL and TypeScript duplicate-call keys agree for the stored ASCII genotype grammar only.
- Overwriting a case does not carry its per-case annotations (ACMG classifications, stars,
  comments, tags) over to the replacement; the batch-import dialog says so.
```

In `## Consequences users will see`, replace the `Association / burden` bullet (line 86):

```markdown
- Association / burden: assumed-het samples carry dosage 1. Sites with an unknown or conflicting
  call in any selected sample are left out and counted per gene. Variants on chrX, chrY and MT are
  left out and counted per run.
```

- [ ] **Step 2: Update the user documentation**

In `docs/features/cohort-analysis.md`, add after the bullet list of `## Gene Burden Analysis` (after line 36):

```markdown
The burden test uses variants on chromosomes 1-22. All selected cases must have the same genome build. Your filters choose the variants; VarLens then reads every stored call of the selected cases at those variants, so a filter cannot hide a carrier.

A variant is left out for a gene when a selected sample has no usable call there: a no-call (`./.`), or two stored calls that disagree (`0/1` and `1/1`). The result table shows how many variants were used and how many were left out, with the reason. Variants on chrX, chrY and MT are not tested; the result says how many of your qualifying variants that concerns. Variants are weighted by their minor allele frequency among the tested samples.

Samples without a stored call are treated as reference. Use data called and filtered the same way for both groups.
```

- [ ] **Step 3: Run the verification gates**

On megalodon, wrap each heavy run: `systemd-run --user --scope -p MemoryMax=16G <command>`.

Run: `make typecheck`
Expected: exit 0.

Run: `make rebuild-node && make test`
Expected: exit 0; all suites pass, including the new `contingency`, `burden`, `weights`, `association-data-builder`, `association-config-schema`, `association-results` and `AssociationResultsTable` tests. The PostgreSQL-gated suites report their `(skipped)` test.

Run: `VARLENS_WEB=1 make test`
Expected: exit 0 (needs PostgreSQL; `web-gate-static` and `web-gate-integration` pass). If no PostgreSQL is available, report that this gate was not run.

Run: `make agent-check`
Expected: exit 0; no file grows past 600 lines (`contingency.ts` is about 250 lines, `AssociationResultsTable.vue` about 215, `PostgresAssociationDataBuilder.ts` about 195).

Report each command with its real outcome. The full `make preflight-full` gate, which also runs the PostgreSQL-gated tests (`postgres-association-parity`, `postgres-split-genotype-zygosity`), is run once by the orchestrator after all three parallel plans have landed; do not run it per plan.

- [ ] **Step 4: Commit**

```bash
git add .planning/docs/SPLIT-GENOTYPE-ZYGOSITY.md docs/features/cohort-analysis.md
git commit -m "docs(statistics): burden test eligibility rules and remaining limits (#520)"
```

---

## Self-Review

**Spec coverage (phase 1 items):**

| Spec item | Task |
| --- | --- |
| 1. Autosomes 1-22; one genome build, else rejected | 4 (SQLite), 5 (PostgreSQL) |
| 2. Select, then collect | 4, 5 |
| 3. Missing dosage: unknown class or disagreeing duplicates; shipped classes stay; association test only; no quality rescue | 2 (rule), 4 (quality 99 / 2 example, `1/.` and `0/.` in the fixture), 8 (decision record) |
| 4. Complete-site rule for burden and Fisher | 2 |
| 5. Weight on `min(p, 1 - p)`; no called alleles excluded | 1, 3 |
| 6. Complete-covariate samples chosen before frequencies | 3 |
| 7. Sites used and excluded per reason; non-autosomal count in the run result; sentence in view and export | 2 (gene fields), 4 and 5 (run field), 7 (view, export) |
| 8. Remove `acmg_classifications`, `max_internal_af` | 4, 5 (builders), 6 (type, schema) |
| Both builders identical | 5 (parity test) |
| Docs "Known limits" | 8 |

**Spec tests:**

| Spec test | Where |
| --- | --- |
| Depth column filter does not make a carrier a reference sample | Task 4 (`qual` filter), Task 5 on PostgreSQL |
| Unknown call in either group excludes the site; swapped labels exclude the same sites | Task 2 |
| `1/.` stays dosage 1 and keeps its site; `./.` excludes it | Task 2, Task 4 fixture (`chr1:500`) |
| `0/1` + `1/1` missing; `0/1` + `0\|1` het; quality 99 / 2 does not select the homozygote | Task 2, Task 4 |
| `p = 0.75` weighted at 0.25 | Task 1 |
| chrX, chrY, MT never enter and are counted in the run result; mixed builds rejected | Task 4 (builder, engine), Task 5 (PostgreSQL, web runner) |
| Builders identical | Task 5 |
| Golden references still match | Task 1 Step 4 and Task 8 (`make test`); nothing regenerated |

**Placeholder scan:** every code step holds the code; `<url>` in Task 5 is the developer's own PostgreSQL URL, not plan content.

**Type consistency:** `SiteExclusionReason` / `SiteExclusionCounts` (Task 2) are used by `contingency.ts`, `gene-tests.ts` and mirrored as `SitesExcluded` in the renderer (Task 7), which cannot import from `src/main`. `sites_excluded` is the one field name on `GeneContingencyData`, `GeneAssociationResult`, the fixture projection and the renderer row. `hasCompleteCovariates` (Task 3), `assertSingleGenomeBuild` and `autosomeSql` (Task 4) keep one signature across Tasks 3-5. `AssociationBuildResult` (Task 4) is the return type of both builders, the db-worker task and `buildData`; `non_autosomal_variants` is the one field name from the builders to the renderer prop `nonAutosomalVariants`.

**Review Focus:** each of the five lines has its test in the task named there.

**Where the spec and the code differ:**

- The spec's test names "a column filter on depth". `variants` has no depth column; the only per-sample numeric column is `qual`. The tests filter on `qual`.
- The spec's GQ 99 / GQ 2 example: genotype quality is not stored per call. The fixture uses `qual` 99 and 2 to show that quality does not decide.
- The spec says `gtDosageSql` returns NULL for unknown calls and that NULL is carried. It also returns NULL for a reference half-call (`0/.`), which the spec keeps as dosage 0 with two called alleles. The plan carries the NULL from SQL and resolves it in `contingency.ts` with the shipped `calledAlleleCount` (`rowDosage`), so no SQL or genotype helper changes.
- The spec's unknown-class examples (`./.`, NULL, other text) match the decision record's table except for `0/.`, which that table lists as unknown while its frequency paragraph counts it as two called alleles. The record's table is left as it is (it gives the SQL dosage); Task 8 adds how the burden test reads `0/.`.
- "Not on an autosome" counts every contig outside 1-22, so unplaced and decoy contigs are in `non_autosomal_variants` together with chrX, chrY and MT.
- `no_called_alleles` can only occur when no selected sample has complete covariates: after the complete-site rule every tested sample contributes at least one allele.
- The spec's file list names `src/shared/sql/genotype-dosage.ts` and `src/shared/utils/genotype.ts`. Neither needs a change.
- Changing the builders' return type costs about 30 one-word test edits (`.genes`). The alternative needs a new db-worker task in two files the cohort row identity plan edits.
