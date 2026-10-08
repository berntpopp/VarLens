# Maximum Carrier Cases Filter Spec

Date: 2026-10-08

Status: proposed

Issue: #455 (follow-up to #123)

Checked against `main` at `bcbc86cf` (v0.81.0). Depends on the cohort row identity spec
(`2026-10-08-cohort-row-identity-carriers.md`), which lands first.

## Summary

Add a filter "seen in at most K cases" on the absolute number of cases in the database that
carry a variant. It removes recurrent artefacts and locally common variants at any database
size, where the internal frequency filter fails below about 100 cases (one case in 67 is already
1.5%). It ships in the case view and the cohort view, on SQLite and PostgreSQL, in one PR.

## Decisions (2026-10-08)

1. **Existing built-in presets are not changed.** A silent cap could hide a variant shared by an
   affected family or a recurrent ClinVar pathogenic variant. One new built-in preset is added.
2. **Suggested K is 3 cases in total** (the current case and two others). It is a convenience
   value; no published standard exists and other tools leave it to the lab.
3. **One number, one meaning.** K counts all cases including the current one, so a saved preset
   means the same in the case view and the cohort view. The case view labels it "including this
   case".
4. **No switch to frequency at a larger database size.** It would change the question each time a
   case is imported.
5. **No family deduplication.** `analysis_groups` holds families and tumor-normal pairs, allows
   several memberships and has a nullable `individual_id`; it does not partition cases into
   independent families. The filter says "cases", never "unrelated carriers".

## Evidence

- A cohort-only minimum already exists: `minCarriers` / `carrier_count_min`
  (`src/shared/types/filters.ts:48,92`, `variant-where-builder.ts:115-121`,
  `postgres-cohort-summary-query.ts:518-519`). The maximum mirrors it.
- The count is stored on both backends: `variant_frequency.case_count` (case view, already
  joined as `vf`) and `cohort_variant_summary.carrier_count` (cohort view, indexed).
- `maxInternalAf` / `max_internal_af` shows every place a scalar internal filter must reach; the
  preset merger lists scalar fields by hand (`useFilterPresetStore.ts:93`).
- The PostgreSQL cohort NULL branch the issue asks about is already present
  (`postgres-cohort-summary-query.ts:509-516`).
- The count is one per case with a stored row, including rows with an unknown call
  (`src/shared/sql/cohort-summary-rebuild.ts:51`).

## Design

- **Field:** `maxCarriers` in `FilterState`, `carrier_count_max` in backend filters. Integer,
  minimum 1; `null` or absent means off.
- **Predicate:** keep the row when the count is `NULL` or `<= K`. This matches `max_internal_af`:
  a variant without a frequency row is kept.
- **Case view:** `vf.case_count`, the join the internal-frequency filter already uses, so the two
  internal filters agree. Files: `variant-filter/core-filters.ts`,
  `PostgresVariantReadRepository.ts`.
- **Cohort view:** `carrier_count`, next to the existing minimum. Files:
  `variant-where-builder.ts`, `cohort.ts`, `postgres-cohort-summary-query.ts`.
- **Association:** the `cohort-burden` scope drops summary-only filters. The new field is not
  added to the association configuration.
- **Other consumers of the filter object:** `shortlist-query.ts`, `cohort-export.ts`, shared
  types and zod schemas (`filters.ts`, `database.ts`, `cohort.ts`, `ipc-schemas.ts`,
  `api/schemas/variants.ts`, `filterDefaults.ts`).
- **Renderer:** one numeric field "Seen in at most N cases" in `FilterDrawer.vue` and
  `CohortFilterDrawer.vue`, a filter chip, and the field added to defaults, clearing,
  serialization, preset application, the preset merger, the emit scheduler and the mock API.
- **Preset:** one new built-in, `Rare, not recurrent` =
  `{ maxGnomadAf: 0.01, maxCarriers: 3 }`, after the existing eight. Seeded by SQLite migration
  v45 and PostgreSQL migration 0028 (insert if absent). Existing rows are untouched.

## Known limit

`variant_frequency` is keyed on `(chr, pos, ref, alt)`, without build or type. In a database
that mixes GRCh37 and GRCh38 cases, the case-view count can include a different variant at the
same coordinate and hide a row it should keep. The internal-frequency filter has the same limit
today. Fixing the key fixes both filters and is separate work; the cohort view is not affected.

The two views read different tables: the case view reads `variant_frequency`, updated when a
case is published; the cohort view reads the summary, which can be stale until its rebuild
finishes. While it is stale the two views can differ for the same K.

## Out of scope

- Zygosity-specific caps (het / hom). A general cap must not change recessive analyses.
- Family-level or individual-level recurrence. It needs authoritative identity rules first.
- Extending the existing minimum to the case view.

## Tests

- K = 1, K = 3 and off; the current case counts exactly once.
- Several transcript rows of one case count once; a second imported case counts.
- A variant without a frequency row is kept.
- In a single-build database with a fresh cohort summary, case view and cohort view return the
  same variants for the same K, on both backends, including page counts and the cohort export.
- A saved preset with `maxCarriers` round-trips; user presets and the eight existing built-ins
  are unchanged by the migrations.
- K below 1 or non-integer is rejected by the schema.

Gate: `make rebuild-node && make test`, `VARLENS_WEB=1 make test`, `make agent-check`.
