/**
 * Capability document (spec §4.3): one per-session, role-aware document built
 * from the parity manifest by both desktop main and the web server.
 */
import fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { describe, expect, it } from 'vitest'

import {
  computeCapabilityDocument,
  type CapabilityDocument
} from '../../../src/shared/ipc/capability-document'
import { CAPABILITY_FEATURES } from '../../../src/shared/ipc/capability-features'
import { buildDispatcher, registerDispatcher } from '../../../src/web/server/dispatcher'
import { makeDeps } from '../../web-gate/helpers/dispatcher-adapters'

describe('computeCapabilityDocument', () => {
  it('enables every feature and blocks nothing on desktop', () => {
    const doc = computeCapabilityDocument({ runtime: 'desktop', role: 'admin', storage: null })
    expect(doc.blockedMethods).toEqual([])
    for (const feature of Object.keys(
      CAPABILITY_FEATURES
    ) as (keyof typeof CAPABILITY_FEATURES)[]) {
      expect(doc.features[feature], feature).toEqual({ enabled: true })
    }
  })

  it('blocks desktop-only and pending methods in web with the user-facing reason', () => {
    const doc = computeCapabilityDocument({ runtime: 'web', role: 'admin', storage: null })
    expect(doc.blockedMethods).toContain('database.open')
    expect(doc.blockedMethods).toContain('geneRef.update')
    expect(doc.blockedMethods).not.toContain('cases.list')
    expect(doc.blockedMethods).not.toContain('hpo.search')
    expect(doc.features.geneRefUpdate).toEqual({
      enabled: false,
      reason: CAPABILITY_FEATURES.geneRefUpdate.unavailableInWeb
    })
    // External lookups are served but default-off instance features (egress policy).
    expect(doc.blockedMethods).not.toContain('vep.fetch')
    expect(doc.features.vepEnrichment).toEqual({
      enabled: false,
      reason: CAPABILITY_FEATURES.vepEnrichment.unavailableInWeb
    })
    expect(doc.features.multiFileImport.enabled).toBe(true)
  })

  it('is role-aware: admin methods are blocked for other roles', () => {
    const user = computeCapabilityDocument({ runtime: 'web', role: 'user', storage: null })
    const admin = computeCapabilityDocument({ runtime: 'web', role: 'admin', storage: null })
    expect(user.blockedMethods).toContain('auth.listUsers')
    expect(user.features.userAdmin).toMatchObject({ enabled: false })
    expect(admin.blockedMethods).not.toContain('auth.listUsers')
    expect(admin.features.userAdmin.enabled).toBe(true)
  })

  it('viewer / analyst / admin: viewers are read-only, analysts write, admins administer', () => {
    const doc = (role: string) => computeCapabilityDocument({ runtime: 'web', role, storage: null })
    const viewer = doc('viewer')
    const analyst = doc('analyst')
    const admin = doc('admin')
    for (const write of [
      'annotations.upsertGlobal',
      'tags.create',
      'import.start',
      'export.variants'
    ]) {
      expect(viewer.blockedMethods, write).toContain(write)
      expect(analyst.blockedMethods, write).not.toContain(write)
    }
    expect(viewer.blockedMethods).not.toContain('variants.query')
    expect(viewer.features.panelBedExport).toEqual({
      enabled: false,
      reason: expect.stringMatching(/read-only \(viewer\)/)
    })
    expect(analyst.features.panelBedExport.enabled).toBe(true)
    expect(analyst.blockedMethods).toContain('cases.deleteAll')
    expect(admin.blockedMethods).not.toContain('cases.deleteAll')
    // Legacy role name from a stale session acts as analyst; unknown roles get nothing.
    expect(doc('user').blockedMethods).not.toContain('tags.create')
    expect(doc('superuser').blockedMethods).toContain('variants.query')
  })

  it('reports instance features from server configuration', () => {
    const off = computeCapabilityDocument({ runtime: 'web', role: 'user', storage: null })
    const on = computeCapabilityDocument({
      runtime: 'web',
      role: 'user',
      storage: null,
      instanceFeatures: { igvLocalBroadcast: true }
    })
    expect(off.features.igvLocalBroadcast.enabled).toBe(false)
    expect(off.features.igvLocalBroadcast.reason).toMatch(/VARLENS_WEB_ALLOW_LOCAL_IGV/)
    expect(on.features.igvLocalBroadcast.enabled).toBe(true)
  })
})

describe('system:getCapabilities over HTTP', () => {
  async function fetchAs(role: 'admin' | 'user'): Promise<CapabilityDocument> {
    const { deps } = makeDeps()
    const app = fastify({ logger: false })
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 1, username: role, role, passwordChangedAt: null }
      } as never
    })
    registerDispatcher(app, deps, buildDispatcher(deps).overrides)
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/system/getCapabilities',
        payload: { args: [] }
      })
      expect(response.statusCode).toBe(200)
      return response.json() as CapabilityDocument
    } finally {
      await app.close()
    }
  }

  it('serves a per-session document for the signed-in role', async () => {
    const user = await fetchAs('user')
    const admin = await fetchAs('admin')
    expect(user).toMatchObject({ runtime: 'web', role: 'user' })
    expect(user.features.userAdmin.enabled).toBe(false)
    expect(admin.features.userAdmin.enabled).toBe(true)
    expect(user.storage).toMatchObject({ backend: 'postgres' })
  })
})
