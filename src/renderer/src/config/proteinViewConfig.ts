/**
 * Copy for the protein view entry points (details-panel strip and header
 * buttons, row quick menu, `p` shortcut). One source so every entry point
 * gives the same reason when the view cannot open.
 */
export const PROTEIN_VIEW_COPY = {
  lookupsOff: 'Protein view needs external lookups — an administrator can enable them in Settings',
  noVariant: 'Select a variant to open the protein view',
  noGene: 'No gene annotated for this variant',
  noProteinPosition: 'No protein position for this variant',
  noMapping: 'No UniProt protein found for this gene',
  loadFailed: 'Protein data could not be loaded',
  noDomain: 'no annotated domain'
} as const

/** Modal tabs, in display order; the strip and buttons open one directly. */
export type ProteinViewTab = 'lollipop' | 'gene-structure' | '3d'
