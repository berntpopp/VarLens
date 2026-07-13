import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

vi.mock('../../../../src/main/ipc/handlers/import-logic', () => ({
  startImport: vi.fn().mockResolvedValue({
    caseId: 1,
    variantCount: 0,
    skipped: 0,
    errors: [],
    elapsed: 0
  }),
  cancelImport: vi.fn(),
  getVcfPreview: vi.fn(),
  getVcfMultiPreview: vi.fn(),
  startMultiFileImport: vi.fn()
}))

vi.mock('../../../../src/main/ipc/utils/settings-io', () => ({
  loadSettings: vi.fn().mockResolvedValue({}),
  saveSettings: vi.fn().mockResolvedValue(undefined)
}))

import { dialog } from 'electron'
import { registerImportHandlers } from '../../../../src/main/ipc/handlers/import'
import {
  getVcfMultiPreview,
  getVcfPreview,
  startImport,
  startMultiFileImport
} from '../../../../src/main/ipc/handlers/import-logic'
import {
  __resetAllowlistForTests,
  addAllowedImportPath,
  isStrictlyEnrolledPath
} from '../../../../src/main/security/import-path-allowlist'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function makeIpcMain(): { handle: ReturnType<typeof vi.fn> } {
  return {
    handle: vi.fn()
  }
}

function makeDeps(ipcMain: { handle: ReturnType<typeof vi.fn> }): {
  ipcMain: typeof ipcMain
  getDb: () => unknown
  getDbManager: () => unknown
} {
  const getDb = vi.fn()
  const getDbManager = vi.fn().mockReturnValue({
    getCurrentSession: vi.fn().mockReturnValue({
      capabilities: { backend: 'sqlite' },
      getImportExecutor: vi.fn()
    })
  })
  return { ipcMain, getDb, getDbManager }
}

function getHandler(
  ipcMain: { handle: ReturnType<typeof vi.fn> },
  channel: string
): HandlerCallback {
  const call = ipcMain.handle.mock.calls.find(([c]) => c === channel) as
    [string, HandlerCallback] | undefined
  if (!call) throw new Error(`Handler for ${channel} not registered`)
  return call[1]
}

async function invokeHandler(
  ipcMain: { handle: ReturnType<typeof vi.fn> },
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const handler = getHandler(ipcMain, channel)
  return handler({}, ...args)
}

function expectInvalidParametersResult(result: unknown): void {
  expect(isIpcError(result)).toBe(true)
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  expect((result as { code: ErrorCode }).code).toBe(ErrorCode.INVALID_PARAMETERS)
}

const LEGACY_IMPORT_PATH_CHANNELS = [
  'import:start',
  'import:startMultiFile',
  'import:vcfPreview',
  'import:vcfMultiPreview'
] as const

type LegacyImportPathChannel = (typeof LEGACY_IMPORT_PATH_CHANNELS)[number]

function argsForPath(channel: LegacyImportPathChannel, filePath: string): unknown[] {
  switch (channel) {
    case 'import:start':
      return [filePath, 'Case A', undefined]
    case 'import:startMultiFile':
      return [
        'Case A',
        [{ filePath, variantType: 'SNV', caller: null, annotationFormat: null }],
        undefined,
        undefined
      ]
    case 'import:vcfPreview':
      return [filePath]
    case 'import:vcfMultiPreview':
      return [[filePath]]
  }
}

function expectPathConsumerCalled(channel: LegacyImportPathChannel): void {
  switch (channel) {
    case 'import:start':
      expect(startImport).toHaveBeenCalledOnce()
      return
    case 'import:startMultiFile':
      expect(startMultiFileImport).toHaveBeenCalledOnce()
      return
    case 'import:vcfPreview':
      expect(getVcfPreview).toHaveBeenCalledOnce()
      return
    case 'import:vcfMultiPreview':
      expect(getVcfMultiPreview).toHaveBeenCalledOnce()
  }
}

