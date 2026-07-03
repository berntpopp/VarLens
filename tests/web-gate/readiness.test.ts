import { describe, expect, test } from 'vitest'

import { buildReadinessReport } from '../../src/web/readiness'

/**
 * A5c — /readyz must report control-DB health and public-annotation-DB health as
 * SEPARATE signals. Previously `db.open` was folded together with public health, so
 * a degraded public read path masqueraded as a control-DB outage.
 */
describe('buildReadinessReport', () => {
  test('all healthy: ready, both signals open', () => {
    expect(
      buildReadinessReport({ controlOpen: true, controlReadOpen: true, publicAnnotationOpen: true })
    ).toEqual({
      ready: true,
      body: { status: 'ok', db: { open: true }, publicAnnotationDb: { open: true } }
    })
  })

  test('public annotation down does not report the control db as down', () => {
    const report = buildReadinessReport({
      controlOpen: true,
      controlReadOpen: true,
      publicAnnotationOpen: false
    })
    expect(report.ready).toBe(false)
    expect(report.body.db.open).toBe(true)
    expect(report.body.publicAnnotationDb.open).toBe(false)
    expect(report.body.status).toBe('unhealthy')
  })

  test('control state down reports db.open false', () => {
    expect(
      buildReadinessReport({ controlOpen: false, controlReadOpen: true, publicAnnotationOpen: true })
        .body.db.open
    ).toBe(false)
  })

  test('control read down reports db.open false', () => {
    expect(
      buildReadinessReport({ controlOpen: true, controlReadOpen: false, publicAnnotationOpen: true })
        .body.db.open
    ).toBe(false)
  })
})
