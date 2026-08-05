# Build performance baseline — pre-Phase-1

- label: `pre-phase1`
- gitSha: `63f2eaa8`
- nodeVersion: v24.15.0
- electronVersion: 43.3.0
- createdAt: 2026-08-05T21:27:26.770Z
- host: AMD Ryzen 9 9950X 16-Core Processor, 32 threads, 59 GiB RAM
- measured with: `systemd-run --user --scope -p MemoryMax=16G -- make perf-build LABEL=pre-phase1`

This is the pre-change baseline every later phase of the build/CI
performance project is measured against. All 10 stages exited 0.

## Per-stage results

| Stage | Wall (s) | Peak RSS (MB) | Expect ≈ (spec §2.1) |
|---|---:|---:|---|
| `lint-cold` | 20.04 | 3458.74 | 21s |
| `lint-warm` | 0.62 | 322.21 | 0.6s |
| `format-cold` | 7.55 | 496.54 | 7.6s |
| `format-warm` | 0.82 | 203.21 | 0.8s |
| `typecheck` | 5.79 | 1261.14 | 5–10s |
| `test` | 17.66 | 757.85 | 19s |
| `build` | 11.16 | 2044.11 | 11s |
| `rebuild-electron-cold` | 33.58 | 598.72 | 33–43s |
| `rebuild-electron-warm` | 33.33 | 598.91 | 33–43s |
| `rebuild-node` | 0.47 | 159.88 | 0.5s |

## Sanity check against spec §2.1

Every stage landed within the expected range, including the two
gating figures:

- `rebuild-electron-cold` = 33.58s, `rebuild-electron-warm` = 33.33s
  — both inside the 33–43s band. This confirms the PR 2 premise: the
  Electron native rebuild currently recompiles `better-sqlite3-multiple-ciphers`
  from source on every invocation, cold or warm, at roughly the same
  cost. There is no warm-cache speedup yet — that is what Task 7 adds.
- `lint-cold`/`lint-warm` and `format-cold`/`format-warm` matched the
  quoted figures closely (informational only, per the brief — these
  are noted to vary with cache state).

No stage failed. No re-run was needed.

## Post-run ABI verification

The stage list ends with `rebuild-node`, which leaves the tree on the
Node ABI (required before Vitest can run). Verified with a real
`Database` construction, not a bare `require()`:

```
node -e "const D=require('better-sqlite3-multiple-ciphers'); const d=new D(':memory:'); d.exec('select 1'); console.log('node ABI ok')"
# -> node ABI ok
```

## Raw artifact

The full measurement, including exit codes, is written to
`.planning/artifacts/perf/build/pre-phase1.json` (gitignored on
purpose, matching `phase1/`/`wgs-import/` practice — only this
human-readable summary is committed).
