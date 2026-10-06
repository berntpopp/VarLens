/**
 * Logout for stateless cookie sessions.
 *
 * `@fastify/secure-session` keeps the whole session in the encrypted cookie,
 * so `session.delete()` only clears the browser's copy: a cookie captured
 * before logout would stay valid. Every session therefore carries a random
 * `sid` (set by the auth preHandler), logout records it here, and the
 * preHandler rejects a revoked sid. The SSE hub closes that session's
 * streams at the same moment.
 *
 * Process-local and bounded: entries expire after the longest time a cookie
 * can stay unused (the 4 h max-age) plus margin, and the oldest entries are
 * evicted beyond `maxEntries`. A multi-process deployment would need a shared
 * store; VarLens web runs one process per deployment today.
 */
import { randomUUID } from 'node:crypto'

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 50_000

export class SessionRevocations {
  private readonly revoked = new Map<string, number>()

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly now: () => number = Date.now
  ) {}

  revoke(sid: string | undefined): void {
    if (sid === undefined) return
    this.prune()
    this.revoked.delete(sid)
    this.revoked.set(sid, this.now() + this.ttlMs)
    while (this.revoked.size > this.maxEntries) {
      const oldest = this.revoked.keys().next().value
      if (oldest === undefined) break
      this.revoked.delete(oldest)
    }
  }

  isRevoked(sid: string | undefined): boolean {
    if (sid === undefined) return false
    const expiresAt = this.revoked.get(sid)
    if (expiresAt === undefined) return false
    if (expiresAt <= this.now()) {
      this.revoked.delete(sid)
      return false
    }
    return true
  }

  private prune(): void {
    const now = this.now()
    for (const [sid, expiresAt] of this.revoked) {
      if (expiresAt > now) break
      this.revoked.delete(sid)
    }
  }
}

export function newSessionId(): string {
  return randomUUID()
}
