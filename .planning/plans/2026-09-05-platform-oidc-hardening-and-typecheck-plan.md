# Execution Plan: Platform OIDC Hardening & Web Typecheck

**Status:** Ready to Execute  
**Spec:** `.planning/specs/2026-09-05-platform-oidc-hardening-and-typecheck.md`

---

## Phases of Execution

### Phase 1: Authentication & Session Hardening
- **Task 1.1**: Update `clearAuthenticatedSession` in `src/web/server/platform-identity-routes.ts` to use `request.session.set(..., undefined)` instead of `delete request.session.*`.
- **Task 1.2**: Update `verifyPlatformJwt` in `src/web/server/platform-identity.ts` to take `authorizedParty?: string` and validate `azp` accordingly. Update `completeCallback` to pass `authorizedParty: this.config.clientId`.
- **Task 1.3**: Update `platform-identity.ts` to implement `fetchJsonWithTimeout` preserving timeout across stream/body reads.
- **Task 1.4**: Update `registerPageGate` in `src/web/server/page-gate.ts` to avoid double-prefixing when `next` already begins with `appPathPrefix`.

### Phase 2: Web Layer Type Fixes & TypeScript Integration (Issue #329)
- **Task 2.1**: Fix string replacement in `platform-identity-routes.ts` (use `.replace(/.../g, ...)` instead of `replaceAll`).
- **Task 2.2**: Narrow `OidcDiscovery` properties in `platform-identity.ts`.
- **Task 2.3**: Fix discriminated union checks in `rate-limit.ts`.
- **Task 2.4**: Add type guard for `bedFile` in `routes/import.ts`.
- **Task 2.5**: Fix async return type in `dispatcher.ts` override invoker.
- **Task 2.6**: Provide null fallback for `source_version` in `web-gene-reference.ts`.
- **Task 2.7**: Clean up Swagger UI configuration types in `routes/openapi.ts`.
- **Task 2.8**: Create `tsconfig.web.json`, include `src/web/bootstrap.ts` and `src/web/client/**/*` in `tsconfig.renderer.json`, update `tsconfig.json` references, and add `typecheck:web` npm script and Makefile integration.

### Phase 3: Comprehensive Testing & Verification
- **Task 3.1**: Add unit and integration tests in `tests/web-gate/platform-identity-security.test.ts` covering:
  - Session clearing verification.
  - Distinct `aud` and `azp` validation.
  - Timeout on stalled response body.
  - Idempotent redirection prefixes in `tests/web-gate/page-gate.test.ts`.
- **Task 3.2**: Run `make typecheck`, `npm run typecheck:web`, `make agent-check`, `make lint`, `make format-check`.
- **Task 3.3**: Run `make ci` and `VARLENS_WEB=1 make ci`.
- **Task 3.4**: Run live PostgreSQL web server monkey test script.

---
