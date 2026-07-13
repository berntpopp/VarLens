# PR 306 Renderer Race-Safety Design

## Goal

Close three stale-completion races in the renderer without changing IPC contracts: cancellation must not report success before the backend accepts it, child-dialog events must stay bound to the case that opened them, and overlapping metadata writes must resolve deterministically.

## Import cancellation

`ImportWizard.cancelImport()` becomes asynchronous and unwraps the cancellation result before updating the summary or import store. A failed cancellation leaves the wizard at progress step 3 and leaves the store active. The failure is shown in the wizard's existing error-alert area through a local `cancelError`, because moving the store to its terminal `error` phase would stop progress handling. The next real completion clears that local error and remains eligible for the existing `step === 3` completion guard.

## Child-dialog case authority

Opening the gene-list editor or region-file importer captures the current `{ caseId, generation }`. Loading another case clears those origins. Save, delete, and import handlers validate their captured origin before mutating selections or calling `save()`. Thus an event emitted by a dialog opened for an old case has no authority over the newly loaded case.

## Metadata write ordering

All case-scoped metadata writes run through a module-level per-case promise queue. Each queued unit includes its state snapshot, optimistic update, IPC operation, success application, and rollback. The next unit starts after the previous promise settles, including after rejection. Different cases remain independent.

Serialization is preferred to mutation-generation tokens here. Tokens could suppress an older rollback, but then a newer failure may expose optimistic state that was never persisted. Serial execution keeps every rollback based on the last confirmed/cache state and also handles cross-field cohort/HPO operations consistently.

## Verification

Focused regressions cover cancellation failure followed by real completion, stale gene-list save/delete and region-file import events, and overlapping age, cohort, and HPO operations with mixed success/failure ordering. The complete `make ci` gate and `make agent-check` remain required before commit.
