# Import scale: handover 2 (2026-10-07, 21:10)

Continues `2026-10-07-web-import-scale-handover.md`. Owner priorities: import throughput to
10,000+ exomes first; filters fast and extensible to any column; interactive cohort
aggregation; exact results; storage is no longer a reduction target. Speed matters: do the
release first, in minutes, then the rest.

## 1. Do first: release v0.78.0

`origin/main` is `b600e775` (merge of #475). Since v0.77.0 it gained #478, #479, #475 (two
database migrations: PostgreSQL 0025, SQLite v41; cohort values change), so a minor bump.

```bash
cd ~/development/VarLens-wt/web-import-ux          # clean runner worktree, hooks installed
git fetch origin && git checkout --detach origin/main && git status --short   # must be empty
gh run list --branch main --workflow Build --limit 2   # the merge commit's Build should be green or running
npm version minor --no-git-tag-version                 # 0.77.0 -> 0.78.0 (package.json + lockfile)
git commit -am "chore(release): v0.78.0"               # signed by config
systemd-run --user --scope -q -p MemoryMax=16G make preflight-full   # ~10 min; run from this terminal, not a detached unit
git push origin HEAD:main
gh run list --commit "$(git rev-parse HEAD)" --workflow Build   # wait until success (serialised behind the merge commit's Build)
git tag -a v0.78.0 -m "v0.78.0" && git push origin v0.78.0      # signed tag; triggers release.yml
gh release view v0.78.0 --json isDraft,assets --jq '.isDraft, (.assets|length)'   # expect false
```

Gotchas: the version bump forces `npm ci` inside preflight; with PR #467 merged the first run
should no longer fail on "Installed dependencies changed", but if it does, rerun once. Only
one preflight per host (shared lock). If the push is refused with "Internal Server Error",
retry (it was GitHub-side today). Do not tag before the Build is green on the release commit.

## 2. State

Merged today from this work: #466, #467, #468, #475 (closes #469), #478, #479. Issues #460,
#461, #469 closed. Open issues filed: #476 (log viewer covers its toggle), #477 (export
headers still use the old impact/consequence names).

Local only, not pushed (worktrees under `~/development/VarLens-wt/`):

| Worktree | Branch | Content |
|---|---|---|
| `plan` | `docs/import-scale-experiment-plan` | The plan, revision 3 (`.planning/plans/2026-10-07-import-scale-experiments-and-routes.md`) and this file |
| `pubdesign` | `docs/staged-delta-publication-design` | Publication design, revision 3 (`.planning/specs/2026-10-07-staged-delta-publication.md`) |
| `normalised-model` | `feat/import-stage6-normalised-model` | Rejected first model; keeps the schema-diff harness, conversion tooling, and all measurements under `.planning/artifacts/perf/import-scale/` (start with `SUMMARY.md`) |

Second task after the release: rebase `plan` and `pubdesign` onto main, add the artefact
folder from `normalised-model` (markdown only), and open one docs PR so nothing is local-only.

Cleaned up: every throwaway database and scratch schema is dropped; only `varlens_dev`
remains. No test server is running. Simulated cohort (read-only): `VarLens-wt/_data/sim-cohort/`.

## 3. What is established (measured unless marked)

- Keep one row per call with every filter column on it. Filtering on a deduplicated variant
  table was 1.5× to 33× slower in PostgreSQL; the normalised model was 16× to 180× slower on
  filtered counts and slower on import. Not to be merged.
- Publication bottleneck: the wide cohort summary row and its eight indexes, rewritten for
  every carrier (about 2.2 s per sample under the lock). Narrow counters fold in about 0.45 s
  per single case even at 60 million rows; with at most three cases in preparation, a
  standalone driver sustained 1 to 2 cases per second with "file finished to visible" under
  2 s at the 95th percentile. Synthetic tables, not product code.
- Row writing is then the limit: 60,000 rows take 2.4 s and 164 MB WAL with all twelve
  indexes, 0.6 s with the primary key only. Four workers deliver about 1 case per second.
- Expect roughly 3–9 million distinct sites at 10,000 exomes (derived from ExAC and gnomAD
  counts); the simulator produces about ten times too many private variants per sample and
  has no option for the shared pool's size or spectrum.
- Append-only deltas with base-plus-delta reads: rejected (exact cohort page 2–4 s with a
  backlog of 10–50 cases). Sub-cohort counts from rows: rejected (57 ms per case).

## 4. Next work, in order

1. **Prototype the simplified publication design as code, not prose.** Three review rounds
   (Codex `gpt-6-astra` xhigh, independent Opus xhigh) kept finding SQL-level defects in the
   document; the last verdict was go for the fence (done, #478) and no-go for the rest until
   the fold exists as executable, tested SQL. Design in `pubdesign`: split the summary into a
   narrow counter table and a representative-annotation table; each importer folds its own
   prepared delta under a fair summary lock, the case becomes ready in that transaction;
   edits stay synchronous with a short lock wait and an idempotent recompute fallback; no
   folder, no queue. Open blockers to turn into tests first: invalid assignment form and a
   NULL into a NOT NULL column in the fold statements; a counter missing for a site with
   existing carriers treated as new; recompute operations must run before a new case's
   contribution or after it is visible; workers must not hold row locks and a snapshot while
   waiting behind a rebuild; long alleles in the legacy indexes; SQLite FTS triggers for
   extension rows. Gate (K1e): through the real import worker on a realistic spectrum under
   real row-writing load, arms = today's publication, the new fold, mixed-annotation holders,
   removal, edits during import; pass = serial work per case ≤ 0.6 s and end to end not
   slower than today.
2. **Row writing**: the safe index set with every reader named (the coordinate index serves
   carriers-of-a-variant and the flag recomputes; `case_type` and `case_func` serve reads),
   search on a deduplicated variant table (broad terms 2× faster, selective terms 6× slower:
   needs a `(case_id, variant_id)` path), one transaction and one bulk load per file, JSON
   through the bulk writer.
3. Remaining correctness items from the plan, section 5: annotation writes bypassing the
   summary lock (C2), cohort count and page from one snapshot with a revision bound into
   cursors (C5), SQLite search and read indexes during an import session (C6), SQLite read
   workers' metadata caches (C7), synchronous small-cohort rebuild without backoff (C8),
   per-sample UI refresh for multi-sample VCFs (C9), the internal-frequency denominator (C10).
4. Simulator: options for shared-pool size and frequency spectrum; realistic annotation.
5. The 100-exome run through the browser with a cancel mid-batch; the before/after table.
6. Sub-cohort aggregation (per-case arrays vs block bitmaps vs a columnar sidecar).

## 5. Environment rules that cost time today

- `systemd-oomd` kills the whole VS Code scope (every Claude session) under memory pressure:
  one heavy job at a time, capped; benchmark agents wait while a preflight runs.
- `make preflight` only from the terminal process tree (Chrome's sandbox fails from a
  detached systemd unit); cap 16 GB, not 12.
- Do not wait on `pgrep -f "node scripts/ci/run.mjs"` inside a command that contains that
  string: it matches itself.
- Hosted CI shows a red entry from the run cancelled when a PR is marked ready; judge by the
  newest run.
- Something outside the session pushed an unreviewed stack to main as v0.76.2 this morning;
  check `git log origin/main` before assuming the base.
- Run UI changes in a real browser: unit tests missed two defects today that the browser
  found (PostgreSQL dropping a result field; a doubled log line).
