# Import scale: experiments and implementation routes (2026-10-07)

Status: revision 3. Section 0 records what the second adversarial pass (Codex and a fresh
Opus reviewer) changed and takes precedence over sections 6–7. Phase 1 may start in the
order of section 0.4; Phase 2 is not approved until the additions of section 0.3 exist in
writing and have been reviewed. Supersedes the "Remaining work" list in
`2026-10-07-web-import-scale-handover.md` and stage 4 of the original plan.

## 0. Revision 3: what the second adversarial pass changed

Both second-pass reviewers (Codex `gpt-6-astra` xhigh; a fresh Opus reviewer, xhigh) returned
the same decision: **Phase 1 may start, narrowed and reordered; Phase 2 is not approved as
written.** Where this section and sections 6–7 differ, this section wins; sections 6–7 are
kept as the record of revision 2.

### 0.1 Claims withdrawn

- "10,000 exomes in roughly 1–1.5 hours" is unsupported. It hinges on one counter
  measurement (0.78 s per 60,000 rows at 100 samples) staying flat on a table of 6–60 million
  rows and on fold cost per case falling quickly with queue length.
- Group publication cannot meet "≤ 50% at K = 4 and ≤ 25% at K = 16". The simulator's
  allele-frequency spectrum (234,783 shared sites at AF 0.01–0.45 plus 6,000 private sites
  per sample) reproduces the two measured WAL reductions exactly and predicts 68% and 32%.
  Per-case counter cost by group size: 0.78 s (1), 0.53 s (4), 0.37 s (8), 0.25 s (16),
  0.17 s (32), before gene aggregates, reference counts and flags. Reaching the throughput
  target needs groups of at least seven and a fold transaction of about 2.7 s, which misses
  the 2 s visibility target.
- "5–10 million distinct sites at 10,000 samples" contradicts the simulator (6,000 private
  sites per sample gives 60 million). The real figure depends on the cohort's spectrum and
  must be measured on real data.
- "Cohort page and count ≤ 300 ms for any combination" is unattainable for exact counts: 89 ms
  per 847,000 unindexed rows extrapolates to 0.6–1.0 s at 6–10 million. New target: page
  ≤ 300 ms; exact count delivered asynchronously within 2 s.
- Trio and compound-het joins do not use the coordinate hash; they are unaffected.
- Correctness item C3 was misdescribed: flags are already evaluated under the lock; the race
  is with annotation writers that do not take it (C2).
- `extra jsonb` filter columns are a new feature, not part of this work. Removed.
- Online conversion (M3) is removed: the owner's decision is a maintenance-step conversion,
  and no workspace above 100 samples exists. Partitioning is not "operability only" (it
  forces `case_id` into the primary key and every child foreign key) and needs its own case.
- Experiment X1 is answered by the first screening run (rows win); not repeated.

### 0.2 A defect found by the review, independent of this plan

The cohort's representative annotation is a bytewise `MAX()` per column. For impact that
orders `HIGH < LOW < MODERATE < MODIFIER`, so one carrier with a `MODIFIER` annotation makes
the cohort row `MODIFIER`, and a cohort filter `impact = HIGH` does not return the variant;
ClinVar strings behave the same way. Filed as #469. The oracle decision of section 4 now
includes it: severity-ranked values, or any-carrier filter semantics. No summary redesign
proceeds before the owner has chosen.

### 0.3 Additions required before Phase 2 can be approved

1. **Publication state machine** (one table: state, transition, who performs it, what is
   durable, what a crash at that point leaves and who repairs it). It must cover: prepared
   data that another session can read (today's per-case aggregates are session-local
   temporary tables, and workers hold case-row locks while they wait); claiming queue rows
   (sequence order is not commit order); a poison case in a group; cancel, delete and
   overwrite of a queued case; transcript switch and annotation edits during a fold; folder
   election, death and restart; an uncertain commit; two workspaces; hiding a deleted case in
   the same transaction that subtracts its counts (as today); dictionary garbage collection.
2. **Read and index contract**: every existing filter, sort direction, deep page, search,
   export, column-metadata and cross-case path, with the structure that serves it in the
   target design and its measured cost. Known gaps to close: carriers-of-a-variant (today an
   index scan on the coordinate index, 499,993 scans in the dev schema; the per-case arrays
   cannot serve it), the representative and flag recomputes that use the same index, gene
   substring search (loses its trigram index), internal-frequency filter and sort (60,000
   count lookups per case), search with a large id set (a selective term was 7× slower without
   a `(case_id, variant_id)` index), cohort annotation filters that run against the carrier
   order once counters are split.
