import { ipcRenderer, webUtils } from 'electron'
import type { ImportDomainContract } from '../../shared/ipc/domains/import'

const droppedFileEnrollmentToken = createDroppedFileEnrollmentToken()
let droppedFileEnrollmentTokenRegistration: Promise<unknown> | null = null

function createDroppedFileEnrollmentToken(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(32)
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('Secure dropped-file enrollment is unavailable')
}

async function ensureDroppedFileEnrollmentTokenRegistered(): Promise<void> {
  droppedFileEnrollmentTokenRegistration ??= ipcRenderer.invoke(
    'import:registerDroppedFileEnrollmentToken',
    droppedFileEnrollmentToken
  )
  await droppedFileEnrollmentTokenRegistration
}

export function createImportApi(): ImportDomainContract {
  return {
    selectFile: () => ipcRenderer.invoke('import:selectFile'),
    selectFiles: () => ipcRenderer.invoke('import:selectFiles'),
    selectBedFile: () => ipcRenderer.invoke('import:selectBedFile'),
    enrollDroppedFiles: async (files) => {
      const paths: string[] = []
      if (Array.isArray(files)) {
        for (const file of files.slice(0, 1000)) {
          try {
            const filePath = webUtils.getPathForFile(file)
            if (filePath !== '') paths.push(filePath)
          } catch {
            // Constructed values and renderer strings have no native-file
            // provenance and therefore grant no path authority.
          }
        }
      }
      await ensureDroppedFileEnrollmentTokenRegistered()
      return ipcRenderer.invoke('import:enrollDroppedFiles', {
        token: droppedFileEnrollmentToken,
        filePaths: paths
      })
    },
    start: (filePath, caseName, vcfOptions) =>
      ipcRenderer.invoke('import:start', filePath, caseName, vcfOptions),
    startMultiFile: (caseName, files, vcfOptions, filters) =>
      ipcRenderer.invoke('import:startMultiFile', caseName, files, vcfOptions, filters),
    vcfPreview: (filePath) => ipcRenderer.invoke('import:vcfPreview', filePath),
    vcfMultiPreview: (filePaths) => ipcRenderer.invoke('import:vcfMultiPreview', filePaths),
    cancel: () => ipcRenderer.invoke('import:cancel')
  }
}
