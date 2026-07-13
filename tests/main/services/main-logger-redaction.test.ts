import Module from 'node:module'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// MainLogger.ts uses guarded CommonJS require() so worker-thread imports don't
// load Electron. Patch Node's loader directly for this test boundary.
const mockWebContentsSend = vi.fn()
const mockGetAllWindows = vi.fn(() => [
  { isDestroyed: () => false, webContents: { send: mockWebContentsSend } }
])
const mockFileLog = {
  initialize: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  transports: {
    file: {
      level: '',
      maxSize: 0,
      format: '',
      getFile: () => ({ path: '/tmp/varlens-test.log' })
    },
    console: { level: '' }
  }
}

const originalLoad = Module._load

describe('MainLogger PHI redaction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(Module, '_load').mockImplementation((request, parent, isMain) => {
      if (request === 'electron') {
        return { BrowserWindow: { getAllWindows: mockGetAllWindows } }
      }
      if (request === 'electron-log/main') {
        return mockFileLog
      }
      return originalLoad(request, parent, isMain)
    })
    mockFileLog.initialize.mockReset()
    mockFileLog.error.mockReset()
    mockFileLog.info.mockReset()
    mockWebContentsSend.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('redacts HGVS, coords, and patient IDs from the file-write path', async () => {
    const { mainLogger } = await import('../../../src/main/services/MainLogger')
    mainLogger.error('variant chr1:12345 c.123A>G failed for PATIENT-001', 'import')

    expect(mockFileLog.error).toHaveBeenCalledOnce()
    const writtenLine = mockFileLog.error.mock.calls[0][0] as string
    expect(writtenLine).toContain('[REDACTED:COORD]')
    expect(writtenLine).toContain('[REDACTED:HGVS]')
    expect(writtenLine).toContain('[REDACTED:ID]')
    expect(writtenLine).not.toContain('chr1:12345')
    expect(writtenLine).not.toContain('c.123A>G')
    expect(writtenLine).not.toContain('PATIENT-001')
  })

  it('redacts the webContents.send payload too', async () => {
    const { mainLogger } = await import('../../../src/main/services/MainLogger')
    mainLogger.error('variant chr1:12345 c.123A>G failed for PATIENT-001', 'import')

    expect(mockWebContentsSend).toHaveBeenCalledOnce()
    const [channel, payload] = mockWebContentsSend.mock.calls[0]
    expect(channel).toBe('logs:message')
    expect(payload.message).toContain('[REDACTED:COORD]')
    expect(payload.message).toContain('[REDACTED:HGVS]')
    expect(payload.message).toContain('[REDACTED:ID]')
    expect(payload.message).not.toContain('chr1:12345')
    expect(payload.message).not.toContain('c.123A>G')
    expect(payload.message).not.toContain('PATIENT-001')
  })

  it('redacts a colon-form credential from the file and IPC paths', async () => {
    const { mainLogger } = await import('../../../src/main/services/MainLogger')
    mainLogger.error('password: hunter2', 'database')

    const writtenLine = mockFileLog.error.mock.calls[0][0] as string
    expect(writtenLine).toContain('[REDACTED:KEY]')
    expect(writtenLine).not.toContain('hunter2')

    const [, payload] = mockWebContentsSend.mock.calls[0]
    expect(payload.message).toContain('[REDACTED:KEY]')
    expect(payload.message).not.toContain('hunter2')
  })

  it('does not redact a benign control message', async () => {
    const { mainLogger } = await import('../../../src/main/services/MainLogger')
    mainLogger.info('startup complete in 1.42s', 'main')

    const writtenLine = mockFileLog.info.mock.calls[0][0] as string
    expect(writtenLine).toContain('startup complete in 1.42s')
    expect(writtenLine).not.toContain('[REDACTED:')
  })
})
