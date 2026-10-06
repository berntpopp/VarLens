/**
 * Session-safe SSE (`GET /api/events`, PR-W6): event ids + Last-Event-ID
 * replay, heartbeat, revalidation and close-on-revoke, over a real socket
 * (inject() cannot observe a hijacked streaming response).
 */
import { get, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, test } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'

import { registerEventStream, WebEventHub } from '../../src/web/server/events'

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

interface Harness {
  hub: WebEventHub
  valid: { current: boolean }
  open: (headers?: Record<string, string>) => Promise<Stream>
}

interface Stream {
  res: IncomingMessage
  text: () => string
  waitFor: (pattern: RegExp) => Promise<void>
  ended: Promise<void>
}

async function harness(heartbeatMs = 1000): Promise<Harness> {
  const hub = new WebEventHub()
  const valid = { current: true }
  app = fastify()
  app.addHook('onRequest', async (request) => {
    const user = request.headers['x-test-user']
    request.session = (
      user === undefined
        ? {}
        : { user: { id: Number(user), username: `u${user}`, role: 'user' }, sid: `sid-${user}` }
    ) as never
  })
  registerEventStream(app, hub, {
    heartbeatMs,
    revalidate: async () => (valid.current ? { role: 'user' } : undefined)
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address() as AddressInfo

  const open = (headers: Record<string, string> = {}): Promise<Stream> =>
    new Promise((resolve, reject) => {
      const req = get({ host: '127.0.0.1', port, path: '/api/events', headers }, (res) => {
        let buffer = ''
        const waiters: Array<{ pattern: RegExp; done: () => void }> = []
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          buffer += chunk
          for (const waiter of [...waiters]) {
            if (waiter.pattern.test(buffer)) {
              waiters.splice(waiters.indexOf(waiter), 1)
              waiter.done()
            }
          }
        })
        const ended = new Promise<void>((done) => res.on('end', () => done()))
        resolve({
          res,
          text: () => buffer,
          ended,
          waitFor: (pattern) =>
            pattern.test(buffer)
              ? Promise.resolve()
              : new Promise((done) => waiters.push({ pattern, done }))
        })
      })
      req.on('error', reject)
    })
  return { hub, valid, open }
}

describe('GET /api/events', () => {
  test('rejects an unauthenticated stream', async () => {
    const { open } = await harness()
    const stream = await open()
    expect(stream.res.statusCode).toBe(401)
  })

  test('sends ids and replays missed events for the same user after Last-Event-ID', async () => {
    const { hub, open } = await harness()
    const first = await open({ 'x-test-user': '1' })
    await first.waitFor(/: connected/)
    hub.publish(1, 'jobs:changed', { n: 1 })
    await first.waitFor(/"n":1/)
    const id = /id: (\S+)\nevent: jobs:changed/.exec(first.text())?.[1]
    expect(id).toBe(`${hub.bootId}.1`)
    first.res.destroy()

    hub.publish(1, 'jobs:changed', { n: 2 })
    hub.publish(2, 'jobs:changed', { n: 99 })
    const resumed = await open({ 'x-test-user': '1', 'last-event-id': id! })
    await resumed.waitFor(/"n":2/)
    expect(resumed.text()).not.toContain('"n":99')
    expect(resumed.text()).not.toContain('"n":1}')
    resumed.res.destroy()
  })

  test('asks the client to resync when the gap cannot be replayed', async () => {
    const { open } = await harness()
    const stream = await open({ 'x-test-user': '1', 'last-event-id': 'previous-boot.7' })
    await stream.waitFor(/event: events:resync/)
    stream.res.destroy()
  })

  test('heartbeats, and closes the stream once the session is no longer valid', async () => {
    const { valid, open } = await harness(50)
    const stream = await open({ 'x-test-user': '1' })
    await stream.waitFor(/: heartbeat \d+/)
    valid.current = false
    await stream.ended
    expect(stream.text()).toContain('event: session:revoked')
  })

  test('logout of one browser session closes only that session’s stream', async () => {
    const { hub, open } = await harness()
    const mine = await open({ 'x-test-user': '1' })
    const other = await open({ 'x-test-user': '2' })
    await mine.waitFor(/: connected/)
    await other.waitFor(/: connected/)

    hub.closeSession('sid-1')
    await mine.ended
    expect(mine.text()).toContain('event: session:revoked')
    expect(hub.subscriberCount()).toBe(1)
    other.res.destroy()
  })
})
