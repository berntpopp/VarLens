import type {
  BatchAnnotationKey,
  BatchPerCaseAnnotationUpdates,
  GlobalAnnotationUpdates,
  PerCaseAnnotationUpdates,
  VariantAnnotationsResult
} from '../../types/api'
import type { VariantAnnotation, CaseVariantAnnotation } from '../../types/database-entities'
import type { IpcResult } from '../../types/errors'

export interface AnnotationsDomainContract {
  /** Global annotations are keyed by genome build as well (#577). */
  getGlobal: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    genomeBuild: string
  ) => Promise<IpcResult<VariantAnnotation | null>>
  upsertGlobal: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates,
    genomeBuild: string
  ) => Promise<IpcResult<VariantAnnotation>>
  deleteGlobal: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    genomeBuild: string
  ) => Promise<IpcResult<void>>
  getPerCase: (
    caseId: number,
    variantId: number
  ) => Promise<IpcResult<CaseVariantAnnotation | null>>
  upsertPerCase: (
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates
  ) => Promise<IpcResult<CaseVariantAnnotation>>
  batchUpsertPerCase: (
    caseId: number,
    variantIds: number[],
    updates: BatchPerCaseAnnotationUpdates
  ) => Promise<IpcResult<{ updatedCount: number }>>
  deletePerCase: (caseId: number, variantId: number) => Promise<IpcResult<void>>
  getForVariant: (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<VariantAnnotationsResult>>
  /** Global rows of the case's build; without a case, of `genomeBuild`. */
  batchGet: (
    caseId: number | null,
    variantKeys: BatchAnnotationKey[],
    genomeBuild?: string | null
  ) => Promise<IpcResult<Record<string, VariantAnnotationsResult>>>
}
