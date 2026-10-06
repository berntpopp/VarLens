/**
 * Per-view document title and page heading (WCAG 2.4.2 Page Titled,
 * 1.3.1 / 2.4.6 headings).
 *
 * VarLens uses memory-history routing, so the browser never sees a URL
 * change; this keeps `document.title` and the view's `<h1>` in sync with
 * what the user is looking at:
 *   case selected → "LB26-0060 · Case · VarLens"
 *   cohort        → "Cohort · VarLens"
 *   no case       → "VarLens"
 */
import { computed, watchEffect, type ComputedRef } from 'vue'
import { useAppState } from './useAppState'

export const APP_NAME = 'VarLens'
const SEPARATOR = ' · '

export interface ViewTitleInput {
  tab: 'case' | 'cohort'
  caseName: string | null
}

export interface ViewTitle {
  /** Value for document.title */
  documentTitle: string
  /** Text for the view's (visually hidden) h1 */
  heading: string
}

export function buildViewTitle({ tab, caseName }: ViewTitleInput): ViewTitle {
  if (tab === 'cohort') {
    return { documentTitle: ['Cohort', APP_NAME].join(SEPARATOR), heading: 'Cohort analysis' }
  }
  const name = caseName?.trim() ?? ''
  if (name !== '') {
    return {
      documentTitle: [name, 'Case', APP_NAME].join(SEPARATOR),
      heading: `Case ${name}`
    }
  }
  return { documentTitle: APP_NAME, heading: `${APP_NAME} — select a case` }
}

/** Reactive view title; also mirrors it into document.title. */
export function useViewTitle(): ComputedRef<ViewTitle> {
  const { activeTab, selectedCaseId, selectedCaseName } = useAppState()
  const title = computed(() =>
    buildViewTitle({
      tab: activeTab.value,
      caseName: selectedCaseId.value == null ? null : selectedCaseName.value
    })
  )
  watchEffect(() => {
    document.title = title.value.documentTitle
  })
  return title
}
