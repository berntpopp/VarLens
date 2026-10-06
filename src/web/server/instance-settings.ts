/**
 * Instance-level settings read from the server environment. They feed the
 * capability document (`routes/system.ts`) and security headers, so a
 * feature an operator has not enabled is reported disabled with a reason
 * instead of failing in the browser.
 */

/** Opt-in: let the browser reach a local IGV desktop (`http://localhost:60151`). */
export const LOCAL_IGV_ENV = 'VARLENS_WEB_ALLOW_LOCAL_IGV'

/** Opt-in: serve `/api/docs` and `/api/openapi.json` without a session. */
export const PUBLIC_API_DOCS_ENV = 'VARLENS_WEB_PUBLIC_API_DOCS'

function flagEnabled(name: string, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name]?.trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

export function isLocalIgvAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagEnabled(LOCAL_IGV_ENV, env)
}

export function isPublicApiDocsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagEnabled(PUBLIC_API_DOCS_ENV, env)
}

/** Origins the local IGV batch port listens on. */
export const LOCAL_IGV_ORIGINS = 'http://localhost:60151 http://127.0.0.1:60151'
