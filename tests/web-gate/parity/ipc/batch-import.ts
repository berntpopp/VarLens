import { basenames, zipBatchPath, type IpcScenario } from './shared'

export const batchImportScenario: IpcScenario = {
  area: 'batch-import',
  run: async (ctx) => {
    const extracted = await ctx.call<{
      files: string[]
      errors: string[]
      extractionId: string
    }>('batchImport', 'extractZip', [zipBatchPath()])
    await ctx.call('batchImport', 'cleanupZipTemp', [extracted.extractionId])
    return [{ errors: extracted.errors, files: basenames(extracted.files) }]
  }
}
