import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { AnalysisGroupMember, WindowAPI } from '../../../../shared/types/api'
import { ZYGOSITY_COLORS } from '../../../../shared/config/domain.config'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import { genotypeZygosity } from '../../../../shared/utils/genotype'
import type { useColumnPreferences } from '../../composables/useColumnPreferences'
import { useExternalLinksStore } from '../../stores/externalLinksStore'
import { LINKS_COLUMN_KEY, linksColumnWidthRem } from '../../utils/link-outs'
import { svHeaders } from './sv-columns'
import { cnvHeaders } from './cnv-columns'
import { strHeaders } from './str-columns'
import { withFixedWidth } from './column-widths'
import { useAutoHiddenColumns } from '../../composables/useResponsiveLayout'
import { withPhenotypeDefault } from './usePhenotypeColumn'

export interface ColumnDef {
  title: string
  key: string
  sortable: boolean
  width?: string
  align?: 'start' | 'end' | 'center'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: (item: any) => unknown
}

/** Returns the appropriate column definitions for a given variant type. */
export function getHeadersForType(variantType: string): ColumnDef[] {
  switch (variantType) {
    case 'sv':
      return svHeaders
    case 'cnv':
      return cnvHeaders
    case 'str':
      return strHeaders
    default:
      return baseHeaders
  }
}

export const baseHeaders: ColumnDef[] = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' },
  { title: 'Ref', key: 'ref', sortable: false, width: '100px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '100px' },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Impact', key: 'consequence', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' },
  { title: 'CADD', key: 'cadd', sortable: true, align: 'end' },
  { title: 'Phenotype', key: 'phenotype_score', sortable: true },
  { title: 'Consequence', key: 'func', sortable: true },
  { title: 'OMIM', key: 'omim_mim_number', sortable: true, width: '100px' },
  { title: 'Transcript', key: 'transcript', sortable: true },
  { title: 'cDNA', key: 'cdna', sortable: true },
  { title: 'AA Change', key: 'aa_change', sortable: true },
  { title: 'Qual', key: 'qual', sortable: true, align: 'end' },
  { title: 'HPO Score', key: 'hpo_sim_score', sortable: true, align: 'end' },
  { title: 'HPO Match', key: 'hpo_match', sortable: true },
  { title: 'MoI', key: 'moi', sortable: true }
]

export function linksColumn(linkCount: number): ColumnDef[] {
  if (linkCount === 0) return []
  return [
    {
      title: 'Links',
      key: LINKS_COLUMN_KEY,
      sortable: false,
      width: `${linksColumnWidthRem(linkCount)}rem`
    }
  ]
}

export function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export function zygosityColor(gt: string | null | undefined): string | undefined {
  const zygosity = genotypeZygosity(gt)
  return zygosity === null ? undefined : ZYGOSITY_COLORS[zygosity]
}

