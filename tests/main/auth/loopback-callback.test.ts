import { describe, it, expect } from 'vitest'
import { connect } from 'net'
import { openLoopbackListener } from '../../../src/main/auth/loopback-callback'

function rawRequest(port: number, requestLine: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`${requestLine}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
    })
    let answer = ''
    socket.on('data', (chunk) => (answer += chunk.toString()))
    socket.on('end', () => resolve(answer))
    socket.on('error', reject)
  })
}

describe('loopback callback listener', () => {
  it('listens on 127.0.0.1 only and answers a malformed request with 400', async () => {
    const listener = await openLoopbackListener('the-state', 5_000)
    try {
      expect(listener.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
      const port = Number(new URL(listener.redirectUri).port)
      const answer = await rawRequest(port, 'GET http://[ HTTP/1.1')
      expect(answer).toMatch(/^HTTP\/1\.1 400/)
      expect(answer).toContain('Bad request.')
      const other = await fetch(`http://127.0.0.1:${port}/elsewhere`)
      expect(other.status).toBe(404)
      const forged = await fetch(`${listener.redirectUri}?code=x&state=forged`)
      expect(forged.status).toBe(400)
      expect(await forged.text()).not.toContain('forged')
      const good = await fetch(`${listener.redirectUri}?code=the-code&state=the-state`)
      expect(good.headers.get('cache-control')).toBe('no-store')
      expect(good.headers.get('content-security-policy')).toContain("default-src 'none'")
      await expect(listener.result).resolves.toEqual({ code: 'the-code' })
    } finally {
      listener.close()
    }
  })

  it('rejects on timeout and on close', async () => {
    const timed = await openLoopbackListener('s', 50)
    await expect(timed.result).rejects.toThrow(/timed out/)
    const closed = await openLoopbackListener('s', 5_000)
    closed.close()
    await expect(closed.result).rejects.toThrow('cancelled')
  })
})
