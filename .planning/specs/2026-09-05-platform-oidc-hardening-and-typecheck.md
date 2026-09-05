# Specification: Platform OIDC Authentication Hardening & Web Typecheck

**Date:** 2026-09-05  
**Author:** Antigravity (145 IQ Systems & Security Reviewer)  
**Adversarial Reviewer:** Astra 6 (`gpt-6-astra` via Codex CLI)  
**Scope:** `src/web/`, `tests/web-gate/`, build and typecheck configurations.

---

## 1. Problem Statement & Motivation

Following the initial merge of PR #332 (`feat(web): add optional platform OIDC authentication`), an adversarial audit using Codex CLI with Astra 6 (`gpt-6-astra`) and deep architectural inspection revealed five critical defects and gaps:

1. **Session Property Deletion Flaw ([P2 / Astra 6 Finding])**:  
   In `src/web/server/platform-identity-routes.ts`, `clearAuthenticatedSession(request)` called `delete request.session.user` and `delete request.session.authMode`. `@fastify/secure-session` wraps session data in a Proxy that does not implement the `deleteProperty` trap. As a result, the `delete` operations are silent no-ops, leaving active authenticated sessions intact when starting a new OIDC flow.
2. **Authorized Party (`azp`) Disambiguation ([P2 / Astra 6 Finding])**:  
   In `src/web/server/platform-identity.ts`, `verifyPlatformJwt` enforced `payload.azp === params.audience`. In OpenID Connect Core 1.0 (section 3.1.3.7) and OAuth 2.0 Token Exchange, when access-token verification is enabled, `aud` represents the resource server (e.g., `varlens-platform:app:varlens:dev`), whereas `azp` indicates the client that requested the token (e.g., `varlens-dev`). Comparing `azp` against `audience` causes valid Keycloak access tokens to be rejected.
3. **Outbound Timeout Premature Clearance ([P2 / Astra 6 Finding])**:  
   In `src/web/server/platform-identity.ts`, `fetchWithTimeout` cleared the abort timeout as soon as `fetch()` resolved headers, leaving body streaming (`response.json()`) unmonitored. A slow or stalled response stream could hang indefinitely, permanently freezing promises in `entitlementInFlight` and blocking affected users from logging in.
4. **Double Prefix in Post-Login Redirects**:  
   In `src/web/server/page-gate.ts`, `location` unconditionally constructed `appPathPrefix + next`. When a request URL already included `appPathPrefix` (e.g. `/varlens/cases`), it generated double-prefixed paths (e.g. `/varlens/varlens/cases`), leading to post-login 404 errors.
5. **Web Layer Type Checking Coverage (Issue #329)**:  
   `src/web/**` was not covered by any `tsconfig`. Running `tsc` revealed hidden type errors, including incompatible `replaceAll` calls against ES2020 lib targets, improper discriminated union handling in `@fastify/rate-limit`, unvalidated `unknown` casts in OIDC discovery parsing, and unhandled promise returns in dispatcher overrides.

---

## 2. Technical Specification

### 2.1 Session Clearing via `@fastify/secure-session` API
In `src/web/server/platform-identity-routes.ts`:
```ts
function clearAuthenticatedSession(request: FastifyRequest): void {
  request.session.set('user', undefined)
  request.session.set('authMode', undefined)
  request.session.set('mustChangePassword', false)
}
```
This forces `@fastify/secure-session` to unset the properties in its internal session storage, ensuring they are deleted from serialized cookies.

### 2.2 Authorized Party (`azp`) Validation
In `src/web/server/platform-identity.ts`:
- Extend `verifyPlatformJwt` parameters to accept `authorizedParty?: string`.
- Set `const expectedAzp = params.authorizedParty ?? params.audience`.
- In `completeCallback`:
  - For ID token: pass `audience: this.config.clientId`, `authorizedParty: this.config.clientId`.
  - For access token: pass `audience: this.config.audience`, `authorizedParty: this.config.clientId`.

### 2.3 Comprehensive Timeout for Outbound Requests
In `src/web/server/platform-identity.ts`:
- Replace raw `fetchWithTimeout` with `fetchJsonWithTimeout<T>` that preserves the `AbortController` timeout across both `fetch()` and `response.json()` / `response.text()`.
- Ensure that network timeouts or stream stalls trigger `AbortError` and clear in-flight promises cleanly.

### 2.4 Idempotent Path Prefixing in Page Gate
In `src/web/server/page-gate.ts`:
```ts
const nextPath =
  appPathPrefix !== '' && (next === appPathPrefix || next.startsWith(appPathPrefix + '/'))
    ? next
    : appPathPrefix + next
```
Avoids duplicate `/varlens/varlens/...` redirects.

### 2.5 TypeScript Coverage for `src/web` (Issue #329)
1. Fix all existing type issues across `src/web/**`:
   - Replace `.replaceAll` with regex `.replace(/.../g, ...)`.
   - Properly narrow `OidcDiscovery` properties.
   - Handle `RateLimitResult` discriminated union (`if (result.isAllowed || !result.isExceeded) return`).
   - Narrow `resolvedFilters.bedFile` with `typeof ... === 'string'`.
   - Ensure async return types in `dispatcher.ts`.
   - Provide null fallback for `source_version`.
   - Narrow Swagger / OpenAPI objects.
2. Add `tsconfig.web.json` for backend web code.
3. Include web browser code (`src/web/bootstrap.ts`, `src/web/client/**/*`) in `tsconfig.renderer.json`.
4. Update `package.json` scripts and `Makefile` to include `typecheck:web` in web gate checks.

---

## 3. Verification & Acceptance Criteria

1. **Unit & Integration Tests**:
   - Verify session clearing with `@fastify/secure-session`.
   - Verify access tokens with distinct `aud` and `azp`.
   - Verify stalled streams timeout within `OUTBOUND_FETCH_TIMEOUT_MS`.
   - Verify page-gate redirection idempotency with prefixes.
2. **Static Analysis & Typechecks**:
   - `make typecheck` and `npx tsc --noEmit -p tsconfig.web.json` pass with 0 errors.
   - `make agent-check` passes (all source files under 600 lines).
   - `make lint-check` and `make format-check` pass.
3. **End-to-End & Application Testing**:
   - Full test suites pass (`make ci` and `VARLENS_WEB=1 make ci`).
   - Monkey test against running application succeeds with 100% pass rate.
