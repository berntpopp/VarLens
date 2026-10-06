import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'child_process'
import { performance } from 'perf_hooks'
import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'
import {
  createPerfDatabase,
  importFrozenPerfFixture,
  PERF_CASE_NAMES,
  selectCaseByName
} from './helpers/perf-fixture'
import {
  installQuerySpy,
  readInteractionWindow,
  readQuerySpy,
  startInteractionWindow,
  type InteractionMetrics
} from './helpers/interaction-metrics'
import {
  CASE_TABLE_STEPS,
  closeDetailsPanel,
  COHORT_TABLE_STEPS,
  firstRenderedPosition,
  settleTable,
  sortableHeader,
  type InteractionStep
} from './helpers/interaction-workflows'
import {
  writeJsonArtifact,
  type WorkflowRunArtifact,
  summarizeWorkflowRuns
} from './helpers/perf-artifacts'
import {
  getPerfOutputRoot,
  getPerfWorkflowCommand,
  getPerfWorkflowNames,
  type PerfWorkflowName
} from './helpers/perf-workflows'

interface PerfSnapshot {
  main: {
    elapsedMs: number
    milestones: Record<string, number>
  }
  renderer: {
    traces: Array<{ name: string; duration: number }>
    longTasks: {
      count: number
      totalDurationMs: number
      maxDurationMs: number
    }
  }
}

async function resetPerfSnapshot(window: Page): Promise<void> {
  await window.evaluate(async () => {
    await window.api.perf.resetSnapshot()
  })
}

async function getPerfSnapshot(window: Page): Promise<PerfSnapshot> {
  return await window.evaluate(async () => {
    return await window.api.perf.getSnapshot()
  })
}

async function closeBlockingDrawers(window: Page): Promise<void> {
  const variantDetailsTitle = window.getByText('Variant Details', { exact: true })
  if (await variantDetailsTitle.isVisible()) {
    const closedVariantDetails = await window.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('.v-toolbar-title__placeholder'))
      const title = titles.find((node) => node.textContent?.trim() === 'Variant Details')
      const drawer = title?.closest('nav')
      const closeButton = drawer?.querySelector('.v-toolbar button') as HTMLButtonElement | null
      closeButton?.click()
      return closeButton !== null
    })

    if (closedVariantDetails) {
      await window.waitForTimeout(200)
    }
  }

  const scrim = window.locator('.v-navigation-drawer__scrim').first()
  if ((await scrim.count()) > 0 && (await scrim.isVisible())) {
    const box = await scrim.boundingBox()
    if (box) {
      await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    } else {
      await window.keyboard.press('Escape')
    }
    await expect(scrim).toBeHidden()
  }
}

async function ensureConcreteCaseTab(window: Page): Promise<void> {
  await closeBlockingDrawers(window)
  const variantTabs = window.locator('.variant-type-tabs .v-tab')
  const tabCount = await variantTabs.count()
  if (tabCount < 2) return

  const firstTabText = (await variantTabs.nth(0).textContent()) ?? ''
  if (firstTabText.includes('Shortlist')) {
    await variantTabs.nth(1).click()
  }
}

function makeWorkflowRun(runIndex: number, warmup: boolean, durationMs: number, snapshot: PerfSnapshot) {
  return {
    runIndex,
    warmup,
    durationMs: Math.round(durationMs * 100) / 100,
    longTaskCount: snapshot.renderer.longTasks.count,
    maxSingleLongTaskMs: snapshot.renderer.longTasks.maxDurationMs
  } satisfies WorkflowRunArtifact
}

async function measureStartupShell(runIndex: number): Promise<WorkflowRunArtifact> {
  const launched = await launchElectronApp({ perfMode: true })
  const warmup = runIndex < 2
  const startedAt = performance.now()

  try {
    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)
    await expect(launched.window.locator('.v-app-bar')).toBeVisible()
    const snapshot = await getPerfSnapshot(launched.window)
    return makeWorkflowRun(runIndex, warmup, performance.now() - startedAt, snapshot)
  } finally {
    await launched.cleanup()
  }
}

