---
id: "UI-01"
number: 7
title: "Async race condition in useTranscripts causes stale transcript display on rapid selection"
priority: "P2 - High"
tags: ["ui-ux", "renderer", "concurrency", "clinical-safety", "bug"]
affected_files:
  - "src/renderer/src/composables/useTranscripts.ts"
created: "2026-10-06"
reviewed_by: "Claude Code CLI (Claude Opus 5.5)"
---

# [UI-01] Async race condition in useTranscripts causes stale transcript display on rapid selection

| Attribute | Value |
|---|---|
| **Priority** | **P2 - High** |
| **Tags** | `ui-ux` `renderer` `concurrency` `clinical-safety` `bug` |
| **Affected Files** | `src/renderer/src/composables/useTranscripts.ts` |
| **Audited Snippet** | `In useTranscripts.ts:18, loadTranscripts does not track request sequencing. If variant 1 is clicked ...` |

---

## Technical Context & Audited Impact
Clinical user reviewing variants sees wrong transcript annotations for the active variant.

---

## Claude Opus 5.5 Architectural Review & Issue Specification

## UI-01 review: race condition in `useTranscripts` can show the wrong variant's transcripts

### 1. Technical assessment

**Valid on `main`.** In `main:src/renderer/src/composables/useTranscripts.ts`, `loadTranscripts` writes `transcripts.value = unwrapIpcResult(await api.transcripts.list(id))` without checking that `id` is still the selected variant. The `finally` block also clears `loading` no matter which request finishes.

**Why it reaches the UI:** `VariantDetailsPanel.vue:53` renders `<TranscriptSection>` without a `:key`. The component, and the composable inside it, is reused across selections, so nothing is reset between variants. The race only affects case mode; cohort mode passes `variantId = null`.

**Root cause:** nothing tracks which request is the latest, and the order in which async IPC responses arrive is not guaranteed.

**Edge cases beyond the audit's A→B scenario:**
- **A→B→A:** checking only `id === variantId.value` is not enough, because a stale response for A could land after the newer A request. A request token (sequence number) is required.
- **Error path:** a failed stale request can set `error` and clear `transcripts` for the active variant.
- **Loading flag:** a stale request's `finally` sets `loading = false` while the current request is still running, so the UI briefly looks "loaded" with the wrong rows.
- **`switchTranscript` / `insertAndSwitch`:** both read `variantId.value` again after their `await`. If the selection changed in between, the reload and any error message go to the wrong variant.
- **Leftover rows while loading:** the previous variant's rows stay in `transcripts` until the new response arrives, so they can show under the new variant's header.

**Current state:** the working tree on `feat/variant-simulator` already has an uncommitted fix (a `currentToken` guard, captured `targetVariantId`, and a reset on `null`) plus a new `tests/renderer/composables/useTranscripts.test.ts`. That fix covers the first four edge cases but not the leftover rows. It is also mixed into an unrelated feature branch, so it should be split out. I could not run the new test file because running it needed permission approval.

### 2. Severity: **P2 (High)**

- **Why not lower:** the failure is silent. A clinician sees wrong transcript annotations (HGVS, consequence, canonical flag) for the variant on screen, which can mislead classification. It belongs with data-integrity bugs, not cosmetic ones.
- **Why not P1:** the timing window is narrow because the IPC call goes to local SQLite and is fast. Stored data is never corrupted; only the display is wrong. Re-selecting the variant fixes it, and no mutation is sent to the wrong variant.

### 3. Labels
`bug`, `data-integrity`, `ui-ux`, `renderer`, `async`

### 4. Issue specification

**Title:** `fix(renderer): guard useTranscripts against out-of-order IPC responses on rapid variant selection`

**Description and reproduction**
`useTranscripts.loadTranscripts` (`src/renderer/src/composables/useTranscripts.ts`) applies whichever `transcripts.list` response arrives last, not the one for the selected variant. `TranscriptSection` is not keyed by variant, so its state carries over between selections.

1. Open a case in case mode and select variant A.
2. Before A's transcripts arrive, select variant B. To make this deterministic in a test, mock `api.transcripts.list` so A's call resolves after B's.
3. The panel shows B's header with A's transcripts, and `loading` turns false early.

The same thing happens with A→B→A, with a failed stale request, and when the selection changes during `switchTranscript` or `insertAndSwitch`.

**Expected behavior**
- `transcripts`, `error` and `loading` only ever reflect the latest request for the current `variantId`.
- Stale responses and stale errors are thrown away.
- When the selection changes, the previous variant's rows are cleared straight away, not left visible until the new data loads.
- Switch and insert operations reload, and report errors, only for the variant they were started on.

**Proposed fix**
1. **Request token.** Use a counter that increments on every load. Ignore a response unless `token === currentToken && id === variantId.value`, and apply the same check to the `catch` and `finally` blocks. This is the pattern already in the working tree.
2. **Pin the target variant.** Store `targetVariantId` before the `await` in `switchTranscript` and `insertAndSwitch`. Afterwards, only reload or set `error` if the selection hasn't changed.
3. **Reset on change.** When `variantId` changes, set `transcripts.value = []` before loading, and on `null` also increment the token and reset `loading` and `error`. The current working-tree fix does not clear rows on a non-null change yet.
4. **Optional follow-up:** move the token/latest-wins logic into a small shared helper (e.g. `useLatestRequest`). Other renderer composables that fetch per selection probably have the same problem, but that needs auditing before claiming it.
5. **Do not use** `:key="variantId"` on `TranscriptSection` as the fix. Remounting hides the race but does not remove it, because in-flight promises can still resolve into the next instance's flow, and it causes UI flicker.

**Tests (behavior level):** in `tests/renderer/composables/useTranscripts.test.ts`, use deferred promises to cover:
- A→B with A resolving last
- A→B→A
- A stale request that rejects
- `loading` staying true while the current request is pending
- Rows being cleared immediately on a selection change
- `switchTranscript` when the selection changes before its reload

**Delivery:** move the fix and its tests out of `feat/variant-simulator` into a separate `fix/use-transcripts-race` branch and PR. Before claiming done, run `make typecheck`, then `make rebuild-node && make test`.
