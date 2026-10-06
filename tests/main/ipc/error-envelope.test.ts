import { describe, expect, it } from 'vitest'

import { UniqueConstraintError } from '../../../src/main/database/errors'
import { decodeWorkerError, encodeWorkerError } from '../../../src/main/database/worker-error-codec'
import { AppError, ConflictError, ForbiddenError } from '../../../src/main/ipc/errors'
import { toSerializableError } from '../../../src/main/ipc/serializable-error'
import { JobRunner } from '../../../src/main/services/jobs/JobRunner'
import { workerErrorToError } from '../../../src/main/storage/postgres/PostgresImportExecutor'
import { ERROR_HTTP_STATUS, httpStatusForErrorCode } from '../../../src/shared/errors/error-status'
import { ErrorCode } from '../../../src/shared/types/errors'

/**
 * Error envelope (desktop/web parity spec §4.4): one closed ErrorCode set,
 * one status table, and the same classification for both database drivers.
 */
describe('error envelope', () => {
  it('maps every ErrorCode to exactly one HTTP status', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_HTTP_STATUS[code], code).toBeGreaterThanOrEqual(400)
    }
    expect(httpStatusForErrorCode(ErrorCode.VALIDATION)).toBe(400)
    expect(httpStatusForErrorCode(ErrorCode.UNAUTHENTICATED)).toBe(401)
    expect(httpStatusForErrorCode(ErrorCode.FORBIDDEN)).toBe(403)
    expect(httpStatusForErrorCode(ErrorCode.NOT_FOUND)).toBe(404)
    expect(httpStatusForErrorCode(ErrorCode.CONFLICT)).toBe(409)
    expect(httpStatusForErrorCode(ErrorCode.UNSUPPORTED_RUNTIME)).toBe(501)
    expect(httpStatusForErrorCode(ErrorCode.UNAVAILABLE_UPSTREAM)).toBe(502)
    expect(httpStatusForErrorCode(ErrorCode.INTERNAL)).toBe(500)
    expect(httpStatusForErrorCode('SOMETHING_ELSE')).toBe(500)
  })

  it('repository unique violations become CONFLICT with a readable message', () => {
    const result = toSerializableError(new UniqueConstraintError('name', 'My preset'))
    expect(result.code).toBe(ErrorCode.CONFLICT)
    expect(result.userMessage).toBe("Name 'My preset' already exists. Choose a different name.")
  })

  it('Postgres 23505 becomes CONFLICT naming the item and value, never the SQL', () => {
    const pgError = Object.assign(
      new Error('duplicate key value violates unique constraint "region_files_name_key"'),
      { code: '23505', table: 'region_files', detail: 'Key (name)=(Exome) already exists.' }
    )
    const result = toSerializableError(pgError)
    expect(result.code).toBe(ErrorCode.CONFLICT)
    expect(result.userMessage).toBe(
      "A region file with this name ('Exome') already exists. Choose a different name."
    )
  })

  it('SQLite SQLITE_CONSTRAINT_UNIQUE becomes CONFLICT, also after the worker hop', () => {
    const sqliteError = Object.assign(new Error('UNIQUE constraint failed: filter_presets.name'), {
      name: 'SqliteError',
      code: 'SQLITE_CONSTRAINT_UNIQUE'
    })
    const direct = toSerializableError(sqliteError)
    expect(direct.code).toBe(ErrorCode.CONFLICT)
    expect(direct.userMessage).toBe(
      'A filter preset with this name already exists. Choose a different name.'
    )
    const rehydrated = decodeWorkerError(encodeWorkerError(sqliteError))
    expect(toSerializableError(rehydrated).code).toBe(ErrorCode.CONFLICT)
  })

  it('a rehydrated UniqueConstraintError keeps its readable message', () => {
    const rehydrated = decodeWorkerError(encodeWorkerError(new UniqueConstraintError('case', 'A')))
    expect(toSerializableError(rehydrated)).toMatchObject({
      code: ErrorCode.CONFLICT,
      userMessage: "Case 'A' already exists. Choose a different name."
    })
  })

  it('AppError subclasses pass their code through, also across the worker codec', () => {
    expect(toSerializableError(new ForbiddenError('not yours')).code).toBe(ErrorCode.FORBIDDEN)
    const conflict = decodeWorkerError(encodeWorkerError(new ConflictError('busy', 'Busy.')))
    expect(toSerializableError(conflict)).toEqual({
      code: ErrorCode.CONFLICT,
      message: 'busy',
      userMessage: 'Busy.'
    })
  })

  it('the PG import worker error message keeps a CONFLICT code across the thread hop', () => {
    const error = workerErrorToError({
      type: 'error',
      message: "case 'HG005' already exists",
      code: ErrorCode.CONFLICT,
      userMessage: "Case 'HG005' already exists. Choose a different name."
    })
    expect(error).toBeInstanceOf(AppError)
    expect(toSerializableError(error).code).toBe(ErrorCode.CONFLICT)
    expect(
      workerErrorToError({ type: 'error', message: 'boom', code: 'UNKNOWN' })
    ).not.toBeInstanceOf(AppError)
  })

  it('a job single-flight rejection is a CONFLICT', () => {
    const runner = new JobRunner()
    const gate = new Promise<void>(() => undefined)
    runner.enqueue('export', {}, () => gate)
    let thrown: unknown
    try {
      runner.enqueue('export', {}, () => gate)
    } catch (error) {
      thrown = error
    }
    expect(toSerializableError(thrown)).toMatchObject({
      code: ErrorCode.CONFLICT,
      message: 'An export is already in progress'
    })
  })
})
