import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

import { SAME_ORIGIN_HEADERS, startWebDriver } from '../helpers/web-driver'

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''
const ANNOTATION_PATHS = [
  '/api/annotations/getGlobal',
  '/api/annotations/upsertGlobal',
  '/api/annotations/upsertPerCase',
  '/api/annotations/getForVariant'
] as const
const ASSET_PATHS = [
  '/api/case-metadata/createCohort',
  '/api/analysis-groups/create',
  '/api/analysis-groups/addMember',
  '/api/region-files/importBed',
  '/api/gene-lists/setGenes'
] as const
const CASE_COMMENT_PATHS = [
  '/api/case-comments/list',
  '/api/case-comments/create',
  '/api/case-comments/update',
  '/api/case-comments/delete'
] as const
const CASE_METRIC_PATHS = [
  '/api/case-metrics/listDefinitions',
  '/api/case-metrics/createDefinition',
  '/api/case-metrics/listForCase',
  '/api/case-metrics/upsert',
  '/api/case-metrics/delete'
] as const
const REFERENCE_PATHS = [
  '/api/gene-ref/info',
  '/api/gene-ref/assemblies',
  '/api/hpo/search',
  '/api/hpo/clearCache',
  '/api/vep/fetch',
  '/api/vep/getCacheStats',
  '/api/vep/clearCache',
  '/api/vep/cancel',
  '/api/protein/getMapping',
  '/api/protein/getDomains',
  '/api/protein/getStructure',
  '/api/protein/getGeneStructure'
] as const
const TAG_PATHS = [
  '/api/tags/list',
  '/api/tags/create',
  '/api/tags/update',
  '/api/tags/delete',
  '/api/tags/getUsageCount',
  '/api/tags/getVariantTags',
  '/api/tags/assignVariantTag',
  '/api/tags/removeVariantTag',
  '/api/tags/setVariantTags'
] as const

