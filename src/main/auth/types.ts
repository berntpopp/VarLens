/**
 * Auth type definitions.
 *
 * `Credential` is a discriminated union prepared for token-based auth. The
 * current auth path only implements the `password` arm; the `token` arm exists
 * so future auth providers can plug in without touching call sites.
 *
 * Enforced by `tests/web-gate/auth-isolation.test.ts` ("Credential
 * discriminated union is shaped for OIDC retrofit").
 */
export type Credential =
  { kind: 'password'; username: string; password: string } | { kind: 'token'; jwt: string }
