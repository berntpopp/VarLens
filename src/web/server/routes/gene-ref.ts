import { getWebGeneReferenceDb } from '../web-gene-reference'
import { unsupportedWebCapability } from './common'
import type { OverrideHandler } from './types'

/**
 * Gene reference metadata. Served from the bundled read-only
 * `gene_reference.db` (shipped in the container under
 * `/app/resources/`). These used to answer 501 unless the parity-fixture
 * mode was on, which broke the Gene Panels dialog in every real
 * deployment. `geneRef:update` / `checkUpdates` stay desktop-only: the
 * web server's reference file is part of the deployed image.
 */
function withGeneRef<T>(
  reply: Parameters<OverrideHandler['handle']>[2],
  capability: string,
  read: () => T
): T | ReturnType<typeof unsupportedWebCapability> {
  try {
    return read()
  } catch {
    return unsupportedWebCapability(reply, capability)
  }
}

export function buildGeneRefOverrides(): Record<string, OverrideHandler> {
  return {
    'gene-ref:info': {
      handle(_args, _request, reply) {
        return withGeneRef(reply, 'geneRef.info', () => getWebGeneReferenceDb().getInfo())
      }
    },

    'gene-ref:assemblies': {
      handle(_args, _request, reply) {
        return withGeneRef(reply, 'geneRef.assemblies', () =>
          getWebGeneReferenceDb().getAssemblies()
        )
      }
    }
  }
}
