/**
 * Preload contract — compile-time IpcResult locks.
 *
 * PR-A Item 3: `expectTypeOf(...).toEqualTypeOf(...)` (from vitest's
 * `expect-type` dependency) is a **runtime no-op** — every matcher method
 * (`toEqualTypeOf`, `toMatchTypeOf`, etc.) is implemented as
 * `const fn = () => true` (see `node_modules/expect-type/dist/index.js`).
 * The entire check happens in TypeScript's generic-constraint resolution at
 * compile time; there is no way to verify type equality at runtime.
 *
 * That means these assertions only mean anything if a real typechecker
 * processes this file. Before this fix, they lived inline in
 * `preload-contract.test.ts` — a plain `.test.ts` file — where they were
 * silently inert:
 *   - `make typecheck` (`vue-tsc -p tsconfig.renderer.json` +
 *     `tsc -p tsconfig.node.json`) never covers `tests/` — neither tsconfig
 *     includes it.
 *   - `make test` (`vitest run --project main --project renderer`) executes
 *     the file at runtime only; vitest's `test.typecheck` mode was not
 *     enabled, so no typechecker ever ran over the file's type positions.
 * Reverting `CaseMetadataAPI` (or any other locked contract) to a naked
 * `Promise<T>` would therefore compile silently and pass every command in
 * the PR gate.
 *
 * The fix: vitest's typecheck convention is files matching
 * `**\/*.{test,spec}-d.ts` (see `configDefaults.typecheck.include` in
 * `vitest/dist/config.cjs`) — this file. It is picked up by the dedicated
 * `contract-typecheck` vitest project (see `vitest.config.ts`), which spawns
 * a real `tsc --noEmit` against the narrow `tsconfig.typecheck-tests.json`
 * (scoped to `src/shared/**` + this file, to avoid pulling in `src/main`,
 * `src/renderer`, or the rest of `tests/` and cascading into unrelated type
 * errors). `npm run typecheck:contracts` runs it, and `npm run typecheck`
 * (== `make typecheck`) now runs it as its third step.
 *
 * This file only exists for `expectTypeOf`; it has no runtime tests. Do not
 * add `describe`/`it` bodies that need to execute — put those back in
 * preload-contract.test.ts.
 */

import { describe, it, expectTypeOf } from 'vitest'
import type {
  WindowAPI,
  Case,
  CaseDataInfo,
  CaseMetadata,
  CaseExternalId,
  CohortGroup,
  GeneListWithCount
} from '../../../src/shared/types/api'
import type { IpcResult } from '../../../src/shared/types/errors'
import type {
  ImportResult,
  VcfMultiPreviewResult,
  VcfPreviewResult
} from '../../../src/shared/types/import'
import type { Job } from '../../../src/shared/types/jobs'

describe('Preload contract alignment — compile-time IpcResult shapes', () => {
  it('exposes IpcResult for scoped wrapHandler-backed methods', () => {
    expectTypeOf<Awaited<ReturnType<WindowAPI['cases']['list']>>>().toEqualTypeOf<
      IpcResult<Case[]>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['cohort']['runAssociation']>>>().toEqualTypeOf<
      IpcResult<unknown>
    >()
  })
})

describe('debug domain — Sprint A PR-2 Gate 10c', () => {
  it('compile-time check: WindowAPI debug methods return IpcResult', () => {
    expectTypeOf<Awaited<ReturnType<WindowAPI['debug']['queryCountersReset']>>>().toEqualTypeOf<
      IpcResult<{ enabled: boolean }>
    >()
  })
})

describe('jobs domain — Sprint A PR-4 Gate 11', () => {
  it('compile-time check: WindowAPI jobs methods return IpcResult', () => {
    expectTypeOf<Awaited<ReturnType<WindowAPI['jobs']['list']>>>().toEqualTypeOf<IpcResult<Job[]>>()
    expectTypeOf<Awaited<ReturnType<WindowAPI['jobs']['get']>>>().toEqualTypeOf<
      IpcResult<Job | null>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['jobs']['progress']>>>().toEqualTypeOf<
      IpcResult<Job['progress']>
    >()
  })

  it('existing import contract is unchanged by the jobs domain', () => {
    // Byte-identity guard: the import domain's start signature must be
    // untouched by PR-4.
    expectTypeOf<Awaited<ReturnType<WindowAPI['import']['start']>>>().toEqualTypeOf<
      IpcResult<ImportResult>
    >()
  })
})

