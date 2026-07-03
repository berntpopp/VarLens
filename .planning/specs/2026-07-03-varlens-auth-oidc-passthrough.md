# VarLens Authentication: OIDC compatibility + upstream passthrough

**Status:** Draft 2026-07-03
**Scope:** Hosted web app (thin client) and desktop. Single database. VarLens stays the user store.
**Not:** multi-tenant orchestration (control DB, per-customer DB routing). That is a separate repo on top.

## Goal

A user already authenticated by an upstream service reaches the VarLens hosted web app **without a second login**, while VarLens's own single database remains the source of truth for users.

## What exists today (main)

Local user management in VarLens's own DB: admin bootstrap, argon2 password login with lockout, user CRUD, roles (admin/user), password change/reset, sessions, audit, rate limiting.
**Missing:** OIDC verification and any passthrough. That is the gap this spec fills.

## Design

### User store (unchanged)

One VarLens user record per person, in VarLens's single DB. Credentials are **additive**: a user may have a local password and/or a linked external identity. Records link by a configured stable claim (default `email`, configurable to `sub`). VarLens roles stay authoritative; the IdP never dictates authorization.

### Login methods (all converge on VarLens's own session)

1. **Local password** — exists, unchanged.
2. **OIDC** — VarLens verifies an upstream `id_token` against a configured issuer + JWKS (signature, `iss`, `aud`, `exp`, `nonce`), resolves the VarLens user by the mapping claim, then issues a VarLens session.
3. **Passthrough** — the other service forwards its verified OIDC token (bearer) to VarLens; VarLens verifies it via the *same* path and issues a session. For a non-OIDC upstream, a trusted reverse-proxy header is the documented fallback (honored only when the request arrives through the configured proxy).

OIDC and passthrough share **one** verification path: a verified upstream token becomes a VarLens session. That single step is the whole "no double authenticate."

### Account resolution

- **Match found** → issue session (role from the VarLens record).
- **No match + auto-provision enabled** (`VARLENS_AUTH_OIDC_AUTOPROVISION=1` + issuer/domain allowlist) → create user with default role `user`, then issue session.
- **No match + auto-provision disabled** (default) → deny: "no VarLens account."

### Configuration (env; absence = feature off = current password-only behavior)

- `VARLENS_AUTH_OIDC_ISSUER`, `VARLENS_AUTH_OIDC_CLIENT_ID` (aud), `VARLENS_AUTH_OIDC_JWKS_URI` (or discovery)
- `VARLENS_AUTH_OIDC_CLAIM` (default `email`)
- `VARLENS_AUTH_OIDC_AUTOPROVISION` (default off), `VARLENS_AUTH_OIDC_ALLOWED_DOMAINS`
- `VARLENS_AUTH_TRUSTED_PROXY` (enables header passthrough), `VARLENS_AUTH_PROXY_USER_HEADER`

### Implementation surface (small)

- New module: OIDC token verification (JWKS cache + `id_token` checks). Reference/lift from #290's verification logic, dropping its control-DB coupling.
- Extend `PostgresWebAuthService`: `resolveExternalUser(claim)` + `linkExternalIdentity` / auto-provision.
- New login route `POST /auth/oidc` (token in), plus passthrough acceptance in the auth middleware.
- Session issuance reuses the existing VarLens session path.

## Out of scope

Control DB, per-customer database routing, cross-database provisioning, and making an external IdP the system of record. Those belong to a separate orchestration service that consumes VarLens.

## Retention / data class

No new persistent data class. External-identity link fields live on the existing `users` table (operational/auth data), same class as current accounts.

## Open decisions (confirm)

1. Mapping claim default — `email` (proposed) vs `sub`.
2. Auto-provision default — **off**, admin pre-creates (proposed) vs on-with-allowlist.
3. Passthrough primary mechanism — forwarded OIDC bearer token (proposed) vs trusted proxy header.