3. **Derived-structure inventory**: flags (per-site reference counts in the fold; "changes
   only when a site gains or loses a distinct annotation" is wrong, a deleted case's star must
   clear), carriers, gene aggregates with distinct carriers, `variant_frequency` (four-part
   key, all-build denominator), unique-variant tile (four-part key), column metadata (2.8 s at
   100 samples today and recomputed per fold).
4. **Id resolution protocol**: the payload column list (per-call INFO and per-case transcript
   fields such as `hpo_sim_score` and `moi` must not be in it), a 128-bit lookup key, a
   separate autocommit resolve with an anti-join insert (a blind `ON CONFLICT DO NOTHING`
   burns 60,000 sequence values per file), retry for rows another importer has not committed
   yet, and a budget. The only measured implementation costs 1.5–2.3 s per sample, more than
   the whole row-writing target.
5. **Operating budget**: WAL bytes per sample and per hour against `max_wal_size`, vacuum and
   dead-tuple limits on the counter table, snapshot-age monitoring (a long reader pins the
   horizon), memory for dictionaries against `shared_buffers`.
6. **SQLite design of its own**: single writer, so fold inline at file end with a bounded
   visibility delay; no array type; search maintenance must gate readiness; checkpoint
   behaviour; SQLCipher cost; a numeric gate.

### 0.4 Phase 1, narrowed and reordered

| Order | Item | Gate |
|---|---|---|
| 1 | **P1 benchmark**, with: WAL bytes and buffer counts as primary metrics (timing spread on the shared host is ±21%); absolute floors on ratio gates ("≤ 2× or ≤ 10 ms"); real annotated exomes; 4, 8 and 16 importers; readers running during import; a soak with a long-lived reader; a late-cohort write test (200 real files imported on top of the 10,000-sample read-scale schema); the diff harness must assert expected success, not just equal outcomes | Baseline reproduced within the measured spread |
| 2 | **K1 fold-scaling curve**: fold duration T(K) for K = 1…32 on real-spectrum data against a counter table of 6 million and 60 million rows, at the target arrival rate, with a bounded queue. This is the experiment that kills the folder design fastest | T(K) ≤ 1 s at the K the arrival rate requires, queue age ≤ 2 s sustained; otherwise the base-plus-delta design is the route |
| 3 | **K2 id-resolution microbenchmark**: natural key to integer id for 60,000 calls, mostly known, at 1, 4 and 16 concurrent importers | ≤ 150 ms per file at 16 importers; otherwise integer ids are resolved differently or not at all |
| 4 | **Oracle** (experiment 0b, extended to flags, key parts, frequency numerator and the MAX ordering) and the owner's decision, including #469 | Written rule; failing examples become tests |
| 5 | **Correctness PRs** C1, C2, C4–C10 | Each with a failing test first |
| 6 | **P3 counter split**, gated on the 10,000-sample read-scale schema, including the anti-correlated filter-against-sort case and the keyset tiebreak | Page ≤ 300 ms; exact count within 2 s; summary step per the K1 result |
| 7 | **One shared queue implementation** (replaces P2 and the publication half of M2; built once), only after items 2, 4 and the state machine | State machine tests; sustained-load gate from item 2 |
| 8 | **P4 and P5** (index removal with a replacement named for every reader; one bulk load per file; JSON path). They give no end-to-end gain while publication bounds throughput, so they come after it | Row-writing WAL and time; read contract intact |
| 9 | **X3 sub-cohorts**, with case sets up to 5,000, page plus sort, maintenance cost, and three arms: per-case arrays, block bitmaps with delta arrays, and a columnar per-case sidecar | ≤ 1 s for an arbitrary set at 10,000 samples |

Alternatives, per the reviewers: fold-then-ready stays the first choice because no read
changes; K1 decides whether base-plus-delta replaces it. A columnar sidecar stays rejected
for the import path but is a live candidate for sub-cohorts, where rows are already ruled
out and arrays are predicted to stop being interactive above roughly 150 cases.

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

