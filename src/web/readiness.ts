export interface ReadinessSignals {
  /** Control state DB (read/write) health. */
  controlOpen: boolean
  /** Control read-replica health (true when no separate read pool is configured). */
  controlReadOpen: boolean
  /** Public annotation read DB health (true when the public annotation DB is not configured). */
  publicAnnotationOpen: boolean
}

export interface ReadinessReport {
  ready: boolean
  body: {
    status: 'ok' | 'unhealthy'
    db: { open: boolean }
    publicAnnotationDb: { open: boolean }
  }
}

/**
 * A5c — compute the /readyz report from independent DB-health signals.
 *
 * `db.open` reports CONTROL DB health only; public-annotation health is a separate
 * `publicAnnotationDb.open` signal so a degraded public read path is not misreported
 * as a control-DB outage. Overall readiness (and the 503) still fails if either the
 * control DB or the public annotation DB is down.
 */
export function buildReadinessReport(signals: ReadinessSignals): ReadinessReport {
  const dbOpen = signals.controlOpen && signals.controlReadOpen
  const ready = dbOpen && signals.publicAnnotationOpen
  return {
    ready,
    body: {
      status: ready ? 'ok' : 'unhealthy',
      db: { open: dbOpen },
      publicAnnotationDb: { open: signals.publicAnnotationOpen }
    }
  }
}
