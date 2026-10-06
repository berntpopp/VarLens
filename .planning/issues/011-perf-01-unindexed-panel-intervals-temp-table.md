---
id: "PERF-01"
number: 11
title: "Unindexed temporary table in panel interval filter causes O(N*M) table scans"
priority: "P2 - High"
tags: ["performance", "database", "sqlite", "filtering"]
affected_files:
  - "src/main/database/VariantFilterBuilder.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [PERF-01] Unindexed temporary table in panel interval filter causes O(N*M) table scans

| Attribute | Value |
|---|---|
| **Priority** | **P2 - High** |
| **Tags** | `performance` `database` `sqlite` `filtering` |
| **Affected Files** | `src/main/database/VariantFilterBuilder.ts` |
| **Audited Snippet** | `In setupPanelIntervalsTable, _panel_intervals (chr, start_pos, end_pos) is created without an index....` |

---

## Technical Context & Audited Impact
Severe query latency on large custom BED panels (exome/target gene panels).

---

## Claude Opus 5.5 Architectural Review & Issue Specification

# PERF-01 review: unindexed `_panel_intervals` temp table

## 1. Technical assessment

**The finding is valid, but the stated complexity needs correcting.** I checked it against `src/main/database/VariantFilterBuilder.ts`:

- `setupPanelIntervalsTable` (`VariantFilterBuilder.ts:746-762`) runs `CREATE TEMP TABLE _panel_intervals (chr TEXT, start_pos INTEGER, end_pos INTEGER)`. It has no primary key, no index and no `ANALYZE`.
- The predicate (`VariantFilterBuilder.ts:384`) is a correlated subquery: `EXISTS (SELECT 1 FROM _panel_intervals pi WHERE variants.chr = pi.chr AND variants.pos BETWEEN pi.start_pos AND pi.end_pos)`. It is evaluated once for every candidate variant row, after the other filters.
- The temp table is only used when there are 50 or more intervals (`VariantFilterBuilder.ts:371`, `:776`). Small panels use an OR chain, so they aren't affected.

**Correction to "O(N·M) full table scans":** by default SQLite can build an automatic covering index for a correlated subquery, keyed on the equality term `chr = ?`. The cost is then roughly O(N · M/n_chr) rather than O(N · M), where N is candidate variants, M is intervals and n_chr is the number of chromosomes. That is still linear in M for every variant, so a 20k–200k-interval exome or BED panel scans thousands of rows per variant. Adding only an index on `(chr, start_pos)` is **not enough**: `start_pos <= pos` is an open range, so on average half the chromosome's intervals are still scanned per probe.

I couldn't run an `EXPLAIN QUERY PLAN` benchmark in this session (the command needed approval). The automatic-index behaviour above is from SQLite's planner semantics and still needs to be measured.

**Root cause:** the predicate tests whether a point lies inside a set of intervals, but it's written as a linear scan. The intervals are never sorted, merged or indexed, so no logarithmic lookup is possible.

**Related problems found in the same code path** (recommend tracking them separately):

| # | Location | Problem |
|---|---|---|
| A | `VariantRepository.ts:431` (`compileExportQuery`, `forceOrChain: true`) | Export always uses the OR chain with 3 bound parameters per interval. Above about 10,900 intervals this exceeds SQLite's limit of 32,766 bound parameters, so **export fails outright** on large BED panels. `cohort.ts:110-120` has the same pattern, and the Postgres builders hit their 65,535-parameter limit at about 21,800 intervals. |
| B | `VariantFilterBuilder.ts:377/384` vs `cohort.ts:118` | **Parity bug.** The case view tests whether the variant's start position is inside the interval (`pos BETWEEN`). The cohort view tests overlap (`pos <= end AND COALESCE(end_pos,pos) >= start`). An SV or CNV that spans a panel region but starts outside it shows up in the cohort view and is silently dropped from the case view. |
| C | `VariantFilterBuilder.ts:768` | The table is dropped after every query (count, page and metadata each set it up again), so any index is rebuilt each time. That's cheap if sorting happens once at setup, but it's worth noting. |

