/**
 * Server-sent events for web mode (`GET /api/events`).
 *
 * Events are hints on top of pollable APIs (parity spec §4.5, Limin L10):
 *
 * - Every event carries an `id:` (`<bootId>.<seq>`). A bounded in-memory ring
 *   lets a reconnecting `EventSource` resume via `Last-Event-ID`; when the gap
 *   cannot be filled (server restart, ring overflow) the stream sends
 *   `events:resync` so clients re-poll.
 * - A comment heartbeat every 15 s keeps proxies from idling the stream out.
 * - On every heartbeat the stream re-validates its session against the live
 *   user row (deactivation, password reset, role change). An invalid session,
 *   a logout of the same browser session (`closeSession`) or an admin action
 *   on the user (`closeUser`) ends the stream with `session:revoked`.
 * - Audience: an event goes to one user, or to one user plus every admin
 *   (job snapshots: admins see all jobs). Admin status is re-read on
 *   revalidation, so a demoted admin stops receiving other users' jobs.
 */
import { randomBytes } from 'node:crypto'

import type { FastifyInstance, FastifyRequest } from 'fastify'

import { ErrorCode } from '../../shared/types/errors'

export interface WebEvent {
  id: string
  type: string
  payload: unknown
}

export interface EventViewer {
  userId: number
  role: string
  /** Browser-session id (see auth.ts); lets logout close only its own streams. */
  sid?: string
}

interface StoredEvent extends WebEvent {
  seq: number
  userId: number | undefined
  admins: boolean
}

interface Subscription {
  viewer: EventViewer
  listener: (event: WebEvent) => void
  close: () => void
}

export const EVENT_RESYNC = 'events:resync'
export const EVENT_SESSION_REVOKED = 'session:revoked'
const DEFAULT_RING_SIZE = 1000

export class WebEventHub {
  readonly bootId = randomBytes(6).toString('hex')
  private seq = 0
  private readonly ring: StoredEvent[] = []
  private readonly subscriptions = new Set<Subscription>()

  constructor(private readonly ringSize = DEFAULT_RING_SIZE) {}

  /**
   * Subscribe a stream. `close` is invoked when the hub revokes the
   * subscription (logout / user revoked); the returned function unsubscribes.
   */
  subscribe(
    viewer: EventViewer,
    listener: (event: WebEvent) => void,
    close: () => void = () => undefined
  ): () => void {
    const subscription: Subscription = { viewer, listener, close }
    this.subscriptions.add(subscription)
    return () => {
      this.subscriptions.delete(subscription)
    }
  }

  /** Event for one user. */
  publish(userId: number, type: string, payload: unknown): void {
    this.emit({ userId, admins: false, type, payload })
  }

  /** Event for one user (if any) and every admin. */
  publishToUserAndAdmins(userId: number | undefined, type: string, payload: unknown): void {
    this.emit({ userId, admins: true, type, payload })
  }

  /**
   * Events after `lastEventId` visible to `viewer`, or `undefined` when the
   * gap cannot be replayed (other boot, unparsable id, already evicted).
   */
  replaySince(lastEventId: string, viewer: EventViewer): WebEvent[] | undefined {
    const [boot, rawSeq] = lastEventId.split('.', 2)
    const seq = Number(rawSeq)
    if (boot !== this.bootId || !Number.isInteger(seq) || seq < 0 || seq > this.seq) {
      return undefined
    }
    const oldest = this.ring[0]?.seq ?? this.seq + 1
    if (seq < oldest - 1) return undefined
    return this.ring
      .filter((event) => event.seq > seq && visibleTo(event, viewer))
      .map(({ id, type, payload }) => ({ id, type, payload }))
  }

  /** Close every stream opened by one browser session (logout). */
  closeSession(sid: string | undefined): void {
    if (sid === undefined) return
    this.closeWhere((viewer) => viewer.sid === sid)
  }

  /** Close every stream of a user (deactivated, password reset, role change). */
  closeUser(userId: number): void {
    this.closeWhere((viewer) => viewer.userId === userId)
  }

