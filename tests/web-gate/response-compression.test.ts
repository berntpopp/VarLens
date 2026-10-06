import { describe, expect, test } from 'vitest'
import fastify from 'fastify'
import { Readable } from 'node:stream'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { registerResponseCompression } from '../../src/web/server/compression'

const LARGE = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, gene: 'BRCA1' })) }

async function buildApp() {
  const app = fastify()
  registerResponseCompression(app)
  app.get('/api/large', async () => LARGE)
  app.get('/api/small', async () => ({ ok: true }))
  app.get('/api/stream', async (_request, reply) => {
    reply.type('text/plain')
    return reply.send(Readable.from(['x'.repeat(4096)]))
  })
  app.get('/api/png', async (_request, reply) => {
    reply.type('image/png')
    return reply.send(Buffer.alloc(4096, 1))
  })
  return app
}

describe('web JSON response compression', () => {
  test('brotli-compresses JSON responses above the threshold when accepted', async () => {
    const app = await buildApp()
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/large',
        headers: { 'accept-encoding': 'gzip, deflate, br' }
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-encoding']).toBe('br')
      expect(String(response.headers.vary)).toMatch(/accept-encoding/i)
      expect(response.rawPayload.length).toBeLessThan(JSON.stringify(LARGE).length)
      expect(JSON.parse(brotliDecompressSync(response.rawPayload).toString())).toEqual(LARGE)
    } finally {
      await app.close()
    }
  })

  test('uses gzip when brotli is not accepted', async () => {
    const app = await buildApp()
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/large',
        headers: { 'accept-encoding': 'gzip' }
      })
      expect(response.headers['content-encoding']).toBe('gzip')
      expect(JSON.parse(gunzipSync(response.rawPayload).toString())).toEqual(LARGE)
    } finally {
      await app.close()
    }
  })

  test('honours q=0 and missing Accept-Encoding', async () => {
    const app = await buildApp()
    try {
      const rejected = await app.inject({
        method: 'GET',
        url: '/api/large',
        headers: { 'accept-encoding': 'br;q=0, gzip;q=0' }
      })
      expect(rejected.headers['content-encoding']).toBeUndefined()
      expect(rejected.json()).toEqual(LARGE)

      const none = await app.inject({ method: 'GET', url: '/api/large' })
      expect(none.headers['content-encoding']).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  test('leaves small payloads, streams, and binary types untouched', async () => {
    const app = await buildApp()
    try {
      for (const url of ['/api/small', '/api/stream', '/api/png']) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: { 'accept-encoding': 'br, gzip' }
        })
        expect(response.statusCode, url).toBe(200)
        expect(response.headers['content-encoding'], url).toBeUndefined()
      }
    } finally {
      await app.close()
    }
  })
})
