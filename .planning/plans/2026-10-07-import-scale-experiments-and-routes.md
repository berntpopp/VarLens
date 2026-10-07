# Import scale: experiments and implementation routes (2026-10-07)

Status: plan, not yet reviewed. Supersedes the "Remaining work" list in
`2026-10-07-web-import-scale-handover.md` and stage 4 of the original plan. It will be
updated once when the two inputs still outstanding arrive (independent Opus review;
source-code check of seqr, VarFish, TileDB-VCF, OpenCGA), and then goes to Codex and Opus
for a second adversarial pass before implementation of anything beyond sections 5 and 6.1.

## 1. Goal and priorities

Owner priorities, in order (restated 2026-10-07):

1. **Import throughput** to 10,000+ exomes (about 60,000 variants each, most shared),
   parallel, UI never blocked, each sample visible in case list and cohort when it lands.
2. **Interactive reads**: per-case filters on *any* column and *any* combination, sorts,
   paging and search; cohort aggregation (carrier/het/hom counts, internal frequency, gene
   burden, tiles) with arbitrary filter combinations and sub-cohorts.
3. **Exact results**, defined by one written rule (section 4).
4. **Storage**: must not explode and must stay operable. A multi-fold reduction is no longer
   a target; bytes may be spent to buy speed.

A change that makes import or any filter slower than today does not ship, even if it is
result-equivalent.

### Numeric targets (pass/fail for every route)

| Metric | Today (100 samples, 4 workers) | Target | Stretch |
|---|---|---|---|
| End-to-end seconds per sample, sustained to 10,000 | about 4 s (11 h) | ≤ 1.0 s (under 3 h) | ≤ 0.5 s |
| Serial work per sample (anything under a global lock) | about 3.5 s | ≤ 0.2 s | constant, about 10 ms |
| Row writing per sample at sample 100 / 1,000 | about 5 s / unknown | ≤ 1.5 s, flat | ≤ 1.0 s |
| Per-case filtered count, any column or combination | 0.6–12 ms | ≤ 2× today | = today |
| Per-case page (default and sorted) | 0.8–235 ms | ≤ 1.5× today | = today |
| Cohort page + count, any filter combination, 10,000 samples | not measured | ≤ 300 ms | ≤ 100 ms |
| Sub-cohort counts for an arbitrary case set | not supported | ≤ 1 s at 10,000 | ≤ 200 ms |
| Case visible after its file finishes | about 1 s | ≤ 2 s, exact | same |
| Storage per 1,000 exomes | about 52 GB | ≤ 60 GB | lower is a bonus |

## 2. What is established, and how firmly

Measured here (simulated cohort, shared machine; ratios are reliable, absolutes are not):

- Publication is serial: about 3.5 s under the lock per sample, 1.5–2.0 s of it the cohort
  summary upsert; 0.4 s with only the primary key; about 610,000 WAL records per publication.
  The summary has eight indexes, several containing the carrier count, so every counter
  change writes a new row version and an entry in every index.
- Counters in a narrow side table: 0.78 s and 308,000 WAL records for that step.
- Merging several prepared cases in one statement: 32% fewer WAL records at four cases, 52%
  at eight (timing not measured).
- No summary index can simply be dropped: all eight serve a real read path.
- Row writing is about 2.3 s per sample and grows to about 5 s by sample 100.
- First normalised model: result-equivalent (0 differences in 130 million compared values),
  but 312 bytes per call (162 of them indexes), row writing 12–45% slower, impact count 180×
  and gnomAD count 16× slower. Rejected.

From code reading (Codex review, not reproduced by running):

- JSON import inserts extension-bearing rows one awaited statement at a time.
- A VCF import spends about 360 command round trips in per-batch setup before publication.
- Correctness gaps listed in section 5.
- The summary path and the live cohort path use different rules (section 4).

From research (other systems; being re-checked in their source):

- Filter access paths are kept case-local; display annotation is deduplicated.
- Counts are not maintained row by row on the import path: signed deltas or partial counts
  are appended and compacted.
