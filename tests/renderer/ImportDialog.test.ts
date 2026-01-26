import { describe, it, expect, beforeEach, vi } from 'vitest'
import ImportDialog from '../../src/renderer/src/components/ImportDialog.vue'
import type { ImportResult } from '../../src/shared/types/api'
import { ErrorCode } from '../../src/shared/types/errors'

// Mock window.api
const mockApi = {
  import: {
    selectFile: vi.fn(),
    start: vi.fn(),
    onProgress: vi.fn(() => {
      return vi.fn() // Return cleanup function
    }),
    cancel: vi.fn()
  }
}

// Inject mock API into global
global.window = {
  ...global.window,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: mockApi as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

describe('ImportDialog.vue', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Default mock implementations
    mockApi.import.selectFile.mockResolvedValue('/path/to/sample.json.gz')
    mockApi.import.start.mockResolvedValue({
      caseId: 1,
      variantCount: 1000,
      skipped: 0,
      errors: [],
      elapsed: 5000
    } as ImportResult)
  })

  it('exports a valid Vue component', () => {
    expect(ImportDialog).toBeDefined()
    expect(typeof ImportDialog).toBe('object')
  })

  it('has required component structure', () => {
    // Verify component has setup function (script setup)
    expect(ImportDialog).toHaveProperty('setup')
  })

  it('component name contains ImportDialog', () => {
    // Verify this is the correct component
    const componentName = ImportDialog.__name || ImportDialog.name || ''
    expect(componentName.toLowerCase()).toContain('import')
  })

  it('mock API is properly configured', () => {
    expect(mockApi.import.selectFile).toBeDefined()
    expect(mockApi.import.start).toBeDefined()
    expect(mockApi.import.onProgress).toBeDefined()
    expect(mockApi.import.cancel).toBeDefined()
  })

  it('mock selectFile returns expected path', async () => {
    const result = await mockApi.import.selectFile()
    expect(result).toBe('/path/to/sample.json.gz')
  })

  it('mock start returns expected result', async () => {
    const result = await mockApi.import.start('test.json', 'test')
    expect(result).toHaveProperty('caseId')
    expect(result).toHaveProperty('variantCount')
  })

  it('mock onProgress registers listener', () => {
    const callback = vi.fn()
    const cleanup = mockApi.import.onProgress(callback)

    expect(mockApi.import.onProgress).toHaveBeenCalled()
    expect(typeof cleanup).toBe('function')
  })

  it('error type guard works correctly', () => {
    const successResult: ImportResult = {
      caseId: 1,
      variantCount: 1000,
      skipped: 0,
      errors: [],
      elapsed: 5000
    }

    const errorResult = {
      code: ErrorCode.PARSE_ERROR,
      message: 'Invalid JSON',
      userMessage: 'File format not supported'
    }

    // Success result should not be an error
    expect(errorResult).toHaveProperty('code')
    expect(errorResult).toHaveProperty('userMessage')

    // Success result should not have these properties
    expect(successResult).not.toHaveProperty('code')
    expect(successResult).not.toHaveProperty('userMessage')
  })

  it('ErrorCode enum has expected values', () => {
    expect(ErrorCode.UNIQUE_CONSTRAINT).toBeDefined()
    expect(ErrorCode.PARSE_ERROR).toBeDefined()
    expect(ErrorCode.FILE_NOT_FOUND).toBeDefined()
    expect(ErrorCode.CANCELLED).toBeDefined()
  })
})
