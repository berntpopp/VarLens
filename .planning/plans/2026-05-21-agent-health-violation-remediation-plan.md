# Agent Health Violation Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce VarLens's oversized source-file baseline in safe batches, starting with low-risk contract/preload splits.

**Architecture:** Treat the oversized-file baseline as the remediation ledger. Each implementation slice extracts one stable responsibility from an oversized file, updates imports and the baseline, then verifies with targeted tests plus `make agent-check`.

**Tech Stack:** TypeScript 6, Vue 3, Electron preload/main IPC, Vitest, Makefile, Node 24 ESM.

---

## File Map

- Modify `scripts/agent-health-baseline.json`: remove entries only after touched files fall below threshold.
- Modify `.planning/specs/2026-05-21-agent-health-violation-remediation.md`: source remediation spec.
- Modify `src/preload/index.ts`: reduce preload assembly surface by extracting cohesive API groups.
- Create or modify files under `src/preload/domains/`: preserve domain-module preload bindings.
- Modify `src/shared/types/api.ts`, `src/shared/types/database.ts`, or `src/shared/types/ipc-schemas.ts`: split type groups only when imports can stay stable through barrels.
- Modify tests under `tests/shared/types/` or existing preload contract tests when public API shape is touched.

## Task 1: Confirm Baseline and Pick First Slice

- [ ] Run `make agent-check`.
  Expected: pass with 24 baseline source entries and 6 report-only oversized test entries.
- [ ] Choose one first slice from the low-risk group: `src/preload/index.ts`,
  `src/shared/types/api.ts`, `src/shared/types/database.ts`, or `src/shared/types/ipc-schemas.ts`.
- [ ] Read the chosen file and its direct tests/imports with `rg`.
- [ ] Record which existing test protects the public shape before editing.

## Task 2: Write or Identify Failing Coverage

- [ ] If the slice changes exported behavior, add a focused test before implementation.
- [ ] If the slice is a pure extraction with stable exports, run the existing shape/type test before
  editing and record it as the guard.
- [ ] For preload/API shape work, run:

```bash
npx vitest run tests/shared/types/preload-contract.test.ts
```

Expected before behavior changes: pass. Expected after adding a new shape expectation: fail until
implementation is updated.

## Task 3: Extract One Responsibility

- [ ] Create a new focused helper/type file next to the original responsibility.
- [ ] Move code without changing names visible to existing callers unless the plan explicitly updates all imports.
- [ ] Update the original oversized file to import/re-export the moved responsibility.
- [ ] Run the targeted test from Task 2.
- [ ] Run `npm run typecheck:node` or the narrower relevant typecheck when TypeScript contracts move.

## Task 4: Update Agent Baseline

- [ ] Run:

```bash
make agent-check
```

- [ ] If a touched source file is now below 600 lines, remove its entry from
  `scripts/agent-health-baseline.json`.
- [ ] Re-run `make agent-check`.
  Expected: pass and either fewer baseline entries or lower line counts for the touched entry.

## Task 5: Verify Batch

- [ ] Run focused tests for touched surfaces.
- [ ] Run:

```bash
make ci
```

Expected: lint, format, typecheck, rebuild-node, and Vitest pass.

## Task 6: Commit and PR

- [ ] Commit with `refactor: reduce agent health baseline`.
- [ ] Push branch and open a PR referencing this plan.
- [ ] Include current `make agent-check` before/after counts in the PR description.

## Self-Review

- The plan covers the spec's batch strategy by starting with contract/preload work.
- No task requires clearing all 24 files at once.
- Every edit path has a verification command.
- Baseline removal is conditional on objective line-count results.