## 6. Reconciled findings (three reviews and a source-code check)

Inputs: Codex (`gpt-6-astra`, xhigh; code reading), an independent Opus reviewer (xhigh; code
reading plus read-only catalog queries and `EXPLAIN` on a 54-case dev schema), a literature
and documentation survey, and a source-code check of seqr, VarFish, VarFish worker,
TileDB-VCF, OpenCGA, Hail, AFQuery and GEMINI at pinned commits. Nothing below was measured
by running an import; expected effects are hypotheses until section 7 measures them.

Where all agree:

- Do not ship the first normalised model or its view and trigger layer.
- The per-sample row is not the problem. The cost is (1) cross-case structures maintained on
  the per-sample table, (2) cohort counts maintained row by row under a serial lock, and
  (3) cold data (every transcript, INFO) written per call.
- Filter access paths must stay case-local. In PostgreSQL a predicate evaluated on a
  deduplicated table and joined to one case's 60,000 calls plans as a hash join over the
  whole dimension or as 60,000 probes for anything that is not selective (planner cost
  157,015 against 20 for the case-local index-only count). seqr can do it only because a
  ClickHouse dictionary probe is an order of magnitude cheaper, and it still keeps its two
  coarsest flags in the fact's sort key.
- Nobody maintains per-variant counts row by row on the import path. seqr sums signed rows
  per project and regroups for global counts; TileDB-VCF appends partial counts; VarFish
  refreshes a materialised view weekly and is slow on cohorts for exactly that reason (plus
  one statement per case unioned together, JSON genotypes, and no cross-case index).
- No inspected system satisfies all of our requirements. Arbitrary sub-cohorts exist only in
  AFQuery (research code, per-variant carrier bitmaps).

Verified from our own catalog and code (Opus review):

- `cohort_variant_summary`: 2,626,744 updates, 0 heap-only; indexes 334 MB against a 103 MB
  heap. About ten WAL records per counter change.
- About 140 of about 312 index bytes per call on the variant table are cross-case:
  the coordinate-hash index 84 B (random inserts), the gene trigram GIN 24 B (0 scans), the
  coordinate index 17 B, the full-text GIN 16 B, a BRIN with 0 scans. Every import touches
  these across their whole extent; the case-prefixed indexes append locally.
- `search_document` (98 B) and `coord_hash` (33 B) are 40% of the heap row and are computed
  per row during COPY.
- Transcripts cost about 208 B per call across four indexes, two of them prefix-redundant;
  no filter reads them.
- 60 transactions per exome (1,000-row batches, an id reservation and two COPYs each).
- The summary lock is a polling try-lock (25–250 ms backoff, not FIFO); waiters hold a
  transaction id while polling.
- The simulated data is flattering: `cdna`, `aa_change`, `omim`, `moi` and `info_json` are
  all NULL and there is one transcript per variant; the VEP fixtures average 565 B of INFO.
  The dev container runs `wal_level=minimal`.

Where the reviews disagree, and how this plan resolves it:

| Question | Positions | Resolution |
|---|---|---|
| Per-sample rows or narrow fact plus dimension join | Opus: keep rows with every filter column case-local. Code check: narrow fact joined to a dictionary, as seqr and OpenCGA do. Codex: either, as long as filters are case-local | Rows are the primary route (the planner evidence is ours; the join is proven only on ClickHouse). The join is measured once (experiment X1) so the decision rests on our numbers |
| Exact visibility: fold then publish, or publish deltas and read base plus delta | Opus: a case becomes ready in the transaction that folds it, so readers never see deltas. Codex and the survey: delta log with base-plus-delta reads | Fold-then-ready first: it needs no change to any cohort read. Base-plus-delta only if the fold cannot keep visibility under 2 s |
| Load into a standalone table and attach | Survey: yes. Opus: no, it breaks visible-on-commit and is unnecessary once the fact has only case-local indexes | Not planned; range partitions by case-id block for operability only |
| Carrier bitmaps | Survey and code check: needed for arbitrary sub-cohorts. Opus: count ad hoc sets from per-case id arrays first; bitmaps only if large sets become routine | Per-case id arrays first (experiment X3), bitmaps as the follow-up |
| Compressed per-case chunks or a columnar engine | Codex: the credible way to hit storage and speed together. Opus: only at 100,000 samples | Deferred; storage is no longer a target |

