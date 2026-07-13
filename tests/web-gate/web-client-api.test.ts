import { afterEach, describe, expect, test, vi } from 'vitest'

import { WEB_UPLOAD_CANCEL_EVENT, WEB_UPLOAD_EVENT, createApi } from '../../src/web/client/api'

interface TestApi {
  cases: {
    list: () => Promise<unknown>
  }
  import: {
    onProgress: (callback: (progress: unknown) => void) => () => void
    selectFile: () => Promise<string | null>
    selectBedFile: () => Promise<string | null>
    enrollDroppedFiles: (files: readonly File[]) => Promise<string[]>
    cancel: () => Promise<void>
    start: (...args: unknown[]) => Promise<unknown>
  }
  export: {
    revealInFolder: (filePath: string) => Promise<{ success: boolean }>
  }
  batchImport: {
    onProgress: (callback: (progress: unknown) => void) => () => void
    onComplete: (callback: (result: unknown) => void) => () => void
    selectFiles: () => Promise<string[]>
    selectFolder: () => Promise<string[]>
    selectZip: () => Promise<unknown>
  }
  cohort: {
    onSummaryRebuilt: (callback: (status: unknown) => void) => () => void
  }
  variants: {
    onAnnotationChanged: (callback: (event: unknown) => void) => () => void
    query: (...args: unknown[]) => Promise<unknown>
  }
}

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly listeners = new Map<string, Set<EventListener>>()
  readonly url: string
  readonly init?: EventSourceInit
  close = vi.fn()

  constructor(url: string, init?: EventSourceInit) {
    this.url = url
    this.init = init
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)?.add(listener)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
    if (this.listeners.get(type)?.size === 0) this.listeners.delete(type)
  }

  emit(type: string, data: unknown): void {
    this.listeners
      .get(type)
      ?.forEach((listener) => listener({ data: JSON.stringify(data) } as MessageEvent<string>))
  }
}

function mockFetch(response: {
  ok: boolean
  status: number
  statusText: string
  body: string
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text: async () => response.body
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function ensureCustomEvent(): void {
  if (typeof globalThis.CustomEvent === 'function') return
  vi.stubGlobal(
    'CustomEvent',
    class TestCustomEvent<T = unknown> extends Event {
      readonly detail: T

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type)
        this.detail = init?.detail as T
      }
    }
  )
}

function createMockWindow(): {
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  dispatchEvent: ReturnType<typeof vi.fn>
  setTimeout: ReturnType<typeof vi.fn>
  clearTimeout: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  runPendingTimers: () => void
} {
  const listeners = new Map<string, Set<EventListener>>()
  const pendingTimers: Array<() => void> = []

  return {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener)
    }),
    dispatchEvent: vi.fn((event: Event) => {
      listeners.get(event.type)?.forEach((listener) => listener(event))
      return true
    }),
    setTimeout: vi.fn((callback: () => void) => {
      pendingTimers.push(callback)
      return pendingTimers.length
    }),
    clearTimeout: vi.fn(),
    open: vi.fn(),
    runPendingTimers: () => {
      while (pendingTimers.length > 0) {
        pendingTimers.shift()?.()
      }
    }
  }
}

type MockXhrMode = 'success' | 'http-error' | 'network-error' | 'manual'

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = []
  static mode: MockXhrMode = 'success'

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  responseText = ''
  status = 200
  statusText = 'OK'
  withCredentials = false
  method = ''
  url = ''
  body: unknown
  readonly headers = new Map<string, string>()

  constructor() {
    MockXMLHttpRequest.instances.push(this)
  }

  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value)
  }

  send(body: unknown): void {
    this.body = body
    const file = body as File
    if (MockXMLHttpRequest.mode === 'manual') return

    if (MockXMLHttpRequest.mode === 'network-error') {
      this.status = 0
      this.statusText = ''
      this.onerror?.()
      return
    }

    this.upload.onprogress?.({
      loaded: file.size,
      total: file.size,
      lengthComputable: true
    } as ProgressEvent)

    if (MockXMLHttpRequest.mode === 'http-error') {
      this.status = 413
      this.statusText = 'Payload Too Large'
      this.responseText = 'upload exceeds limit'
      this.onload?.()
      return
    }

    this.responseText = JSON.stringify({
      id: `upload-${file.name}`,
      ref: `web-upload:upload-${file.name}/${file.name}`,
      fileName: file.name,
      size: file.size
    })
    this.onload?.()
  }

  abort(): void {
    this.onabort?.()
  }
}

type MockUploadFileInput = Omit<HTMLInputElement, 'files'> & {
  files: FileList | null
  click: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  setAttribute: ReturnType<typeof vi.fn>
  runPendingTimers: () => void
}

function createFileList(files: File[]): FileList {
  return Object.assign([...files], {
    item: (index: number) => files[index] ?? null
  }) as unknown as FileList
}

