/**
 * Role matrix for the non-dispatcher HTTP routes (upload staging and export
 * downloads), which apply the same security map through requireOperation().
 */
import fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, test } from 'vitest'

import { registerImportUploadRoutes } from '../../src/web/server/routes/upload-staging'
import { registerExportDownloadRoutes } from '../../src/web/server/routes/export-download'
import { makeDeps } from './helpers/dispatcher-adapters'

function jsonBody(response: { body: string }): unknown {
  return response.body === '' ? null : (JSON.parse(response.body) as unknown)
}

function isRoleRefusal(statusCode: number, body: unknown): boolean {
  const details = (body as { details?: { error?: string } } | null)?.details
  return statusCode === 403 && details?.error === 'role-required'
}

function routeApp(role: string): { app: FastifyInstance; made: ReturnType<typeof makeDeps> } {
  const made = makeDeps()
  const app = fastify()
  app.addHook('preHandler', async (request) => {
    request.session = {
      user: { id: 7, username: `${role}-user`, role, passwordChangedAt: null }
    } as never
  })
  registerImportUploadRoutes(app, made.deps)
  registerExportDownloadRoutes(app, made.deps)
  return { app, made }
}

describe('role matrix: non-dispatcher routes', () => {
  test.each([['viewer'], ['analyst'], ['admin']])(
    '%s: upload staging and artifact download follow the analyst policy',
    async (role) => {
      const { app, made } = routeApp(role)
      const upload = await app.inject({
        method: 'POST',
        url: '/api/import/upload',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('{}')
      })
      const download = await app.inject({
        method: 'GET',
        url: '/api/download/unknowntokenvalue1.1.sig'
      })
      if (role === 'viewer') {
        expect(isRoleRefusal(upload.statusCode, jsonBody(upload))).toBe(true)
        expect(isRoleRefusal(download.statusCode, jsonBody(download))).toBe(true)
        expect(made.execute).not.toHaveBeenCalled()
        expect(made.writeExecute).not.toHaveBeenCalled()
      } else {
        // Past authorization: missing file name / unknown download grant.
        expect(upload.statusCode).toBe(400)
        expect(download.statusCode).toBe(404)
      }
      await app.close()
    }
  )
})
