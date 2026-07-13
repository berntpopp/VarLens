import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { resolve } from 'path'
import pkg from './package.json'

/**
 * Vitest config — split by test environment via Projects so:
 *
 *   - `tests/main/**` and `tests/shared/**` (121 + 11 files) run under the
 *     Node environment. They exercise main-process code + better-sqlite3
 *     and never touch DOM APIs, so paying the happy-dom tax on every file
 *     was pure waste (the single biggest cost in the previous single-env
 *     config, per 2026-04-10 benchmarks and the Vitest perf guide).
 *
 *   - `tests/renderer/**` (61 files) stays on happy-dom. Roughly half of
 *     these mount Vue components via `@vue/test-utils` and genuinely
 *     need the DOM; the rest pay a small fixed cost that isn't worth
 *     the complexity of per-file env switching.
 *
 * File parallelism is re-enabled. The previous `fileParallelism: false`
 * setting — a workaround for https://github.com/vitest-dev/vitest/issues/8968
 * ("timeout terminating forks worker" with better-sqlite3) — was the
 * dominant slowdown, forcing 193 files through a single worker. The
 * project split isolates Vue/happy-dom workers from better-sqlite3
 * workers, which addresses the underlying worker-termination race
 * without serializing everything.
 *
 * We keep `pool: 'forks'` (not `threads`) because better-sqlite3-multiple-
 * ciphers is a native C++ addon and Vitest's `threads` pool documents
 * segfault risk for native modules.
 *
 * Coverage is gated on `COVERAGE=1` so PR runs can skip the collection
 * and reporting overhead and only the main-branch CI job (and the
 * explicit `npm run test:coverage`) pays the cost.
 */

