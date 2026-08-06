/**
 * Vite config for the web-mode browser bundle.
 *
 * Builds `src/web/index.html` + `src/web/bootstrap.ts` (which installs
 * the HTTP `window.api` Proxy and dynamic-imports the renderer entry).
 * Output: `out/web/public/`. Served by Fastify static + SPA fallback.
 *
 * The desktop renderer build lives in `electron.vite.config.ts` under
 * the `renderer:` key. This is its web sibling — same renderer source
 * tree, different transport, different entry HTML.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

import pkg from './package.json'

function normalizeBase(value: string | undefined): string {
  const raw = value?.trim()
  if (raw === undefined || raw === '') return '/varlens/'
  if (raw === '/') return '/'
  const withLeading = raw.startsWith('/') ? raw : '/' + raw
  return withLeading.endsWith('/') ? withLeading : withLeading + '/'
}

function copyWebPublicAssets(): Plugin {
  const outDir = resolve(__dirname, 'out/web/public')
  // Brand/favicon assets live in src/renderer/public/ (the desktop renderer's
  // Vite publicDir). The web build uses a different publicDir, so copy the
  // favicon set explicitly. Missing files are skipped so the build never
  // breaks if an optional icon hasn't been generated.
  const brandAssets = [
    'favicon.svg',
    'favicon.ico',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'manifest.webmanifest'
  ]
  return {
    name: 'web-renderer:copy-public-assets',
    apply: 'build',
    writeBundle() {
      mkdirSync(outDir, { recursive: true })
      for (const file of brandAssets) {
        const src = resolve(__dirname, 'src/renderer/public', file)
        if (existsSync(src)) copyFileSync(src, resolve(outDir, file))
      }
    }
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  // Reverse proxies may mount the app under a path prefix such as /varlens.
  // The browser still loads index.html from that prefix, so asset URLs and
  // API calls must include it. This build-time value must match the server's
  // runtime APP_PATH_PREFIX. Local web-dev overrides both values to `/`.
  base: normalizeBase(process.env.VARLENS_WEB_BASE),
  publicDir: resolve(__dirname, 'src/renderer/src/assets'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [vue(), vuetify({ autoImport: true }), copyWebPublicAssets()],
  build: {
    target: 'es2022',
    outDir: resolve(__dirname, 'out/web/public'),
    emptyOutDir: true,
    sourcemap: true,
    assetsInlineLimit: 8192,
    rollupOptions: {
      input: resolve(__dirname, 'src/web/index.html'),
      output: {
        manualChunks: {
          vuetify: ['vuetify']
        }
      }
    }
  },
  server: {
    port: 5200,
    strictPort: false,
    proxy: {
      '/api': 'http://localhost:8787',
      '/healthz': 'http://localhost:8787'
    }
  }
})
