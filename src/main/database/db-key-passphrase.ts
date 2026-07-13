import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

/** AES-256-GCM passphrase wrap of a DEK. All fields are base64-encoded. */
export interface PassphraseWrap {
  saltB64: string
  ivB64: string
  ctB64: string
  tagB64: string
}

/** scrypt cost parameters. N=16384, r=8, p=1 derives ~16 MiB. */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const
const SCRYPT_KEY_LENGTH = 32
const GCM_IV_LENGTH = 12
const PASSPHRASE_SALT_LENGTH = 16

export function wrapPassphrase(dek: string, passphrase: string): PassphraseWrap {
  const salt = randomBytes(PASSPHRASE_SALT_LENGTH)
  const iv = randomBytes(GCM_IV_LENGTH)
  const derivedKey = scryptSync(passphrase, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS)
  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv)
  const ct = Buffer.concat([cipher.update(dek, 'utf8'), cipher.final()])
  return {
    saltB64: salt.toString('base64'),
    ivB64: iv.toString('base64'),
    ctB64: ct.toString('base64'),
    tagB64: cipher.getAuthTag().toString('base64')
  }
}

/** Null on a wrong passphrase, GCM auth failure, or malformed wrap. */
export function unwrapPassphrase(wrap: PassphraseWrap, passphrase: string): string | null {
  try {
    const salt = Buffer.from(wrap.saltB64, 'base64')
    const iv = Buffer.from(wrap.ivB64, 'base64')
    const ct = Buffer.from(wrap.ctB64, 'base64')
    const tag = Buffer.from(wrap.tagB64, 'base64')
    const derivedKey = scryptSync(passphrase, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS)
    const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
