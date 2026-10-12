import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  callTool,
  GenefoundryToolError,
  parseRpcBody
} from '../../../../scripts/shortlist-sim/annotate/genefoundry'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const fast = { baseDelayMs: 1 }

afterEach(() => vi.unstubAllGlobals())

describe('callTool', () => {
  it('retries a 502 and returns structuredContent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(ok({ jsonrpc: '2.0', id: 2, result: { structuredContent: { a: 1 } } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callTool('vep-link', 'x', {}, fast)).resolves.toEqual({ a: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://vep-link.genefoundry.org/mcp')
    expect(JSON.parse(init.body as string)).toMatchObject({
      method: 'tools/call',
      params: { name: 'x' }
    })
  })

  it('raises a JSON-RPC error with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          ok({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad args' } })
        )
    )
    await expect(callTool('vep-link', 'x', {}, fast)).rejects.toThrow('bad args')
  })

  it('parses content[0].text when structuredContent is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          ok({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"b":2}' }] } })
        )
    )
    await expect(callTool('gnomad-link', 'x', {}, fast)).resolves.toEqual({ b: 2 })
  })

  it('surfaces a non-retryable tool failure (e.g. not_found) without retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        ok({
          jsonrpc: '2.0',
          id: 1,
          result: {
            structuredContent: { success: false, error_code: 'not_found', retryable: false }
          }
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    const err = await callTool('gnomad-link', 'x', {}, fast).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GenefoundryToolError)
    expect((err as GenefoundryToolError).code).toBe('not_found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callTool('vep-link', 'x', {}, { ...fast, retries: 2 })).rejects.toThrow('HTTP 503')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('parseRpcBody', () => {
  it('reads an SSE body', () => {
    expect(parseRpcBody('event: message\ndata: {"id":1}\n\n')).toEqual({ id: 1 })
  })
})