async function prepareLoadedApp() {
  const launched = await launchElectronApp({ perfMode: true })
  await waitForAppShell(launched.window)
  await dismissDisclaimerIfPresent(launched.window)
  await createPerfDatabase(launched.app, launched.window, launched.userDataDir)
  const importedCases = await importFrozenPerfFixture(launched.window, launched.app)
  const caseCount = await launched.window.evaluate(async () => {
    const cases = await window.api.cases.list()
    return cases.length
  })
  expect(caseCount).toBe(3)
  await launched.window.reload()
  await waitForAppShell(launched.window)
  await dismissDisclaimerIfPresent(launched.window)
  return { ...launched, importedCases }
}

async function measureCaseSelectVisibleRows(
  window: Page,
  caseName: string,
  runIndex: number
): Promise<WorkflowRunArtifact> {
  await window.locator('.mode-toggle .v-btn').nth(0).click()
  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  await selectCaseByName(window, caseName)
  await ensureConcreteCaseTab(window)
  await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })
  await expect(window.locator('.v-data-table tbody tr').first()).toBeVisible({ timeout: 15000 })
  const snapshot = await getPerfSnapshot(window)
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

async function measureFilterApply(window: Page, runIndex: number): Promise<WorkflowRunArtifact> {
  await ensureConcreteCaseTab(window)
  const clearAllButton = window.locator('.applied-filters-bar .v-btn:has-text("Clear all")').first()
  if ((await clearAllButton.count()) > 0) {
    await clearAllButton.click()
    await window.waitForTimeout(250)
  }

  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  const filtersButton = window.locator('.v-btn:has-text("Filters")').first()
  await filtersButton.click()
  const afPreset = window.getByText('<= 1%', { exact: true })
  await afPreset.click()
  await closeBlockingDrawers(window)
  await expect(window.locator('.applied-filters-bar')).toBeVisible({ timeout: 15000 })
  const snapshot = await getPerfSnapshot(window)
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

async function measurePageNextPrev(window: Page, runIndex: number): Promise<WorkflowRunArtifact> {
  await ensureConcreteCaseTab(window)
  const clearAllButton = window.locator('.applied-filters-bar .v-btn:has-text("Clear all")').first()
  if ((await clearAllButton.count()) > 0) {
    await clearAllButton.click()
    await window.waitForTimeout(250)
  }

  const nextButton = window.getByLabel('Next page')
  const previousButton = window.getByLabel('Previous page')

  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  await nextButton.click()
  await previousButton.click()
  await expect(window.locator('.v-data-table tbody tr').first()).toBeVisible({ timeout: 15000 })
  const snapshot = await getPerfSnapshot(window)
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

async function measureCohortToggle(window: Page, runIndex: number): Promise<WorkflowRunArtifact> {
  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  await window.locator('.mode-toggle .v-btn').nth(1).click()
  await expect(window.locator('.v-data-table tbody tr').first()).toBeVisible({ timeout: 15000 })
  const snapshot = await getPerfSnapshot(window)
  await window.locator('.mode-toggle .v-btn').nth(0).click()
  await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

async function measureKeyboardNavBurst(window: Page, runIndex: number): Promise<WorkflowRunArtifact> {
  await ensureConcreteCaseTab(window)
  await window.locator('.v-data-table tbody tr').first().click()
  await resetPerfSnapshot(window)
  const startedAt = performance.now()
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowDown')
  await expect(window.locator('tbody tr.variant-row--selected').first()).toBeVisible({
    timeout: 15000
  })
  const snapshot = await getPerfSnapshot(window)
  return makeWorkflowRun(runIndex, runIndex < 2, performance.now() - startedAt, snapshot)
}

const selectedWorkflows = new Set(getPerfWorkflowNames())

test.describe.serial('Phase 1 renderer perf baseline', () => {
  test.setTimeout(600000)

  test('filter workflow leaves no blocking drawer state behind', async () => {
    const launched = await prepareLoadedApp()

    try {
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[0], 0)
      await measureFilterApply(launched.window, 0)

      await expect(launched.window.locator('.v-navigation-drawer__scrim')).toBeHidden()
      await ensureConcreteCaseTab(launched.window)
      await expect(launched.window.locator('.filter-toolbar-container')).toBeVisible()
    } finally {
      await launched.cleanup()
    }
  })

  test('case reselection reopens the sidebar after row interaction workflows', async () => {
    const launched = await prepareLoadedApp()

    try {
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[0], 0)
      await measureKeyboardNavBurst(launched.window, 0)
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[1], 1)

      await expect(launched.window.locator('.filter-toolbar-container')).toBeVisible()
    } finally {
      await launched.cleanup()
    }
  })

  test('keyboard navigation workflow leaves filter controls reachable', async () => {
    const launched = await prepareLoadedApp()

    try {
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[0], 0)
      await measureKeyboardNavBurst(launched.window, 0)
      await measureFilterApply(launched.window, 1)

      await expect(launched.window.locator('.applied-filters-bar')).toBeVisible()
    } finally {
      await launched.cleanup()
    }
  })

  test('captures frozen-fixture baseline artifacts', async () => {
    const startupRuns: WorkflowRunArtifact[] = []
    for (let runIndex = 0; runIndex < 12; runIndex += 1) {
      startupRuns.push(await measureStartupShell(runIndex))
    }

    const launched = await prepareLoadedApp()

    try {
      const runManifest = {
        gitSha: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
        nodeVersion: process.versions.node,
        electronVersion: (await launched.window.evaluate(async () => {
          const version = await window.api.system.getVersion()
          return version.electron
        })) as string,
        runParameters: {
          fixturePath: 'tests/fixtures/import/columnar-format.json.gz',
          importsPerBaseline: 3,
          runCount: 12,
          warmupDiscarded: 2,
          measuredRuns: 10
        },
        importedCases: launched.importedCases,
        manualChecks: {
          acPowerConfirmed: false,
          otherElectronSessionsClosed: false
        },
        commands: [
          'npm run rebuild:electron',
          'npm run build',
          getPerfWorkflowCommand(getPerfOutputRoot())
        ]
      }
      writeJsonArtifact('run-manifest.json', runManifest)

      const workflowRuns: Record<string, WorkflowRunArtifact[]> = {
        'startup-shell': startupRuns,
        'case-select-visible-rows': [],
        'filter-apply': [],
        'page-next-prev': [],
        'cohort-toggle': [],
        'keyboard-nav-burst': []
      }

      for (let runIndex = 0; runIndex < 12; runIndex += 1) {
        const caseName = PERF_CASE_NAMES[runIndex % PERF_CASE_NAMES.length]
        const caseSelectRun = await measureCaseSelectVisibleRows(launched.window, caseName, runIndex)
        const filterApplyRun = await measureFilterApply(launched.window, runIndex)
        const pageNextPrevRun = await measurePageNextPrev(launched.window, runIndex)
        const cohortToggleRun = await measureCohortToggle(launched.window, runIndex)
        const keyboardNavRun = await measureKeyboardNavBurst(launched.window, runIndex)

        if (selectedWorkflows.has('case-select-visible-rows')) {
          workflowRuns['case-select-visible-rows'].push(caseSelectRun)
        }
        if (selectedWorkflows.has('filter-apply')) {
          workflowRuns['filter-apply'].push(filterApplyRun)
        }
        if (selectedWorkflows.has('page-next-prev')) {
          workflowRuns['page-next-prev'].push(pageNextPrevRun)
        }
        if (selectedWorkflows.has('cohort-toggle')) {
          workflowRuns['cohort-toggle'].push(cohortToggleRun)
        }
        if (selectedWorkflows.has('keyboard-nav-burst')) {
          workflowRuns['keyboard-nav-burst'].push(keyboardNavRun)
        }
      }

      for (const [workflowName, runs] of Object.entries(workflowRuns)) {
        if (runs.length === 0) continue
        writeJsonArtifact(`workflows/${workflowName}/raw-runs.json`, runs)
        writeJsonArtifact(`workflows/${workflowName}/summary.json`, summarizeWorkflowRuns(runs))
      }

      for (const workflowName of Object.keys(workflowRuns) as PerfWorkflowName[]) {
        if (!selectedWorkflows.has(workflowName)) continue
        const summary = summarizeWorkflowRuns(workflowRuns[workflowName])
        expect(summary.measuredRuns).toBe(10)
        expect(Object.keys(summary).sort()).toEqual(
          [
            'maxSingleLongTaskMs',
            'measuredRuns',
            'medianLongTaskCount',
            'p50Ms',
            'p95Ms'
          ].sort()
        )
      }
    } finally {
      await launched.cleanup()
    }
  })
})

