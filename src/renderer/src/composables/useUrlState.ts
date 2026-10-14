/**
 * Two-way sync between view state and the router query (`?case=&tab=&f=&q=&sort=`).
 *
 * Owners of a piece of state register a binding with `useUrlParam`:
 *   - `read()`  → the current value as a query string, `undefined` to omit
 *                 the key, or `null` for "not ready yet" (skip writing);
 *   - `apply()` → set state from a query value (`undefined` = default).
 *
 * State → URL: changes are batched per microtask into one router navigation
 * (`push` if any changed binding is a history step such as case/tab, else
 * `replace` for filters/sort). URL → state: on reload, back/forward or a
 * pasted link, bindings of the active route apply in `priority` order
 * (case before tab before filters), with writes suppressed meanwhile so
 * intermediate resets never clobber the URL being restored.
 *
 * In web mode the router uses HTML5 history, so this is real deep-linking;
 * on desktop it runs against memory history (harmless, keeps one code path).
 */
import {
  computed,
  nextTick,
  onScopeDispose,
  ref,
  shallowReactive,
  watch,
  type ComputedRef
} from 'vue'
import type { LocationQuery, LocationQueryRaw, Router } from 'vue-router'
import { VIEW_STATE_KEYS } from '../utils/url-state/view-state-memory'

export type ViewRoute = 'case' | 'cohort'

export interface UrlParamBinding {
  route: ViewRoute
  key: string
  /** Lower applies first when restoring from the URL. */
  priority: number
  /**
   * `push` = navigable history step (case, tab); `replace` = refinement.
   * A function is evaluated per change (e.g. automatic tab defaults replace).
   */
  history: 'push' | 'replace' | (() => 'push' | 'replace')
  read: () => string | undefined | null
  apply: (value: string | undefined) => void | Promise<void>
}

const bindings = shallowReactive(new Set<UrlParamBinding>())
let router: Router | null = null
let restoring = 0
/**
 * URL-state work in flight that will still change view state: restores, and
 * history steps (case/tab) until their navigation and the view memory settled.
 * Tables hold their queries meanwhile (see useViewStatePending).
 */
const settling = ref(0)
/**
 * Restores run strictly one after another: fast back/forward must not
 * interleave two half-applied states. Each run reads the route afresh, so
 * the last navigation always wins.
 */
let restoreChain: Promise<void> = Promise.resolve()
function queueRestore(): void {
  settling.value++
  restoreChain = restoreChain
    .then(restoreFromRoute, restoreFromRoute)
    .finally(() => settling.value--)
}
let flushScheduled = false
let pendingPush = false
/** Paths we navigated to ourselves; their route change must not re-apply state. */
const selfNavigations = new Set<string>()

function currentRoute(): ViewRoute | null {
  const name = router?.currentRoute.value.name
  return name === 'case' || name === 'cohort' ? name : null
}

function queryValue(query: LocationQuery, key: string): string | undefined {
  const raw = query[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === null || value === undefined ? undefined : value
}

/** Query object reflecting the registered state of `route` (for navigation). */
export function queryForRoute(route: ViewRoute): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  for (const b of bindings) {
    if (b.route !== route) continue
    const value = b.read()
    if (typeof value === 'string') query[b.key] = value
  }
  return query
}

function flushWrites(): void {
  flushScheduled = false
  const usePush = pendingPush
  pendingPush = false
  // A history step holds view queries until its navigation (and view memory) settled.
  const settled = (): void => {
    if (usePush) settling.value--
  }
  const route = currentRoute()
  if (router === null || route === null || restoring > 0) {
    settled()
    return
  }
  const current = router.currentRoute.value.query
  const next: LocationQueryRaw = { ...current }
  let changed = false
  for (const b of bindings) {
    if (b.route !== route) continue
    const value = b.read()
    if (value === null) continue
    if (value === queryValue(current, b.key)) continue
    changed = true
    if (value === undefined) delete next[b.key]
    else next[b.key] = value
  }
  if (!changed) {
    settled()
    return
  }
  selfNavigations.add(router.resolve({ query: next }).fullPath)
  const navigation = usePush ? router.push({ query: next }) : router.replace({ query: next })
  void navigation.finally(settled)
}

