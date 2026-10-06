import { afterEach, describe, expect, test } from 'vitest'
import fastify from 'fastify'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'node:zlib'

import { registerStatic } from '../../src/web/server/static'

const IMMUTABLE = 'public, max-age=31536000, immutable'
const JS_SOURCE = 'export const answer = 42;\n'.repeat(200)

async function makePublicDir(): Promise<string> {
  const publicDir = await mkdtemp(join(tmpdir(), 'varlens-web-cache-'))
  await mkdir(join(publicDir, 'assets'))
  await writeFile(join(publicDir, 'index.html'), '<html><body>VarLens web</body></html>')
  await writeFile(join(publicDir, 'assets', 'main-AbC123.js'), JS_SOURCE)
  await writeFile(join(publicDir, 'assets', 'main-AbC123.js.br'), brotliCompressSync(JS_SOURCE))
  await writeFile(join(publicDir, 'assets', 'main-AbC123.js.gz'), gzipSync(JS_SOURCE))
  await writeFile(join(publicDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  return publicDir
}

describe('web static caching + precompressed assets', () => {
  const previousPublicDir = process.env.VARLENS_WEB_PUBLIC_DIR
  let publicDir = ''

  afterEach(async () => {
    if (previousPublicDir === undefined) delete process.env.VARLENS_WEB_PUBLIC_DIR
    else process.env.VARLENS_WEB_PUBLIC_DIR = previousPublicDir
    if (publicDir !== '') await rm(publicDir, { recursive: true, force: true })
    publicDir = ''
  })

  async function buildStaticApp() {
    publicDir = await makePublicDir()
    process.env.VARLENS_WEB_PUBLIC_DIR = publicDir
    const app = fastify()
    await registerStatic(app)
    return app
  }

  test('hashed /assets/* files are cached as immutable for a year', async () => {
    const app = await buildStaticApp()
    try {
      const response = await app.inject({ method: 'GET', url: '/assets/main-AbC123.js' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe(IMMUTABLE)
    } finally {
      await app.close()
    }
  })

  test('serves the precompressed brotli variant when the client accepts br', async () => {
    const app = await buildStaticApp()
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/assets/main-AbC123.js',
        headers: { 'accept-encoding': 'gzip, deflate, br' }
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-encoding']).toBe('br')
      expect(response.headers['content-type']).toMatch(/javascript/)
      expect(response.headers['cache-control']).toBe(IMMUTABLE)
      expect(String(response.headers.vary)).toMatch(/accept-encoding/i)
      expect(brotliDecompressSync(response.rawPayload).toString()).toBe(JS_SOURCE)
    } finally {
      await app.close()
    }
  })

  test('falls back to gzip when brotli is not accepted', async () => {
    const app = await buildStaticApp()
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/assets/main-AbC123.js',
        headers: { 'accept-encoding': 'gzip' }
      })
      expect(response.headers['content-encoding']).toBe('gzip')
    } finally {
      await app.close()
    }
  })

  test('HTML shell (direct and SPA fallback) is served with no-cache + CSP', async () => {
    const app = await buildStaticApp()
    try {
      for (const url of ['/index.html', '/cases/42', '/']) {
        const response = await app.inject({ method: 'GET', url })
        expect(response.statusCode, url).toBe(200)
        expect(response.headers['cache-control'], url).toBe('no-cache')
        expect(response.headers['content-security-policy'], url).toContain("frame-ancestors 'none'")
      }
    } finally {
      await app.close()
    }
  })

  test('non-hashed root files are revalidated, never marked immutable', async () => {
    const app = await buildStaticApp()
    try {
      const response = await app.inject({ method: 'GET', url: '/favicon.svg' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-cache')
    } finally {
      await app.close()
    }
  })
})
