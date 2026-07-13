import { describe, it, expect, beforeEach } from 'vitest'
import {
  isUrlSafeForExternal,
  isDomainAllowed,
  setUserDomains,
  isValidHostname
} from '../../../src/main/utils/url-validation'

describe('isValidHostname', () => {
  it('accepts valid hostname', () => {
    expect(isValidHostname('example.com')).toBe(true)
  })

  it('accepts subdomain', () => {
    expect(isValidHostname('sub.example.com')).toBe(true)
  })

  it('rejects bare TLD', () => {
    expect(isValidHostname('com')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidHostname('')).toBe(false)
  })

  it('rejects hostname with spaces', () => {
    expect(isValidHostname('example .com')).toBe(false)
  })
})

describe('isDomainAllowed', () => {
  beforeEach(() => {
    setUserDomains([])
  })

  it('allows exact match from built-in list', () => {
    expect(isDomainAllowed('github.com')).toBe(true)
  })

  it('allows subdomain of built-in domain', () => {
    expect(isDomainAllowed('pages.github.com')).toBe(true)
  })

  it('rejects unknown domain', () => {
    expect(isDomainAllowed('evil.com')).toBe(false)
  })

  it('rejects suffix match without dot boundary', () => {
    expect(isDomainAllowed('evilgithub.com')).toBe(false)
  })

  it('allows user-configured domain', () => {
    setUserDomains(['mylab.org'])
    expect(isDomainAllowed('mylab.org')).toBe(true)
  })

  it('rejects invalid user domains', () => {
    setUserDomains(['com', 'valid.org'])
    expect(isDomainAllowed('evil.com')).toBe(false)
    expect(isDomainAllowed('valid.org')).toBe(true)
  })

  it('excludes user-configured domains when includeUserDomains is false (S1)', () => {
    setUserDomains(['mylab.org'])
    expect(isDomainAllowed('mylab.org')).toBe(true)
    expect(isDomainAllowed('mylab.org', { includeUserDomains: false })).toBe(false)
    expect(isDomainAllowed('github.com', { includeUserDomains: false })).toBe(true)
  })
})

describe('isUrlSafeForExternal', () => {
  beforeEach(() => {
    setUserDomains([])
  })

  it('allows https URL to allowed domain', () => {
    expect(isUrlSafeForExternal('https://github.com/repo')).toBe(true)
  })

  it('rejects http URL', () => {
    expect(isUrlSafeForExternal('http://github.com/repo')).toBe(false)
  })

  it('rejects javascript: URL', () => {
    expect(isUrlSafeForExternal('javascript:alert(1)')).toBe(false)
  })

  it('rejects file: URL', () => {
    expect(isUrlSafeForExternal('file:///etc/passwd')).toBe(false)
  })

  it('rejects unknown domain over https', () => {
    expect(isUrlSafeForExternal('https://evil.com/phish')).toBe(false)
  })

  it('rejects malformed URL', () => {
    expect(isUrlSafeForExternal('not a url')).toBe(false)
  })

  it('narrows github.io to the docs subdomain only (S5)', () => {
    expect(isUrlSafeForExternal('https://attacker.github.io/x')).toBe(false)
    expect(isUrlSafeForExternal('https://berntpopp.github.io/varlens')).toBe(true)
  })

  describe('renderer-added domains gate openExternal only (S1)', () => {
    it('allows a user-added domain by default (openExternal path)', () => {
      setUserDomains(['evil.com'])
      expect(isUrlSafeForExternal('https://evil.com')).toBe(true)
    })

    it('denies a user-added domain when includeUserDomains is false (window-open path)', () => {
      setUserDomains(['evil.com'])
      expect(isUrlSafeForExternal('https://evil.com', { includeUserDomains: false })).toBe(false)
    })

    it('still allows a built-in domain when includeUserDomains is false', () => {
      setUserDomains(['evil.com'])
      expect(isUrlSafeForExternal('https://github.com/repo', { includeUserDomains: false })).toBe(
        true
      )
    })

    it('keeps the https-only gate when includeUserDomains is false', () => {
      setUserDomains(['evil.com'])
      expect(isUrlSafeForExternal('http://github.com/repo', { includeUserDomains: false })).toBe(
        false
      )
    })
  })
})
