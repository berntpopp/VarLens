import { afterEach, describe, expect, test, vi } from 'vitest'

import { uploadImportFiles } from '../../src/web/client/uploads'
import { WEB_UPLOAD_EVENT, type WebUploadEventDetail } from '../../src/shared/types/web-upload'
import { UPLOAD_CONFIG } from '../../src/shared/config/upload.config'

type Reply = { status: number; body: unknown }

/** XMLHttpRequest stand-in answering each upload with the next scripted reply. */
function stubXhr(replies: Reply[], sent: string[] = []): void {
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
    setRequestHeader(name: string, value: string): void {
      if (name === 'x-varlens-file-name') sent.push(value)
    }
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
    expect(events.filter((e) => e.status === 'skipped').map((e) => e.message)).toEqual([
      '1 file skipped: bad.txt: Only VCF, JSON, BED, GZIP, and ZIP files are supported'
    ])
  })

  test('a folder pick never uploads files of other types, and one line sums up the skips', async () => {
    const sent: string[] = []
    stubXhr([ok('a.vcf.gz'), ok('b.vcf.gz')], sent)
    const events = captureEvents()
    const names = [
      'a.vcf.gz',
      'a.vcf.gz.tbi',
      'b.vcf.gz',
      'b.vcf.gz.tbi',
      'notes.txt',
      'c.csi',
      'd.bam'
    ]

    const refs = await uploadImportFiles(files(...names), '.vcf,.vcf.gz,.json,.json.gz,.gz')

    expect(refs).toHaveLength(2)
    expect(sent).toHaveLength(2)
    const reason = UPLOAD_CONFIG.NOT_ACCEPTED_REASON
    expect(events.filter((e) => e.status === 'skipped').map((e) => e.message)).toEqual([
      `5 files skipped: a.vcf.gz.tbi: ${reason}; b.vcf.gz.tbi: ${reason}; notes.txt: ${reason}; and 2 more`
    ])
  })

  test('rejects with the server message, not the JSON envelope, when every file is refused', async () => {
    stubXhr([refused])
    await expect(uploadImportFiles(files('bad.txt'))).rejects.toThrow(
      /^1 file skipped: bad\.txt: Only VCF, JSON, BED, GZIP, and ZIP files are supported$/
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