function mockJsonResponse(body: unknown): {
  ok: boolean
  status: number
  statusText: string
  text: () => Promise<string>
} {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body)
  }
}

function stubUploadPicker(
  files: File[],
  options: { cancel?: boolean; focusBeforeChange?: boolean; deferTimers?: boolean } = {}
): MockUploadFileInput {
  let changeListener: EventListener | undefined
  let cancelListener: EventListener | undefined
  let focusListener: EventListener | undefined
  const mockWindow = createMockWindow()
  const input = {
    type: '',
    accept: '',
    multiple: false,
    files: createFileList([]),
    style: {},
    setAttribute: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'change') changeListener = listener
      if (type === 'cancel') cancelListener = listener
    }),
    click: vi.fn(() => {
      if (options.cancel === true) {
        cancelListener?.({} as Event)
        return
      }
      if (options.focusBeforeChange === true) focusListener?.({} as Event)
      input.files = createFileList(files)
      changeListener?.({} as Event)
    }),
    remove: vi.fn(),
    runPendingTimers: () => {
      mockWindow.runPendingTimers()
    }
  } as unknown as MockUploadFileInput

  vi.stubGlobal('document', {
    createElement: vi.fn((tagName: string) => {
      expect(tagName).toBe('input')
      return input
    }),
    body: {
      append: vi.fn()
    }
  })
  vi.stubGlobal('window', {
    ...mockWindow,
    setTimeout: vi.fn((callback: () => void) => {
      if (options.deferTimers === true) {
        return mockWindow.setTimeout(callback)
      }
      callback()
      return 0
    }),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'focus') focusListener = listener
      mockWindow.addEventListener(type, listener)
    }),
    removeEventListener: mockWindow.removeEventListener,
    dispatchEvent: mockWindow.dispatchEvent
  })
  ensureCustomEvent()
  vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest)
  return input
}

