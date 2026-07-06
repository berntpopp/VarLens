---
name: varlens-ipc-channel
description: Use when adding, renaming, or changing an IPC channel between the VarLens renderer and main process — exposing new data or actions on window.api, wiring a new domain, or touching preload/contract/handler code. Symptoms include "how do I call main from the renderer", editing src/preload or src/main/ipc, a failing tests/shared/types/preload-contract.test.ts, or a renderer call that returns a SerializableError instead of data.
metadata:
  version: "1.0.0"
  updated: "2026-07-06"
---

# VarLens IPC channels (domain-module pattern)

## Overview

The renderer talks to main **only** through the typed `window.api` exposed by the
preload. Never use raw `ipcRenderer` from renderer code. Every channel is one method
on a **domain contract**, wired across a fixed set of files, and returns
`IpcResult<T>` — the value on success, or a `SerializableError` on failure. The
renderer unwraps that result at the edge.

New IPC work follows the **domain-module pattern** (contract + preload + main
triplet). The remaining flat registrations (`shell`, `shortlist`, `system`,
`updater`) are intentional legacy — **do not** copy them as templates.

## The three laws

1. **Channels are named `domain:action`** — `presets:list`, `cases:deleteAll`,
   `variants:query`. The literal string lives **only** in the preload domain file.
2. **Handlers never try/catch for control flow.** Wrap the body in `wrapHandler(...)`
   and let errors throw — `wrapHandler` converts them to `SerializableError`.
   (`src/main/ipc/errorHandler.ts`.)
3. **The renderer unwraps.** Call `unwrapIpcResult(...)` (from
   `src/shared/types/errors.ts`) at the call site, or `isIpcError(...)` to branch.
   Never let a `SerializableError` leak into UI state as if it were data.

## Reference implementation

Copy the shape of an existing domain-module domain. **`filter-presets`** (preload
key `presets`) is a clean, complete example. Read these four files first:

- `src/shared/ipc/domains/filter-presets.ts` — the contract interface
- `src/preload/domains/filter-presets.ts` — the `ipcRenderer.invoke` bindings
- `src/main/ipc/handlers/filter-presets.ts` — `ipcMain.handle` + `wrapHandler` + Zod validation
- `src/main/ipc/domains/filter-presets.ts` — thin wiring that resolves deps

Two style choices exist for the public type. **Prefer the alias style** for new work:
`export type FooAPI = FooDomainContract` in `src/shared/types/api.ts` (like `cases`),
not a hand-mirrored parallel interface (like the older `PresetsAPI`).

## Recipe: add ONE channel to an EXISTING domain

Minimum is **4 files**; the rest depend on the domain.

1. `src/shared/ipc/domains/<name>.ts` — add the method to `<Name>DomainContract`, returning `Promise<IpcResult<T>>`.
2. `src/preload/domains/<name>.ts` — add `action: (...args) => ipcRenderer.invoke('<name>:action', ...args)`.
3. `src/main/ipc/handlers/<name>.ts` — add `ipcMain.handle('<name>:action', async (_e, args) => wrapHandler(async () => { /* validate, then logic */ }))`. Return `undefined` for `void` channels.
4. `src/preload/window-api/core-api.ts` **or** `app-api.ts` — add the passthrough line in that domain's block.

Then, as applicable:
- `src/shared/types/ipc-schemas.ts` — add a Zod schema if the channel takes params, and `safeParse` it inside the handler.
- `src/shared/types/api.ts` — only if the domain uses a hand-mirrored `XAPI` interface (alias-style domains need nothing here).
- `tests/utils/mock-api.ts` — **required**: add the method to the domain's mock block, or the contract test's key-equality check fails.
- `tests/shared/types/preload-contract.test.ts` — only if the domain has a hardcoded per-domain block (`cases`, `database`, `filter-presets`): add a `toContain('<name>:action')` assertion.
- **Postgres-backed domains**: add the operation to `src/main/storage/{read,write}-executor.ts` and both the sqlite and postgres executor implementations. Handlers dispatch `{ type: '<name>:action' }` to the session executor when `backend === 'postgres'`, else call the sqlite repo directly.
- **Web-parity domains**: add `src/web/server/routes/<name>.ts` + dispatcher/task-types entries. Web parity is domain-dependent, not universal — check whether the domain already has a web route before assuming you need one.

## Recipe: add a WHOLE NEW domain

~9–12 files. Do steps 1–4 above, plus:
- `src/shared/types/api.ts` — `export type <Name>API = <Name>DomainContract` and add `<key>: <Name>API` to `interface WindowAPI`.
- `src/preload/window-api/domains.ts` — import the factory, add `<name>Domain: create<Name>Api()`.
- `src/preload/window-api/create-window-api.ts` — attach `<key>` to the assembled API.
- `src/main/ipc/domains/<name>.ts` — `register<Name>Domain(ipcMain)` that resolves deps and calls the handlers.
- `src/main/ipc/index.ts` — import and call `register<Name>Domain(ipcMain)` in the alphabetical block inside `registerIpcHandlers()`.
- `tests/utils/mock-api.ts` and `tests/shared/types/preload-contract.test.ts` (`DOMAIN_CONTRACT_PATHS`) — register the new domain.

## Verify

The preload contract test is your first-line guardrail — it parses source and asserts
the domain keys of `WindowAPI`, the preload object, and `MockApi` are **identical
sets**. A missing `mock-api.ts` entry or a preload/contract key mismatch fails it.

```bash
make rebuild-node      # tests run on the Node ABI (see varlens-native-rebuild)
make typecheck         # the contract is type-checked end to end
make test              # includes tests/shared/types/preload-contract.test.ts
```

## Common mistakes

- **Raw `ipcRenderer` in renderer code.** Renderer only touches `window.api`. Adding
  a channel means editing the shared contract, preload, and main handler — not reaching around them.
- **Forgetting `tests/utils/mock-api.ts`.** The contract test compares key sets; a new
  method with no mock entry fails the suite even if the app works.
- **try/catch inside a handler.** `wrapHandler` already turns throws into
  `SerializableError`. Manual catching swallows the structured error fields.
- **Renderer treating `IpcResult<T>` as `T`.** Always `unwrapIpcResult(...)` (throws
  on error) or `isIpcError(...)` (branch). A raw result put into state is a bug.
- **Copying `shortlist`/`shell`/`system`/`updater`.** Those are flat legacy handlers,
  not the domain-module pattern. Use `filter-presets` or `cases` as the template.
- **Postgres domain with a sqlite-only handler.** If the domain is postgres-backed,
  a new channel needs the executor operation on both backends or it breaks in web mode.
