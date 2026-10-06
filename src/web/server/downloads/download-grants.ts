/**
 * Short-lived, single-use, user-bound download grants (PR-W5, spec §4.5).
 *
 * Why signed tokens rather than plain cookie-authenticated GETs with the
 * export parameters in the query string:
 *
 *   - The grant is minted by `export:prepareDownload`, an ordinary dispatcher
 *     POST, so it passes the Fetch-Metadata/Origin CSRF gate and the role
 *     check like every other unsafe call. The GET that follows only redeems
 *     a token, so a cross-site page cannot make a victim's browser start an
 *     export by navigation, and the GET itself has no side effect beyond
 *     streaming what was already authorized.
 *   - Tokens are HMAC-SHA256 signed with a per-process key, expire after
 *     `ttlMs` (60 s default) and are deleted on first use, so a URL that
 *     leaks through history, logs or a proxy cannot be replayed.
 *   - Redemption ALSO requires the session cookie of the user the grant was
 *     minted for (defence in depth: a stolen token is useless on its own).
 *   - The parameters stay on the server, which removes the ~12 KB request-
 *     line limit the query-string design imposed on large filter sets.
 *
 * Grants live in process memory (bounded): a restart invalidates pending
 * downloads, which is harmless — the user clicks Export again. A
 * multi-instance deployment needs sticky sessions for this route.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface DownloadGrant<T = unknown> {
  id: string
  userId: number
  username: string
  artifact: T
  expiresAt: number
}

export type RedeemFailure =
  'malformed' | 'bad-signature' | 'unknown-or-used' | 'expired' | 'wrong-user'

export interface DownloadGrantRegistryOptions {
  ttlMs?: number
  maxPerUser?: number
  maxTotal?: number
  now?: () => number
  key?: Buffer
}

const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_PER_USER = 8
const DEFAULT_MAX_TOTAL = 1_000

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

export class DownloadGrantRegistry<T = unknown> {
  private readonly grants = new Map<string, DownloadGrant<T>>()
  private readonly key: Buffer
  private readonly ttlMs: number
  private readonly maxPerUser: number
  private readonly maxTotal: number
  private readonly now: () => number

  constructor(options: DownloadGrantRegistryOptions = {}) {
    this.key = options.key ?? randomBytes(32)
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxPerUser = options.maxPerUser ?? DEFAULT_MAX_PER_USER
    this.maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL
    this.now = options.now ?? Date.now
  }

  private sign(id: string, userId: number, expiresAt: number): string {
    return base64url(createHmac('sha256', this.key).update(`${id}.${userId}.${expiresAt}`).digest())
  }

  private prune(): void {
    const now = this.now()
    for (const [id, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(id)
    }
  }

  /** Mint a token for `artifact`. Oldest grants of the user are evicted past the cap. */
  issue(user: { id: number; username: string }, artifact: T): { token: string; expiresAt: number } {
    this.prune()
    const mine = [...this.grants.values()].filter((g) => g.userId === user.id)
    for (const stale of mine.slice(0, Math.max(0, mine.length - this.maxPerUser + 1))) {
      this.grants.delete(stale.id)
    }
    if (this.grants.size >= this.maxTotal) {
      const oldest = this.grants.keys().next().value
      if (oldest !== undefined) this.grants.delete(oldest)
    }
    const id = base64url(randomBytes(18))
    const expiresAt = this.now() + this.ttlMs
    this.grants.set(id, { id, userId: user.id, username: user.username, artifact, expiresAt })
    return { token: `${id}.${expiresAt}.${this.sign(id, user.id, expiresAt)}`, expiresAt }
  }

  /**
   * Redeem (and consume) a token for the session user. Any failure leaves no
   * grant behind for a wrong-user attempt either: a token presented by the
   * wrong account is burned, so it cannot be retried.
   */
  redeem(
    token: string,
    userId: number
  ): { ok: true; grant: DownloadGrant<T> } | { ok: false; reason: RedeemFailure } {
    const parts = token.split('.')
    if (parts.length !== 3) return { ok: false, reason: 'malformed' }
    const [id, expiresRaw, signature] = parts
    const expiresAt = Number(expiresRaw)
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || !Number.isSafeInteger(expiresAt)) {
      return { ok: false, reason: 'malformed' }
    }
    const grant = this.grants.get(id)
    // Verify against the grant's own user so a forged userId cannot match.
    const expected = Buffer.from(this.sign(id, grant?.userId ?? userId, expiresAt))
    const given = Buffer.from(signature)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return { ok: false, reason: 'bad-signature' }
    }
    if (grant === undefined || grant.expiresAt !== expiresAt) {
      return { ok: false, reason: 'unknown-or-used' }
    }
    this.grants.delete(id)
    if (grant.expiresAt <= this.now()) return { ok: false, reason: 'expired' }
    if (grant.userId !== userId) return { ok: false, reason: 'wrong-user' }
    return { ok: true, grant }
  }

  /** Pending (unexpired, unredeemed) grants; for tests and metrics. */
  get size(): number {
    this.prune()
    return this.grants.size
  }
}
