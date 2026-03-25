import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { resolve } from 'path'
import pkg from './package.json'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['better-sqlite3-multiple-ciphers'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'statistics-worker': resolve(__dirname, 'src/main/statistics/worker.ts'),
          'import-worker': resolve(__dirname, 'src/main/workers/import-worker.ts'),
          'delete-worker': resolve(__dirname, 'src/main/workers/delete-worker.ts'),
          'export-worker': resolve(__dirname, 'src/main/workers/export-worker.ts'),
          'rebuild-summary-worker': resolve(
            __dirname,
            'src/main/workers/rebuild-summary-worker.ts'
          ),
          'db-worker': resolve(__dirname, 'src/main/workers/db-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    server: {
      port: 5199,
      strictPort: false
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue(), vuetify({ autoImport: true })],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  }
})
