import type { BuildReview } from '../../types/build-review'
import type { Case, CaseSearchParams, CaseWithCohorts } from '../../types/database'
import type { IpcResult } from '../../types/errors'
import type { CaseDeleteJobHandle, CaseDeleteTarget } from '../../types/case-delete-job'

export interface CasesDomainContract {
  list: () => Promise<IpcResult<Case[]>>
  query: (
    params: CaseSearchParams
  ) => Promise<IpcResult<{ data: CaseWithCohorts[]; total_count: number }>>
  delete: (id: number) => Promise<IpcResult<void>>
  deleteAll: () => Promise<IpcResult<number>>
  deleteBatch: (ids: number[]) => Promise<IpcResult<number>>
  /**
   * Start a background `case_delete` job and return immediately with its id.
   * Progress / completion arrive as `jobs:changed` snapshots; cancel with
   * `jobs:cancel`. See src/shared/types/case-delete-job.ts.
   */
  startDelete: (target: CaseDeleteTarget) => Promise<IpcResult<CaseDeleteJobHandle>>
  availableBuilds: () => Promise<IpcResult<Array<{ build: string; caseCount: number }>>>
  /** Cases whose genome build must be confirmed before their chromosome names are updated. */
  buildReviews: () => Promise<IpcResult<BuildReview[]>>
  /** Confirm a flagged case's build; its chromosome names are renamed to that build's form. */
  resolveBuildReview: (caseId: number, build: string) => Promise<IpcResult<void>>
}