export function formatFamilyCallMeta(call?: {
  gq?: number | null
  dp?: number | null
}): string | undefined {
  if (!call) return undefined
  const parts: string[] = []
  if (call.gq != null) parts.push(`GQ ${call.gq}`)
  if (call.dp != null) parts.push(`DP ${call.dp}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function useFamilyMembers(
  groupIdGetter: () => number | undefined,
  caseIdGetter: () => number,
  api?: WindowAPI
): Ref<AnalysisGroupMember[]> {
  const familyMembers = ref<AnalysisGroupMember[]>([])
  watch(
    [groupIdGetter, caseIdGetter],
    async ([groupId, currentCaseId]) => {
      if (groupId == null || api?.analysisGroups?.get === undefined) {
        familyMembers.value = []
        return
      }
      try {
        const group = unwrapIpcResult(await api.analysisGroups.get(groupId))
        if (groupIdGetter() !== groupId || caseIdGetter() !== currentCaseId) return
        const members = group?.members ?? []
        familyMembers.value = members.some((m) => m.case_id === currentCaseId)
          ? members.filter((m) => m.case_id !== currentCaseId)
          : []
      } catch {
        familyMembers.value = []
      }
    },
    { immediate: true }
  )
  return familyMembers
}

export function familyMemberColumns(
  members: ReadonlyArray<{ case_id: number; role: string }>
): ColumnDef[] {
  return members.map((m) => ({
    key: `_member_${m.case_id}`,
    title: roleLabel(m.role),
    align: 'center' as const,
    sortable: false
  }))
}

function spliceAfterGt(cols: ColumnDef[], memberCols: ColumnDef[]): ColumnDef[] {
  if (memberCols.length === 0) return cols
  const gtIdx = cols.findIndex((c) => c.key === 'gt_num')
  if (gtIdx === -1) return [...cols, ...memberCols]
  return [...cols.slice(0, gtIdx + 1), ...memberCols, ...cols.slice(gtIdx + 1)]
}

/**
 * Composable that computes dynamic, ordered, and visible column sets.
 *
 * @param prefs - Column preferences from useColumnPreferences
 * @param variantType - Optional reactive variant type; swaps base column set when
 *   set to 'sv', 'cnv', or 'str'. Defaults to SNV/Indel columns.
 *
 * Columns without an explicit visibility preference follow the responsive
 * default from `useAutoHiddenColumns` (lowest-priority columns hidden on
 * narrower viewports).
 */
export function useVariantColumns(
  prefs: ReturnType<typeof useColumnPreferences>['prefs'],
  variantType?: Ref<string> | ComputedRef<string>,
  /** The case, for the Phenotype column's default (usePhenotypeColumn.ts) */
  caseId?: () => number,
  /** Non-proband members of the active analysis group (#628). */
  familyMembers?:
    | Ref<ReadonlyArray<{ case_id: number; role: string }>>
    | ComputedRef<ReadonlyArray<{ case_id: number; role: string }>>
) {
  if (caseId !== undefined) prefs = withPhenotypeDefault(prefs, caseId)
  const linksStore = useExternalLinksStore()
  const memberCols = computed(() => familyMemberColumns(familyMembers?.value ?? []))

  /** All headers including the merged Links column (SNV/Indel view only). */
  const headers: ComputedRef<ColumnDef[]> = computed(() => {
    const type = variantType?.value ?? 'snv'
    // Type-specific views (SV/CNV/STR) have curated columns and no link-outs or exact-coordinate family joins
    if (type !== 'snv') return getHeadersForType(type)
    const typeHeaders = spliceAfterGt(getHeadersForType(type), memberCols.value)
    return [...typeHeaders, ...linksColumn(linksStore.virtualLinks.length)]
  })

  /** Columns ordered by user preferences. */
  const orderedColumns = computed(() => {
    const base = headers.value
    if (prefs.value.order.length > 0) {
      const memberKeySet = new Set(memberCols.value.map((c) => c.key))
      const withoutUnorderedMembers = base.filter(
        (c) => !memberKeySet.has(c.key) || prefs.value.order.includes(c.key)
      )
      const sorted = [...withoutUnorderedMembers].sort((a, b) => {
        const aIdx = prefs.value.order.indexOf(a.key)
        const bIdx = prefs.value.order.indexOf(b.key)
        if (aIdx === -1 && bIdx === -1) return 0
        if (aIdx === -1) return 1
        if (bIdx === -1) return -1
        return aIdx - bIdx
      })
      const unorderedMembers = memberCols.value.filter((c) => !prefs.value.order.includes(c.key))
      return spliceAfterGt(sorted, unorderedMembers)
    }
    return base
  })

  const { isVisible } = useAutoHiddenColumns(headers, prefs)

  /** Only columns visible per user preferences, with shared fixed widths (no jitter). */
  const visibleHeaders = computed(() =>
    orderedColumns.value.filter((h) => isVisible(h.key)).map(withFixedWidth)
  )

  /** Filterable columns: sortable data columns (exclude annotations and the Links column). */
  const filterableColumns = computed(() =>
    visibleHeaders.value.filter(
      (h) => h.sortable !== false && h.key !== LINKS_COLUMN_KEY && h.key !== 'annotations'
    )
  )

  return { headers, orderedColumns, visibleHeaders, filterableColumns }
}
