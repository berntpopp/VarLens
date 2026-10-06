/**
 * Audit / authorization registry completeness (PR-W8, spec §4.1 L3).
 *
 * The web server has ONE security map (src/web/server/security/
 * operation-security-map.ts). This test makes it impossible to:
 *   - serve a method that has no policy (it would be refused at runtime, but
 *     we want the omission caught before it ships),
 *   - keep a stale policy for a method that no longer exists,
 *   - classify a mutating method as a read (so it would skip write auditing),
 *   - leave a write un-audited without a written reason,
 *   - quietly widen what viewers can write or what non-admins can administer.
 */
import { describe, expect, test } from 'vitest'

import { buildDispatcher, publicOverrideKeys } from '../../src/web/server/dispatcher'
import {
  DISPATCHER_SECURITY_MAP,
  HTTP_ROUTE_SECURITY_MAP
} from '../../src/web/server/security/operation-security-map'
import { READ_TASK_TYPES, WRITE_TASK_TYPES } from '../../src/web/server/task-types'
import { isPublicApiPath } from '../../src/web/server/auth'
import { makeDeps } from './helpers/dispatcher-adapters'

const { deps } = makeDeps()
const overrides = buildDispatcher(deps).overrides
const REACHABLE = new Set<string>([
  ...Object.keys(overrides),
  ...READ_TASK_TYPES,
  ...WRITE_TASK_TYPES
])
const ENTRIES = Object.entries(DISPATCHER_SECURITY_MAP)

/** Method-name prefixes that always mean "changes server-side state". */
const MUTATING_VERB =
  /^(create|update|delete|upsert|set|assign|remove|add|start|cancel|switch|insert|reorder|duplicate|activate|deactivate|reactivate|clear|rebuild|run|extract|cleanup|import|reset|change|login|logout)/

function methodOf(key: string): string {
  return key.slice(key.indexOf(':') + 1)
}

describe('operation security registry', () => {
  test('every reachable dispatcher method has exactly one policy', () => {
    const missing = [...REACHABLE].filter((key) => DISPATCHER_SECURITY_MAP[key] === undefined)
    expect(missing, 'add these methods to DISPATCHER_SECURITY_MAP').toEqual([])
  })

  test('the map has no stale entries for methods the dispatcher no longer serves', () => {
    const stale = Object.keys(DISPATCHER_SECURITY_MAP).filter((key) => !REACHABLE.has(key))
    expect(stale, 'remove these entries or restore the handler').toEqual([])
  })

  test('every executor write task and every mutating verb is classified as a write', () => {
    const misclassified = ENTRIES.filter(
      ([key, policy]) =>
        policy.kind !== 'write' &&
        ((WRITE_TASK_TYPES as readonly string[]).includes(key) || MUTATING_VERB.test(methodOf(key)))
    ).map(([key]) => key)
    expect(misclassified).toEqual([])
  })

  test('executor read tasks are never classified as writes', () => {
    const wrong = READ_TASK_TYPES.filter((key) => DISPATCHER_SECURITY_MAP[key]?.kind === 'write')
    expect(wrong).toEqual([])
  })

  test('every write is audited (by the wrapper or its handler) or exempt with a reason', () => {
    const all = { ...DISPATCHER_SECURITY_MAP, ...HTTP_ROUTE_SECURITY_MAP }
    for (const [key, policy] of Object.entries(all)) {
      const audit = policy.audit
      if (audit.mode === 'handler') {
        expect(
          audit.event.trim().length,
          `${key}: handler audit must name its event`
        ).toBeGreaterThan(3)
      }
      if (audit.mode === 'exempt') {
        expect(audit.reason, `${key}: exemption reason must be a sentence`).toMatch(
          /^[A-Z].{19,}\.$/
        )
      }
    }
  })

  test('handler-audited methods are exactly the ones that write their own audit rows', () => {
    const handlerAudited = ENTRIES.filter(([, p]) => p.audit.mode === 'handler')
      .map(([key]) => key)
      .sort()
    expect(handlerAudited).toEqual([
      'auth:changePassword',
      'auth:createUser',
      'auth:deactivateUser',
      'auth:login',
      'auth:logout',
      'auth:reactivateUser',
      'auth:resetPassword',
      'auth:setRole',
      // Outbound reference lookups write their own egress audit row (P-C).
      'gnomad:getClinVarVariants',
      'gnomad:getVariants',
      'myvariant:fetch',
      'panels:searchPanelApp',
      'reference-services:setPolicy',
      'spliceai:fetch'
    ])
  })

  test('viewers can only perform self-service writes', () => {
    const viewerWrites = ENTRIES.filter(
      ([, p]) => p.kind === 'write' && (p.minRole === 'viewer' || p.minRole === 'public')
    )
      .map(([key]) => key)
      .sort()
    expect(viewerWrites).toEqual(['auth:changePassword', 'auth:login', 'auth:logout', 'vep:cancel'])
  })

  test('administration stays admin-only', () => {
    const adminOnly = ENTRIES.filter(([, p]) => p.minRole === 'admin')
      .map(([key]) => key)
      .sort()
    expect(adminOnly).toEqual([
      'audit:query',
      'auth:createUser',
      'auth:deactivateUser',
      'auth:listUsers',
      'auth:reactivateUser',
      'auth:resetPassword',
      'auth:setRole',
      'cases:deleteAll',
      'hpo:clearCache',
      'myvariant:clearCache',
      'reference-services:setPolicy',
      'spliceai:clearCache',
      'vep:clearCache'
    ])
  })

  test('public policies match the public overrides and the session gate allowlist', () => {
    const publicPolicies = ENTRIES.filter(([, p]) => p.minRole === 'public')
      .map(([key]) => key)
      .sort()
    expect(publicPolicies).toEqual([...publicOverrideKeys(overrides)].sort())
    for (const key of publicPolicies) {
      const [domain, method] = key.split(':')
      expect(isPublicApiPath(`/api/${domain}/${method}`), key).toBe(true)
    }
  })

  test('non-dispatcher routes declare their policies', () => {
    expect(Object.keys(HTTP_ROUTE_SECURITY_MAP).sort()).toEqual([
      'http:events',
      'http:export:download',
      'http:import:upload'
    ])
    expect(HTTP_ROUTE_SECURITY_MAP['http:import:upload'].minRole).toBe('analyst')
    expect(HTTP_ROUTE_SECURITY_MAP['http:export:download'].minRole).toBe('analyst')
  })
})
