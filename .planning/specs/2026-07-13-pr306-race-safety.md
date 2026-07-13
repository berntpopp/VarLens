# PR 306 Renderer Race-Safety Design

## Goal

Close stale-completion races in the renderer without changing IPC contracts: cancellation must target the active executor and remain terminal after acknowledgement, child-dialog events must stay bound to the case that opened them, and metadata activity must resolve deterministically without crossing database sessions.

## Import cancellation

`ImportWizard.cancelImport()` becomes asynchronous and unwraps the cancellation result before updating the summary or import store. The selected format determines the executor: VCF uses `import.cancel()` in both desktop and web runtimes, while JSON/ZIP uses `batchImport.cancel()`. A failed cancellation leaves the wizard at progress step 3 and leaves the store active. The failure is shown in the wizard's existing error-alert area through a local `cancelError`, because moving the store to its terminal `error` phase would stop progress handling. Once cancellation succeeds, late resolution or rejection from the active start promise cannot replace the terminal cancelled state.

## Child-dialog case authority

Opening the gene-list editor or region-file importer captures the current `{ caseId, generation }`. Loading another case clears those origins. Save, delete, and import handlers validate their captured origin before mutating selections or calling `save()`. Thus an event emitted by a dialog opened for an old case has no authority over the newly loaded case.

## Metadata write ordering

All case-scoped metadata writes run through a module-level per-case promise queue. Each queued unit includes its state snapshot, optimistic update, IPC operation, success application, and rollback. The next unit starts after the previous promise settles, including after rejection. Different cases remain independent.

Serialization is preferred to mutation-generation tokens here. Tokens could suppress an older rollback, but then a newer failure may expose optimistic state that was never persisted. Serial execution keeps every rollback based on the last confirmed/cache state and also handles cross-field cohort/HPO operations consistently.

Database switches add a separate authority boundary around that serialization. `clearCache()` increments a module-level generation and detaches the old per-case queues. Reads and mutation completions capture their originating generation and may update shared caches only while it remains current. Queued work checks the generation before invoking IPC, and multi-step mutations check between calls, so an old queued intent cannot execute through the newly selected database session.

## Verification

Focused regressions cover cancellation failure followed by real completion, desktop/web VCF executor routing, late start settlement, stale gene-list save/delete and region-file import events, overlapping age/cohort/HPO operations, stale reads, queued writes, and multi-step writes across database switches. The complete `make ci` gate and `make agent-check` remain required before commit.
