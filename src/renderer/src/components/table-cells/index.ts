/**
 * Shared table cell components
 *
 * Barrel export for convenient importing of all table cell components.
 * These components eliminate duplication between VariantTable.vue and CohortDataTable.vue.
 * The simple value/link cells are functional components (see simple-cells.ts).
 *
 * @example
 * ```vue
 * import { PositionCell, ClinVarCell, AnnotationsCell } from '@/components/table-cells'
 * ```
 */

export {
  PositionCell,
  AlleleCell,
  ClinVarCell,
  FrequencyCell,
  CaddScoreCell,
  GeneSymbolCell,
  ConsequenceCell,
  ExternalLinkCell,
  EmptyPlaceholder,
  HgvsCell
} from './simple-cells'
export { CellIcon, CellChip } from './cell-components'
export { default as AnnotationsCell } from './AnnotationsCell.vue'
export { default as AnnotationsHeader } from './AnnotationsHeader.vue'
export { default as ExpandToggleCell } from './ExpandToggleCell.vue'
