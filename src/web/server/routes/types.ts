import type { FastifyReply, FastifyRequest } from 'fastify'

import type { StorageSession } from '../../../main/storage/session'
import type { PostgresWebAuthService } from '../../auth/PostgresWebAuthService'
import type { WebEventHub } from '../events'

export interface DispatcherDeps {
  session: StorageSession
  authService: PostgresWebAuthService
  events: WebEventHub
  resolveSession?: (request: FastifyRequest) => Promise<StorageSession>
}

export interface InvokeBodyPayload {
  args?: unknown[]
}

export type InvokeBody = InvokeBodyPayload | null | undefined

export interface OverrideHandler {
  /** True = bypasses the auth preHandler (e.g. login). Default: false. */
  public?: boolean
  /** Receives raw args array + request + deps; returns the value to JSON-encode. */
  handle: (
    args: unknown[],
    request: FastifyRequest,
    reply: FastifyReply,
    deps: DispatcherDeps
  ) => Promise<unknown> | unknown
}