describe('batch-import and system domains — C1 renderer unwrap guards', () => {
  it('compile-time check: every import picker, preview, and cancel method returns IpcResult', () => {
    expectTypeOf<Awaited<ReturnType<WindowAPI['import']['selectFile']>>>().toEqualTypeOf<
      IpcResult<string | null>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['import']['selectFiles']>>>().toEqualTypeOf<
      IpcResult<string[]>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['import']['selectBedFile']>>>().toEqualTypeOf<
      IpcResult<string | null>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['import']['vcfPreview']>>>().toEqualTypeOf<
      IpcResult<VcfPreviewResult>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['import']['vcfMultiPreview']>>>().toEqualTypeOf<
      IpcResult<VcfMultiPreviewResult>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['import']['cancel']>>>().toEqualTypeOf<
      IpcResult<void>
    >()
  })

  it('compile-time check: auth login and logout return IpcResult', () => {
    expectTypeOf<Awaited<ReturnType<WindowAPI['auth']['login']>>>().toEqualTypeOf<
      IpcResult<{
        success: boolean
        user?: { id: number; username: string; role: string }
        mustChangePassword?: boolean
        locked?: boolean
      }>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['auth']['logout']>>>().toEqualTypeOf<
      IpcResult<void>
    >()
  })

  it('compile-time check: batch-import picker methods return IpcResult', () => {
    expectTypeOf<Awaited<ReturnType<WindowAPI['batchImport']['selectFiles']>>>().toEqualTypeOf<
      IpcResult<string[]>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['batchImport']['selectFolder']>>>().toEqualTypeOf<
      IpcResult<string[]>
    >()
  })

  it('compile-time check: system worker-thread methods return IpcResult', () => {
    expectTypeOf<Awaited<ReturnType<WindowAPI['system']['getCpuCount']>>>().toEqualTypeOf<
      IpcResult<number>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['system']['setWorkerThreads']>>>().toEqualTypeOf<
      IpcResult<void>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['system']['getWorkerThreads']>>>().toEqualTypeOf<
      IpcResult<number>
    >()
  })
})

describe('cohort domain — Sprint A PR-3 Gate 10b', () => {
  it('getSummaryStatus contract shape is unchanged ({ is_stale, last_rebuilt_at:number })', () => {
    expectTypeOf<Awaited<ReturnType<WindowAPI['cohort']['getSummaryStatus']>>>().toEqualTypeOf<
      IpcResult<{ is_stale: boolean; last_rebuilt_at: number }>
    >()
  })
})

describe('case-metadata domain — Task A4 IpcResult laundering guard', () => {
  it('compile-time check: WindowAPI caseMetadata methods return IpcResult (regression guard for C1)', () => {
    // This is the exact shape of the CaseDataInfoTab.vue bug: `getDataInfo`
    // must resolve `IpcResult<CaseDataInfo | null>`, not the naked value, so
    // a raw `dataInfo.value = await api.caseMetadata.getDataInfo(...)` (no
    // `unwrapIpcResult`) fails to compile.
    expectTypeOf<Awaited<ReturnType<WindowAPI['caseMetadata']['getDataInfo']>>>().toEqualTypeOf<
      IpcResult<CaseDataInfo | null>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['caseMetadata']['upsert']>>>().toEqualTypeOf<
      IpcResult<CaseMetadata>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['caseMetadata']['createCohort']>>>().toEqualTypeOf<
      IpcResult<CohortGroup>
    >()
    expectTypeOf<Awaited<ReturnType<WindowAPI['caseMetadata']['listExternalIds']>>>().toEqualTypeOf<
      IpcResult<CaseExternalId[]>
    >()
  })

  it('compile-time check: WindowAPI geneLists methods already return IpcResult (no drift to guard)', () => {
    // gene-lists was already honest before this task; lock it too so a
    // future refactor of GeneListsAPI can't silently launder it back to a
    // naked `Promise<T>` the way CaseMetadataAPI once was.
    expectTypeOf<Awaited<ReturnType<WindowAPI['geneLists']['list']>>>().toEqualTypeOf<
      IpcResult<GeneListWithCount[]>
    >()
  })
})
