/**
 * Shared table cell components
 *
 * Barrel export for convenient importing of all table cell components.
 * These components eliminate duplication between VariantTable.vue and CohortTableRow.vue.
 *
 * @example
 * ```vue
 * import { PositionCell, ClinVarCell, AnnotationsCell } from '@/components/table-cells'
 * ```
 */

export { default as PositionCell } from './PositionCell.vue'
export { default as AlleleCell } from './AlleleCell.vue'
export { default as ClinVarCell } from './ClinVarCell.vue'
export { default as FrequencyCell } from './FrequencyCell.vue'
export { default as CaddScoreCell } from './CaddScoreCell.vue'
export { default as GeneSymbolCell } from './GeneSymbolCell.vue'
export { default as ConsequenceCell } from './ConsequenceCell.vue'
export { default as ExternalLinkCell } from './ExternalLinkCell.vue'
export { default as AnnotationsCell } from './AnnotationsCell.vue'
export { default as EmptyPlaceholder } from './EmptyPlaceholder.vue'
