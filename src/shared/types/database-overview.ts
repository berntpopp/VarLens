/**
 * Database overview types for the admin console dialog.
 */
import type { CohortSummary } from './cohort'

/** Overview case with metadata */
export interface OverviewCase {
  id: number
  name: string
  variant_count: number
  created_at: number
  affected_status: string | null
}

/** Cohort group with member count */
export interface OverviewCohortGroup {
  id: number
  name: string
  description: string | null
  created_at: number
  member_count: number
}

/** Tag with usage count */
export interface OverviewTag {
  id: number
  name: string
  color: string
  usage_count: number
}

/** HPO term frequency across cases */
export interface OverviewPhenotype {
  hpo_id: string
  hpo_label: string
  case_count: number
}

/** Complete database overview response */
export interface DatabaseOverview {
  summary: CohortSummary
  cases: OverviewCase[]
  cohortGroups: OverviewCohortGroup[]
  tags: OverviewTag[]
  topPhenotypes: OverviewPhenotype[]
  /**
   * Same-load read warnings, as on cohort reads. `staleSummary`: the variant
   * figures of `summary` come from a cohort summary that is being rebuilt.
   */
  warnings?: { staleSummary?: boolean }
}
