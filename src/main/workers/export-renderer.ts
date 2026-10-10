/** Format a cell value — applies numeric formatting for specific columns. */
export function formatCellValue(key: string, value: unknown): string | number | null {
  if (value === null || value === undefined) return ''
  if (key === 'gnomad_af' && typeof value === 'number') {
    return value.toExponential(2)
  }
  if (key === 'cadd' && typeof value === 'number') {
    return value.toFixed(2)
  }
  if (key === 'hpo_sim_score' && typeof value === 'number') {
    return value.toFixed(4)
  }
  return value as string | number | null
}

export { escapeDelimitedCell as csvEscape } from '../../shared/utils/delimited-text'
