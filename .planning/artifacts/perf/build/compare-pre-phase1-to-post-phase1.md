# Build performance: pre-phase1 → post-phase1

Total measured wall clock: **131.02s → 99.42s** (-31.6s)

| Stage | Before (s) | After (s) | Δ (s) | Δ (%) | Peak RSS before → after (MB) | Verdict |
|---|---:|---:|---:|---:|---:|---|
| `lint-cold` | 20.04 | 20.21 | 0.17 | 0.85% | 3458.74 → 3445.53 | unchanged |
| `lint-warm` | 0.62 | 0.64 | 0.02 | 3.23% | 322.21 → 331.84 | unchanged |
| `format-cold` | 7.55 | 7.55 | 0 | 0% | 496.54 → 463.75 | unchanged |
| `format-warm` | 0.82 | 0.84 | 0.02 | 2.44% | 203.21 → 198.68 | unchanged |
| `typecheck` | 5.79 | 5.97 | 0.18 | 3.11% | 1261.14 → 1256 | unchanged |
| `test` | 17.66 | 17.94 | 0.28 | 1.59% | 757.85 → 758.44 | unchanged |
| `build` | 11.16 | 11.1 | -0.06 | -0.54% | 2044.11 → 2058.94 | unchanged |
| `rebuild-electron-cold` | 33.58 | 34.56 | 0.98 | 2.92% | 598.72 → 597.69 | regressed |
| `rebuild-electron-warm` | 33.33 | 0.09 | -33.24 | -99.73% | 598.91 → 64.26 | improved |
| `rebuild-node` | 0.47 | 0.52 | 0.05 | 10.64% | 159.88 → 169.29 | unchanged |

No stage failed.
**Regressions:** rebuild-electron-cold