/**
 * Interaction-quality gates (audit 2026-10-06 §9, standards A4 P2/P3):
 * per table interaction CLS <= 0.02 and INP < 200 ms, exactly one query per
 * sort, and no stale render when the first request is delayed. Run alone with
 * `make perf-interaction-gates`.
 */
const CLS_BUDGET = 0.02
const INP_BUDGET_MS = 200

/**
 * Explicitly-known pending defects owned by another track. Checked inverted:
 * they must still fail, so the gate goes red (XPASS) once fixed and the entry
 * has to be removed. Never add a new regression here.
 */
const KNOWN_INTERACTION_FAILURES: Record<string, string> = {
  // TODO(track 2, table render perf): cohort column widths change when the
  // sort direction changes; shift 0.046-0.072 lands inside the 500 ms input
  // window, so CWV CLS reads 0 but the user sees the columns jump.
  'cohort-sort:allShifts': 'cohort sort shifts columns (track 2)'
}

function expectWithinBudget(name: string, metric: 'cls' | 'allShifts' | 'inpMs', value: number): void {
  const budget = metric === 'inpMs' ? INP_BUDGET_MS - 1 : CLS_BUDGET
  const known = KNOWN_INTERACTION_FAILURES[`${name}:${metric}`]
  if (known !== undefined) {
    test.info().annotations.push({ type: 'expected-fail', description: `${name} ${metric}: ${known}` })
    expect.soft(value, `XPASS ${name} ${metric} — remove it from KNOWN_INTERACTION_FAILURES`).toBeGreaterThan(budget)
    return
  }
  expect.soft(value, `${name} ${metric}`).toBeLessThanOrEqual(budget)
}