function scheduleWrite(binding: UrlParamBinding): void {
  if (restoring > 0) return
  const history = typeof binding.history === 'function' ? binding.history() : binding.history
  if (history === 'push' && !pendingPush) {
    pendingPush = true
    settling.value++
  }
  if (flushScheduled) return
  flushScheduled = true
  void Promise.resolve().then(flushWrites)
}

/** Apply the URL to every binding of the active route, in priority order. */
async function restoreFromRoute(): Promise<void> {
  const route = currentRoute()
  if (router === null || route === null) return
  const query = router.currentRoute.value.query
  const ordered = [...bindings]
    .filter((b) => b.route === route)
    .sort((a, b) => a.priority - b.priority)
  restoring++
  try {
    for (const b of ordered) {
      const value = queryValue(query, b.key)
      if (value === b.read()) continue
      await b.apply(value)
      // Let watchers that react to this step (e.g. per-case filter reset)
      // run before the next binding applies on top of them.
      await nextTick()
      await nextTick()
    }
  } finally {
    restoring--
  }
  if (restoring === 0) {
    for (const b of ordered) scheduleWrite({ ...b, history: 'replace' })
  }
}

/** Install once (App.vue). Re-applies state on back/forward and pasted links. */
export function installUrlStateSync(appRouter: Router): void {
  router = appRouter
  watch(
    () => appRouter.currentRoute.value.fullPath,
    (fullPath) => {
      if (selfNavigations.delete(fullPath)) return
      queueRestore()
    }
  )
  // The initial navigation may settle after bindings registered (lazy views).
  void appRouter.isReady().then(queueRestore)
}

/** Register a binding for the lifetime of the calling component/scope. */
export function useUrlParam(binding: UrlParamBinding): void {
  bindings.add(binding)
  onScopeDispose(() => bindings.delete(binding))

  // Restore on registration (reload / deep link): URL wins over defaults.
  if (router !== null && currentRoute() === binding.route) {
    const value = queryValue(router.currentRoute.value.query, binding.key)
    if (value !== undefined && value !== binding.read()) {
      // Deferred a microtask: the owner may still be mid-setup.
      restoring++
      settling.value++
      void Promise.resolve()
        .then(() => binding.apply(value))
        .finally(() => {
          restoring--
          settling.value--
        })
    }
  }

  watch(binding.read, () => scheduleWrite(binding))
}

/** True while a URL restore applies state (it should land at once, not debounced). */
export function isRestoringUrlState(): boolean {
  return restoring > 0
}

/**
 * Navigate to `query` and apply it to the bindings, holding view queries until
 * done (view memory restore). Works without the sync installed (navigation only).
 */
export async function replaceAndRestore(target: Router, query: LocationQueryRaw): Promise<void> {
  settling.value++
  try {
    if (router !== null) selfNavigations.add(target.resolve({ query }).fullPath)
    await target.replace({ query })
    if (router !== null) queueRestore()
  } finally {
    settling.value--
  }
}

/**
 * Whether `route`'s table state is still being settled from the URL: a restore
 * or history step is in flight, or the URL carries view state (`f`/`q`/`sort`)
 * whose owner has not registered yet (e.g. the deferred case filter toolbar).
 * A table holds its page query meanwhile, so it queries once, with that state.
 */
export function useViewStatePending(route: ViewRoute): ComputedRef<boolean> {
  return computed(() => {
    if (router === null || currentRoute() !== route) return false
    if (settling.value > 0) return true
    const query = router.currentRoute.value.query
    return VIEW_STATE_KEYS.some(
      (key) =>
        queryValue(query, key) !== undefined &&
        ![...bindings].some((b) => b.route === route && b.key === key)
    )
  })
}

/** Test seam: reset module state between tests. */
export function _resetUrlStateForTesting(): void {
  bindings.clear()
  router = null
  restoring = 0
  settling.value = 0
  flushScheduled = false
  pendingPush = false
  selfNavigations.clear()
  restoreChain = Promise.resolve()
}
