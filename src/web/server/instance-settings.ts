/**
 * Instance-level settings read from the server environment. They feed the
 * capability document (`routes/system.ts`) and security headers, so a
 * feature an operator has not enabled is reported disabled with a reason
 * instead of failing in the browser.
 */
import { isIP } from 'node:net'

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

/** Reverse-proxy hops or addresses whose `X-Forwarded-*` headers are trusted. */
export const TRUST_PROXY_ENV = 'VARLENS_WEB_TRUST_PROXY'

function isProxyAddress(entry: string): boolean {
  const [address, prefix, ...rest] = entry.split('/')
  const family = isIP(address)
  if (family === 0 || rest.length > 0) return false
  if (prefix === undefined) return true
  // A /0 prefix trusts every peer, i.e. lets any client choose its own address.
  return /^\d+$/.test(prefix) && Number(prefix) >= 1 && Number(prefix) <= (family === 4 ? 32 : 128)
}

/**
 * Fastify's `trustProxy` from the environment: unset = off (the direct peer is
 * the client), an integer = number of proxy hops, otherwise a comma-separated
 * list of proxy IPs / CIDRs. "Trust everything" is refused — it would let a
 * client spoof the address the login rate limit and the logs record.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): false | number | string {
  const raw = env[TRUST_PROXY_ENV]?.trim() ?? ''
  if (raw === '') return false
  if (/^[1-9]\d?$/.test(raw)) return Number(raw)
  const entries = raw.split(',').map((entry) => entry.trim())
  if (!entries.every(isProxyAddress)) {
    throw new Error(
      `${TRUST_PROXY_ENV} must be a hop count (1-99) or a comma-separated list of proxy IPs/CIDRs; got ${raw}`
    )
  }
  return entries.join(',')
}
