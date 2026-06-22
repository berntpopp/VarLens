import { describe, expect, test } from 'vitest'

describe('web server - hosted topology preflight', () => {
  test('hosted mode validates hosted env and fails closed before single-PG fallback', async () => {
    const previous = {
      topology: process.env.VARLENS_WEB_DB_TOPOLOGY,
      pgUrl: process.env.VARLENS_PG_URL,
      controlRo: process.env.VARLENS_CONTROL_RO_PG_URL,
      controlState: process.env.VARLENS_CONTROL_STATE_PG_URL,
      publicAnnotation: process.env.VARLENS_PUBLIC_ANNOTATION_PG_URL,
      workspaceSecretDir: process.env.VARLENS_WORKSPACE_DB_SECRET_DIR,
      controlPoolMax: process.env.VARLENS_CONTROL_POOL_MAX,
      publicAnnotationPoolMax: process.env.VARLENS_PUBLIC_ANNOTATION_POOL_MAX,
      workspacePoolMax: process.env.VARLENS_WORKSPACE_POOL_MAX,
      workspacePoolGlobalMax: process.env.VARLENS_WORKSPACE_POOL_GLOBAL_MAX,
      workspacePoolIdleMs: process.env.VARLENS_WORKSPACE_POOL_IDLE_MS
    }

    process.env.VARLENS_WEB_DB_TOPOLOGY = 'hosted'
    delete process.env.VARLENS_PG_URL
    process.env.VARLENS_CONTROL_RO_PG_URL = 'postgresql://control-ro/db'
    process.env.VARLENS_CONTROL_STATE_PG_URL = 'postgresql://control-state/db'
    process.env.VARLENS_WORKSPACE_DB_SECRET_DIR = '/var/run/varlens/workspaces'

    try {
      const { buildApp } = await import('../../../src/web/server')
      await expect(buildApp()).rejects.toThrow(/hosted workspace routing is not implemented/i)
    } finally {
      restoreEnv('VARLENS_WEB_DB_TOPOLOGY', previous.topology)
      restoreEnv('VARLENS_PG_URL', previous.pgUrl)
      restoreEnv('VARLENS_CONTROL_RO_PG_URL', previous.controlRo)
      restoreEnv('VARLENS_CONTROL_STATE_PG_URL', previous.controlState)
      restoreEnv('VARLENS_PUBLIC_ANNOTATION_PG_URL', previous.publicAnnotation)
      restoreEnv('VARLENS_WORKSPACE_DB_SECRET_DIR', previous.workspaceSecretDir)
      restoreEnv('VARLENS_CONTROL_POOL_MAX', previous.controlPoolMax)
      restoreEnv('VARLENS_PUBLIC_ANNOTATION_POOL_MAX', previous.publicAnnotationPoolMax)
      restoreEnv('VARLENS_WORKSPACE_POOL_MAX', previous.workspacePoolMax)
      restoreEnv('VARLENS_WORKSPACE_POOL_GLOBAL_MAX', previous.workspacePoolGlobalMax)
      restoreEnv('VARLENS_WORKSPACE_POOL_IDLE_MS', previous.workspacePoolIdleMs)
    }
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
