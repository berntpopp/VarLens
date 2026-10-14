/**
 * Tags every database starts with (#125): quick flags for the variant table.
 *
 * Seeded once by SQLite v55 / PostgreSQL 0038, only where no tag of the same
 * name (case-insensitive) exists; users may rename or delete them afterwards.
 * The PG migration repeats these values as a fixed record, and
 * tests/main/storage/postgres-migration-definitions.test.ts fails if they drift.
 * Colours come from the tag palette (renderer composables/useTags.ts).
 */
export interface DefaultTag {
  name: string
  color: string
}

export const DEFAULT_TAGS: readonly DefaultTag[] = [
  { name: 'Pathogenic candidate', color: '#F44336' },
  { name: 'VUS follow-up', color: '#FFC107' },
  { name: 'Benign/artifact', color: '#4CAF50' },
  { name: 'Reported', color: '#2196F3' }
]
