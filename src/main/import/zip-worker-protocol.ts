import type { ZipExtractionResult } from './ZipExtractor'

/** Main → ZIP worker. One request per worker; the worker is terminated after replying. */
export type ZipWorkerRequest =
  | { op: 'isEncrypted'; zipPath: string }
  | { op: 'testPassword'; zipPath: string; password: string }
  | { op: 'extract'; zipPath: string; targetDir: string; password?: string }

/** ZIP worker → main. */
export type ZipWorkerResponse =
  | { ok: true; result: boolean | ZipExtractionResult }
  | { ok: false; error: { name: string; message: string } }
