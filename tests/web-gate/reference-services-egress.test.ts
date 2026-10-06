import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { buildDispatcher } from '../../src/web/server/dispatcher'
import type { DispatcherDeps } from '../../src/web/server/dispatcher'
import { createExternalLookupAuditSink } from '../../src/web/server/reference-services/audit-sink'
import {
  defaultExternalLookupPolicy,
  parseExternalLookupPolicy,
  type ExternalLookupPolicy,
  type ExternalLookupPolicySource
} from '../../src/web/server/reference-services/policy-store'
import { WebReferenceServices } from '../../src/web/server/reference-services/reference-services'
import { closeWebGeneReferenceDb } from '../../src/web/server/web-gene-reference'
import type { ReferenceServicePolicyUpdate } from '../../src/shared/ipc/domains/reference-services'
import { makeDeps } from './helpers/dispatcher-adapters'

/**
 * Egress policy for external reference lookups in web mode (parity PR-W7c).
 *
 * The lookups run the real desktop API clients; `globalThis.fetch` is the
 * only way out of the process, so it is replaced with a spy. A disabled
 * service must answer 403 with a user-facing reason and make NO request;
 * an enabled one reaches the (mocked) upstream. Every attempt is audited
 * with user, service and identifier before any request is made.
 */

class MemoryPolicy implements ExternalLookupPolicySource {
  policy: ExternalLookupPolicy = defaultExternalLookupPolicy()
  async load(): Promise<ExternalLookupPolicy> {
    return this.policy
  }
  async save(update: ReferenceServicePolicyUpdate, actor: string): Promise<ExternalLookupPolicy> {
    const services = { ...this.policy.services }
    for (const [id, value] of Object.entries(update)) {
      if (typeof value === 'boolean') services[id as keyof typeof services] = value
    }
    this.policy = { services, updatedAt: 1, updatedBy: actor }
    return this.policy
  }
}

const ANALYST = { session: { user: { id: 2, username: 'analyst', role: 'user' } } }
const ADMIN = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

let fetchSpy: ReturnType<typeof vi.fn>
const realFetch = globalThis.fetch

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

beforeEach(() => {
  fetchSpy = vi.fn(async () => jsonResponse({}))
  globalThis.fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  closeWebGeneReferenceDb()
})

function harness(enabled: ReferenceServicePolicyUpdate = {}) {
  const base = makeDeps()
  const policy = new MemoryPolicy()
  for (const [id, value] of Object.entries(enabled)) {
    policy.policy.services[id as keyof ExternalLookupPolicy['services']] = value === true
  }
  const referenceServices = new WebReferenceServices({
    policy,
    audit: createExternalLookupAuditSink(base.deps.session)
  })
  const deps = { ...base.deps, referenceServices } as DispatcherDeps
  const { overrides } = buildDispatcher(deps)
  const call = async (key: string, args: unknown[], request: unknown = ANALYST) => {
    const reply = { code: vi.fn() }
    const result = await overrides[key].handle(args, request as never, reply as never, deps)
    return { result, reply }
  }
  const auditRows = () =>
    base.writeExecute.mock.calls
      .map(([task]) => task as { type: string; params: Array<Record<string, unknown>> })
      .filter((task) => task.type === 'audit:append')
      .map((task) => task.params[0])
  return { call, policy, auditRows, writeExecute: base.writeExecute }
}

const DISABLED_CALLS: Array<{ key: string; args: unknown[]; service: string; identifier: string }> =
  [
    { key: 'vep:fetch', args: ['chr1', 100, 'A', 'T'], service: 'vep', identifier: 'chr1:100:A>T' },
    {
      key: 'myvariant:fetch',
      args: ['chr1', 100, 'A', 'T'],
      service: 'myvariant',
      identifier: 'chr1:100:A>T'
    },
    {
      key: 'spliceai:fetch',
      args: ['chr1', 100, 'A', 'T'],
      service: 'spliceai',
      identifier: 'chr1:100:A>T'
    },
    { key: 'gnomad:getVariants', args: ['TP53'], service: 'gnomad', identifier: 'TP53' },
    { key: 'gnomad:getClinVarVariants', args: ['TP53'], service: 'gnomad', identifier: 'TP53' },
    { key: 'protein:getMapping', args: ['TP53'], service: 'protein', identifier: 'TP53' },
    { key: 'protein:getDomains', args: ['P04637'], service: 'protein', identifier: 'P04637' },
    { key: 'protein:getStructure', args: ['P04637'], service: 'protein', identifier: 'P04637' },
    { key: 'protein:getGeneStructure', args: ['TP53'], service: 'protein', identifier: 'TP53' },
    {
      key: 'panels:searchPanelApp',
      args: ['epilepsy', 'uk'],
      service: 'panelapp',
      identifier: 'uk:epilepsy'
    },
    {
      key: 'panels:importPanelApp',
      args: [{ panelId: 402, region: 'uk', confidenceThreshold: 'green' }],
      service: 'panelapp',
      identifier: 'uk:402'
    },
    {
      key: 'panels:generateStringDb',
      args: [{ seedGenes: ['TP53', 'MDM2'], requiredScore: 700, networkType: 'physical' }],
      service: 'stringdb',
      identifier: 'TP53,MDM2'
    }
  ]

