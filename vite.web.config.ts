/**
 * Vite config for the web build target.
 *
 * Builds `src/web/server.ts` → `out/web/server.cjs`. Existence of that file
 * gates `tests/web-gate/integration/*.test.ts` (they `skipIf(!existsSync(...))`).
 *
 * Run via `npm run build:web` or `make build-web`.
 *
 * Externals: Node-builtins and the better-sqlite3 native addon are kept
 * external — they're resolved at runtime, not bundled.
 */
import { defineConfig, type Plugin } from 'vite'
import { builtinModules } from 'node:module'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Map of desktop modules that import `electron` (directly or transitively)
 * to web-build stubs that match each module's public surface using only
 * Node builtins + console. Each entry is matched by a "ends with this
 * path" check after resolving the import to an absolute file path —
 * works for any depth of relative path the source happens to use.
 *
 * Why this exists: Rollup hoists static-arg requires even when they sit
 * inside a try/catch in source, so MainLogger's `require('electron')`
 * leaks into the web bundle's top level. After `npm prune --omit=dev`
 * electron is gone and the bundle won't load. Stubbing severs the
 * import graph at the right boundary.
 */
const WEB_STUBS: Record<string, string> = {
  '/main/services/MainLogger': resolve(__dirname, 'src/web/stubs/main-logger-stub.ts'),
  '/main/database/geneReferenceLoader': resolve(
    __dirname,
    'src/web/stubs/gene-reference-loader-stub.ts'
  )
}

/**
 * Copies static assets that live next to the web server source but
 * are not part of the JS bundle — currently just the login wall HTML
 * (`src/web/login/login.html` → `out/web/login/login.html`). The
 * server reads it from disk at request time; bundling it into the
 * .cjs would force a rebuild for content tweaks and complicate the
 * `VARLENS_LOGIN_HTML_PATH` override path used by tests.
 */
function copyWebStaticAssets(): Plugin {
  const outDir = resolve(__dirname, 'out/web')
  return {
    name: 'web-build:copy-static-assets',
    apply: 'build',
    writeBundle() {
      mkdirSync(resolve(outDir, 'login'), { recursive: true })
      copyFileSync(
        resolve(__dirname, 'src/web/login/login.html'),
        resolve(outDir, 'login/login.html')
      )
    }
  }
}

function aliasDesktopModulesToWebStubs(): Plugin {
  return {
    name: 'web-build:alias-desktop-to-web-stubs',
    enforce: 'pre',
    async resolveId(source, importer) {
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (resolved === null) return null
      const id = resolved.id.replace(/\.[jt]sx?$/, '').replace(/\\/g, '/')
      for (const [ending, stubPath] of Object.entries(WEB_STUBS)) {
        if (id.endsWith(ending)) return stubPath
      }
      return null
    }
  }
}

export default defineConfig({
  plugins: [aliasDesktopModulesToWebStubs(), copyWebStaticAssets()],
  build: {
    target: 'node24',
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    ssr: true,
    rollupOptions: {
      input: {
        server: resolve(__dirname, 'src/web/server.ts'),
        'postgres-import-worker': resolve(__dirname, 'src/main/workers/postgres-import-worker.ts'),
        'provision-user': resolve(__dirname, 'src/web/provision-user.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => (chunkInfo.name === 'server' ? 'server.cjs' : '[name].cjs'),
        format: 'cjs'
      },
      external: [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        'better-sqlite3-multiple-ciphers',
        'fastify',
        '@fastify/secure-session',
        '@fastify/static',
        'pg',
        'pg-query-stream'
      ]
    },
    minify: false,
    sourcemap: true
  }
})
