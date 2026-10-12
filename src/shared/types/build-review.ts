import type { BuildReviewReason } from '../genome/contig-naming-plan'

/**
 * A case whose genome build could not be confirmed, so its chromosome names
 * were not updated to the build's form (cases:buildReviews).
 */
export interface BuildReview {
  caseId: number
  caseName: string
  storedBuild: string
  /** Build named by the case's source header, when it disagrees. */
  suggestedBuild: string | null
  reason: BuildReviewReason
}

/** The build the user confirmed for one flagged case (cases:resolveBuildReviews). */
export interface BuildReviewChoice {
  caseId: number
  build: string
}

/** cases:buildReviews: the flagged cases, and whether a background rename still runs. */
export interface BuildReviewList {
  reviews: BuildReview[]
  /**
   * PostgreSQL only: stored cases are still being renamed in the background,
   * so cohort counts can mix old and new names until it finishes.
   */
  renameInProgress: boolean
  /** PostgreSQL only: the background rename keeps failing (it retries with back-off). */
  renameFailed: boolean
}