## 7. The target design and the work to get there

### 7.1 Target (to be confirmed by measurement)

One row per call stays, with every filterable column on it. What changes:

- **Integer identities resolved at import**: `site_id` (build, chromosome, position, alleles,
  type) and `variant_id` (site plus annotation payload). Everything cross-case moves onto
  these ids.
- **The per-sample table keeps only case-local indexes.** The coordinate-hash column and its
  index, the full-text and trigram GIN indexes and the unused BRIN leave the fact.
- **Search runs on the deduplicated `variant` table** (one search document per distinct
  variant) and reaches a case as `variant_id = ANY(ids)`.
- **Transcripts become transcript sets** shared between calls; a call references its set.
- **Extension and INFO-derived filter columns** live in a registry-keyed `extra jsonb` on the
  row, so a new filter column needs no schema change; typed columns stay typed.
- **Cohort counts**: a narrow `site_stats` table (counts only, two indexes) written by a
  single folder that takes every queued case in one transaction; a case becomes `ready` in
  the transaction that folds it. The wide representative-annotation table changes only when
  a site gains or loses a distinct annotation. Deletes and transcript switches enqueue
  signed work instead of taking the lock.
- **Sub-cohorts**: `case_calls` holds each case's site ids as an integer array; ad hoc case
  sets are counted from it on demand; declared groups get folded counters.
- **Import**: one narrow round trip to resolve ids (only novel variants upload their
  payload), then one transaction and one COPY per file.
- **SQLite**: the same tables; fold every K files.

Expected, not measured: row writing ≤ 1 s and flat; publication 0.1–0.3 s per case amortised
with no global lock held by importers; 10,000 exomes in roughly 1–1.5 hours; about 200 GB at
10,000 exomes on simulated widths.

### 7.2 Phase 1: on the current schema (no new model; starts now)

Each item is an experiment first (pass and kill criteria), then a PR if it passes.

| # | Change | Pass | Kill |
|---|---|---|---|
| P1 | Honest benchmark: protocol of section 3 plus real VEP-annotated exomes, `wal_level=replica`, lz4 WAL and TOAST compression, and the 10,000-sample read-scale schema | Baseline numbers reproduced within 15% on two days | none (prerequisite) |
| P2 | Group publication: the lock holder folds every prepared case in one upsert (K up to 32), each case still reported individually; a failing group is bisected and retried singly | Work under the lock per case ≤ 50% of today at K = 4 and ≤ 25% at K = 16; visibility ≤ 2 s; parallel equals sequential | Failure isolation not achievable, or visibility above 2 s |
| P3 | Counters split from the annotation and filter indexes (`site_stats`-shaped table on the current key), annotation rows written only when the representative value changes | Summary step ≤ 0.8 s single-case; every cohort row of the read matrix ≤ 1.5× today | A default cohort sort or filter slower than 2× |
| P4 | Remove redundant indexes one at a time with `EXPLAIN` of every caller and the read matrix: two prefix-redundant transcript indexes and the unreferenced surrogate key, the BRIN, the gene trigram GIN, then the coordinate-hash index against the coordinate index | Row writing −20% or better at sample 100, flatter curve, no read regression | Any read in the matrix slower than 1.5× |
| P5 | One transaction and one COPY per file; JSON through the same bulk writer | Round trips per file down tenfold; JSON within 1.3× of VCF | none for JSON; no VCF gain means drop the VCF part |
| P6 | Blocking FIFO advisory lock on the worker's own connection; no transaction id held while waiting | No idle handoff in the profile; vacuum horizon not pinned by waiters | Pool-timeout problem reappears on any path |

P2 and P3 attack the measured bottleneck and combine. Expected together: serial work per case
from about 3.5 s to well under 1 s.

### 7.3 Phase 2: the new model (after Gate 1)

