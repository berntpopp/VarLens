import type { HpoTermFlags } from '../types/hpo-profile'

/**
 * The status `assignHpoTerm` stores for given flags (a missing flag is false).
 * Excluded wins: a term looked for and found absent can never be key (spec §2).
 */
export function resolveHpoTermFlags(flags: HpoTermFlags): { excluded: boolean; key: boolean } {
  const excluded = flags.excluded === true
  return { excluded, key: !excluded && flags.key === true }
}