## 2. Severity and priority

**P2 (High)** for PERF-01 itself. It is latency only, with no wrong results, and it only affects panels with 50+ intervals. But large custom BED panels are a core clinical workflow, and the cost grows with N·M on every page, count and sort.

Item **A should be P1** in its own issue, because the operation fails outright rather than just slowing down.

## 3. Labels

`performance`, `database`, `sqlite`, `parity` (for B), `bug` (for A and B)

## 4. Issue specification

### Title
`perf(db): panel interval filter does a linear interval scan per variant; replace with an O(log M) lookup on merged intervals`

### Description and reproduction
1. Import a WGS or exome case (≥300k variants) and apply a custom BED panel with ≥10k intervals, for example an exome capture BED.
2. Open the case variant table and page through or sort it.
3. Run `EXPLAIN QUERY PLAN` on the generated query. The correlated subquery shows `SCAN pi` or `AUTOMATIC COVERING INDEX (chr=?)`, with the range check done row by row.
4. Expected observation: page and count latency grows linearly with interval count. To demonstrate A, export the same case: it fails with `too many SQL variables`.

### Expected behaviour
- Interval filtering costs O(N log M), or O(M log N + k) when driven from the intervals (k = number of matching variants), on every query path: page, count, column metadata and export.
- No parameter-count ceiling on how many intervals a panel can have.
- Case view and cohort view agree on overlap semantics for SVs and CNVs.

### Proposed fix
1. **Normalise at setup.** Sort the intervals by `(chr, start)` and merge overlapping or adjacent ones in TypeScript before inserting them. Exome BEDs shrink considerably after merging. Store them in `CREATE TEMP TABLE _panel_intervals (chr TEXT, start_pos INTEGER, end_pos INTEGER, PRIMARY KEY (chr, start_pos)) WITHOUT ROWID`.
2. **Use a predecessor lookup instead of a scan.** After merging the intervals don't overlap, so at most one can contain a given position: the one with the largest `start_pos <= pos`.
   ```sql
   (SELECT pi.end_pos FROM _panel_intervals pi
     WHERE pi.chr = variants.chr AND pi.start_pos <= variants.pos
     ORDER BY pi.start_pos DESC LIMIT 1) >= variants.pos
   ```
   That is a single B-tree seek per variant, O(log M). For overlap semantics (item B), also require `pi.start_pos <= COALESCE(variants.end_pos, variants.pos)`. Merged, non-overlapping intervals plus one extra seek with `start_pos BETWEEN pos AND end_pos` keep this logarithmic.
   *Alternative when the intervals are selective:* drive the query from the intervals using `idx_variants_case_coords (case_id, chr, pos, …)`, i.e. `id IN (SELECT v.id FROM _panel_intervals pi JOIN variants v ON v.case_id = ? AND v.chr = pi.chr AND v.pos BETWEEN pi.start_pos AND pi.end_pos)`. Choose between the two approaches with the benchmark below.
3. **Export path (item A).** Stop forcing the OR chain. Either pass the merged intervals to the worker and create the same temp table on the worker's connection, or pass them as one JSON parameter and read it with `json_each(?)` inside a `MATERIALIZED` CTE. Apply the same fix to `cohort.ts` and the Postgres builders (Postgres: `unnest($1::text[], $2::int[], $3::int[])` or an `int8range`/GiST join). This also satisfies the cohort-parity rule.
4. **Tests at the behaviour boundary:**
   - Results are identical between the OR-chain path and the temp-table path, including overlapping input intervals and a spanning SV.
   - A 20k-interval export succeeds.
   - A gated perf test (in the style of `VARLENS_RUN_*_PERF`) records page latency before and after for 1k, 20k and 200k intervals against ≥300k variants.

**Decision:** merge the intervals and use the predecessor-seek predicate (steps 1–2) as the default. It's a small change local to `VariantFilterBuilder` and works the same however selective the panel is. Fix the export and parity problems (items A and B) in a separate PR that also covers the cohort view and Postgres.