- Bulk loads go to a standalone table, indexes are built after the load, then it is attached.

Not known yet, and the experiments below exist to find out:

- Which of the 12 + 4 indexes, stored hash/search columns and foreign keys account for the
  row-writing time, and why it grows with cohort size.
- Whether filters evaluated on a deduplicated variant table and joined to a case's calls by
  integer id stay within 2× of today across selectivities.
- How any of this behaves at 1,000 and 10,000 samples (nothing above 100 has been run).

## 3. Benchmark protocol (experiment 0, prerequisite for all others)

Every number in this plan is produced the same way, or it does not count.

- **Datasets.** (a) the simulated cohort, extended to 1,000 exomes; (b) the GIAB trio with
  VEP and SnpEff; (c) a *realistically annotated* set, because the simulator's INFO and
  annotation diversity are not representative: a few hundred public exomes annotated with the
  production VEP configuration, or, if that is not available, the GIAB samples replicated
  with perturbed genotypes. (d) A 10,000-sample **read-scale schema** built without importing
  10,000 files: import 1,000, then synthesise calls for 9,000 further cases set-based from
  the observed allele-frequency spectrum. Used for read experiments only, never for write
  timings.
- **Machine state.** One benchmark at a time; start only with at least 20 GB available and
  load below 8; record load and available memory with every run. Compare alternating pairs
  (A, B, A, B), at least three pairs at 20 samples, one pair at 100, one run at 1,000 for
  finalists.
- **Write metrics.** Seconds per sample by phase from `VARLENS_PG_IMPORT_PROFILE=1`, at
  samples 1–5, 16–20, 81–100 and (finalists) 901–1,000; WAL bytes and records
  (`pg_stat_wal`), heap-only update ratio, relation and index sizes, checkpoints requested,
  time under any global lock.
- **Read metrics.** A fixed predicate matrix, each as count, first page with default sort and
  page sorted by another column, warm and cold, median and 95th percentile of ten runs:
  impact = HIGH; gnomAD ≤ 0.01; CADD ≥ 20; ClinVar pathogenic; gene in a 50-gene panel; a
  three-way AND; an unselective predicate keeping about 60% of rows; full-text search; an
  extension (INFO-derived) column; tags/stars/ACMG. Per case, and over the cohort.
- **Equivalence.** The diff harness against the oracle of section 4 after every candidate;
  parallel import equals sequential; maintained equals rebuilt.
- **Artefacts.** One markdown table per experiment under
  `.planning/artifacts/perf/import-scale/`, with the commands used.

Deliverable: `scripts/perf/import-scale-bench.mjs` and the read-matrix runner, both committed
before experiment 1 starts. Estimated effort: one day. The existing
`bench-web-batch-import.mjs` and the diff harness are the starting points.

## 4. The oracle: one rule for "exact" (decision needed before any new model)

Today two code paths answer cohort questions differently: the summary uses independent
NULL-safe maxima per annotation column on a six-part key (coordinates, variant type, build);
the live path (used for extension filters and for export) uses the minimum gnomAD value,
groups by coordinates only and filters occurrences before aggregating. For a coordinate
annotated with frequency 0.001 in one case and 0.1 in another they can disagree on value and
on filter membership.

Experiment 0b (half a day, reading plus a targeted test): enumerate every place the two paths
can differ, with a failing example each. Then the owner picks the rule. Recommendation to
confirm: the summary rule everywhere, and export through the same rule. Everything after this
is verified against that single rule.

## 5. Correctness track (starts now, independent of the performance route)

These are defects or hazards in code that is on `main` or in PR #468. Each gets a failing
test first, and each is its own small PR.

