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
          'postgres-import-worker': resolve(
            __dirname,
            'src/main/workers/postgres-import-worker.ts'
          ),
          'delete-worker': resolve(__dirname, 'src/main/workers/delete-worker.ts'),
          'export-worker': resolve(__dirname, 'src/main/workers/export-worker.ts'),
          'rebuild-summary-worker': resolve(
            __dirname,
            'src/main/workers/rebuild-summary-worker.ts'
          ),
          'db-worker': resolve(__dirname, 'src/main/workers/db-worker.ts'),
          'write-worker': resolve(__dirname, 'src/main/workers/write-worker.ts'),
          'zip-worker': resolve(__dirname, 'src/main/import/zip-worker.ts')
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
      // vuedraggable's UMD build `require('vue')`s, which through CJS interop
      // resolves to Vue's full build (with @vue/compiler-core). Pin bare `vue`
      // to the runtime-only ESM build. Keep in sync with vite.web-renderer.config.ts.
      alias: [
        { find: '@renderer', replacement: resolve('src/renderer/src') },
        { find: /^vue$/, replacement: 'vue/dist/vue.runtime.esm-bundler.js' }
      ],
      dedupe: ['vue']
    },
    plugins: [vue(), vuetify({ autoImport: true })],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    build: {
      // Inline small assets to avoid extra file-protocol round-trips in Electron
      assetsInlineLimit: 8192,
      rollupOptions: {
        output: {
          // Separate large vendor chunks so the main bundle stays small and
          // the renderer can start executing sooner (parallel chunk loading).
          manualChunks: {
            vuetify: ['vuetify']
          }
        }
      }
    }
  }
})
