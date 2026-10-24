/**
 * Windows: is the admin config file, or its folder, safe from users who are
 * not administrators? Reads the security descriptor in SDDL form, which does
 * not depend on the system language.
 *
 * Standard users may create folders and files under C:\ProgramData and then
 * own them, so "this user cannot write it" is not enough: a file another user
 * planted would pass. Trusted means:
 *
 * - the owner is Administrators, SYSTEM or TrustedInstaller;
 * - no access entry that applies to the object itself grants anyone else a
 *   right that changes it: writing or deleting the file, deleting entries in
 *   or renaming the folder, or changing permissions or the owner.
 *
 * Creating new files in the folder stays allowed (the inherited default for
 * C:\ProgramData); it cannot replace the existing file.
 */

const TRUSTED_SIDS = new Set([
  'BA', // BUILTIN\Administrators
  'SY', // NT AUTHORITY\SYSTEM
  'OW', // OWNER RIGHTS: the owner, which must itself be trusted
  'S-1-5-32-544',
  'S-1-5-18',
  'S-1-3-4',
  // NT SERVICE\TrustedInstaller
  'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
])

const TRUSTED_OWNERS = new Set([...TRUSTED_SIDS].filter((sid) => sid !== 'OW' && sid !== 'S-1-3-4'))

/** SDDL right codes and their access-mask bits (file and generic rights). */
const RIGHTS: Record<string, number> = {
  GA: 0x10000000,
  GR: 0x80000000,
  GW: 0x40000000,
  GX: 0x20000000,
  RC: 0x00020000,
  SD: 0x00010000,
  WD: 0x00040000,
  WO: 0x00080000,
  CC: 0x00000001,
  DC: 0x00000002,
  LC: 0x00000004,
  SW: 0x00000008,
  RP: 0x00000010,
  WP: 0x00000020,
  DT: 0x00000040,
  LO: 0x00000080,
  CR: 0x00000100,
  FA: 0x001f01ff,
  FR: 0x00120089,
  FW: 0x00120116,
  FX: 0x001200a0
}

const DELETE = 0x00010000
const WRITE_DAC = 0x00040000
const WRITE_OWNER = 0x00080000
const GENERIC_ALL = 0x10000000
const GENERIC_WRITE = 0x40000000

/** Rights that let a holder change, replace or remove the object. */
const CHANGING_RIGHTS = {
  // write data, append data
  file: 0x2 | 0x4 | DELETE | WRITE_DAC | WRITE_OWNER | GENERIC_ALL | GENERIC_WRITE,
  // delete child; DELETE on the folder would allow renaming it away
  folder: 0x40 | DELETE | WRITE_DAC | WRITE_OWNER | GENERIC_ALL
} as const

/**
 * The account an entry names, safe for the log and the sign-in screen:
 * well-known aliases and BUILTIN groups by name, anything else, such as a
 * person's account SID, only as "another account".
 */
function displaySid(sid: string): string {
  return /^[A-Z]{2}$/.test(sid) || /^S-1-5-32-\d+$/.test(sid) ? sid : 'another account'
}

function rightsMask(rights: string): number | undefined {
  if (/^0x[0-9a-f]+$/i.test(rights)) return Number.parseInt(rights, 16)
  if (rights.length % 2 !== 0) return undefined
  let mask = 0
  for (let index = 0; index < rights.length; index += 2) {
    const bits = RIGHTS[rights.slice(index, index + 2).toUpperCase()]
    if (bits === undefined) return undefined
    mask |= bits
  }
  return mask
}

function section(sddl: string, tag: 'O' | 'D'): string | undefined {
  const match = new RegExp(`(?:^|[)A-Z0-9-])${tag}:(.*?)(?=(?:O|G|D|S):|$)`).exec(sddl)
  return match?.[1]
}

/** Why the object is not safe, or undefined when it is. */
export function windowsAclProblem(sddl: string, kind: 'file' | 'folder'): string | undefined {
  const trimmed = sddl.trim()
  const owner = section(trimmed, 'O')?.toUpperCase()
  if (owner === undefined || !TRUSTED_OWNERS.has(owner)) {
    return 'is not owned by Administrators, SYSTEM or TrustedInstaller'
  }
  // The descriptor is read as owner and access list only, so the access list
  // must run to the end in plain entries: conditional entries carry nested
  // parentheses that would hide the rest.
  const dacl = /D:([A-Z_]*)((?:\([^()]*\))*)$/.exec(trimmed)
  if (dacl === null)
    return /D:/.test(trimmed)
      ? 'has an access entry that cannot be read'
      : 'has no access control list'
  if (dacl[1].includes('NO_ACCESS_CONTROL')) return 'has no access control list'
  for (const [, ace] of dacl[2].matchAll(/\(([^()]*)\)/g)) {
    const fields = ace.split(';')
    const [type, flags, rights, , , sid] = fields.map((field) => field.toUpperCase())
    if (fields.length !== 6 || flags === undefined || rights === undefined || sid === undefined) {
      return 'has an access entry that cannot be read'
    }
    // Deny entries only take rights away; any type but allow and deny fails closed.
    if (type === 'D') continue
    if (type !== 'A') return 'has an access entry that cannot be read'
    // Inherit-only entries apply to children, not to this object.
    const flagCodes: string[] = flags.match(/.{2}/g) ?? []
    if (flagCodes.includes('IO')) continue
    if (TRUSTED_SIDS.has(sid)) continue
    const mask = rightsMask(rights)
    if (mask === undefined) return 'has an access entry that cannot be read'
    if ((mask & CHANGING_RIGHTS[kind]) !== 0) return `can be changed by ${displaySid(sid)}`
  }
  return undefined
}
