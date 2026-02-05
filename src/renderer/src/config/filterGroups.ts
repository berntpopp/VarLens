/**
 * Filter group configurations for consequence types and ClinVar classifications
 * These define logical groupings for multi-select filters with "select all" functionality
 *
 * Values sourced from real clinical datasets (case-892-snv-annotations.json.gz)
 * Any values not in these groups will appear in an auto-generated "Other" category
 */

export interface FilterGroupItem {
  value: string
  label: string
}

export interface FilterGroup {
  id: string
  label: string
  color: string
  icon: string
  items: FilterGroupItem[]
}

export interface FilterGroupConfig {
  id: string
  label: string
  groups: FilterGroup[]
}

/**
 * Consequence type groupings
 * Groups variants by their functional impact severity
 */
export const consequenceGroups: FilterGroupConfig = {
  id: 'consequence',
  label: 'Consequence',
  groups: [
    {
      id: 'truncating',
      label: 'Truncating',
      color: 'error',
      icon: 'mdi-alert-octagon',
      items: [
        { value: 'stop_gained', label: 'Stop Gained' },
        { value: 'frameshift_truncation', label: 'Frameshift Truncation' },
        { value: 'frameshift_elongation', label: 'Frameshift Elongation' },
        { value: 'frameshift_variant', label: 'Frameshift' },
        { value: 'splice_acceptor_variant', label: 'Splice Acceptor' },
        { value: 'splice_donor_variant', label: 'Splice Donor' },
        { value: 'start_lost', label: 'Start Lost' },
        { value: 'stop_lost', label: 'Stop Lost' }
      ]
    },
    {
      id: 'missense_inframe',
      label: 'Missense / Inframe',
      color: 'warning',
      icon: 'mdi-alert',
      items: [
        { value: 'missense_variant', label: 'Missense' },
        { value: 'inframe_indel', label: 'Inframe Indel' },
        { value: 'inframe_deletion', label: 'Inframe Deletion' },
        { value: 'inframe_insertion', label: 'Inframe Insertion' },
        { value: 'disruptive_inframe_deletion', label: 'Disruptive Inframe Del' },
        { value: 'disruptive_inframe_insertion', label: 'Disruptive Inframe Ins' }
      ]
    },
    {
      id: 'splice_region',
      label: 'Splice Region',
      color: 'orange-darken-2',
      icon: 'mdi-call-split',
      items: [{ value: 'splice_region_variant', label: 'Splice Region' }]
    },
    {
      id: 'synonymous',
      label: 'Synonymous',
      color: 'info',
      icon: 'mdi-equal',
      items: [
        { value: 'synonymous_variant', label: 'Synonymous' },
        { value: 'stop_retained_variant', label: 'Stop Retained' }
      ]
    },
    {
      id: 'utr',
      label: 'UTR',
      color: 'blue-grey',
      icon: 'mdi-arrow-expand-horizontal',
      items: [
        { value: '3_prime_UTR_exon_variant', label: "3' UTR Exon" },
        { value: '3_prime_UTR_intron_variant', label: "3' UTR Intron" },
        { value: '5_prime_UTR_exon_variant', label: "5' UTR Exon" },
        { value: '5_prime_UTR_intron_variant', label: "5' UTR Intron" }
      ]
    },
    {
      id: 'intronic',
      label: 'Intronic',
      color: 'grey',
      icon: 'mdi-minus',
      items: [
        { value: 'coding_transcript_intron_variant', label: 'Coding Intron' },
        { value: 'non_coding_transcript_intron_variant', label: 'Non-coding Intron' }
      ]
    },
    {
      id: 'noncoding_other',
      label: 'Non-coding Other',
      color: 'grey-darken-1',
      icon: 'mdi-dna',
      items: [
        { value: 'non_coding_transcript_exon_variant', label: 'Non-coding Exon' },
        { value: 'upstream_gene_variant', label: 'Upstream' },
        { value: 'downstream_gene_variant', label: 'Downstream' },
        { value: 'intergenic_variant', label: 'Intergenic' }
      ]
    },
    {
      id: 'complex',
      label: 'Complex',
      color: 'purple',
      icon: 'mdi-swap-horizontal',
      items: [
        { value: 'complex_substitution', label: 'Complex Substitution' },
        { value: 'direct_tandem_duplication', label: 'Tandem Duplication' },
        { value: 'mnv', label: 'MNV' }
      ]
    }
  ]
}

/**
 * ClinVar classification groupings
 * Groups by pathogenicity interpretation
 *
 * Note: ClinVar values can have combined classifications (e.g., "Benign|risk_factor")
 * We group by the primary classification where possible
 */
