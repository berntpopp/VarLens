# CI/build optimization measurements

Measurements belong to the isolated CI optimization worktree. They do not establish a universal end-to-end speedup; current main was integrated during implementation and changes the application and dependency versions.

## Reusable compression

Same frozen baseline corpus: 63 text assets, 10,215,910 raw bytes. Node 24.15.0, Brotli quality 11 and gzip level 9 unchanged.

| Run | Time | Cache hits | Brotli bytes | Gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| Cold | 11,917.93 ms | 0/63 | 2,212,317 | 2,764,074 |
| Warm | 64.14 ms | 63/63 | 2,212,317 | 2,764,074 |

Cold and warm outputs are byte-identical to the original baseline compressed assets. Warm compression time fell 99.46% on this corpus. Each cache restore verifies both compressed hashes and a bounded decompression round trip. Changed content, changed compressor identity, corrupt payload, unavailable cache, stale siblings and cache bounds have focused regression coverage.

Raw evidence: `/tmp/varlens-ci-implementation/compression-benchmark.json`.

## Docker production dependency bottleneck

A real bounded BuildKit run on this host spent **211.0 seconds** in the original `npm prune --omit=dev --ignore-scripts` layer after a successful 32.2-second web build. Inspection showed approximately 778 MB of development modules copied into the overlay upper snapshot; npm worker threads waited in filesystem journal/rename operations. This was not a demonstrated registry-audit stall. The existing post-prune bundle/native probe passed.

That observation motivates installing only production dependencies in a fresh stage, retaining the locked versions and copying the builder's Node-ABI SQLite binary into the tested production tree. npm documents `ci` as a frozen install with `--omit=dev` excluding development packages from disk; Docker documents copying selected artifacts between stages: [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/).

The replacement production dependency install measured **15.2 seconds**, versus the original prune step at 211.0 seconds (92.8% less time for this step). Its first probe correctly caught missing migration SQL in the new stage; that input was added before the runtime rerun. This is a step comparison, not a complete Docker build speedup.

Raw evidence: `/tmp/varlens-ci-implementation/docker-build-progress.log`, `docker-prune-diagnostic.log`, and `docker-optimized-missing-sql.log`. The PR validation report records the final production-stage and runtime/scan results; no cold/warm Docker speedup is claimed here without the replacement run.

## Scope of remaining measurements

The existing audit records the redundant PR web jobs and repeated local installs/builds removed by this implementation. Authoritative typed ESLint intentionally runs without its unsafe cross-file cache; edit-time feedback retains caching. Heavy local stages remain serialized, except a separately bounded, isolated Docker validation during implementation. No renderer-performance improvement is claimed.
