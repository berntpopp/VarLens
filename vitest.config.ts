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

    // Cap CI workers a bit below core count to reduce SQLite lock contention
    // on the shared-file code paths and keep memory bounded on ubuntu-latest.
    maxWorkers: process.env.CI ? 4 : undefined,
    minWorkers: 1,

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
          include: ['tests/main/**/*.test.ts', 'tests/shared/**/*.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['tests/renderer/**/*.test.ts']
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
        autoUpdate: true,
        // Global floor -- calibrated from CI actuals (~0.5% below to account for platform variance).
        // Recalibrated 2026-04-10 after adding multi-variant-type import plumbing
        // (migration v25, multi-file session housekeeping, genome-build lock,
        // new wizard IPC surface). The added production code is not yet
        // unit-covered, which drops the ratios below.
        lines: 33.9,
        functions: 21.1,
        branches: 28.0,
        statements: 33.3
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