export const clinvarGroups: FilterGroupConfig = {
  id: 'clinvar',
  label: 'ClinVar',
  groups: [
    {
      id: 'pathogenic',
      label: 'Pathogenic',
      color: 'error',
      icon: 'mdi-alert-circle',
      items: [
        { value: 'Pathogenic', label: 'Pathogenic' },
        { value: 'Likely_pathogenic', label: 'Likely Pathogenic' },
        { value: 'Pathogenic/Likely_pathogenic', label: 'Pathogenic/LP' },
        { value: 'Pathogenic|risk_factor', label: 'Pathogenic + Risk' },
        { value: 'Likely_pathogenic|protective', label: 'LP + Protective' }
      ]
    },
    {
      id: 'vus',
      label: 'VUS',
      color: 'warning',
      icon: 'mdi-help-circle',
      items: [
        { value: 'Uncertain_significance', label: 'VUS' },
        { value: 'Uncertain_significance|association', label: 'VUS + Association' },
        { value: 'Conflicting_classifications_of_pathogenicity', label: 'Conflicting' },
        {
          value: 'Conflicting_classifications_of_pathogenicity|drug_response|other',
          label: 'Conflicting + Drug'
        },
        {
          value: 'Conflicting_classifications_of_pathogenicity|protective',
          label: 'Conflicting + Protective'
        },
        {
          value: 'Conflicting_classifications_of_pathogenicity|risk_factor',
          label: 'Conflicting + Risk'
        }
      ]
    },
    {
      id: 'benign',
      label: 'Benign',
      color: 'success',
      icon: 'mdi-check-circle',
      items: [
        { value: 'Benign', label: 'Benign' },
        { value: 'Likely_benign', label: 'Likely Benign' },
        { value: 'Benign/Likely_benign', label: 'Benign/LB' },
        { value: 'Benign|Affects', label: 'Benign + Affects' },
        { value: 'Benign|association', label: 'Benign + Association' },
        { value: 'Benign|confers_sensitivity', label: 'Benign + Sensitivity' },
        { value: 'Benign|drug_response', label: 'Benign + Drug' },
        { value: 'Benign|other', label: 'Benign + Other' },
        { value: 'Benign|protective', label: 'Benign + Protective' },
        { value: 'Benign|risk_factor', label: 'Benign + Risk' },
        { value: 'Likely_benign|drug_response|other', label: 'LB + Drug/Other' }
      ]
    },
    {
      id: 'risk_association',
      label: 'Risk / Association',
      color: 'orange',
      icon: 'mdi-trending-up',
      items: [
        { value: 'risk_factor', label: 'Risk Factor' },
        { value: 'Likely_risk_allele', label: 'Likely Risk Allele' },
        { value: 'Uncertain_risk_allele|risk_factor', label: 'Uncertain Risk' },
        { value: 'association', label: 'Association' },
        { value: 'association|drug_response|risk_factor', label: 'Association + Drug/Risk' },
        { value: 'protective', label: 'Protective' },
        { value: 'drug_response', label: 'Drug Response' },
        { value: 'Affects', label: 'Affects' }
      ]
    },
    {
      id: 'compound',
      label: 'Compound Het',
      color: 'purple',
      icon: 'mdi-link-variant',
      items: [
        { value: 'Compound:Pathogenic', label: 'Compound: Pathogenic' },
        { value: 'Compound:Likely_pathogenic', label: 'Compound: LP' },
        { value: 'Compound:Pathogenic/Likely_pathogenic', label: 'Compound: P/LP' },
        { value: 'Compound:Uncertain_significance', label: 'Compound: VUS' },
        { value: 'Compound:Benign', label: 'Compound: Benign' }
      ]
    },
    {
      id: 'no_classification',
      label: 'No Classification',
      color: 'grey',
      icon: 'mdi-help-circle-outline',
      items: [
        { value: 'not_provided', label: 'Not Provided' },
        { value: 'no_classification_for_the_single_variant', label: 'No Classification' },
        { value: 'other', label: 'Other' }
      ]
    }
  ]
}

/**
 * Get all values from a filter group config
 */
export function getAllGroupValues(config: FilterGroupConfig): string[] {
  return config.groups.flatMap((group) => group.items.map((item) => item.value))
}

/**
 * Get all values from a specific group by ID
 */
export function getGroupValues(config: FilterGroupConfig, groupId: string): string[] {
  const group = config.groups.find((g) => g.id === groupId)
  return group ? group.items.map((item) => item.value) : []
}

/**
 * Check if all items in a group are selected
 */
export function isGroupFullySelected(
  config: FilterGroupConfig,
  groupId: string,
  selectedValues: string[]
): boolean {
  const groupValues = getGroupValues(config, groupId)
  return groupValues.length > 0 && groupValues.every((v) => selectedValues.includes(v))
}

/**
 * Check if some (but not all) items in a group are selected
 */
export function isGroupPartiallySelected(
  config: FilterGroupConfig,
  groupId: string,
  selectedValues: string[]
): boolean {
  const groupValues = getGroupValues(config, groupId)
  const selectedCount = groupValues.filter((v) => selectedValues.includes(v)).length
  return selectedCount > 0 && selectedCount < groupValues.length
}

/**
 * Toggle all items in a group
 * If any are unselected, select all; if all selected, deselect all
 */
export function toggleGroup(
  config: FilterGroupConfig,
  groupId: string,
  currentSelection: string[]
): string[] {
  const groupValues = getGroupValues(config, groupId)
  const isFullySelected = isGroupFullySelected(config, groupId, currentSelection)

  if (isFullySelected) {
    // Deselect all items in this group
    return currentSelection.filter((v) => !groupValues.includes(v))
  } else {
    // Select all items in this group (add missing ones)
    const newSelection = [...currentSelection]
    groupValues.forEach((v) => {
      if (!newSelection.includes(v)) {
        newSelection.push(v)
      }
    })
    return newSelection
  }
}
