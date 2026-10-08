# Web Narrow Hardening Spec

## Goal

Close the remaining high-risk web pilot gaps without starting a broad IPC/HTTP
handler refactor. The first pass hardens browser security defaults, removes
browser-triggered server-local path reads, documents single-user mode honestly,
and tightens seam tests so per-domain web overrides cannot grow unnoticed.

## Scope

This spec covers the current web pilot only. It does not replace the existing
desktop IPC domain modules, rewrite the dispatcher into a shared handler object,
or add row-level multi-user data isolation.

## Decisions

1. **Browser web mode never opens arbitrary server-local paths.**
   Web import flows must use staged upload refs. The existing production escape
   hatch for absolute server paths is removed from runtime code. Tests may stage
   local files into upload refs, but the dispatcher must reject raw absolute
   paths in development, test, and production.

2. **Unsafe API requests require a fail-closed CSRF signal.**
   For unsafe `/api/*` methods, reject `Sec-Fetch-Site: cross-site` and
   `Sec-Fetch-Site: none`. Allow `same-origin` only (`same-site` was allowed
   until #507: a sibling subdomain could then drive argument-less writes). If Fetch
   Metadata is absent, fall back to strict Origin verification against the
   request host and protocol. If both signals are absent, reject.

3. **Single-user web mode is explicit.**
   The current web slice keeps `auth:createUser` disabled and treats row-level
   multi-user data isolation as out of scope. Planning docs and sentinel tests
   must say this directly.

4. **Per-domain override drift is constrained by tests.**
   Keep the current route override modules for the narrow fix, but add a seam
   guard that fails when new override modules are added without updating the
   audited exception list. This is not a replacement for a later shared-handler
   refactor; it prevents accidental expansion while narrow hardening lands.

## User-Visible Behavior

- Browser uploads continue to work through `web-upload:` refs.
- Raw absolute path import calls through web APIs return a typed
  `server-path-import-disabled` response even in test mode.
- Same-origin browser API calls continue to work.
- Cross-site, top-level-navigation, missing-Origin, and missing-Fetch-Metadata
  unsafe API calls are rejected with `FORBIDDEN_ORIGIN`.
- Admin user creation remains disabled with `multi-user-disabled`.

## Non-Goals

- No shared handler object refactor in this pass.
- No row-level or tenant-level data scoping.
- No multi-user admin console.
- No new public REST endpoint vocabulary.
- No Electron behavior changes for local file dialogs.

## Parallel Work Packages

1. **CSRF Gate Hardening**
   Add Fetch Metadata handling and tests for same-origin, same-site,
   cross-site, none, Origin fallback, and missing-signal rejection.

2. **Server-Path Removal**
   Replace the env-gated server-path helper with an always-disabled web helper.
   Update import, batch import, region-file, and parity tests to use staged
   uploads instead of raw absolute paths.

3. **Single-User Contract**
   Update web planning notes and tests to explicitly state that multi-user
   authentication scaffolding does not imply multi-user data isolation.

4. **Override Seam Guard**
   Add a static guard that pins the audited override module set and fails if a
   new override module appears without an explicit review update.

## Acceptance Criteria

- Targeted web-gate tests pass:
  `auth-origin`, `handler-seam`, `dispatcher-adapters-auth-import`,
  `dispatcher-adapters-assets-annotations-export`, and `user-id-schema`.
- No runtime code reads `VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT`.
- Web route tests that need local fixture files use `web-upload:` refs.
- New docs/specs do not describe web mode as multi-user-ready for clinical data.