const INTERACTION_ROUNDS = 3

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Runs the step list INTERACTION_ROUNDS times and reports the per-step median,
 * so one GC pause or compositor hiccup on a shared CI runner cannot fail the
 * gate while a consistently slow interaction still does.
 */
async function measureSteps(
  window: Page,
  steps: readonly InteractionStep[]
): Promise<Record<string, InteractionMetrics & { rounds: InteractionMetrics[] }>> {
  const rounds: Record<string, InteractionMetrics[]> = {}
  for (let round = 0; round < INTERACTION_ROUNDS; round += 1) {
    for (const step of steps) {
      await startInteractionWindow(window)
      await step.run(window)
      ;(rounds[step.name] ??= []).push(await readInteractionWindow(window))
    }
    await closeDetailsPanel(window)
  }
  return Object.fromEntries(
    Object.entries(rounds).map(([name, samples]) => [
      name,
      {
        cls: medianOf(samples.map((s) => s.cls)),
        allShifts: medianOf(samples.map((s) => s.allShifts)),
        inpMs: medianOf(samples.map((s) => s.inpMs)),
        interactionCount: medianOf(samples.map((s) => s.interactionCount)),
        rounds: samples
      }
    ])
  )
}

/**
 * A sort must fetch the visible page exactly once. Idle prefetch of the
 * adjacent page (stale-while-revalidate page cache, audit PR 2) is allowed.
 */
