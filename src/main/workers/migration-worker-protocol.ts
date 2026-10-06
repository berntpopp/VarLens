/** Main → migration worker. */
export interface MigrationWorkerRequest {
  dbPath: string
  encryptionKey?: string
}

/** Migration worker → main. */
export type MigrationWorkerResponse =
  | { type: 'done'; fromVersion: number; toVersion: number; elapsedMs: number }
  | { type: 'error'; error: string }
