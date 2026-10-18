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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 50_000
const REVOKED_SESSIONS_FILENAME = 'web-revoked-sessions.json'

export function resolveDefaultRevocationsPath(): string | undefined {
  const fromEnv = process.env.VARLENS_REVOKED_SESSIONS_PATH
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim()
  }
  const recoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
  if (
    typeof recoveryDir === 'string' &&
    recoveryDir.trim() !== '' &&
    isAbsolute(recoveryDir.trim())
  ) {
    return join(recoveryDir.trim(), REVOKED_SESSIONS_FILENAME)
  }
  if (existsSync('/data')) {
    return join('/data', REVOKED_SESSIONS_FILENAME)
  }
  return undefined
}

export class SessionRevocations {
  private readonly revoked = new Map<string, number>()
  private readonly storagePath?: string

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly now: () => number = Date.now,
    storagePath?: string
  ) {
    this.storagePath = storagePath ?? resolveDefaultRevocationsPath()
    this.load()
  }

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
    this.save()
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

  private load(): void {
    if (this.storagePath === undefined || this.storagePath === '') return
    try {
      if (!existsSync(this.storagePath)) return
      const raw = readFileSync(this.storagePath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const now = this.now()
      for (const [sid, expiresAt] of Object.entries(parsed)) {
        if (typeof expiresAt === 'number' && expiresAt > now) {
          this.revoked.set(sid, expiresAt)
        }
      }
    } catch {
      // Ignore unreadable or corrupt file
    }
  }

  private save(): void {
    if (this.storagePath === undefined || this.storagePath === '') return
    try {
      const dir = dirname(this.storagePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
      }
      const data: Record<string, number> = {}
      for (const [sid, expiresAt] of this.revoked) {
        data[sid] = expiresAt
      }
      const tmp = `${this.storagePath}.${randomBytes(4).toString('hex')}.tmp`
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
      renameSync(tmp, this.storagePath)
    } catch {
      // Best-effort write if disk is not writable
    }
  }
}

export function newSessionId(): string {
  return randomUUID()
}
