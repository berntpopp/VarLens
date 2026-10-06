/**
 * Shared types for domain handler factories and contract unwrapping.
 *
 * Handlers return the unwrapped domain data type `T` rather than transport-specific
 * envelopes. Electron IPC wraps the result via `wrapHandler` into `IpcResult<T>`,
 * while Fastify web dispatch serializes `T` directly over HTTP.
 */

import type { SerializableError } from './errors'

export type UnwrappedResult<T> =
  T extends Promise<infer R>
    ? Promise<Exclude<R, SerializableError>>
    : Exclude<T, SerializableError>

export type DomainHandlers<Contract> = {
  [M in keyof Contract]: Contract[M] extends (...args: infer Args) => infer R
    ? (...args: Args) => UnwrappedResult<R>
    : never
}