| # | Change | Proof before it ships |
|---|---|---|
| M1 | `site` and `variant` tables, id resolution round trip, cleaned row with `site_id`, `variant_id` and `extra`; search and transcripts on `variant` | Row writing ≤ 1 s flat to 1,000 samples; read matrix within targets; diff harness 0 differences |
| M2 | `site_stats`, representative-annotation table, `variant_refs`, `case_calls`, fold queue and single folder; delete and transcript switch through the queue | Publication ≤ 0.3 s per case amortised; maintained equals rebuilt after random add, delete and switch sequences; crash schedules |
| M3 | Range partitions by case-id block; online per-case conversion behind a `legacy ∪ new` view, gated by the harness | Conversion of the 1,000-sample set verified row by row; rollback tested |
| M4 | Sub-cohorts: declared groups with folded counters, ad hoc sets counted from `case_calls` | Targets of section 1 on the 10,000-sample read-scale schema |
| M5 | SQLite: same tables, fold every K files, search kept current per file | Batch time not above today's pre-upkeep figure; parity tests |

### 7.4 Cross-check experiments (cheap, decide open disagreements)

| # | Question | Method |
|---|---|---|
| X1 | Does a narrow integer fact joined to the variant table ever beat case-local rows in PostgreSQL? | The read matrix on a 100-sample schema, forcing merge, hash and nested-loop plans. Expected to confirm rows; one day |
| X2 | How much of the 2.3 s → 5 s row-writing growth is the cross-case indexes? | P4's runs, per-index WAL and buffer attribution |
| X3 | Are ad hoc sub-cohort counts from per-case id arrays interactive? | Case sets of 10, 100, 1,000 on the read-scale schema; then core `bit varying` popcount as the comparison |
| X4 | What does realistic annotation do to every number? | Finalists re-run on the real VEP set |

### 7.5 Gates

**Gate 1 (after Phase 1 and X1–X2).** With the measured table: if P2 + P3 + P4 + P5 bring the
current schema to ≤ 1.5 s per sample sustained at 1,000 samples with the read matrix intact,
they ship as they are and Phase 2 proceeds for the remaining gap and the sub-cohort
capability. If Phase 1 misses badly, Phase 2 starts with M2 (the publication half) first.

**Gate 2 (before any migration existing workspaces must run).** On one build: write targets
at 1,000 samples and read targets at 10,000; the diff harness at 0 differences against the
oracle; the concurrency and crash schedules of the correctness track passing; a Codex and an
independent review with no blocker; a tested conversion and rollback.

Shipping units, each a PR that leaves the product correct on its own: the benchmark; the
correctness PRs; P5; P4; P3; P2 (behind `VARLENS_IMPORT_PUBLICATION`, current path as the
rollback switch for one release); P6; then M1–M5 in order.

## 8. What is explicitly not being done

- No switch-over to the first normalised model. Its branch stays as the source of the diff
  harness, the conversion tooling and the measurements.
- No dropping of summary indexes without a read-matrix result.
- No approximate counts, no stale-but-labelled results as an end state.
- No new database engine, no compressed per-case chunks and no carrier bitmaps as a filter
  mechanism before Gate 1.
- No load-then-attach partitioning: it breaks visible-on-commit and is unnecessary once the
  per-sample table has only case-local indexes.
- No sha256 lookup keys, no hash partitioning, no further tuning of the per-row summary
  upsert.
- No release-affecting change without the full preflight and a hosted green build.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Simulated data hides real annotation diversity and INFO sizes | Dataset (c) in section 3; finalists re-measured on it |
| Shared machine distorts timings | Protocol in section 3; alternating pairs; nothing concluded from a single run |
| Group publication (P2) couples cases | A failing group is bisected and retried singly; each case reported individually |
| A single folder (M2) becomes the new serial point | It does set-based work over the union of queued cases, so cost per case falls as the queue grows; measured in M2 before anything ships |
| `extra jsonb` filters are slower than typed columns | Typed columns stay typed; registry keys are measured in the read matrix (the extension-column row) |
| A migration of existing workspaces at 10,000-sample scale | Every schema change is additive first, with a background conversion and a rollback switch |
| Memory pressure on the development host (two out-of-memory session kills on 2026-10-07) | One heavy job at a time, capped; read-only work in parallel only |

## 10. Open inputs

- The measurement agent's first results on the 100-sample data (running); they are labelled
  with the experiment ids of an earlier revision: A1 → P4/X2, A2 → search on the `variant`
  table (M1), A3 → P3, A4 → P2, A5 → base-plus-delta fallback, A6 → P5, B1/B2 → X1,
  B3 → M1, B4 → X3.
- The second adversarial pass on this revision (Codex and Opus).
- The owner's decision on the oracle (section 4) and on the frequency denominator (C10).