function resetMockXhr(mode: MockXhrMode = 'success'): void {
  MockXMLHttpRequest.instances = []
  MockXMLHttpRequest.mode = mode
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('web client api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    MockEventSource.instances = []
    resetMockXhr()
  })

  test('returns parsed JSON for successful RPC responses', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: JSON.stringify([{ id: 1, name: 'case-a' }])
    })

    const api = createApi() as unknown as TestApi
    await expect(api.cases.list()).resolves.toEqual([{ id: 1, name: 'case-a' }])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cases/list',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ args: [] })
      })
    )
  })

  test('returns non-2xx SerializableError JSON as the IPC result envelope', async () => {
    mockFetch({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      body: JSON.stringify({
        code: 'NOT_FOUND',
        message: 'unknown method',
        userMessage: 'Unknown API method.',
        details: { domain: 'variants', method: 'query' }
      })
    })

    const api = createApi() as unknown as TestApi
    await expect(api.variants.query(1, {}, 0, 50)).resolves.toEqual({
      code: 'NOT_FOUND',
      message: 'unknown method',
      userMessage: 'Unknown API method.',
      details: { domain: 'variants', method: 'query' }
    })
  })

  test('rejects non-2xx plain-text errors with the raw body', async () => {
    mockFetch({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: 'database offline'
    })

    const api = createApi() as unknown as TestApi
    await expect(api.cases.list()).rejects.toThrow(
      'web rpc cases.list: 503 Service Unavailable: database offline'
    )
  })

  test('bridges import progress subscriptions through server-sent events', () => {
    vi.stubGlobal('EventSource', MockEventSource)
    const api = createApi() as unknown as TestApi
    const onProgress = vi.fn()

    const unsubscribe = api.import.onProgress(onProgress)
    MockEventSource.instances[0].emit('import:progress', { phase: 'parsing', count: 5 })
    unsubscribe()

    expect(MockEventSource.instances[0].url).toBe('/api/events')
    expect(MockEventSource.instances[0].init).toEqual({ withCredentials: true })
    expect(onProgress).toHaveBeenCalledWith({ phase: 'parsing', count: 5 })
    expect(MockEventSource.instances[0].close).toHaveBeenCalledOnce()
  })

  test('bridges batch import progress and complete subscriptions through server-sent events', () => {
    vi.stubGlobal('EventSource', MockEventSource)
    const api = createApi() as unknown as TestApi
    const onProgress = vi.fn()
    const onComplete = vi.fn()

    const unsubscribeProgress = api.batchImport.onProgress(onProgress)
    const unsubscribeComplete = api.batchImport.onComplete(onComplete)
    MockEventSource.instances[0].emit('batch-import:progress', { currentIndex: 0 })
    MockEventSource.instances[0].emit('batch-import:complete', { succeeded: 1 })
    unsubscribeProgress()
    expect(MockEventSource.instances[0].close).not.toHaveBeenCalled()
    unsubscribeComplete()

    expect(MockEventSource.instances).toHaveLength(1)
    expect(onProgress).toHaveBeenCalledWith({ currentIndex: 0 })
    expect(onComplete).toHaveBeenCalledWith({ succeeded: 1 })
    expect(MockEventSource.instances[0].close).toHaveBeenCalledOnce()
  })

  test('bridges variant annotation and cohort summary subscriptions through server-sent events', () => {
    vi.stubGlobal('EventSource', MockEventSource)
    const api = createApi() as unknown as TestApi
    const onAnnotationChanged = vi.fn()
    const onSummaryRebuilt = vi.fn()

    const unsubscribeAnnotation = api.variants.onAnnotationChanged(onAnnotationChanged)
    const unsubscribeSummary = api.cohort.onSummaryRebuilt(onSummaryRebuilt)
    expect(MockEventSource.instances).toHaveLength(1)
    MockEventSource.instances[0].emit('variants:annotationChanged', {
      caseId: 1,
      variantId: 2,
      kind: 'star'
    })
    MockEventSource.instances[0].emit('cohort:summaryRebuilt', { is_stale: false })
    unsubscribeAnnotation()
    expect(MockEventSource.instances[0].close).not.toHaveBeenCalled()
    unsubscribeSummary()

    expect(onAnnotationChanged).toHaveBeenCalledWith({
      caseId: 1,
      variantId: 2,
      kind: 'star'
    })
    expect(onSummaryRebuilt).toHaveBeenCalledWith({ is_stale: false })
    expect(MockEventSource.instances[0].close).toHaveBeenCalledOnce()
  })

  test('keeps import RPC methods available beside the progress subscription override', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: JSON.stringify({ caseId: 1 })
    })

    const api = createApi() as unknown as TestApi
    await expect(api.import.start('/tmp/input.vcf', 'Case A')).resolves.toEqual({ caseId: 1 })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/import/start',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ args: ['/tmp/input.vcf', 'Case A'] })
      })
    )
  })

  test('import.selectFile opens a browser picker and returns a desktop-compatible upload ref', async () => {
    const file = new File(['##fileformat=VCFv4.2'], 'case-a.vcf')
    resetMockXhr()
    const input = stubUploadPicker([file])

    const api = createApi() as unknown as TestApi
    await expect(api.import.selectFile()).resolves.toBe('web-upload:upload-case-a.vcf/case-a.vcf')

    expect(input.type).toBe('file')
    expect(input.accept).toBe('.vcf,.vcf.gz,.json,.json.gz,.gz')
    expect(input.multiple).toBe(false)
    expect(input.remove).toHaveBeenCalledOnce()
    expect(MockXMLHttpRequest.instances).toHaveLength(1)
    const xhr = MockXMLHttpRequest.instances[0]
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/import/upload')
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.headers.get('content-type')).toBe('application/octet-stream')
    expect(xhr.headers.get('x-varlens-file-name')).toBe('case-a.vcf')
    expect(xhr.body).toBe(file)
  })

  test('import.selectFile returns null when the picker is cancelled', async () => {
    const input = stubUploadPicker([], { cancel: true })

    const api = createApi() as unknown as TestApi
    await expect(api.import.selectFile()).resolves.toBeNull()

    expect(input.remove).toHaveBeenCalledOnce()
    expect(MockXMLHttpRequest.instances).toHaveLength(0)
  })

  test('import.selectFile keeps early focus from cancelling before file change arrives', async () => {
    const file = new File(['##fileformat=VCFv4.2'], 'manual.vcf')
    resetMockXhr()
    const input = stubUploadPicker([file], { focusBeforeChange: true, deferTimers: true })

    const api = createApi() as unknown as TestApi
    await expect(api.import.selectFile()).resolves.toBe('web-upload:upload-manual.vcf/manual.vcf')

    expect(input.remove).toHaveBeenCalledOnce()
    expect(MockXMLHttpRequest.instances).toHaveLength(1)

    input.runPendingTimers()
    expect(MockXMLHttpRequest.instances).toHaveLength(1)
  })

  test('import.selectBedFile uses the same picker/upload seam for BED files', async () => {
    const file = new File(['chr1\t1\t100'], 'panel.bed')
    const input = stubUploadPicker([file])

    const api = createApi() as unknown as TestApi
    await expect(api.import.selectBedFile()).resolves.toBe('web-upload:upload-panel.bed/panel.bed')

    expect(input.accept).toBe('.bed,.bed.gz,.gz')
    expect(input.multiple).toBe(false)
  })

  test('import.enrollDroppedFiles uploads the exact dropped Files and returns user-scoped refs', async () => {
    const first = new File(['##fileformat=VCFv4.2\n'], 'case-a.vcf')
    const second = new File(['compressed'], 'case-b.vcf.gz')
    resetMockXhr()
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest)

    const api = createApi() as unknown as TestApi
    await expect(api.import.enrollDroppedFiles([first, second])).resolves.toEqual([
      'web-upload:upload-case-a.vcf/case-a.vcf',
      'web-upload:upload-case-b.vcf.gz/case-b.vcf.gz'
    ])

    expect(MockXMLHttpRequest.instances).toHaveLength(2)
  })

  test('export.revealInFolder is an explicit unsupported web capability', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, statusText: 'OK', body: '{}' })
    const api = createApi() as unknown as TestApi

    await expect(api.export.revealInFolder('/server/export.xlsx')).resolves.toEqual({
      success: false
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('batchImport.selectFolder enables directory picking and uploads all selected files', async () => {
    const first = new File(['{}'], 'case-a.json')
    const second = new File(['{}'], 'case-b.json')
    const input = stubUploadPicker([first, second])

    const api = createApi() as unknown as TestApi
    await expect(api.batchImport.selectFolder()).resolves.toEqual([
      'web-upload:upload-case-a.json/case-a.json',
      'web-upload:upload-case-b.json/case-b.json'
    ])

    expect(input.multiple).toBe(true)
    expect(input.setAttribute).toHaveBeenCalledWith('webkitdirectory', '')
    expect(MockXMLHttpRequest.instances).toHaveLength(2)
  })

  test('batchImport.selectZip returns the upload ref plus encrypted-state probe result', async () => {
    const zip = new File(['PK'], 'batch.zip')
    stubUploadPicker([zip])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/batch-import/testZipPassword')
      expect(init?.body).toBe(
        JSON.stringify({ args: ['web-upload:upload-batch.zip/batch.zip', ''] })
      )
      return mockJsonResponse({ success: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    const api = createApi() as unknown as TestApi
    await expect(api.batchImport.selectZip()).resolves.toEqual({
      filePath: 'web-upload:upload-batch.zip/batch.zip',
      isEncrypted: true
    })
  })

  test('upload helper emits progress and complete states', async () => {
    const file = new File(['{}'], 'case-progress.json')
    stubUploadPicker([file])
    const uploadEvents: unknown[] = []
    window.addEventListener(WEB_UPLOAD_EVENT, (event) => {
      uploadEvents.push((event as CustomEvent).detail)
    })

    const api = createApi() as unknown as TestApi
    await expect(api.import.selectFile()).resolves.toBe(
      'web-upload:upload-case-progress.json/case-progress.json'
    )

    expect(uploadEvents).toEqual([
      expect.objectContaining({
        status: 'started',
        fileName: 'case-progress.json',
        fileIndex: 0,
        totalFiles: 1,
        loadedBytes: 0,
        percent: 0
      }),
      expect.objectContaining({
        status: 'progress',
        fileName: 'case-progress.json',
        loadedBytes: file.size,
        percent: 100
      }),
      expect.objectContaining({
        status: 'complete',
        fileName: 'case-progress.json',
        loadedBytes: file.size,
        percent: 100
      })
    ])
  })

  test('upload helper emits error state for server-side upload rejection', async () => {
    resetMockXhr('http-error')
    const file = new File(['too-large'], 'too-large.vcf')
    stubUploadPicker([file])
    const uploadEvents: unknown[] = []
    window.addEventListener(WEB_UPLOAD_EVENT, (event) => {
      uploadEvents.push((event as CustomEvent).detail)
    })

    const api = createApi() as unknown as TestApi
    await expect(api.import.selectFile()).rejects.toThrow(
      'web upload: 413 Payload Too Large: upload exceeds limit'
    )

    expect(uploadEvents).toContainEqual(
      expect.objectContaining({
        status: 'error',
        fileName: 'too-large.vcf',
        message: 'web upload: 413 Payload Too Large: upload exceeds limit'
      })
    )
  })

  test('upload helper aborts the active upload through the cancel event', async () => {
    resetMockXhr('manual')
    const file = new File(['pending'], 'pending.vcf')
    stubUploadPicker([file])
    const uploadEvents: unknown[] = []
    window.addEventListener(WEB_UPLOAD_EVENT, (event) => {
      uploadEvents.push((event as CustomEvent).detail)
    })

    const api = createApi() as unknown as TestApi
    const selection = api.import.selectFile()
    await flushPromises()
    expect(MockXMLHttpRequest.instances).toHaveLength(1)
    window.dispatchEvent(new CustomEvent(WEB_UPLOAD_CANCEL_EVENT))

    await expect(selection).rejects.toThrow('Upload cancelled')
    expect(uploadEvents).toContainEqual(
      expect.objectContaining({
        status: 'aborted',
        fileName: 'pending.vcf',
        message: 'Upload cancelled'
      })
    )
  })
})
