import { EXPORT_NUMBER_FORMATS } from '../../shared/config'

/** Format a cell value — rounds configured numeric columns, keeping them numbers. */
export function formatCellValue(key: string, value: unknown): string | number | null {
  if (value === null || value === undefined) return ''
  const format = EXPORT_NUMBER_FORMATS[key]
  if (format !== undefined && typeof value === 'number' && Number.isFinite(value)) {
    return 'decimals' in format
      ? Number(value.toFixed(format.decimals))
      : Number(value.toPrecision(format.significantDigits))
  }
  return value as string | number | null
}

export { escapeDelimitedCell as csvEscape } from '../../shared/utils/delimited-text'
