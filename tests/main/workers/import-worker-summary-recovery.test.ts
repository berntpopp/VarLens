// @vitest-environment node
/**
 * What an import session does when the cohort summary it is about to maintain
 * cannot be trusted or cannot be repaired: it must never report the summary
 * current on a base nobody verified, and never lose track of an unfinished
 * session.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { referenceSummary, snapshotSummary, summaryMeta } from './support/summary-reference'
import {
  openSummarySessionHarness,
  sessionStatuses,
  variantAt,
  type SummarySessionHarness
} from './support/summary-session-harness'

const MARK_SESSION_OPEN =
  "INSERT OR REPLACE INTO cohort_summary_meta (key, value) VALUES ('import_session_open', '1')"

/** Makes every full rebuild fail: its first statement empties the summary. */
const BREAK_REBUILD = `
  CREATE TRIGGER break_rebuild BEFORE DELETE ON cohort_variant_summary
  BEGIN SELECT RAISE(ABORT, 'summary rebuild broken for this test'); END`

describe('import worker: cohort summary recovery', () => {
  let h: SummarySessionHarness

  beforeEach(() => {
    h = openSummarySessionHarness()
  })

  afterEach(() => {
    h.close()
  })

  const needsStartupRebuild = (): boolean => {
    const service = new DatabaseService(h.dbPath)
    try {
      return service.needsStartupRebuild()
    } finally {
      service.close()
    }
  }

  it('does not merge files onto a summary whose session-start rebuild failed', async () => {
    await h.run([h.file('A', [variantAt(100, 'AAA'), variantAt(200, 'AAA')])])
    // A worker died mid-session: marker left behind, summary off, not flagged.
    h.db.exec(MARK_SESSION_OPEN)
    h.db.exec('UPDATE cohort_variant_summary SET carrier_count = 99 WHERE pos = 100')
    h.db.exec(BREAK_REBUILD)

    const messages = await h.run([h.file('B', [variantAt(100, 'AAA')])])

    expect(sessionStatuses(messages)).toEqual(['B:success'])
    // The rebuild could not run, so the summary is wrong — and says so.
    expect(
      h.db.prepare('SELECT carrier_count FROM cohort_variant_summary WHERE pos = 100').get()
    ).not.toEqual({ carrier_count: 2 })
    expect(summaryMeta(h.db, 'is_stale')).toBe('1')
    expect(summaryMeta(h.db, 'import_session_open')).toBe('1')
    expect(needsStartupRebuild()).toBe(true)

    // Once a rebuild can run again, the next session repairs it.
    h.db.exec('DROP TRIGGER break_rebuild')
    await h.run([])
    expect(snapshotSummary(h.db)).toEqual(referenceSummary(h.db))
    expect(summaryMeta(h.db, 'is_stale')).toBe('0')
    expect(summaryMeta(h.db, 'import_session_open')).toBeUndefined()
  })
})