describe('web reference services egress policy', () => {
  test('policy defaults to every service off; malformed stored JSON stays off', () => {
    expect(Object.values(defaultExternalLookupPolicy().services).every((v) => v === false)).toBe(
      true
    )
    expect(parseExternalLookupPolicy('not json').services.vep).toBe(false)
    expect(
      parseExternalLookupPolicy(JSON.stringify({ services: { vep: true, bogus: true } })).services
    ).toMatchObject({ vep: true, myvariant: false })
    expect(
      parseExternalLookupPolicy(JSON.stringify({ services: { vep: 'yes' } })).services.vep
    ).toBe(false)
  })

  test.each(DISABLED_CALLS)(
    '$key with $service disabled: 403 + reason, no outbound request, audited as blocked',
    async ({ key, args, service, identifier }) => {
      const { call, auditRows } = harness()
      const { result, reply } = await call(key, args)

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(result).toMatchObject({ error: 'external-lookup-disabled', service })
      expect((result as { message: string }).message).toMatch(/turned off on this server/)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(auditRows()).toEqual([
        expect.objectContaining({
          action_type: 'api_read',
          entity_type: 'api_call',
          entity_key: `external-lookup:${service}`,
          user_name: 'analyst',
          new_value: expect.objectContaining({
            service,
            method: key,
            identifier,
            outcome: 'blocked'
          })
        })
      ])
    }
  )

  test('an enabled service reaches the upstream and is audited before the request', async () => {
    const { call, auditRows, writeExecute } = harness({ vep: true })
    let auditedBeforeFetch = false
    fetchSpy.mockImplementation(async () => {
      auditedBeforeFetch = writeExecute.mock.calls.length > 0
      return jsonResponse([])
    })

    const { reply } = await call('vep:fetch', ['chr7', 117559590, 'G', 'A'])

    expect(reply.code).not.toHaveBeenCalledWith(403)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toContain('rest.ensembl.org/vep/human/region/')
    expect(auditedBeforeFetch).toBe(true)
    expect(auditRows()[0]).toMatchObject({
      user_name: 'analyst',
      new_value: expect.objectContaining({
        service: 'vep',
        identifier: 'chr7:117559590:G>A',
        outcome: 'allowed',
        hosts: ['rest.ensembl.org']
      })
    })
  })

  test('enabling one service does not open the others', async () => {
    const { call } = harness({ vep: true })
    const { reply } = await call('myvariant:fetch', ['chr1', 100, 'A', 'T'])
    expect(reply.code).toHaveBeenCalledWith(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('a failed audit write blocks the lookup (fail closed)', async () => {
    const { call, writeExecute } = harness({ vep: true })
    writeExecute.mockRejectedValueOnce(new Error('audit down'))
    await expect(call('vep:fetch', ['chr1', 100, 'A', 'T'])).rejects.toThrow('audit down')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('invalid arguments are rejected before policy or network', async () => {
    const { call, auditRows } = harness({ vep: true, gnomad: true })
    expect((await call('vep:fetch', ['chr1', 'x', 'A', 'T'])).reply.code).toHaveBeenCalledWith(400)
    expect((await call('gnomad:getVariants', [''])).reply.code).toHaveBeenCalledWith(400)
    expect(
      (await call('protein:getDomains', ['not an accession!'])).reply.code
    ).toHaveBeenCalledWith(400)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(auditRows()).toEqual([])
  })

  test('status is readable by any user and lists every service off by default', async () => {
    const { call } = harness()
    const { result } = await call('reference-services:status', [])
    const status = result as {
      runtime: string
      configurable: boolean
      services: Array<{ id: string; enabled: boolean; reason: string | null }>
    }
    expect(status.runtime).toBe('web')
    expect(status.configurable).toBe(true)
    expect(status.services.map((s) => s.id)).toEqual([
      'vep',
      'myvariant',
      'spliceai',
      'gnomad',
      'protein',
      'panelapp',
      'stringdb'
    ])
    expect(status.services.every((s) => !s.enabled && s.reason !== null)).toBe(true)
  })

  test('setPolicy is admin-only, validated, persisted and audited', async () => {
    const { call, policy, auditRows } = harness()

    const denied = await call('reference-services:setPolicy', [{ vep: true }], ANALYST)
    expect(denied.reply.code).toHaveBeenCalledWith(403)
    expect(policy.policy.services.vep).toBe(false)

    const invalid = await call('reference-services:setPolicy', [{ evil: true }], ADMIN)
    expect(invalid.reply.code).toHaveBeenCalledWith(400)

    const ok = await call('reference-services:setPolicy', [{ vep: true }], ADMIN)
    expect(ok.reply.code).not.toHaveBeenCalled()
    expect(policy.policy.services.vep).toBe(true)
    expect(policy.policy.updatedBy).toBe('admin')
    const vep = (ok.result as { services: Array<{ id: string; enabled: boolean }> }).services.find(
      (s) => s.id === 'vep'
    )
    expect(vep?.enabled).toBe(true)
    expect(auditRows()).toContainEqual(
      expect.objectContaining({
        action_type: 'api_write',
        entity_key: 'reference-services:setPolicy',
        user_name: 'admin',
        new_value: { method: 'reference-services:setPolicy', update: { vep: true } }
      })
    )
  })

  test('without a ReferenceServices facade the methods answer 501, never 404', async () => {
    const base = makeDeps()
    const { overrides } = buildDispatcher(base.deps)
    const reply = { code: vi.fn() }
    await overrides['gnomad:getClinVarVariants'].handle(
      ['TP53'],
      ANALYST as never,
      reply as never,
      base.deps
    )
    expect(reply.code).toHaveBeenCalledWith(501)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
