/** User-facing import messages, shared by the desktop and web import paths. */
export const IMPORT_MESSAGES = {
  /** A columnar row whose width differs from the header would shift every later value. */
  rowWidthMismatch: (row: number, values: number, columns: number): string =>
    `Row ${row} has ${values} values but the header declares ${columns} columns`
} as const