const coverageEnabled = process.env.COVERAGE === '1'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  test: {
    // Pool configuration for native modules (better-sqlite3-multiple-ciphers).
    // See https://vitest.dev/guide/common-errors.html#failed-to-terminate-worker
    // and https://github.com/vitest-dev/vitest/issues/8968 — `threads` is
    // unsafe with our native addon, so we stay on `forks`.
    pool: 'forks',

    // Re-enabled after the project split (see file docblock above).
    fileParallelism: true,

    // Memory-safe defaults for forked workers.
    //
    // Worker count — local runs used to default to `os.availableParallelism()
    // / 2`, which on a 32-core workstation fanned out to 16 forks. With
    // Vitest's full transform cache per fork this drove peak RSS past what
    // a 64 GB box can absorb once IDEs and browsers are also resident, and
    // triggered SIGKILL on a chained `make ci` run. Cap at 8 locally; CI
    // Ubuntu runners stay at 4 to match their ~7 GB memory envelope.
    //
    // Per-worker heap — bound each fork to 2 GB via V8's
    // `--max-old-space-size`. This makes the ceiling deterministic
    // (workers × 2 GB) and turns a runaway test file into a single-fork
    // OOM rather than a workstation-wide one.
    maxWorkers: process.env.CI ? 4 : 8,
    minWorkers: 1,
    // Vitest 4 flattened the former `poolOptions.forks.execArgv` to a
    // top-level `execArgv` (see migration guide). Applies to whichever
    // pool is active.
    execArgv: ['--max-old-space-size=2048'],

    // Timeouts — main-process tests do real on-disk work during migration,
    // so keep generous hook/test budgets.
    testTimeout: process.env.CI ? 120_000 : 60_000,
    hookTimeout: process.env.CI ? 60_000 : 30_000,
    teardownTimeout: 30_000,

    // Worker termination timeouts with native modules are still a known
    // Vitest issue in rare cases — keep the graceful-ignore so they don't
    // fail the run when all tests have already passed.
    dangerouslyIgnoreUnhandledErrors: true,

    setupFiles: ['tests/setup.ts'],
    server: {
      deps: {
        inline: ['vuetify']
      }
    },

    // Projects split main/shared (Node) from renderer (happy-dom).
    // The root `include` intentionally omits `environment` — each project
    // declares its own.
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          environment: 'node',
          include: [
            'tests/main/**/*.test.ts',
            'tests/shared/**/*.test.ts',
            'tests/scripts/**/*.test.ts',
            'tests/refactor-checkpoint/**/*.test.ts'
          ]
        }
      },
      {
        // Phase 1 web-migration gate. Static structural rules + skipped
        // web-only integration tests.
        //
        // **OPT-IN — desktop is the default mode of VarLens.** The gate
        // validates the path that adds web mode alongside the existing
        // Electron app, so a desktop-only contributor (researcher, clinician)
        // should never see web-gate failures during `make ci` or
        // `npm run test`. The project is therefore excluded from the
        // default `npm run test` script (see package.json — `--project main
        // --project renderer`) and only runs when explicitly invoked via
        // `npm run test:web-gate` or `make web-gate-static`.
        //
        // Layer 3 parity (heavy, boots Electron) is its own project below
        // and additionally requires VARLENS_RUN_WEB_GATE_PARITY=1.
        //
        // See .planning/web/completed/testing/desktop-to-web-parity.md.
        extends: true,
        test: {
          name: 'web-gate',
          environment: 'node',
          include: ['tests/web-gate/*.test.ts', 'tests/web-gate/integration/**/*.test.ts']
        }
      },
      {
        // Layer 3 parity. Opt-in mirror of the `perf` project: tests use
        // `describe.skipIf(!SHOULD_RUN)` keyed on VARLENS_RUN_WEB_GATE_PARITY.
        // Without the env var the project schedules but every test skips,
        // so desktop-only contributors never pay the Electron-boot cost.
        // Run via `make web-gate-parity`.
        extends: true,
        test: {
          name: 'web-gate-parity',
          environment: 'node',
          include: ['tests/web-gate/parity/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 60_000
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['tests/renderer/**/*.test.ts']
        }
      },
      {
        // Phase 9 WGS perf benchmarks. Files live under tests/perf/ and use
        // `describe.skipIf(!SHOULD_RUN)` so they no-op unless
        // VARLENS_RUN_WGS_PERF=1 is set. Lives in its own project so the
        // include glob doesn't pollute the main suite.
        extends: true,
        test: {
          name: 'perf',
          environment: 'node',
          include: ['tests/perf/**/*.perf.test.ts'],
          // WGS imports take minutes; raise the per-test timeout ceiling.
          // Each perf test sets its own explicit timeout via the third
          // arg of `it(...)`; this is the cap.
          testTimeout: 30 * 60_000,
          hookTimeout: 5 * 60_000
        }
      },
      {
        // PR-A Item 3: enforces the compile-time-only IpcResult locks in
        // tests/shared/types/preload-contract.test-d.ts under a real
        // typechecker. `expectTypeOf(...).toEqualTypeOf(...)` is a runtime
        // no-op (see that file's docblock) — without this project, those
        // assertions never fail anything. `typecheck.only` means this
        // project runs NO runtime tests (so it doesn't duplicate/slow down
        // `make test`); it is invoked explicitly via
        // `npm run typecheck:contracts` (wired into `npm run typecheck`,
        // i.e. `make typecheck`). The narrow `tsconfig.typecheck-tests.json`
        // keeps the checked file set to just the *.test-d.ts files plus
        // src/shared/**, so this can't cascade into unrelated pre-existing
        // type errors across src/main, src/renderer, or the rest of tests/.
        extends: true,
        test: {
          name: 'contract-typecheck',
          environment: 'node',
          include: [],
          typecheck: {
            enabled: true,
            only: true,
            checker: 'tsc',
            tsconfig: 'tsconfig.typecheck-tests.json',
            include: ['tests/shared/types/**/*.test-d.ts']
          }
        }
      }
    ],

    coverage: {
      enabled: coverageEnabled,
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main/index.ts',
        'src/preload/index.ts',
        'src/renderer/src/main.ts',
        'src/renderer/src/plugins/**'
      ],
      thresholds: {
        // Global floor — calibrated ~0.5 pp BELOW the CI-observed values to
        // absorb platform variance and flaky/skipped test delta between
        // local and CI. The 0.55.0 release failed because `autoUpdate: true`
        // ratcheted the thresholds up to the exact PR-branch local values
        // (lines 35.52 / statements 34.74 / branches 31.42), and the
        // post-merge CI build on main ran with 6 more tests skipped and
        // landed 0.06-0.09 pp below — enough to trip the gate.
        //
        // `autoUpdate` is intentionally disabled so the floor stays where
        // the engineer set it. When coverage genuinely improves, bump
        // these by hand with a margin rather than letting automation chase
        // the exact observed value.
        autoUpdate: false,
        lines: 35.0,
        functions: 21.5,
        branches: 30.8,
        statements: 34.1,

        // Per-file thresholds for the unified-shortlist modules (spec §8).
        // Vitest 4.x supports glob keys under `coverage.thresholds` —
        // each glob gets its own lines/branches/functions/statements
        // floor applied per-file (not averaged), so any single file
        // in the glob dropping below the threshold fails the run.
        //
        // These only fire when coverage is enabled (COVERAGE=1 or
        // `npm run test:coverage`). `make ci` runs without coverage,
        // so the thresholds are latent in PR runs and gate only the
        // explicit coverage job.
        'src/main/services/scoring/**': {
          lines: 95,
          branches: 90,
          functions: 95,
          statements: 95
        },
        'src/main/database/ShortlistService.ts': {
          lines: 85,
          branches: 80,
          functions: 85,
          statements: 85
        },
        'src/main/database/shortlist-query.ts': {
          lines: 90,
          branches: 85,
          functions: 90,
          statements: 90
        },
        'src/main/ipc/handlers/shortlist.ts': {
          lines: 85,
          branches: 80,
          functions: 85,
          statements: 85
        },
        'src/renderer/src/composables/useShortlistQuery.ts': {
          lines: 80,
          branches: 70,
          functions: 80,
          statements: 80
        },
        'src/renderer/src/components/shortlist/**': {
          lines: 75,
          branches: 65,
          functions: 75,
          statements: 75
        },
        'src/main/storage/postgres/copy-text-encoder.ts': {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100
        }
      },
      // On CI we only need the JSON summary to gate the thresholds and
      // upload as an artifact. Skipping `text` and `html` reporters saves
      // ~5-10s per run by avoiding AST remapping for the HTML output.
      reporter: process.env.CI ? ['json-summary'] : ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage'
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
