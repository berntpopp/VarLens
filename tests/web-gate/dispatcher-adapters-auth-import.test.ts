import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, test, vi } from 'vitest'

import { jobRunner } from '../../src/main/services/jobs/runner'
import { ErrorCode } from '../../src/shared/types/errors'
import { PasswordPolicyError } from '../../src/web/auth/PostgresWebAuthService'
import { buildDispatcher } from '../../src/web/server/dispatcher'
import { AppMetrics } from '../../src/web/server/metrics'
import { stageExistingFileUpload } from '../../src/web/server/routes/upload-staging'
import { makeDeps } from './helpers/dispatcher-adapters'

const ZIP_WITH_ONE_JSON_BASE64 =
  'UEsDBBQAAAgIAJRRwVwz5c4EEQAAAA8AAAARAAAAd2ViLXppcC1jYXNlLmpzb26rVkpOLE5Vsl' +
  'IqT01SquUCAFBLAQIUAxQAAAgIAJRRwVwz5c4EEQAAAA8AAAARAAAAAAAAAAAAAACkgQAAAAB3' +
  'ZWItemlwLWNhc2UuanNvblBLBQYAAAAAAQABAD8AAABAAAAAAAA='

describe('web dispatcher adapters: auth and import', () => {
  test('auth.isAccountsEnabled delegates to the web auth service', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['auth:isAccountsEnabled'].handle(
      [],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toBe(false)
    expect(deps.authService.isAccountsEnabled).toHaveBeenCalledTimes(1)
  })

  test('auth.login records success and failure audit events without credentials', async () => {
    const { deps, reply, writeExecute } = makeDeps()
    const metrics = new AppMetrics({ app: 'varlens', environment: 'test' })
    deps.metrics = metrics
    deps.authService.authenticate = async (username: string, password: string) =>
      password === 'correct'
        ? {
            success: true,
            user: {
              id: 1,
              username,
              role: 'admin',
              password_changed_at: '2026-06-10T12:00:00.000Z'
            },
            mustChangePassword: false
          }
        : { success: false, user: null }
    const { overrides } = buildDispatcher(deps)
    const request = { session: {} }

    await overrides['auth:login'].handle(
      ['admin', 'correct'],
      request as never,
      reply as never,
      deps
    )
    await overrides['auth:login'].handle(
      ['admin', 'wrong'],
      { session: {} } as never,
      reply as never,
      deps
    )

    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        expect.objectContaining({
          action_type: 'auth_login_success',
          entity_type: 'user_account',
          entity_key: 'admin',
          user_name: 'admin',
          new_value: { success: true, role: 'admin', must_change_password: false }
        })
      ]
    })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        expect.objectContaining({
          action_type: 'auth_login_failure',
          entity_type: 'user_account',
          entity_key: 'login-attempt',
          user_name: null,
          new_value: { success: false, reason: 'invalid-credentials' }
        })
      ]
    })
    expect(JSON.stringify(writeExecute.mock.calls)).not.toContain('correct')
    expect(JSON.stringify(writeExecute.mock.calls)).not.toContain('wrong')
    const text = metrics.metricsText()
    expect(text).toContain(
      'varlens_operation_events_total{app="varlens",environment="test",failure_class="none",operation="auth-login",result="success"} 1'
    )
    expect(text).toContain(
      'varlens_operation_events_total{app="varlens",environment="test",failure_class="invalid-credentials",operation="auth-login",result="error"} 1'
    )
  })

  test('auth.login records locked failures without leaking submitted usernames', async () => {
    const { deps, reply, writeExecute } = makeDeps()
    deps.authService.authenticate = vi.fn(async () => ({
      success: false,
      user: null,
      locked: true
    }))
    const { overrides } = buildDispatcher(deps)

    await overrides['auth:login'].handle(
      ['admin@example.test', 'wrong'],
      { session: {} } as never,
      reply as never,
      deps
    )

    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        expect.objectContaining({
          action_type: 'auth_login_failure',
          entity_type: 'user_account',
          entity_key: 'login-attempt',
          user_name: null,
          new_value: { success: false, reason: 'locked' }
        })
      ]
    })
    expect(JSON.stringify(writeExecute.mock.calls)).not.toContain('admin@example.test')
    expect(JSON.stringify(writeExecute.mock.calls)).not.toContain('wrong')
  })

  test('auth.logout records the authenticated session user', async () => {
    const { deps, reply, writeExecute } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = {
      session: {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null },
        delete: vi.fn()
      }
    }

    const result = await overrides['auth:logout'].handle([], request as never, reply as never, deps)

    expect(result).toEqual({ ok: true })
    expect(request.session.delete).toHaveBeenCalledTimes(1)
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        expect.objectContaining({
          action_type: 'auth_logout',
          entity_type: 'user_account',
          entity_key: 'admin',
          user_name: 'admin',
          new_value: { success: true }
        })
      ]
    })
  })

  test('auth.changePassword records success, old-password failure, and policy failure without secrets', async () => {
    const { deps, reply, writeExecute } = makeDeps()
    deps.authService.changePassword = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new PasswordPolicyError('too-short', 'too short'))
    deps.authService.getUser = vi.fn(async (username: string) => ({
      id: 1,
      username,
      role: 'admin',
      password_changed_at: '2026-06-10T12:00:00.000Z'
    }))
    const { overrides } = buildDispatcher(deps)
    const request = {
      session: {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null },
        mustChangePassword: true
      }
    }

    await overrides['auth:changePassword'].handle(
      ['old', 'new-password-1'],
      request as never,
      reply as never,
      deps
    )
    await overrides['auth:changePassword'].handle(
      ['bad-old', 'new-password-2'],
      request as never,
      reply as never,
      deps
    )
    await overrides['auth:changePassword'].handle(
      ['old', 'short'],
      request as never,
      reply as never,
      deps
    )

    const audits = writeExecute.mock.calls
      .map(([task]) => task)
      .filter((task) => task.type === 'audit:append')
      .map((task) => task.params[0])
    expect(audits).toEqual([
      expect.objectContaining({
        action_type: 'auth_password_change',
        entity_key: 'admin',
        user_name: 'admin',
        new_value: { success: true }
      }),
      expect.objectContaining({
        action_type: 'auth_password_change',
        entity_key: 'admin',
        user_name: 'admin',
        new_value: { success: false, reason: 'old-password-invalid' }
      }),
      expect.objectContaining({
        action_type: 'auth_password_change',
        entity_key: 'admin',
        user_name: 'admin',
        new_value: { success: false, reason: 'too-short' }
      })
    ])
    expect(JSON.stringify(writeExecute.mock.calls)).not.toContain('new-password')
    expect(JSON.stringify(writeExecute.mock.calls)).not.toContain('bad-old')
  })

  test('auth.resetPassword and auth.deactivateUser record admin actions without new passwords', async () => {
    const { deps, reply, writeExecute } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = {
      session: {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
      }
    }

    await overrides['auth:resetPassword'].handle(
      ['analyst', 'temporary-secret'],
      request as never,
      reply as never,
      deps
    )
    await overrides['auth:deactivateUser'].handle(
      ['analyst'],
      request as never,
      reply as never,
      deps
    )

    expect(deps.authService.resetPassword).toHaveBeenCalledWith('analyst', 'temporary-secret')
    expect(deps.authService.deactivateUser).toHaveBeenCalledWith('analyst')
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        expect.objectContaining({
          action_type: 'auth_password_reset',
          entity_key: 'analyst',
          user_name: 'admin',
          new_value: { success: true }
        })
      ]
    })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        expect.objectContaining({
          action_type: 'auth_user_deactivate',
          entity_key: 'analyst',
          user_name: 'admin',
          new_value: { success: true }
        })
      ]
    })
    expect(JSON.stringify(writeExecute.mock.calls)).not.toContain('temporary-secret')
  })

  test('import.start rejects raw server paths in production web mode', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const { deps, importSingleFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: {} }

      const result = await overrides['import:start'].handle(
        ['/tmp/input.vcf', 'Case A'],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(result).toMatchObject({ error: 'server-path-import-disabled' })
      expect(importSingleFile).not.toHaveBeenCalled()
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
    }
  })

  test('import.start rejects raw server paths even in test mode with the legacy allow flag', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevAllow = process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT = '1'
    try {
      const { deps, importSingleFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = await overrides['import:start'].handle(
        ['/tmp/input.vcf', 'Case A'],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(result).toMatchObject({ error: 'server-path-import-disabled' })
      expect(importSingleFile).not.toHaveBeenCalled()
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevAllow === undefined) delete process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
      else process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT = prevAllow
    }
  })

  test('batch import zip extraction rejects raw server paths in production web mode', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const { deps, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)

      const result = await overrides['batch-import:extractZip'].handle(
        ['/tmp/input.zip'],
        {} as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(result).toMatchObject({ error: 'server-path-import-disabled' })
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
    }
  })

  test('batch import zip extraction rejects raw server paths even with the legacy allow flag', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevAllow = process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT = '1'
    try {
      const { deps, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)

      const result = await overrides['batch-import:extractZip'].handle(
        ['/tmp/input.zip'],
        {} as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(result).toMatchObject({ error: 'server-path-import-disabled' })
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevAllow === undefined) delete process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
      else process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT = prevAllow
    }
  })

  test('batch import zip extraction accepts web upload refs and returns web upload refs', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-zip-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const zipPath = join(tempDir, 'batch.zip')
      await writeFile(zipPath, Buffer.from(ZIP_WITH_ONE_JSON_BASE64, 'base64'))
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'batch.zip',
        sourcePath: zipPath
      })

      const { deps, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = (await overrides['batch-import:extractZip'].handle(
        [upload.ref],
        request as never,
        reply as never,
        deps
      )) as { files: string[]; errors: string[] }

      expect(reply.code).not.toHaveBeenCalledWith(403)
      expect(result.errors).toEqual([])
      expect(result.files).toHaveLength(1)
      expect(result.files[0]).toMatch(/^web-upload:/)
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('batch-import.start resolves web upload refs and runs through JobRunner-backed import logic', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-batch-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const sourcePath = join(tempDir, 'Case B.json')
      await writeFile(sourcePath, '{}')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'Case B.json',
        sourcePath
      })
      const knownBatchJobs = new Set(jobRunner.list({ kind: 'import_batch' }).map((job) => job.id))
      const { deps, importSingleFile, reply } = makeDeps()
      importSingleFile.mockImplementationOnce(async (params) => {
        params.onProgress?.({ phase: 'parsing', count: 1, elapsed: 3, skipped: 0 })
        return {
          caseId: 12,
          variantCount: 4,
          skipped: 0,
          errors: [],
          elapsed: 15
        }
      })
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = (await overrides['batch-import:start'].handle(
        [[upload.ref], 'skip'],
        request as never,
        reply as never,
        deps
      )) as {
        succeeded: number
        failed: number
        skipped: number
        details: Array<{ filePath: string; fileName: string; caseName: string; status: string }>
      }

      expect(reply.code).not.toHaveBeenCalled()
      expect(importSingleFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: upload.storedPath,
          caseName: 'Case B'
        })
      )
      expect(result).toMatchObject({
        succeeded: 1,
        failed: 0,
        skipped: 0,
        details: [
          {
            filePath: upload.ref,
            fileName: 'Case B.json',
            caseName: 'Case B',
            status: 'success',
            variantCount: 4
          }
        ]
      })
      expect(deps.events.publish).toHaveBeenCalledWith(7, 'batch-import:progress', {
        currentIndex: 0,
        totalFiles: 1,
        currentFileName: 'Case B.json',
        overallPercent: 100,
        fileProgress: { phase: 'parsing', count: 1, elapsed: 3, skipped: 0 }
      })
      expect(deps.events.publish).toHaveBeenCalledWith(7, 'cohort:summaryRebuilt', {
        is_stale: true
      })
      expect(deps.events.publish).toHaveBeenCalledWith(7, 'cohort:summaryRebuilt', {
        is_stale: false
      })
      expect(deps.events.publish).toHaveBeenCalledWith(7, 'batch-import:complete', result)

      const newBatchJobs = jobRunner
        .list({ kind: 'import_batch' })
        .filter((job) => !knownBatchJobs.has(job.id))
      expect(newBatchJobs).toHaveLength(1)
      const newBatchJob = newBatchJobs[0]
      expect(newBatchJob).toBeDefined()
      if (newBatchJob === undefined) throw new Error('expected batch job to be tracked')
      expect(newBatchJob).toMatchObject({ kind: 'import_batch', status: 'completed' })
      const params = newBatchJob.params as {
        files: Array<{ inputPath: string; storedPath: string }>
        duplicateStrategy: string
      }
      expect(params.duplicateStrategy).toBe('skip')
      const paramFile = params.files[0]
      expect(paramFile).toBeDefined()
      expect(paramFile).toMatchObject({
        inputPath: upload.ref,
        storedPath: upload.storedPath
      })
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('batch-import.start renders serializable import errors as user messages', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-batch-error-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const sourcePath = join(tempDir, 'SAMPLE.json')
      await writeFile(sourcePath, '{}')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'SAMPLE.json',
        sourcePath
      })
      const { deps, importSingleFile, reply } = makeDeps()
      importSingleFile.mockRejectedValueOnce({
        code: ErrorCode.UNIQUE_CONSTRAINT,
        message: "case 'SAMPLE' already exists",
        userMessage: "case 'SAMPLE' already exists"
      })
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = (await overrides['batch-import:start'].handle(
        [[upload.ref], 'overwrite'],
        request as never,
        reply as never,
        deps
      )) as {
        succeeded: number
        failed: number
        details: Array<{ status: string; error?: string }>
      }

      expect(reply.code).not.toHaveBeenCalled()
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.details).toMatchObject([
        {
          status: 'failed',
          error: "case 'SAMPLE' already exists"
        }
      ])
      expect(result.details[0]?.error).not.toBe('[object Object]')
      expect(deps.events.publish).toHaveBeenCalledWith(7, 'batch-import:complete', result)
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('batch-import.start skips duplicate case names that appear within the same web batch', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-batch-dupes-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const firstPath = join(tempDir, 'first.json')
      const secondPath = join(tempDir, 'second.json')
      await writeFile(firstPath, '{}')
      await writeFile(secondPath, '{}')
      const firstUpload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'Case B.json',
        sourcePath: firstPath
      })
      const secondUpload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'Case B.json',
        sourcePath: secondPath
      })
      const { deps, importSingleFile, reply } = makeDeps()
      importSingleFile.mockResolvedValueOnce({
        caseId: 12,
        variantCount: 4,
        skipped: 0,
        errors: [],
        elapsed: 15
      })
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = (await overrides['batch-import:start'].handle(
        [[firstUpload.ref, secondUpload.ref], 'skip'],
        request as never,
        reply as never,
        deps
      )) as {
        succeeded: number
        failed: number
        skipped: number
        details: Array<{ filePath: string; fileName: string; caseName: string; status: string }>
      }

      expect(reply.code).not.toHaveBeenCalled()
      expect(importSingleFile).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        succeeded: 1,
        failed: 0,
        skipped: 1,
        details: [
          {
            filePath: firstUpload.ref,
            fileName: 'Case B.json',
            caseName: 'Case B',
            status: 'success'
          },
          {
            filePath: secondUpload.ref,
            fileName: 'Case B.json',
            caseName: 'Case B',
            status: 'skipped'
          }
        ]
      })
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('batch-import.checkDuplicates reports missing web upload refs as upload-not-found', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

    const result = await overrides['batch-import:checkDuplicates'].handle(
      [['web-upload:missing/Case B.json']],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(404)
    expect(result).toEqual({
      error: 'upload-not-found',
      message: 'Uploaded file is no longer available'
    })
  })

  test('batch-import.start reports missing web upload refs as upload-not-found', async () => {
    const { deps, importSingleFile, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

    const result = await overrides['batch-import:start'].handle(
      [['web-upload:missing/Case B.json'], 'skip'],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(404)
    expect(result).toEqual({
      error: 'upload-not-found',
      message: 'Uploaded file is no longer available'
    })
    expect(importSingleFile).not.toHaveBeenCalled()
  })

  test('import.start routes a staged browser upload through shared import logic', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-import-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const sourcePath = join(tempDir, 'input.vcf')
      await writeFile(sourcePath, '##fileformat=VCFv4.2\n')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'input.vcf',
        sourcePath
      })
      const { deps, importSingleFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = await overrides['import:start'].handle(
        [upload.ref, 'Case A', { genomeBuild: 'hg38' }],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).not.toHaveBeenCalled()
      expect(result).toMatchObject({ caseId: 11, variantCount: 2 })
      expect(importSingleFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: upload.storedPath,
          caseName: 'Case A',
          vcfOptions: { genomeBuild: 'hg38', selectedSample: undefined }
        })
      )
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('import.start publishes web progress events to the session user', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-import-progress-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const sourcePath = join(tempDir, 'input.vcf')
      await writeFile(sourcePath, '##fileformat=VCFv4.2\n')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'input.vcf',
        sourcePath
      })
      const { deps, importSingleFile, reply } = makeDeps()
      importSingleFile.mockImplementationOnce(async (params) => {
        params.onProgress?.({ phase: 'parsing', count: 5 })
        return {
          caseId: 11,
          variantCount: 2,
          skipped: 0,
          errors: [],
          elapsed: 12
        }
      })
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      await overrides['import:start'].handle(
        [upload.ref, 'Case A'],
        request as never,
        reply as never,
        deps
      )

      expect(deps.events.publish).toHaveBeenCalledWith(7, 'import:progress', {
        phase: 'parsing',
        count: 5
      })
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('import.startMultiFile normalizes valid object filter payloads for import logic', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-multifile-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const sourcePath = join(tempDir, 'input.vcf')
      await writeFile(sourcePath, '##fileformat=VCFv4.2\n')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'input.vcf',
        sourcePath
      })
      const { deps, importMultiFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      await overrides['import:startMultiFile'].handle(
        [
          'Case A',
          [
            {
              filePath: upload.ref,
              variantType: 'snv',
              caller: 42,
              annotationFormat: null
            }
          ],
          { genomeBuild: 'hg38' },
          { bedPadding: 10, passOnly: true, minQual: 30, minGq: null }
        ],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).not.toHaveBeenCalled()
      expect(importMultiFile).toHaveBeenCalledWith(
        expect.objectContaining({
          caseName: 'Case A',
          files: [
            {
              filePath: upload.storedPath,
              variantType: 'snv',
              caller: null,
              annotationFormat: null
            }
          ],
          vcfOptions: { genomeBuild: 'hg38', selectedSample: undefined },
          filters: expect.objectContaining({
            bedPadding: 10,
            passOnly: true,
            minQual: 30,
            minGq: null
          })
        })
      )
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('import.startMultiFile rejects malformed filter payloads before import logic', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-multifile-invalid-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const sourcePath = join(tempDir, 'input.vcf')
      await writeFile(sourcePath, '##fileformat=VCFv4.2\n')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'input.vcf',
        sourcePath
      })
      const { deps, importMultiFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = await overrides['import:startMultiFile'].handle(
        [
          'Case A',
          [
            {
              filePath: upload.ref,
              variantType: 'snv',
              caller: 'caller',
              annotationFormat: null
            }
          ],
          { genomeBuild: 'hg38' },
          { minQual: '30', passOnly: 'true' }
        ],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(400)
      expect(result).toEqual({
        error: 'invalid-filters',
        message: 'filters must match the import filter schema'
      })
      expect(importMultiFile).not.toHaveBeenCalled()
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('import.startMultiFile treats null filter payloads as absent', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-multifile-null-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
    try {
      const sourcePath = join(tempDir, 'input.vcf')
      await writeFile(sourcePath, '##fileformat=VCFv4.2\n')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'input.vcf',
        sourcePath
      })
      const { deps, importMultiFile, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      await overrides['import:startMultiFile'].handle(
        [
          'Case A',
          [
            {
              filePath: upload.ref,
              variantType: 'snv',
              caller: 'caller',
              annotationFormat: null
            }
          ],
          { genomeBuild: 'hg38' },
          null
        ],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).not.toHaveBeenCalled()
      expect(importMultiFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: undefined
        })
      )
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('auth.listUsers requires an admin session and calls the auth service', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

    const result = await overrides['auth:listUsers'].handle(
      [],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 1, username: 'admin', role: 'admin' }])
    expect(deps.authService.listUsers).toHaveBeenCalledTimes(1)
  })

  test('auth.createUser rejects non-admin sessions at the web boundary', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 2, username: 'user', role: 'user' } } }

    const result = await overrides['auth:createUser'].handle(
      ['analyst', 'Analyst', 'temporary-password'],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(403)
    expect(result).toEqual({ error: 'admin-required' })
    expect(deps.authService.createUser).not.toHaveBeenCalled()
  })

  test('auth.createUser is disabled for admins in single-tenant web mode', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

    const result = await overrides['auth:createUser'].handle(
      ['analyst', 'Analyst', 'temporary-password'],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'multi-user-disabled',
      message: 'Creating additional web users is disabled for this single-tenant release.'
    })
    expect(deps.authService.createUser).not.toHaveBeenCalled()
  })

  test('auth.deactivateUser rejects self-deactivation before calling the auth service', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

    const result = await overrides['auth:deactivateUser'].handle(
      ['admin'],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({ error: 'cannot-deactivate-self' })
    expect(deps.authService.deactivateUser).not.toHaveBeenCalled()
  })

  test('auth.resetPassword rejects self-reset before calling the auth service', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const request = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

    const result = await overrides['auth:resetPassword'].handle(
      ['admin', 'temporary-password'],
      request as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({ error: 'cannot-reset-self' })
    expect(deps.authService.resetPassword).not.toHaveBeenCalled()
  })
})