| # | Problem | Fix direction |
|---|---|---|
| C1 | A worker checks the coordinator's lease only at start; after a coordinator loss it can publish while a new owner's recovery deletes its case without subtracting its contributions | Database-enforced barrier held by workers (shared advisory lock the recovery must take exclusively) plus generation check in the publication statement |
| C2 | Annotation writes (star, comment, ACMG) bypass the summary write lock; a rebuild can miss a concurrent annotation and still mark the summary fresh | Serialise annotation-to-summary projection with the summary lock, or version the projection |
| C3 | Import merges flags with `current OR new` from a snapshot taken before the lock; it can restore a star that was just removed | Evaluate flags under the lock from current rows |
| C4 | A failed summary update marks the summary stale and still publishes the case; the cohort is then not exact for a visible case | Keep the case provisional and retry publication without re-importing, or publish a durable delta (route decision, section 7) |
| C5 | Cohort totals, count and page are separate statements; a publication between them mixes old and new. Carrier-count cursors survive a refresh | One statement or a short repeatable-read transaction; a publication revision bound into counts, pages and cursors |
| C6 | SQLite drops full-text triggers and some read indexes for the import session while publishing cases during it: a visible case can be missing from search until the batch ends | Keep search current per file, or keep the case provisional until it is; measure the cost first |
| C7 | SQLite read workers keep their own metadata caches; invalidating the main-process cache does not reach them | Invalidate by summary revision |
| C8 | Synchronous rebuild path for small cohorts has no backoff (left open by the #468 review fixes) | Same backoff as the background path |
| C9 | Selected samples of one multi-sample VCF only refresh the UI after the whole loop | Per-sample completion event |
| C10 | Internal allele frequency denominator: verify what counts as a case with a call at a site (no-call versus homozygous reference, capture kit). gnomAD had to recompute its denominator in v4.1 | Document the definition; test; change only with the owner's agreement |

## 6. Experiments

Each experiment states the hypothesis, what is changed, the pass and kill criteria, and the
effort. "Scratch" means a throwaway schema and an unmerged branch; nothing ships from an
experiment.

### 6.1 Route A experiments: keep per-sample rows, remove the cost (start now)

| # | Hypothesis | Method | Pass | Kill | Effort |
|---|---|---|---|---|---|
| A1 | A few of the 12 + 4 indexes, the stored hash and search columns and the foreign keys account for most of the row-writing time and for its growth | 20- and 100-sample imports dropping one element at a time, then the cheapest combination that keeps every read in the matrix within target; perf attribution with `pg_stat_io`, WAL bytes per index | Row writing ≤ 1.5 s at sample 100 with the read matrix within target | No combination under 3 s without breaking a read | 1.5 days |
| A2 | Full-text and trigram search on a deduplicated variant table is as fast for the user and removes two GIN indexes from the per-sample rows | Build the deduplicated search table (integer id, search document) and run the search rows of the matrix as a semi-join | Search count and page ≤ 2× today; measurable row-writing gain in A1's terms | Search slower than 2× at 100 samples | 1 day |
| A3 | Counters split from the annotation and filter indexes cut the summary step by more than half without slowing any cohort read | Narrow `cohort_locus_stats` (six-part key, three counters, the carrier keyset index); annotation columns and their indexes stay on the wide table and are written only when the representative value changes; cohort reads join by key | Summary step ≤ 0.8 s; every cohort row of the matrix ≤ 1.5× today | Any default cohort sort or filter slower than 2× | 1.5 days |
| A4 | Publishing K prepared cases in one merge transaction cuts serial time per sample roughly in proportion to shared variants | Group publication with a short maximum wait (K = 2, 4, 8), each case still becoming visible in its own event; failure isolation per case | Serial seconds per sample ≤ 50% of single-case at K = 4 | Per-case visibility delay above 2 s, or failure isolation not achievable | 2 days |
| A5 | Append-only signed count deltas make publication constant-time; exact reads are base plus unmerged deltas | Imports write `(batch, key, het, hom)` delta rows and a manifest; a background job folds them in key order; cohort reads add unmerged deltas; deletes are negative deltas; backlog is bounded and import throttles when it is not | Serial work per sample ≤ 0.2 s; cohort matrix ≤ 1.5× today with a backlog of 50 cases; exact after any interleaving | Reads with a realistic backlog slower than 2×, or the representative-annotation rule cannot be kept exact under deletes | 3 days |
| A6 | Per-batch setup and JSON row-at-a-time inserts are avoidable | One session setup; larger byte-bounded COPY batches; JSON through the VCF bulk writer; binary COPY measured last | JSON import within 1.3× of VCF for the same rows; VCF round trips per sample down by a factor of ten | No measurable gain for VCF (JSON part ships regardless) | 1.5 days |
| A7 | Loading each batch of cases into a standalone table, building its indexes after the load and attaching it as a range partition removes index maintenance from the load and keeps old data physically stable | Range partitions of a few hundred cases; compare with A1's best | Row writing ≤ 1.0 s flat to 1,000 samples | Attach locking or planning time across many partitions breaks interactive reads | 3 days |

A3, A4 and A5 are alternatives for the same bottleneck and are compared on the same runs.
A3 + A4 is the low-risk combination; A5 is the one that removes the serial step entirely.

### 6.2 Route B experiments: narrow integer fact, filters on a deduplicated variant table

Purpose: find out whether extensible filters can be fast *without* per-sample annotation
rows. Only worth building if Route A cannot reach the targets, or if B is faster on reads.

| # | Hypothesis | Method | Pass | Kill | Effort |
|---|---|---|---|---|---|
| B1 | With integer variant ids and a fact clustered by `(case_id, variant_id)`, a predicate evaluated on the variant table and joined to one case's 60,000 calls stays within 2× of today for selective *and* unselective predicates | Fact `(case_id, variant_id, per-call fields)`; every annotation and filter column once on the variant table with today's index set; force merge, hash and nested-loop plans to find the best; also the case's id set as a sorted integer array | Whole per-case matrix ≤ 2× today, warm and cold | Any common predicate above 3× with the best plan | 2 days |
| B2 | A small generic prefilter on the fact (impact rank and a rarity bin, two or three bytes) closes the gap for the selective cases without making filters non-extensible | B1 plus the prefilter, used only as a first cut | Selective counts ≤ 1.5× today | No gain over B1 | 1 day |
| B3 | Integer dictionary resolution (natural-key upsert returning ids, no hashing) writes a mostly-known exome in under a second | Staged writer v2: resolve only missing variant rows, then one COPY of narrow calls | Row writing ≤ 1.0 s at samples 81–100, flat to 1,000; parallel equals sequential; no deadlocks | Slower than A1's best | 3 days |
| B4 | Sub-cohort and on-demand aggregation from the narrow fact is interactive | Counts for arbitrary case sets of 10, 100, 1,000 from the fact; compare with per-variant carrier bitmaps if `pg_roaringbitmap` is available for PostgreSQL 18 | Sub-cohort counts ≤ 1 s at the 10,000-sample read-scale schema | Above 5 s | 2 days |

### 6.3 Route C experiments: columnar or chunked storage (only if A and B both miss)

| # | Question | Method | Effort |
|---|---|---|---|
| C-1 | Does an immutable compressed per-case chunk with local filter vectors and bitmaps beat rows on both writes and reads? | Prototype one chunk format in PostgreSQL `BYTEA` with a vectorised reader in the server process | 1 week |
| C-2 | Would DuckDB over Parquet (also usable on the desktop) or ClickHouse (server only) as the analytic store be simpler and faster? | Load the 1,000-sample set; run the read matrix; write down what exact delete, per-case publication, encryption and backup would need | 1 week |

These are deliberately last: they add an engine or a custom format, and nothing measured so
far says rows cannot meet the targets.

### 6.4 SQLite experiments (after the PostgreSQL route is chosen)

| # | Question | Method |
|---|---|---|
| S1 | Does the chosen counter design (A3/A5) remove the +21% batch cost of per-file upkeep? | Same benchmark as `sqlite-batch-import.perf.test.ts`, 20 and 100 files |
| S2 | Can search stay current per file at acceptable cost (C6)? | FTS5 external-content table updated per file versus per batch |
| S3 | `WITHOUT ROWID` and index order for the fact, deferred index creation | One change at a time, same harness |

## 7. Implementation routes and decision gates

```
            now ─────────────────────────────────────────────────────────────►
 Track 0    benchmark protocol + oracle (E0, E0b)
 Track C    correctness PRs C1…C10 (independent, small, each reviewed)
 Track A    A1 A2 A6 ──► A3 | A4 | A5 ──► A7 ──► Gate 1
 Track B                 B1 B2 (read-only prototypes, in parallel with A3–A5) ──► Gate 1
 Track C/S                                                    only after Gate 1
```

**Gate 1 (after A1–A6 and B1–B2; about one working week).** Decide the route with the
measured table in hand:

- **Route A ships** if the best A combination meets the write targets at 1,000 samples and
  the read matrix at the 10,000-sample read-scale schema. Per-sample rows stay, so every
  column remains filterable exactly as today. Expected shape: A1 + A2 + A6 for row writing,
  A3 with A4 or A5 for publication, A7 if row writing still grows.
- **Route B is added** if A meets the write targets but cohort or sub-cohort reads miss, or
  if B1 shows dimension-side filtering is as fast as per-sample rows. Then B replaces the
  per-sample annotation, behind the existing storage interfaces, proven by the diff harness.
- **Route C is opened** only if both miss.

**Gate 2 (before any switch-over or migration that existing workspaces must run).** The
candidate has, on one build: targets met at 1,000 samples written and 10,000 read; the diff
harness at 0 differences against the oracle; concurrency and crash schedules from the
correctness track passing; an adversarial review by Codex and by an independent reviewer with
no blocker; a tested conversion and rollback path.

Shipping units, each a PR that leaves the product correct on its own:

1. Benchmark protocol and artefacts (no product change).
2. Correctness PRs C1–C10.
3. JSON bulk path and batch-setup amortisation (A6).
4. Index and search changes proven by A1/A2 (migration; reversible).
5. Counter split (A3) with its migration.
6. Grouped publication (A4) or delta publication (A5), behind `VARLENS_IMPORT_PUBLICATION`
   with the current path as the rollback switch for one release.
7. Partitioned bulk load (A7), if needed.
8. SQLite counterparts (S1–S3).
9. Route B, only after Gate 1 says so.

## 8. What is explicitly not being done

- No switch-over to the first normalised model. Its branch stays as the source of the diff
  harness, the conversion tooling and the measurements.
- No dropping of summary indexes without a read-matrix result.
- No approximate counts, no stale-but-labelled results as an end state.
- No new database engine before Gate 1.
- No release-affecting change without the full preflight and a hosted green build.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Simulated data hides real annotation diversity and INFO sizes | Dataset (c) in section 3; finalists re-measured on it |
| Shared machine distorts timings | Protocol in section 3; alternating pairs; nothing concluded from a single run |
| Delta publication (A5) makes reads depend on a backlog | Bounded backlog, import throttling, backlog size in the benchmark |
| Grouped publication (A4) couples cases | Per-case savepoints; a failing case leaves its group and retries alone |
| Partition count and attach locks (A7) | Batches of hundreds of cases, not one partition per case; lock analysis in the experiment |
| A migration of existing workspaces at 10,000-sample scale | Every schema change is additive first, with a background conversion and a rollback switch |
| Memory pressure on the development host (two out-of-memory session kills on 2026-10-07) | One heavy job at a time, capped; read-only work in parallel only |

## 10. Open inputs that will change this plan

- Independent Opus review (running).
- Source-code verification of how seqr, VarFish, TileDB-VCF and OpenCGA implement filters and
  cohort counts (running).
- The measurement agent's first results for A1, A3, A4/A5 and B1 on the 100-sample data
  (running).
- The owner's decision on the oracle (section 4) and on the frequency denominator (C10).
