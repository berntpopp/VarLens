/**
 * Serves the built browser bundle (`out/web/public/`) and falls back
 * to `index.html` for any non-`/api/*`, non-probe GET so Vue
 * Router's history-mode routes resolve.
 *
 * Disabled when the build output isn't present — keeps tests that
 * import `buildApp` without running the renderer build green.
 */
import { existsSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

import { isLocalIgvAllowed, LOCAL_IGV_ORIGINS } from './instance-settings'
import { isProbePath } from './probe-paths'

// At runtime the bundle lives at `/app/out/web/server.cjs`, so __dirname is
// `/app/out/web/` and the renderer build lands beside it at `./public/`.
const DEFAULT_PUBLIC_DIR = resolve(__dirname, 'public')

export const WEB_APP_CSP_HEADER =
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' data: https://alphafold.ebi.ac.uk https://www.ebi.ac.uk https://files.rcsb.org https://models.rcsb.org https://data.rcsb.org https://rest.ensembl.org https://gnomad.broadinstitute.org https://www.proteins.uniprot.org https://rest.uniprot.org https://www.interpro.ebi.ac.uk http://localhost:60151 http://127.0.0.1:60151 blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

/**
 * The CSP header actually sent with the SPA shell. The meta CSP in
 * src/web/index.html allows the local IGV batch port; the effective policy is
 * the intersection of meta and header, so the header keeps it blocked unless the
 * operator opts in with VARLENS_WEB_ALLOW_LOCAL_IGV=1 (the capability document
 * reports the same flag as `igvLocalBroadcast`).
 */
export function webAppCspHeader(env: NodeJS.ProcessEnv = process.env): string {
  if (isLocalIgvAllowed(env)) return WEB_APP_CSP_HEADER
  return WEB_APP_CSP_HEADER.replace(` ${LOCAL_IGV_ORIGINS}`, '')
}

export function getPublicDir(): string {
  const env = process.env.VARLENS_WEB_PUBLIC_DIR
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return DEFAULT_PUBLIC_DIR
}

/** Vite emits content-hashed filenames under `assets/`; they never change in place. */
export const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
/** Everything else (HTML shell, favicon, manifest) must revalidate via ETag. */
export const REVALIDATE_CACHE_CONTROL = 'no-cache'

const PRECOMPRESSED_SUFFIX = /\.(?:br|gz)$/

/**
 * `@fastify/static` hands `setHeaders` the path of the file it actually
 * streams, which is `foo.js.br` when a precompressed sibling was chosen.
 */
function servedAssetPath(publicDir: string, filePath: string): string {
  const withoutEncoding = filePath.replace(PRECOMPRESSED_SUFFIX, '')
  return relative(publicDir, withoutEncoding).split(sep).join('/')
}

function isAssetLikePath(path: string): boolean {
  if (path.startsWith('/assets/')) return true
  const lastSegment = path.split('/').pop() ?? ''
  return lastSegment.includes('.')
}

export async function registerStatic(app: FastifyInstance): Promise<void> {
  const publicDir = getPublicDir()
  if (!existsSync(publicDir)) {
    app.log.warn(
      { publicDir },
      'web: public dir not found; static + SPA fallback disabled. Run `npm run build:web:renderer`.'
    )
    return
  }

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    // We register a manual SPA fallback below; let it handle all 404s
    // for non-asset routes.
    wildcard: false,
    // Serve the `.br` / `.gz` siblings written at build time when the
    // client accepts them (also applies to the SPA fallback's sendFile).
    preCompressed: true,
    // Cache-Control is decided per file in setHeaders below.
    cacheControl: false,
    // @fastify/static v10 hands `setHeaders` a FastifyReply, not a raw
    // ServerResponse — use `reply.header()`, not `res.setHeader()`.
    setHeaders: (reply, pathName) => {
      const assetPath = servedAssetPath(publicDir, pathName)
      if (assetPath.startsWith('assets/')) {
        reply.header('cache-control', IMMUTABLE_ASSET_CACHE_CONTROL)
        return
      }
      reply.header('cache-control', REVALIDATE_CACHE_CONTROL)
      if (assetPath === 'index.html') {
        reply.header('Content-Security-Policy', webAppCspHeader())
      }
    }
  })

  app.setNotFoundHandler(async (request, reply) => {
    const url = request.url.split('?', 1)[0]
    if (request.method !== 'GET') {
      reply.code(404)
      return { error: 'not found' }
    }
    if (url.startsWith('/api/') || isProbePath(url)) {
      reply.code(404)
      return { error: 'not found' }
    }
    if (isAssetLikePath(url)) {
      reply.code(404)
      return { error: 'not found' }
    }
    return reply.header('Content-Security-Policy', webAppCspHeader()).sendFile('index.html')
  })
}
