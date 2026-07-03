/**
 * Argon2id PHC-string validation helpers shared by the web auth surface.
 *
 * Shape-check an Argon2id PHC string without invoking the verifier. This
 * rejects plaintext, other hash families, malformed salt/hash segments, and
 * parameter values that do not match the provider policy so bootstrap fails
 * loudly before any database write.
 */
import { ARGON2_POLICY } from '../../main/auth/providers/argon2-provider'

const ARGON2ID_PHC_PATTERN =
  /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/

function isValidPhcBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 !== 1
}

export function isLikelyArgon2idHash(value: string): boolean {
  const match = value.match(ARGON2ID_PHC_PATTERN)
  return match !== null && isValidPhcBase64(match[5]) && isValidPhcBase64(match[6])
}

export function assertArgon2idHashMatchesProviderPolicy(value: string): void {
  const match = value.match(ARGON2ID_PHC_PATTERN)
  if (match === null || !isValidPhcBase64(match[5]) || !isValidPhcBase64(match[6])) {
    throw new Error(
      'createFirstUserFromHash: passwordHash does not look like an Argon2id hash. ' +
        'Generate one with `npm run varlens:hash-password`.'
    )
  }

  const [, version, memoryCost, timeCost, parallelism] = match
  const mismatches: string[] = []
  if (version !== '19') mismatches.push(`v=${version}`)
  if (Number(memoryCost) !== ARGON2_POLICY.memoryCost) mismatches.push(`m=${memoryCost}`)
  if (Number(timeCost) !== ARGON2_POLICY.timeCost) mismatches.push(`t=${timeCost}`)
  if (Number(parallelism) !== ARGON2_POLICY.parallelism) mismatches.push(`p=${parallelism}`)

  if (mismatches.length > 0) {
    throw new Error(
      'createFirstUserFromHash: passwordHash Argon2id parameters do not match the ' +
        `VarLens provider policy (m=${ARGON2_POLICY.memoryCost},t=${ARGON2_POLICY.timeCost},` +
        `p=${ARGON2_POLICY.parallelism}). Mismatched parameter(s): ${mismatches.join(', ')}.`
    )
  }
}
