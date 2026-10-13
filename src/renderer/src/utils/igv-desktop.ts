/**
 * The "Local IGV" action (#93): which locus to send to IGV desktop's batch
 * port and which genome IGV must show for it. The CSP allows exactly this
 * origin (src/renderer/index.html, src/web/index.html).
 */
import { GENOME_BUILDS } from '../../../shared/config/genome-builds.config'
import { normalizeBuild, variantInterval, type IntervalSource } from './variant-interval'

export const IGV_BATCH_ORIGIN = 'http://localhost:60151'
/** IGV answers a goto at once; no answer within this means no listener. */
export const IGV_TIMEOUT_MS = 1500

/**
 * The locus IGV should show: the start-end span of an SV/CNV interval (the
 * whole call), else the position. A breakend is its own position: its mate is
 * elsewhere, so no single interval fits.
 */
export function igvLocus(v: IntervalSource & { chr: string }): string {
  const interval = variantInterval(v)
  return interval === null
    ? `${v.chr}:${v.pos}-${v.pos}`
    : `${v.chr}:${interval.start}-${interval.end}`
}

export function igvGotoUrl(locus: string): string {
  return `${IGV_BATCH_ORIGIN}/goto?locus=${encodeURIComponent(locus)}`
}

/** IGV's genome id (hg38, hg19) for a known build; null when the build is unknown. */
export function igvGenomeId(build: string | null | undefined): string | null {
  const id = normalizeBuild(build)
  if (id === null) return null
  const builds: ReadonlyArray<{ id: string; links?: { ucscDb: string } }> = GENOME_BUILDS
  return builds.find((b) => b.id === id)?.links?.ucscDb ?? null
}

/**
 * Send the locus to IGV. Resolves true when IGV's port answered, false when
 * nothing listens (refused or timed out). `no-cors`: IGV sends no CORS
 * headers, so the answer is opaque, but a refused connection still throws.
 */
export async function sendToIgv(locus: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IGV_TIMEOUT_MS)
  try {
    await fetch(igvGotoUrl(locus), { mode: 'no-cors', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
