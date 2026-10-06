/**
 * Error-response shaping for the web dispatcher.
 *
 * Everything the dispatcher sends back for a failed call goes through
 * `toSerializableWebError`, which rebuilds a fresh SerializableError from
 * allow-listed, JSON-safe fields. The thrown value itself is never
 * returned, so its `stack` (and any other property a driver or library
 * hung on it — SQL text, connection info) cannot reach the browser.
 * Stacks belong in the server log, not in HTTP responses.
 *
 * The dispatcher additionally pins every response to
 * `application/json` + `nosniff` (see `applyJsonResponseHeaders`), so
 * exception text or an echoed argument can never be interpreted as HTML.
 */
import type { FastifyReply } from 'fastify'

import { ErrorCode, isIpcError, type SerializableError } from '../../shared/types/errors'
import { toSerializableError } from '../../main/ipc/serializable-error'

export const DISPATCHER_JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

const MAX_DETAIL_DEPTH = 4
const MAX_DETAIL_ENTRIES = 50
const MAX_DETAIL_STRING = 2000
const TRUNCATED = '[truncated]'
/** Keys that carry stack-trace information and are never serialised. */
const STACK_KEYS = new Set(['stack', 'stacktrace', 'stackTrace'])
const KNOWN_CODES = new Set<string>(Object.values(ErrorCode))
/** Route params echoed in a 404 body must look like an API identifier. */
const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export function applyJsonResponseHeaders(reply: FastifyReply): void {
  reply.header('content-type', DISPATCHER_JSON_CONTENT_TYPE)
  reply.header('x-content-type-options', 'nosniff')
}

/** Returns the value when it is a plain API identifier, otherwise undefined. */
export function safeIdentifier(value: string): string | undefined {
  return SAFE_IDENTIFIER.test(value) ? value : undefined
}

function clampString(value: string): string {
  return value.length > MAX_DETAIL_STRING ? `${value.slice(0, MAX_DETAIL_STRING)}…` : value
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
      return clampString(value)
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'boolean':
      return value
    case 'bigint':
      return value.toString()
    case 'object':
      break
    default:
      // undefined, function, symbol: not JSON data
      return undefined
  }
  if (depth >= MAX_DETAIL_DEPTH) return TRUNCATED
  if (value instanceof Error) {
    return { name: clampString(value.name), message: clampString(value.message) }
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DETAIL_ENTRIES)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined)
  }
  return sanitizeRecord(value as Record<string, unknown>, depth)
}

function sanitizeRecord(record: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let count = 0
  for (const key of Object.keys(record)) {
    if (STACK_KEYS.has(key)) continue
    if (count >= MAX_DETAIL_ENTRIES) break
    const clean = sanitizeValue(record[key], depth + 1)
    if (clean === undefined) continue
    out[key] = clean
    count += 1
  }
  return out
}

/**
 * JSON-safe, stack-free copy of an error's `details`. Bounded in depth,
 * width and string length; Error instances are reduced to name + message.
 */
export function sanitizeErrorDetails(details: unknown): Record<string, unknown> | undefined {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return undefined
  return sanitizeRecord(details as Record<string, unknown>, 0)
}

function textOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' ? clampString(value) : fallback
}

function fromUnknownThrowable(error: unknown): SerializableError {
  const details =
    error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
  const message =
    typeof details?.message === 'string'
      ? details.message
      : typeof details?.error === 'string'
        ? details.error
        : String(error)
  return {
    code: ErrorCode.UNKNOWN,
    message,
    userMessage: message,
    ...(details !== undefined ? { details } : {})
  }
}

/**
 * Convert anything thrown by (or returned as an error from) a dispatcher
 * handler into a freshly built SerializableError: code / message /
 * userMessage / details only, never the original object, never a stack.
 */
export function toSerializableWebError(error: unknown): SerializableError {
  const source: SerializableError = isIpcError(error)
    ? error
    : error instanceof Error
      ? toSerializableError(error)
      : fromUnknownThrowable(error)

  const code = KNOWN_CODES.has(source.code) ? source.code : ErrorCode.UNKNOWN
  const message = textOrFallback(source.message, 'Unexpected error')
  const result: SerializableError = {
    code,
    message,
    userMessage: textOrFallback(source.userMessage, message)
  }
  const details = sanitizeErrorDetails(source.details)
  if (details !== undefined && Object.keys(details).length > 0) result.details = details
  return result
}
