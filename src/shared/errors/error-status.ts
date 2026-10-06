import { ErrorCode } from '../types/errors'

/**
 * The single ErrorCode → HTTP status table (desktop/web parity spec §4.4).
 *
 * The web dispatcher uses it whenever a handler throws, so a unique-name
 * clash is a 409 on every route instead of a generic 500. Desktop IPC has no
 * status line; the same codes travel inside the `IpcResult` envelope.
 *
 * `CANCELLED` is 409 rather than nginx's non-standard 499 so proxies and the
 * browser treat it as an ordinary client-visible conflict with the job state.
 */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  [ErrorCode.VALIDATION]: 400,
  [ErrorCode.INVALID_PARAMETERS]: 400,
  [ErrorCode.PARSE_ERROR]: 400,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.WRONG_PASSWORD]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.FILE_NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.UNIQUE_CONSTRAINT]: 409,
  [ErrorCode.CANCELLED]: 409,
  [ErrorCode.RESOURCE_LIMIT]: 413,
  [ErrorCode.UNSUPPORTED_RUNTIME]: 501,
  [ErrorCode.UNAVAILABLE_UPSTREAM]: 502,
  [ErrorCode.DB_ERROR]: 500,
  [ErrorCode.INTERNAL]: 500,
  [ErrorCode.UNKNOWN]: 500
}

/** HTTP status for an error code; unknown strings fall back to 500. */
export function httpStatusForErrorCode(code: string): number {
  return (ERROR_HTTP_STATUS as Record<string, number | undefined>)[code] ?? 500
}
