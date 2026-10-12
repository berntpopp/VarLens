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
