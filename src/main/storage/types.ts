export type StorageBackendKind = 'sqlite' | 'postgres'

export interface StorageCapabilities {
  readonly backend: StorageBackendKind
  readonly supportsEncryptionAtRest: boolean
  readonly supportsLocalFileLifecycle: boolean
  readonly supportsHostedConnectionLifecycle: boolean
  readonly supportsWorkerReadPool: boolean
  readonly supportsFullTextSearch: boolean
}

export type WorkspaceRef =
  | {
      kind: 'sqlite'
      path: string
      name: string
      encrypted: boolean
    }
  | {
      kind: 'postgres'
      connectionLabel: string
      connectionUrlRedacted: string
      schema: string
    }

export interface StorageHealth {
  ok: boolean
  backend: StorageBackendKind
  message?: string
  roundTripMs?: number
}
