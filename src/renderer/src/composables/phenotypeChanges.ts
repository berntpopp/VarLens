import { shallowRef } from 'vue'

/**
 * Last change to an input of `hpo_resnik` (#600): a case's committed HPO
 * terms (`caseId`) or newly installed HPO data (`null`, every case). The
 * shortlist refetches on it; a new object per change so watchers always fire.
 */
export const phenotypeChange = shallowRef<{ caseId: number | null } | null>(null)

export function notifyPhenotypeChanged(caseId: number | null): void {
  phenotypeChange.value = { caseId }
}