  subscriberCount(): number {
    return this.subscriptions.size
  }

  private closeWhere(predicate: (viewer: EventViewer) => boolean): void {
    for (const subscription of [...this.subscriptions]) {
      if (!predicate(subscription.viewer)) continue
      this.subscriptions.delete(subscription)
      subscription.close()
    }
  }

  private emit(event: Omit<StoredEvent, 'id' | 'seq'>): void {
    this.seq += 1
    const stored: StoredEvent = { ...event, seq: this.seq, id: `${this.bootId}.${this.seq}` }
    this.ring.push(stored)
    if (this.ring.length > this.ringSize) this.ring.shift()
    const wire: WebEvent = { id: stored.id, type: stored.type, payload: stored.payload }
    for (const subscription of this.subscriptions) {
      if (visibleTo(stored, subscription.viewer)) subscription.listener(wire)
    }
  }
}

function visibleTo(event: StoredEvent, viewer: EventViewer): boolean {
  if (event.userId !== undefined && event.userId === viewer.userId) return true
  return event.admins && viewer.role === 'admin'
}

export interface EventStreamOptions {
  /**
   * Re-check the stream's session. Returns the current role, or `undefined`
   * when the session is no longer valid. Called on every heartbeat.
   */
  revalidate: (request: FastifyRequest) => Promise<{ role: string } | undefined>
  heartbeatMs?: number
}

const DEFAULT_HEARTBEAT_MS = 15_000

function lastEventIdOf(request: FastifyRequest): string | undefined {
  const header = request.headers['last-event-id']
  const value = Array.isArray(header) ? header[0] : header
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 64) : undefined
}

function formatEvent(event: WebEvent): string {
  const id = event.id === '' ? '' : `id: ${event.id}\n`
  return `${id}event: ${event.type}\ndata: ${JSON.stringify(event.payload ?? null)}\n\n`
}

export function registerEventStream(
  app: FastifyInstance,
  events: WebEventHub,
  options: EventStreamOptions
): void {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS

  app.get('/api/events', { schema: { hide: true } }, async (request, reply) => {
    const user = request.session.user
    if (user === undefined) {
      reply.code(401)
      return { code: ErrorCode.UNAUTHENTICATED, message: 'authentication required' }
    }

    const viewer: EventViewer = { userId: user.id, role: user.role, sid: request.session.sid }
    reply.hijack()
    const out = reply.raw
    out.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    out.write('retry: 3000\n: connected\n\n')

    let ended = false
    const timers: NodeJS.Timeout[] = []
    let unsubscribe: () => void = () => undefined
    const end = (reason?: string): void => {
      if (ended) return
      ended = true
      for (const timer of timers) clearInterval(timer)
      unsubscribe()
      if (reason !== undefined && !out.writableEnded) {
        out.write(`event: ${EVENT_SESSION_REVOKED}\ndata: ${JSON.stringify({ reason })}\n\n`)
      }
      if (!out.writableEnded) out.end()
    }

    const lastEventId = lastEventIdOf(request)
    if (lastEventId !== undefined) {
      const missed = events.replaySince(lastEventId, viewer)
      if (missed === undefined) out.write(formatEvent({ id: '', type: EVENT_RESYNC, payload: {} }))
      else for (const event of missed) out.write(formatEvent(event))
    }

    unsubscribe = events.subscribe(
      viewer,
      (event) => {
        if (!ended) out.write(formatEvent(event))
      },
      () => end('revoked')
    )

    let revalidating = false
    const timer = setInterval(() => {
      if (ended || revalidating) return
      out.write(`: heartbeat ${Date.now()}\n\n`)
      revalidating = true
      options
        .revalidate(request)
        .then((live) => {
          if (live === undefined) end('session-invalid')
          else viewer.role = live.role
        })
        .catch((err: unknown) => {
          request.log.warn({ err }, 'event stream: session revalidation failed')
        })
        .finally(() => {
          revalidating = false
        })
    }, heartbeatMs)
    timer.unref()
    timers.push(timer)

    request.raw.on('close', () => end())
  })
}
