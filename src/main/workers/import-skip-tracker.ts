import { MAX_IMPORT_SKIP_REASONS } from '../../shared/types/import-worker'

export class ImportSkipTracker {
  count = 0
  readonly reasons: string[] = []

  /** Record a skip and return whether its representative reason was retained. */
  record(reason: string): boolean {
    this.count += 1
    if (this.reasons.length >= MAX_IMPORT_SKIP_REASONS) return false
    this.reasons.push(reason)
    return true
  }
}
