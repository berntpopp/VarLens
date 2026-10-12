import { afterEach, describe, expect, test, vi } from 'vitest'

import { uploadImportFiles } from '../../src/web/client/uploads'
import { WEB_UPLOAD_EVENT, type WebUploadEventDetail } from '../../src/shared/types/web-upload'

type Reply = { status: number; body: unknown }

/** XMLHttpRequest stand-in answering each upload with the next scripted reply. */
function stubXhr(replies: Reply[]): void {
  class FakeXhr {
    status = 0
    statusText = ''
    responseText = ''
    upload = {}
    withCredentials = false
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    open(): void {}
    setRequestHeader(): void {}
    abort(): void {}
    send(): void {
      const reply = replies.shift()!
      this.status = reply.status
      this.responseText = JSON.stringify(reply.body)
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 }))
  )
}

const ok = (name: string): Reply => ({
  status: 200,
  body: { ref: `web-upload:${name}`, fileName: name, size: 1 }
})
const refused: Reply = {
  status: 400,
  body: {
    error: 'unsupported-file-type',
    message: 'Only VCF, JSON, BED, GZIP, and ZIP files are supported'
  }
}
const files = (...names: string[]): File[] => names.map((name) => new File(['x'], name))

function captureEvents(): WebUploadEventDetail[] {
  const events: WebUploadEventDetail[] = []
  window.addEventListener(WEB_UPLOAD_EVENT, (event) =>
    events.push((event as CustomEvent<WebUploadEventDetail>).detail)
  )
  return events
}

afterEach(() => vi.unstubAllGlobals())

describe('uploadImportFiles', () => {
  test('skips a refused file, names it, and uploads the rest', async () => {
    stubXhr([ok('a.vcf'), refused, ok('c.vcf')])
    const events = captureEvents()

    const refs = await uploadImportFiles(files('a.vcf', 'bad.txt', 'c.vcf'))

    expect(refs.map((r) => r.fileName)).toEqual(['a.vcf', 'c.vcf'])
    expect(events.find((e) => e.status === 'skipped')?.message).toBe(
      'bad.txt: Only VCF, JSON, BED, GZIP, and ZIP files are supported'
    )
  })

  test('rejects with the server message, not the JSON envelope, when every file is refused', async () => {
    stubXhr([refused])
    await expect(uploadImportFiles(files('bad.txt'))).rejects.toThrow(
      /^bad\.txt: Only VCF, JSON, BED, GZIP, and ZIP files are supported$/
    )
  })

  test('a quota refusal still aborts the whole batch', async () => {
    stubXhr([
      ok('a.vcf'),
      {
        status: 413,
        body: { error: 'upload-quota-exceeded', message: 'Staged uploads would exceed' }
      }
    ])
    await expect(uploadImportFiles(files('a.vcf', 'b.vcf'))).rejects.toThrow(
      'b.vcf: Staged uploads would exceed'
    )
  })
})
