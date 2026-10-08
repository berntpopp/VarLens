import type { CohortVariantIdentity } from '../types/cohort'

/**
 * Row key of a cohort variant, built at read time from the six identity
 * fields. Opaque: compare it, never parse it. JSON keeps an ALT that contains
 * the separator (a breakend such as `]13:123456]T`) from colliding with
 * another row.
 */
export function cohortVariantKey(v: CohortVariantIdentity): string {
  return JSON.stringify([v.chr, v.pos, v.ref, v.alt, v.variant_type, v.genome_build])
}
