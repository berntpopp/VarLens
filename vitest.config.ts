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
    testTimeout: process.env.CI ? 120_000 : 60_000,
    hookTimeout: process.env.CI ? 60_000 : 30_000,
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
