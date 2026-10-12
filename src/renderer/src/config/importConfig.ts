/** User-facing copy for case names chosen in the import dialogs. */
export const CASE_NAME_MESSAGES = {
  REQUIRED: 'Case name is required',
  EXISTS: (name: string): string => `A case named '${name}' already exists`,
  REPEATED: 'Each sample needs its own case name'
} as const
