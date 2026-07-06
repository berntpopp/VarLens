---
name: varlens-cohort-parity
description: Use when changing filtering, sorting, searching, column definitions, column metadata, or filter-related UI on the VarLens single-case variant view — or the cohort view — before deciding scope, writing the plan/spec, or opening the PR. Symptoms of about to violate: editing useFilterState.ts / FilterToolbar.vue / VariantTable.vue / variant-table/columns.ts and thinking "I'll add the cohort side later", "cohort is out of scope for this PR", or "the cohort view can catch up separately".
metadata:
  version: "1.0.1"
  updated: "2026-07-06"
---

# VarLens cohort-view parity (non-negotiable)

## The rule

Any change to **filter, sort, search, column metadata, or filter-related UI** on the
single-case variant view MUST ship the equivalent change to the multi-case cohort view
**in the same spec and the same PR**. And vice-versa. This is a standing project gate,
cited by name in multiple specs (`feedback_cohort_parity.md`,
`.planning/specs/2026-05-28-sprint-a-foundations.md`, `2026-05-29-sprint-b-storage-shape.md`).

**Violating the letter of this rule is violating the spirit of it.** Shipping the case
view now and the cohort view "next PR" is the exact failure this rule exists to prevent —
the two surfaces drift, and users get inconsistent behavior between viewing one case and viewing a cohort.

The two surfaces are structural twins:

| Case view | Cohort view |
|---|---|
| `views/CaseView.vue` | `views/CohortView.vue` → `components/CohortView.vue` (+ `CohortTable.vue`) |
| `components/FilterToolbar.vue` | `components/cohort/CohortFilterBar.vue` |
| `components/VariantTable.vue` | `components/cohort/CohortDataTable.vue` |
| `composables/useFilterState.ts` | `composables/useFilters.ts` |
| `components/FilterDrawer.vue` | `components/cohort/CohortFilterDrawer.vue` |
| `components/variant-table/columns.ts` | `components/cohort/useCohortColumns.ts` |

## Touch X ⇒ also touch Y, put the logic in Z

Don't duplicate — put shared logic in the shared module and wire both adapters to it.

| If you touch (case) | Also touch (cohort) | Logic belongs in |
|---|---|---|
| `useFilterState.ts` (add/change a filter field) | `useFilters.ts` | `composables/useFilterCore.ts` (+ `shared/types/filters.ts`, `shared/filters/filterDefaults.ts`) |
| `FilterToolbar.vue` (control/chip) | `cohort/CohortFilterBar.vue` | `SlimFilterToolbar.vue`, `PresetBar.vue`, `filters/FilterTypeNarrowingChip.vue`, `utils/filters/` |
| `FilterDrawer.vue` + `filterDrawerTypes.ts` (new panel) | `cohort/CohortFilterDrawer.vue` + `cohort/cohortFilterDrawerTypes.ts` | shared `components/filters/*` + `ExtensionColumnFilters.vue` |
| `variant-table/columns.ts` (+ `sv/cnv/str-columns.ts`) | `cohort/useCohortColumns.ts` | no shared list today — **edit both** (a real drift risk; consolidating is a good follow-up) |
| `VariantTable.vue` (per-column filter/header/sort/cell) | `cohort/CohortDataTable.vue` | `VariantColumnHeader.vue`, `useColumnFilters.ts`, `useColumnFilterMeta.ts`, `table-cells/` |
| column-meta fetch (`variant-table/useVariantData.ts`) | `CohortTable.vue` `fetchColumnMeta` path | `useVariantColumnMeta.ts` (keys `case:<id>` vs `cases:<ids>`) |
| DSL search behavior | `CohortFilterBar.vue` DSL block | `useDslFilterIntegration.ts` / `useDslSearch.ts` |
| backend `VariantFilterBuilder.ts` (new sortable col / WHERE / meta) | cohort query path `database/cohort.ts` + `storage/postgres/PostgresCohortRepository.ts` | `VariantFilterBuilder.ts` |

**The seam that drifts:** the top-level filter composable is *not* shared — there are two
thin adapters (`useFilterState.ts`, `useFilters.ts`) over one shared core
(`useFilterCore.ts`). Add a shared filter field to `useFilterCore.ts`, then wire it into
**both** adapters. If you find yourself writing the same logic twice, stop and hoist it
into the shared module instead.

> Note: an old note calls `AssociationDataBuilder.ts` "the cohort table" — that is stale.
> `AssociationDataBuilder` now backs only gene-burden association. The live cohort variant
> path is `database/cohort.ts` + `PostgresCohortRepository`. Verify against current code.

## Verify both paths

- **Test both sides.** A case-view test needs a cohort-view counterpart. There is a
  backend trip-wire — `tests/main/storage/cohort-backend-parity.test.ts` (asserts
  SQLite/Postgres cohort parity; gated by `VARLENS_RUN_POSTGRES_E2E=1`). If your change
  reaches the DB filter/sort/meta path, extend it.
- **No renderer test asserts case↔cohort UI parity today.** When you add a filter field or
  column, add a test that asserts it exists in *both* `useFilterState` and `useFilters`
  (or in both `columns.ts` and `useCohortColumns.ts`). That test is the durable guard.

## Rationalizations — all of these mean STOP

| Excuse | Reality |
|---|---|
| "Cohort is out of scope for this PR." | Parity IS the scope. The rule names "same PR" explicitly. |
| "I'll add cohort parity in a follow-up." | Deferring is the exact drift this rule prevents. Not allowed. |
| "The cohort view rarely uses this filter." | Rarely ≠ never. Inconsistent behavior between surfaces is the bug. |
| "It's a tiny change, cohort can catch up." | Small divergences compound. Hoist to the shared module; it's usually smaller than you think. |
| "The two views are too different to share code." | They share `useFilterCore`, `VariantColumnHeader`, `useColumnFilters`, `table-cells`. Find the seam. |
| "I'm just relabeling one column." | Column lists are duplicated across `columns.ts` and `useCohortColumns.ts`. Relabel both. |

## Red flags — you are about to violate the rule

- Editing `useFilterState.ts` / `FilterToolbar.vue` / `VariantTable.vue` / `columns.ts`
  without an open plan for the cohort twin.
- A PR/spec that names the case view but not the cohort view.
- Copy-pasting filter logic instead of adding it to `useFilterCore.ts` / a shared util.
- A new test for the case side with no cohort-side assertion.

All of these mean: widen the change to cohort now, or hoist the logic to the shared module — before you continue.
