import { describe, expect, test } from 'vitest'

import { assertSafeWorkspaceSecretRef, readWebDbTopology } from '../../src/web/topology'

describe('web DB topology contract', () => {
  test('defaults to the existing single-Postgres topology', () => {
    expect(readWebDbTopology({})).toEqual({ mode: 'single' })
  })

  test('rejects hosted-only env in single mode', () => {
    expect(() =>
      readWebDbTopology({
        VARLENS_WEB_DB_TOPOLOGY: 'single',
        VARLENS_CONTROL_RO_PG_URL: 'postgresql://control-ro/db'
      })
    ).toThrow(/Hosted-only database variables/i)
  })

  test('rejects hosted-only pool env in single mode', () => {
    expect(() =>
      readWebDbTopology({
        VARLENS_PG_URL: 'postgresql://single/db',
        VARLENS_WORKSPACE_POOL_MAX: '2'
      })
    ).toThrow(/VARLENS_WORKSPACE_POOL_MAX/i)
  })

  test('rejects invalid topology modes', () => {
    expect(() => readWebDbTopology({ VARLENS_WEB_DB_TOPOLOGY: 'multi' })).toThrow(
      /VARLENS_WEB_DB_TOPOLOGY/i
    )
  })

  test('requires hosted control and workspace routing config', () => {
    expect(() =>
      readWebDbTopology({
        VARLENS_WEB_DB_TOPOLOGY: 'hosted',
        VARLENS_CONTROL_RO_PG_URL: 'postgresql://control-ro/db',
        VARLENS_CONTROL_STATE_PG_URL: 'postgresql://control-state/db'
      })
    ).toThrow(/VARLENS_WORKSPACE_DB_SECRET_DIR/i)
  })

  test('reads hosted config without requiring legacy VARLENS_PG_URL', () => {
    const topology = readWebDbTopology({
      VARLENS_WEB_DB_TOPOLOGY: 'hosted',
      VARLENS_CONTROL_RO_PG_URL: 'postgresql://control-ro/db',
      VARLENS_CONTROL_STATE_PG_URL: 'postgresql://control-state/db',
      VARLENS_PUBLIC_ANNOTATION_PG_URL: 'postgresql://annotation-ro/db',
      VARLENS_WORKSPACE_DB_SECRET_DIR: '/var/run/varlens/workspaces',
      VARLENS_CONTROL_POOL_MAX: '5',
      VARLENS_WORKSPACE_POOL_MAX: '3'
    })

    expect(topology).toMatchObject({
      mode: 'hosted',
      controlReadUrl: 'postgresql://control-ro/db',
      controlStateUrl: 'postgresql://control-state/db',
      publicAnnotationUrl: 'postgresql://annotation-ro/db',
      workspaceSecretDir: '/var/run/varlens/workspaces',
      pools: expect.objectContaining({
        controlPoolMax: 5,
        publicAnnotationPoolMax: 4,
        workspacePoolMax: 3,
        workspacePoolGlobalMax: 20,
        workspacePoolIdleMs: 300_000
      }),
      legacySinglePgUrlPresent: false
    })
  })

  test('rejects non-Postgres hosted URLs', () => {
    expect(() =>
      readWebDbTopology({
        VARLENS_WEB_DB_TOPOLOGY: 'hosted',
        VARLENS_CONTROL_RO_PG_URL: 'https://control-ro/db',
        VARLENS_CONTROL_STATE_PG_URL: 'postgresql://control-state/db',
        VARLENS_WORKSPACE_DB_SECRET_DIR: '/var/run/varlens/workspaces'
      })
    ).toThrow(/VARLENS_CONTROL_RO_PG_URL/i)
  })

  test('rejects relative hosted workspace secret directories', () => {
    expect(() =>
      readWebDbTopology({
        VARLENS_WEB_DB_TOPOLOGY: 'hosted',
        VARLENS_CONTROL_RO_PG_URL: 'postgresql://control-ro/db',
        VARLENS_CONTROL_STATE_PG_URL: 'postgresql://control-state/db',
        VARLENS_WORKSPACE_DB_SECRET_DIR: 'var/run/varlens/workspaces'
      })
    ).toThrow(/VARLENS_WORKSPACE_DB_SECRET_DIR/i)
  })

  test('rejects invalid hosted pool integers', () => {
    expect(() =>
      readWebDbTopology({
        VARLENS_WEB_DB_TOPOLOGY: 'hosted',
        VARLENS_CONTROL_RO_PG_URL: 'postgresql://control-ro/db',
        VARLENS_CONTROL_STATE_PG_URL: 'postgresql://control-state/db',
        VARLENS_WORKSPACE_DB_SECRET_DIR: '/var/run/varlens/workspaces',
        VARLENS_WORKSPACE_POOL_MAX: '0'
      })
    ).toThrow(/VARLENS_WORKSPACE_POOL_MAX/i)
  })

  test('rejects unsafe workspace secret refs', () => {
    expect(() => assertSafeWorkspaceSecretRef('workspace-a.pgurl')).not.toThrow()
    expect(() => assertSafeWorkspaceSecretRef('../workspace-a')).toThrow(/path traversal/i)
    expect(() => assertSafeWorkspaceSecretRef('/workspace-a')).toThrow(/path traversal/i)
    expect(() => assertSafeWorkspaceSecretRef('workspace\\a')).toThrow(/path traversal/i)
    expect(() => assertSafeWorkspaceSecretRef('')).toThrow(/blank/i)
  })
})