function expectNoPathConsumerCalled(): void {
  expect(startImport).not.toHaveBeenCalled()
  expect(startMultiFileImport).not.toHaveBeenCalled()
  expect(getVcfPreview).not.toHaveBeenCalled()
  expect(getVcfMultiPreview).not.toHaveBeenCalled()
}

function clearPathConsumerMocks(): void {
  vi.mocked(startImport).mockClear()
  vi.mocked(startMultiFileImport).mockClear()
  vi.mocked(getVcfPreview).mockClear()
  vi.mocked(getVcfMultiPreview).mockClear()
}

const TRUSTED_DROP_ENROLLMENT_TOKEN = 'trusted-drop-token-0123456789abcdef'

describe('import IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getVcfMultiPreview).mockResolvedValue({
      files: [],
      siblingBedFiles: [],
      suggestedCaseName: 'Case A'
    })
    __resetAllowlistForTests()
  })

  it('returns INVALID_PARAMETERS when import:start receives an empty filePath', async () => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, 'import:start', '', 'Case A', undefined)

    expectInvalidParametersResult(result)
    expect(startImport).not.toHaveBeenCalled()
  })

  it('returns INVALID_PARAMETERS when import:start receives an empty caseName', async () => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, 'import:start', '/tmp/variants.vcf', '', undefined)

    expectInvalidParametersResult(result)
    expect(startImport).not.toHaveBeenCalled()
  })

  it('returns INVALID_PARAMETERS when import:start receives an unallowed filePath', async () => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, 'import:start', '/etc/passwd', 'Case A', undefined)

    expectInvalidParametersResult(result)
    expect(startImport).not.toHaveBeenCalled()
  })

  it.each(
    LEGACY_IMPORT_PATH_CHANNELS.flatMap((channel) => [
      { channel, root: 'temp', filePath: join(tmpdir(), 'varlens-unenrolled', 'variants.vcf') },
      { channel, root: 'home', filePath: join(homedir(), 'varlens-unenrolled', 'variants.vcf') }
    ])
  )('rejects an unenrolled $root path for $channel', async ({ channel, filePath }) => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, channel, ...argsForPath(channel, filePath))

    expectInvalidParametersResult(result)
    expectNoPathConsumerCalled()
  })

  it.each(LEGACY_IMPORT_PATH_CHANNELS)(
    'accepts an explicitly enrolled path for %s',
    async (channel) => {
      const root = mkdtempSync(join(tmpdir(), 'varlens-import-authority-'))
      try {
        const filePath = join(root, 'variants.vcf')
        writeFileSync(filePath, '##fileformat=VCFv4.2\n')
        addAllowedImportPath(filePath)
        const ipcMain = makeIpcMain()
        registerImportHandlers(makeDeps(ipcMain) as never)

        const result = await invokeHandler(ipcMain, channel, ...argsForPath(channel, filePath))

        expect(isIpcError(result)).toBe(false)
        expectPathConsumerCalled(channel)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  const symlinkIt = process.platform === 'win32' ? it.skip : it
  symlinkIt.each(LEGACY_IMPORT_PATH_CHANNELS)(
    'accepts a pinned symlink and rejects it after retargeting for %s',
    async (channel) => {
      const root = mkdtempSync(join(tmpdir(), 'varlens-import-authority-'))
      try {
        const targetA = join(root, 'a.vcf')
        const targetB = join(root, 'b.vcf')
        const selectedPath = join(root, 'selected.vcf')
        writeFileSync(targetA, '##fileformat=VCFv4.2\n')
        writeFileSync(targetB, '##fileformat=VCFv4.2\n')
        symlinkSync(targetA, selectedPath)
        addAllowedImportPath(selectedPath)
        const ipcMain = makeIpcMain()
        registerImportHandlers(makeDeps(ipcMain) as never)

        const accepted = await invokeHandler(
          ipcMain,
          channel,
          ...argsForPath(channel, selectedPath)
        )
        expect(isIpcError(accepted)).toBe(false)
        expectPathConsumerCalled(channel)

        clearPathConsumerMocks()
        unlinkSync(selectedPath)
        symlinkSync(targetB, selectedPath)
        const rejected = await invokeHandler(
          ipcMain,
          channel,
          ...argsForPath(channel, selectedPath)
        )
        expectInvalidParametersResult(rejected)
        expectNoPathConsumerCalled()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  it.each(['relative.vcf', '/tmp/../etc/shadow'])(
    'returns INVALID_PARAMETERS when import:start receives non-normalized filePath %s',
    async (filePath) => {
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(ipcMain, 'import:start', filePath, 'Case A', undefined)

      expectInvalidParametersResult(result)
      expect(startImport).not.toHaveBeenCalled()
    }
  )

  it('returns INVALID_PARAMETERS when import:startMultiFile receives an unallowed filePath', async () => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, 'import:startMultiFile', 'Case A', [
      {
        filePath: '/etc/passwd',
        variantType: 'SNV',
        caller: null,
        annotationFormat: null
      }
    ])

    expectInvalidParametersResult(result)
    expect(startMultiFileImport).not.toHaveBeenCalled()
  })

  it('returns INVALID_PARAMETERS when import:startMultiFile receives an unallowed BED path', async () => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const filePath = join(tmpdir(), 'variants.vcf')
    addAllowedImportPath(filePath)
    const result = await invokeHandler(
      ipcMain,
      'import:startMultiFile',
      'Case A',
      [
        {
          filePath,
          variantType: 'SNV',
          caller: null,
          annotationFormat: null
        }
      ],
      undefined,
      { bedFile: '/etc/passwd' }
    )

    expectInvalidParametersResult(result)
    expect(startMultiFileImport).not.toHaveBeenCalled()
  })

  it.each(['relative.bed', '/tmp/../etc/shadow'])(
    'returns INVALID_PARAMETERS when import:startMultiFile receives non-normalized BED path %s',
    async (bedFile) => {
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      const filePath = join(tmpdir(), 'variants.vcf')
      addAllowedImportPath(filePath)

      const result = await invokeHandler(
        ipcMain,
        'import:startMultiFile',
        'Case A',
        [
          {
            filePath,
            variantType: 'SNV',
            caller: null,
            annotationFormat: null
          }
        ],
        undefined,
        { bedFile }
      )

      expectInvalidParametersResult(result)
      expect(startMultiFileImport).not.toHaveBeenCalled()
    }
  )

  it.each([
    join(tmpdir(), 'varlens-unenrolled', 'regions.bed'),
    join(homedir(), 'varlens-unenrolled', 'regions.bed')
  ])('rejects an unenrolled BED path regardless of its filesystem root', async (bedFile) => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)
    const filePath = join(tmpdir(), 'dialog-enrolled.vcf')
    addAllowedImportPath(filePath)

    const result = await invokeHandler(
      ipcMain,
      'import:startMultiFile',
      'Case A',
      [{ filePath, variantType: 'SNV', caller: null, annotationFormat: null }],
      undefined,
      { bedFile }
    )

    expectInvalidParametersResult(result)
    expect(startMultiFileImport).not.toHaveBeenCalled()
  })

  it('accepts an explicitly enrolled BED path for import:startMultiFile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-import-bed-authority-'))
    try {
      const filePath = join(root, 'variants.vcf')
      const bedFile = join(root, 'regions.bed')
      writeFileSync(filePath, '##fileformat=VCFv4.2\n')
      writeFileSync(bedFile, 'chr1\t0\t10\n')
      addAllowedImportPath(filePath)
      addAllowedImportPath(bedFile)
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      const result = await invokeHandler(
        ipcMain,
        'import:startMultiFile',
        'Case A',
        [{ filePath, variantType: 'SNV', caller: null, annotationFormat: null }],
        undefined,
        { bedFile }
      )

      expect(isIpcError(result)).toBe(false)
      expect(startMultiFileImport).toHaveBeenCalledOnce()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('enrolls a sibling BED discovered by trusted multi-VCF preview', async () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-sibling-bed-authority-'))
    try {
      const filePath = join(root, 'variants.vcf')
      const bedFile = join(root, 'regions.bed')
      writeFileSync(filePath, '##fileformat=VCFv4.2\n')
      writeFileSync(bedFile, 'chr1\t0\t10\n')
      addAllowedImportPath(filePath)
      vi.mocked(getVcfMultiPreview).mockResolvedValueOnce({
        files: [],
        siblingBedFiles: [bedFile],
        suggestedCaseName: 'variants',
        commonSamples: [],
        detectedGenomeBuild: null
      })
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      const preview = await invokeHandler(ipcMain, 'import:vcfMultiPreview', [filePath])
      expect(isIpcError(preview)).toBe(false)
      expect(isStrictlyEnrolledPath(bedFile)).toBe(true)

      const result = await invokeHandler(
        ipcMain,
        'import:startMultiFile',
        'Case A',
        [{ filePath, variantType: 'SNV', caller: null, annotationFormat: null }],
        undefined,
        { bedFile }
      )

      expect(isIpcError(result)).toBe(false)
      expect(startMultiFileImport).toHaveBeenCalledOnce()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not enroll a BED preview result outside the selected VCF directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-sibling-bed-authority-'))
    try {
      const selectedDir = join(root, 'selected')
      const externalDir = join(root, 'external')
      const filePath = join(selectedDir, 'variants.vcf')
      const bedFile = join(externalDir, 'regions.bed')
      mkdirSync(selectedDir)
      mkdirSync(externalDir)
      writeFileSync(filePath, '##fileformat=VCFv4.2\n')
      writeFileSync(bedFile, 'chr1\t0\t10\n')
      addAllowedImportPath(filePath)
      vi.mocked(getVcfMultiPreview).mockResolvedValueOnce({
        files: [],
        siblingBedFiles: [bedFile],
        suggestedCaseName: 'variants',
        commonSamples: [],
        detectedGenomeBuild: null
      })
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      await invokeHandler(ipcMain, 'import:vcfMultiPreview', [filePath])

      expect(isStrictlyEnrolledPath(bedFile)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not enroll a sibling BED result that no longer names a regular file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-sibling-bed-authority-'))
    try {
      const filePath = join(root, 'variants.vcf')
      const missingBed = join(root, 'removed-regions.bed')
      writeFileSync(filePath, '##fileformat=VCFv4.2\n')
      addAllowedImportPath(filePath)
      vi.mocked(getVcfMultiPreview).mockResolvedValueOnce({
        files: [],
        siblingBedFiles: [missingBed],
        suggestedCaseName: 'variants',
        commonSamples: [],
        detectedGenomeBuild: null
      })
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      await invokeHandler(ipcMain, 'import:vcfMultiPreview', [filePath])

      expect(isStrictlyEnrolledPath(missingBed)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects dropped file path enrollment without a trusted preload token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-drop-authority-'))
    try {
      const filePath = join(root, 'variants.vcf')
      writeFileSync(filePath, '##fileformat=VCFv4.2\n')
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      const enrolled = await invokeHandler(ipcMain, 'import:enrollDroppedFiles', [filePath])

      expectInvalidParametersResult(enrolled)
      expect(isStrictlyEnrolledPath(filePath)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('enrolls normalized VCF paths supplied by the trusted drop-provenance preload flow', async () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-drop-authority-'))
    try {
      const filePath = join(root, 'variants.vcf')
      writeFileSync(filePath, '##fileformat=VCFv4.2\n')
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      const registered = await invokeHandler(
        ipcMain,
        'import:registerDroppedFileEnrollmentToken',
        TRUSTED_DROP_ENROLLMENT_TOKEN
      )
      expect(isIpcError(registered)).toBe(false)

      const enrolled = await invokeHandler(ipcMain, 'import:enrollDroppedFiles', {
        token: TRUSTED_DROP_ENROLLMENT_TOKEN,
        filePaths: [filePath]
      })

      expect(enrolled).toEqual([filePath])
      expect(isStrictlyEnrolledPath(filePath)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not enroll unsupported, missing, relative, or non-normalized dropped paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-drop-authority-'))
    try {
      const unsupported = join(root, 'notes.txt')
      const missing = join(root, 'missing.vcf')
      const nonNormalized = `${root}/nested/../missing.vcf`
      writeFileSync(unsupported, 'not a VCF')
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)
      await invokeHandler(
        ipcMain,
        'import:registerDroppedFileEnrollmentToken',
        TRUSTED_DROP_ENROLLMENT_TOKEN
      )

      const enrolled = await invokeHandler(ipcMain, 'import:enrollDroppedFiles', {
        token: TRUSTED_DROP_ENROLLMENT_TOKEN,
        filePaths: [unsupported, missing, 'relative.vcf', nonNormalized]
      })

      expect(enrolled).toEqual([])
      expect(isStrictlyEnrolledPath(unsupported)).toBe(false)
      expect(isStrictlyEnrolledPath(missing)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  symlinkIt('pins an enrolled BED symlink used by import:startMultiFile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-import-bed-authority-'))
    try {
      const filePath = join(root, 'variants.vcf')
      const targetA = join(root, 'a.bed')
      const targetB = join(root, 'b.bed')
      const bedFile = join(root, 'selected.bed')
      writeFileSync(filePath, '##fileformat=VCFv4.2\n')
      writeFileSync(targetA, 'chr1\t0\t10\n')
      writeFileSync(targetB, 'chr2\t0\t10\n')
      symlinkSync(targetA, bedFile)
      addAllowedImportPath(filePath)
      addAllowedImportPath(bedFile)
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      const accepted = await invokeHandler(
        ipcMain,
        'import:startMultiFile',
        'Case A',
        [{ filePath, variantType: 'SNV', caller: null, annotationFormat: null }],
        undefined,
        { bedFile }
      )
      expect(isIpcError(accepted)).toBe(false)
      expect(startMultiFileImport).toHaveBeenCalledOnce()

      clearPathConsumerMocks()
      unlinkSync(bedFile)
      symlinkSync(targetB, bedFile)
      const rejected = await invokeHandler(
        ipcMain,
        'import:startMultiFile',
        'Case A',
        [{ filePath, variantType: 'SNV', caller: null, annotationFormat: null }],
        undefined,
        { bedFile }
      )
      expectInvalidParametersResult(rejected)
      expect(startMultiFileImport).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns INVALID_PARAMETERS when import:vcfPreview receives an unallowed filePath', async () => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, 'import:vcfPreview', '/etc/passwd')

    expectInvalidParametersResult(result)
    expect(getVcfPreview).not.toHaveBeenCalled()
  })

  it('returns INVALID_PARAMETERS when import:vcfMultiPreview receives an unallowed filePath', async () => {
    const ipcMain = makeIpcMain()
    registerImportHandlers(makeDeps(ipcMain) as never)

    const result = await invokeHandler(ipcMain, 'import:vcfMultiPreview', [
      '/tmp/variants.vcf',
      '/etc/passwd'
    ])

    expectInvalidParametersResult(result)
    expect(getVcfMultiPreview).not.toHaveBeenCalled()
  })

  it.each([
    ['import:selectFile', 'selected.vcf'],
    ['import:selectFiles', 'selected.vcf'],
    ['import:selectBedFile', 'selected.bed']
  ])('%s enrolls each explicitly selected file', async (channel, fileName) => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-import-selector-'))
    try {
      const filePath = join(root, fileName)
      writeFileSync(filePath, '')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [filePath]
      } as never)
      const ipcMain = makeIpcMain()
      registerImportHandlers(makeDeps(ipcMain) as never)

      await invokeHandler(ipcMain, channel)

      expect(isStrictlyEnrolledPath(filePath)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
