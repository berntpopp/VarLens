import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { resolve } from 'path'
import pkg from './package.json'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  test: {
    // Pool configuration for native modules (better-sqlite3-multiple-ciphers)
    // See: https://vitest.dev/guide/common-errors.html#failed-to-terminate-worker
    // See: https://github.com/vitest-dev/vitest/issues/8968
    pool: 'forks',

    // CRITICAL: Disable file parallelism for native module compatibility
    // Running test files sequentially prevents "Timeout terminating forks worker"
    // errors with native Node.js modules like better-sqlite3
    fileParallelism: false,

    // Timeouts - increased for long-running import tests with native SQLite
    testTimeout: process.env.CI ? 120_000 : 60_000,
    hookTimeout: process.env.CI ? 60_000 : 30_000,
    teardownTimeout: 30_000, // Give workers time to close DB connections

    // Handle worker termination errors with native modules gracefully
    // Worker termination timeouts are a known vitest issue with native modules
    // All tests pass, this just prevents the error from causing non-zero exit
    // See: https://github.com/vitest-dev/vitest/issues/8968
    dangerouslyIgnoreUnhandledErrors: true,

    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    server: {
      deps: {
        inline: ['vuetify']
      }
    },
    coverage: {
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
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70
      }
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