function expectOneQueryForVisiblePage(spy: { offsets: Array<number | null>; callArgs: string[] }): void {
  const detail = spy.callArgs.join('\n')
  expect(spy.offsets.filter((offset) => offset === 0), detail).toHaveLength(1)
  expect(spy.offsets.filter((offset) => offset !== 0).length, detail).toBeLessThanOrEqual(1)
}

test.describe.serial('interaction quality gates', () => {
  test.setTimeout(180_000)

  test('table interactions keep CLS <= 0.02 and INP < 200 ms (case + cohort)', async () => {
    const launched = await prepareLoadedApp()
    try {
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[0], 0)
      await settleTable(launched.window)
      const measured = await measureSteps(launched.window, CASE_TABLE_STEPS)

      await closeBlockingDrawers(launched.window)
      await launched.window.locator('.mode-toggle .v-btn').nth(1).click()
      await settleTable(launched.window)
      Object.assign(measured, await measureSteps(launched.window, COHORT_TABLE_STEPS))

      writeJsonArtifact('interaction-quality/metrics.json', measured)
      test.info().annotations.push({ type: 'metrics', description: JSON.stringify(measured) })
      for (const [name, metrics] of Object.entries(measured)) {
        expectWithinBudget(name, 'cls', metrics.cls)
        expectWithinBudget(name, 'allShifts', metrics.allShifts)
        expectWithinBudget(name, 'inpMs', metrics.inpMs)
      }
    } finally {
      await launched.cleanup()
    }
  })

  test('a sort fetches the visible page exactly once (case + cohort)', async () => {
    const launched = await prepareLoadedApp()
    try {
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[0], 0)
      await settleTable(launched.window)
      await installQuerySpy(launched.app, 'variants:query')
      await sortableHeader(launched.window, 'Gene').click({ position: { x: 12, y: 12 } })
      await settleTable(launched.window)
      expectOneQueryForVisiblePage(await readQuerySpy(launched.app, 'variants:query'))

      await closeBlockingDrawers(launched.window)
      await launched.window.locator('.mode-toggle .v-btn').nth(1).click()
      await settleTable(launched.window)
      await installQuerySpy(launched.app, 'cohort:variants')
      await sortableHeader(launched.window, 'Gene').click({ position: { x: 12, y: 12 } })
      await settleTable(launched.window)
      expectOneQueryForVisiblePage(await readQuerySpy(launched.app, 'cohort:variants'))
    } finally {
      await launched.cleanup()
    }
  })

  test('a delayed first response never overwrites the latest sort', async () => {
    const launched = await prepareLoadedApp()
    try {
      await measureCaseSelectVisibleRows(launched.window, PERF_CASE_NAMES[0], 0)
      await settleTable(launched.window)
      await installQuerySpy(launched.app, 'variants:query', { delayedCalls: 1, delayFirstCallsMs: 1500 })

      const position = sortableHeader(launched.window, 'Position')
      await position.click({ position: { x: 12, y: 12 } }) // asc — held back 1.5 s
      await launched.window.waitForTimeout(150)
      await position.click({ position: { x: 12, y: 12 } }) // desc — answers first
      await launched.window.waitForTimeout(2500) // the stale asc response lands now
      await settleTable(launched.window)

      const spy = await readQuerySpy(launched.app, 'variants:query')
      // Visible-page requests only; an idle prefetch of page 2 may follow.
      const visiblePage = spy.offsets.flatMap((offset, index) =>
        offset === 0 ? [spy.firstPositions[index]] : []
      )
      expect(visiblePage, spy.callArgs.join('\n')).toHaveLength(2)
      const [staleFirst, latestFirst] = visiblePage
      expect(staleFirst, 'asc and desc pages must differ for the check to mean anything').not.toBe(latestFirst)
      expect(await firstRenderedPosition(launched.window)).toBe(latestFirst)
    } finally {
      await launched.cleanup()
    }
  })
})