describe.skipIf(!isWebBuilt || !HAS_PG)('web OpenAPI endpoint', () => {
  test('serves the contract to signed-in users and exposes dispatcher and auth method paths', async () => {
    const driver = await startWebDriver()
    try {
      const unauthenticated = await driver.app.inject({
        method: 'GET',
        url: '/api/openapi.json'
      })
      // P-21: the API description needs a session unless VARLENS_WEB_PUBLIC_API_DOCS=1.
      expect(unauthenticated.statusCode, unauthenticated.body).toBe(401)

      const authenticated = await driver.app.inject({
        method: 'GET',
        url: '/api/openapi.json',
        headers: { cookie: driver.cookie }
      })
      expect(authenticated.statusCode, authenticated.body).toBe(200)

      const spec = authenticated.json() as {
        openapi?: string
        info?: { title?: string }
        paths?: Record<string, unknown>
      }
      expect(spec.openapi).toMatch(/^3\./)
      expect(spec.info?.title).toBe('VarLens Web API')
      expect(spec.paths).toHaveProperty('/api/auth/login')
      expect(spec.paths).toHaveProperty('/api/auth/createUser')
      expect(spec.paths).toHaveProperty('/api/auth/changePassword')
      expect(spec.paths).not.toHaveProperty('/api/{domain}/{method}')
      expect(spec.paths).not.toHaveProperty('/login')
      expect(spec.paths).not.toHaveProperty('/login/')
      expect(spec.paths).not.toHaveProperty('/api/events')
      expect(spec.paths).not.toHaveProperty('/healthz')
      for (const path of ANNOTATION_PATHS) {
        expect(spec.paths).toHaveProperty(path)
      }
      for (const path of ASSET_PATHS) {
        expect(spec.paths).toHaveProperty(path)
      }
      for (const path of CASE_COMMENT_PATHS) {
        expect(spec.paths).toHaveProperty(path)
      }
      for (const path of CASE_METRIC_PATHS) {
        expect(spec.paths).toHaveProperty(path)
      }
      expect(spec.paths).toHaveProperty('/api/cases/list')
      expect(spec.paths).toHaveProperty('/api/cohort/getVariants')
      expect(spec.paths).toHaveProperty('/api/cohort/runAssociation')
      expect(spec.paths).toHaveProperty('/api/cohort/getSummaryStatus')
      expect(spec.paths).toHaveProperty('/api/database/info')
      expect(spec.paths).not.toHaveProperty('/api/database/recentList')
      expect(spec.paths).toHaveProperty('/api/export/variants')
      expect(spec.paths).toHaveProperty('/api/export/cohort')
      expect(spec.paths).toHaveProperty('/api/import/start')
      expect(spec.paths).toHaveProperty('/api/import/startMultiFile')
      expect(spec.paths).toHaveProperty('/api/batch-import/extractZip')
      expect(spec.paths).toHaveProperty('/api/batch-import/testZipPassword')
      expect(spec.paths).toHaveProperty('/api/batch-import/cleanupZipTemp')
      for (const path of REFERENCE_PATHS) {
        expect(spec.paths).toHaveProperty(path)
      }
      for (const path of TAG_PATHS) {
        expect(spec.paths).toHaveProperty(path)
      }
      expect(spec.paths).toHaveProperty('/api/transcripts/list')
      expect(spec.paths).toHaveProperty('/api/transcripts/switch')
      expect(spec.paths).toHaveProperty('/api/transcripts/insertAndSwitch')
      expect(spec.paths).toHaveProperty('/api/variants/query')
      expect(spec.paths).toHaveProperty('/api/variants/getFilterOptions')

      const paths = spec.paths as Record<
        string,
        { post?: { requestBody?: unknown; responses?: Record<string, unknown> } }
      >
      expect(paths['/api/auth/login']?.post?.requestBody).toBeDefined()
      expect(paths['/api/auth/createUser']?.post?.requestBody).toBeDefined()
      expect(paths['/api/auth/createUser']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/auth/setRole']?.post?.requestBody).toBeDefined()
      expect(paths['/api/auth/reactivateUser']?.post?.requestBody).toBeDefined()
      expect(paths['/api/auth/changePassword']?.post?.requestBody).toBeDefined()
      for (const path of ANNOTATION_PATHS) {
        expect(paths[path]?.post?.requestBody).toBeDefined()
        expect(paths[path]?.post?.responses?.['200']).toBeDefined()
      }
      for (const path of ASSET_PATHS) {
        expect(paths[path]?.post?.requestBody).toBeDefined()
        expect(paths[path]?.post?.responses?.['200']).toBeDefined()
      }
      for (const path of CASE_COMMENT_PATHS) {
        expect(paths[path]?.post?.requestBody).toBeDefined()
        expect(paths[path]?.post?.responses?.['200']).toBeDefined()
      }
      for (const path of CASE_METRIC_PATHS) {
        expect(paths[path]?.post?.requestBody).toBeDefined()
        expect(paths[path]?.post?.responses?.['200']).toBeDefined()
      }
      expect(paths['/api/cases/list']?.post?.requestBody).toBeDefined()
      expect(paths['/api/cases/list']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/cohort/getVariants']?.post?.requestBody).toBeDefined()
      expect(paths['/api/cohort/getSummaryStatus']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/cohort/runAssociation']?.post?.responses?.['501']).toBeDefined()
      expect(paths['/api/cohort/runAssociation']?.post?.responses?.['200']).toBeUndefined()
      expect(paths['/api/database/info']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/export/variants']?.post?.requestBody).toBeDefined()
      expect(paths['/api/export/variants']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/export/variants']?.post?.responses?.['501']).toBeDefined()
      expect(paths['/api/export/cohort']?.post?.requestBody).toBeDefined()
      expect(paths['/api/export/cohort']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/export/cohort']?.post?.responses?.['501']).toBeDefined()
      expect(paths['/api/import/start']?.post?.requestBody).toBeDefined()
      expect(paths['/api/import/start']?.post?.responses?.['403']).toBeDefined()
      expect(paths['/api/import/startMultiFile']?.post?.requestBody).toBeDefined()
      expect(paths['/api/import/startMultiFile']?.post?.responses?.['403']).toBeDefined()
      expect(paths['/api/batch-import/extractZip']?.post?.requestBody).toBeDefined()
      expect(paths['/api/batch-import/extractZip']?.post?.responses?.['403']).toBeDefined()
      expect(paths['/api/batch-import/testZipPassword']?.post?.requestBody).toBeDefined()
      expect(paths['/api/batch-import/testZipPassword']?.post?.responses?.['403']).toBeDefined()
      expect(paths['/api/batch-import/cleanupZipTemp']?.post?.requestBody).toBeDefined()
      expect(paths['/api/batch-import/cleanupZipTemp']?.post?.responses?.['200']).toBeDefined()
      for (const path of REFERENCE_PATHS) {
        expect(paths[path]?.post?.requestBody).toBeDefined()
        expect(paths[path]?.post?.responses?.['501']).toBeDefined()
      }
      for (const path of TAG_PATHS) {
        expect(paths[path]?.post?.requestBody).toBeDefined()
        expect(paths[path]?.post?.responses?.['200']).toBeDefined()
      }
      expect(paths['/api/transcripts/list']?.post?.requestBody).toBeDefined()
      expect(paths['/api/transcripts/list']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/transcripts/switch']?.post?.requestBody).toBeDefined()
      expect(paths['/api/transcripts/switch']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/transcripts/insertAndSwitch']?.post?.requestBody).toBeDefined()
      expect(paths['/api/transcripts/insertAndSwitch']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/variants/query']?.post?.requestBody).toBeDefined()
      expect(paths['/api/variants/query']?.post?.responses?.['200']).toBeDefined()
      expect(paths['/api/variants/getFilterOptions']?.post?.requestBody).toBeDefined()
      expect(paths['/api/variants/getFilterOptions']?.post?.responses?.['200']).toBeDefined()

      const specText = JSON.stringify(spec)
      expect(specText).not.toContain('Generic RPC fallback')
    } finally {
      await driver.close()
    }
  })

  test('keeps dispatcher calls with no request body compatible', async () => {
    const driver = await startWebDriver()
    try {
      const res = await driver.app.inject({
        method: 'POST',
        url: '/api/auth/isAccountsEnabled',
        headers: { ...SAME_ORIGIN_HEADERS, cookie: driver.cookie }
      })

      expect(res.statusCode, res.body).toBe(200)
      expect(res.json()).toBe(true)
    } finally {
      await driver.close()
    }
  })
})
