/**
 * Decide how quickly a filter change should reach the table.
 *
 * Discrete interactions (chips, presets, checkboxes, Clear) apply immediately;
 * only free-typed fields wait for a 250 ms pause so a query is not issued per
 * keystroke. The search box is already debounced upstream by the DSL parser
 * (useDslSearch), so `searchQuery` counts as discrete here — debouncing it
 * again would stack two delays.
 *
 * Shared by the case adapter (useFilterState) and the cohort filter bar so
 * both views apply filters with the same timing (cohort parity).
 */
import { useDebounce } from './useDebounce'

export const TYPED_FILTER_DEBOUNCE_MS = 250

/** FilterState fields edited by typing into a text/number field. */
export const TYPED_FILTER_FIELDS: ReadonlySet<string> = new Set([
  'geneSymbol',
  'maxGnomadAf',
  'minCadd',
  'minCarriers',
  'maxInternalAf',
  'panelPaddingBp'
])

/** Top-level fields that differ between two JSON-serialized filter states. */
export function changedFilterFields(previous: string | undefined, next: string): string[] {
  if (previous === undefined) return ['*']
  const a = JSON.parse(previous) as Record<string, unknown>
  const b = JSON.parse(next) as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}

export function useFilterEmitScheduler(emit: () => void, typedDelayMs = TYPED_FILTER_DEBOUNCE_MS) {
  const { debouncedFn: emitTyped, cancel } = useDebounce(emit, typedDelayMs)

  /** Apply now, superseding any pending typed emission. */
  const emitNow = (): void => {
    cancel()
    emit()
  }

  /** Route a serialized-state change to the immediate or typed path. */
  const onStateChange = (next: string, previous: string | undefined): void => {
    const changed = changedFilterFields(previous, next)
    if (changed.length === 0) return
    if (changed.every((field) => TYPED_FILTER_FIELDS.has(field))) emitTyped()
    else emitNow()
  }

  return { emitNow, emitTyped, cancel, onStateChange }
}
