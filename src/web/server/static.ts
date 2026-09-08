/**
 * Serves the built browser bundle (`out/web/public/`) and falls back
 * to `index.html` for any non-`/api/*`, non-probe GET so Vue
 * Router's history-mode routes resolve.
 *
 * Disabled when the build output isn't present — keeps tests that
 * import `buildApp` without running the renderer build green.
 */
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

// At runtime the bundle lives at `/app/out/web/server.cjs`, so __dirname is
// `/app/out/web/` and the renderer build lands beside it at `./public/`.
const DEFAULT_PUBLIC_DIR = resolve(__dirname, 'public')

export const WEB_APP_CSP_HEADER =
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' data: https://alphafold.ebi.ac.uk https://www.ebi.ac.uk https://files.rcsb.org https://models.rcsb.org https://data.rcsb.org https://rest.ensembl.org https://gnomad.broadinstitute.org https://www.proteins.uniprot.org https://rest.uniprot.org https://www.interpro.ebi.ac.uk blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

export function getPublicDir(): string {
  const env = process.env.VARLENS_WEB_PUBLIC_DIR
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return DEFAULT_PUBLIC_DIR
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
    // @fastify/static v10 hands `setHeaders` a FastifyReply, not a raw
    // ServerResponse — use `reply.header()`, not `res.setHeader()`.
    setHeaders: (reply, pathName) => {
      if (basename(pathName) === 'index.html') {
        reply.header('Content-Security-Policy', WEB_APP_CSP_HEADER)
      }
    }
  })

  app.setNotFoundHandler(async (request, reply) => {
    const url = request.url.split('?', 1)[0]
    if (request.method !== 'GET') {
      reply.code(404)
      return { error: 'not found' }
    }
    if (url.startsWith('/api/') || url === '/livez' || url === '/readyz' || url === '/healthz') {
      reply.code(404)
      return { error: 'not found' }
    }
    if (isAssetLikePath(url)) {
      reply.code(404)
      return { error: 'not found' }
    }
    return reply.header('Content-Security-Policy', WEB_APP_CSP_HEADER).sendFile('index.html')
  })
}
