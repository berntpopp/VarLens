import { ALLOWED_DOMAINS } from '../../shared/config/allowed-domains'

/** User-configured additional domains */
let userDomains: string[] = []

/**
 * Validate that a string is a proper hostname (at least two labels).
 */
export function isValidHostname(h: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(h)
}

/**
 * Set user-configured additional domains.
 * Invalid hostnames (bare TLDs, malformed) are filtered out.
 */
export function setUserDomains(domains: string[]): void {
  userDomains = domains.filter(isValidHostname).map((d) => d.toLowerCase())
}

/** Options controlling whether renderer-added user domains are consulted. */
export interface DomainAllowedOptions {
  /**
   * Whether user-configured domains (`shell:updateUserDomains`) count as
   * allowed, in addition to the built-in `ALLOWED_DOMAINS`. Defaults to
   * `true`. Callers that gate a sink a compromised renderer could otherwise
   * escalate through (`setWindowOpenHandler`) must pass `false` — user
   * domains are meant for `shell.openExternal` only.
   */
  includeUserDomains?: boolean
}

/**
 * Check if a hostname matches an allowed domain exactly or is a subdomain of it.
 * Uses dot-boundary matching to prevent suffix attacks (evilgithub.com != github.com).
 */
export function isDomainAllowed(hostname: string, opts?: DomainAllowedOptions): boolean {
  const includeUserDomains = opts?.includeUserDomains !== false
  const allDomains = includeUserDomains ? [...ALLOWED_DOMAINS, ...userDomains] : ALLOWED_DOMAINS
  return allDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

/**
 * Check if a URL is safe to open externally.
 * Requires HTTPS protocol and an allowed domain.
 */
export function isUrlSafeForExternal(url: string, opts?: DomainAllowedOptions): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return isDomainAllowed(parsed.hostname, opts)
  } catch {
    return false
  }
}
