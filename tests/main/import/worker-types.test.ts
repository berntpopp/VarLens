import { describe, it, expectTypeOf } from 'vitest'
import type {
  WorkerMessage,
  MainMessage,
  VariantInsertRow,
  TranscriptInsertRow
} from '../../../src/shared/types/import-worker'

describe('import worker types', () => {
  it('WorkerMessage progress variant has required fields', () => {
    expectTypeOf<Extract<WorkerMessage, { type: 'progress' }>>().toMatchTypeOf<{
      type: 'progress'
      fileIndex: number
      totalFiles: number
      fileName: string
      overallPercent: number
      phase: string
      variantCount: number
      skipped: number
    }>()
  })

  it('WorkerMessage file-complete carries bounded skip diagnostics', () => {
    expectTypeOf<Extract<WorkerMessage, { type: 'file-complete' }>['result']>().toMatchTypeOf<{
      skipped: number
      skipReasons: string[]
    }>()
  })

  it('MainMessage start variant has required fields', () => {
    expectTypeOf<Extract<MainMessage, { type: 'start' }>>().toMatchTypeOf<{
      type: 'start'
      files: Array<{
        filePath: string
        caseName: string
        isDuplicate: boolean
        duplicateStrategy: 'skip' | 'overwrite'
      }>
      dbPath: string
      throttleMs: number
    }>()
  })

  it('VariantInsertRow has core variant columns', () => {
    expectTypeOf<VariantInsertRow>().toMatchTypeOf<{
      chr: string
      pos: number
      ref: string
      alt: string
    }>()
  })

  it('TranscriptInsertRow has required fields', () => {
    expectTypeOf<TranscriptInsertRow>().toMatchTypeOf<{
      transcript_id: string
      gene_symbol: string | null
      is_selected: number
    }>()
  })
})
