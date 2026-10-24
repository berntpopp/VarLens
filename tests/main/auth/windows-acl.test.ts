import { describe, it, expect } from 'vitest'
import { windowsAclProblem } from '../../../src/main/auth/windows-acl'

describe('windows ACL check', () => {
  it('accepts the inherited ProgramData permissions on an administrator-made folder', () => {
    const folder =
      'O:BAG:SYD:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIIOID;GA;;;CO)(A;OICIID;0x1200a9;;;BU)(A;CIID;DCLCRPCR;;;BU)'
    expect(windowsAclProblem(folder, 'folder')).toBeUndefined()
  })

  it('accepts read-only access for users on the file', () => {
    expect(
      windowsAclProblem('O:SYG:SYD:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FR;;;BU)', 'file')
    ).toBeUndefined()
    expect(
      windowsAclProblem('O:S-1-5-32-544G:SYD:P(A;;FA;;;S-1-5-18)(A;;0x1200a9;;;WD)', 'file')
    ).toBeUndefined()
  })

  it('refuses owners other than Administrators, SYSTEM or TrustedInstaller', () => {
    expect(windowsAclProblem('O:BUG:SYD:(A;;FA;;;BA)', 'file')).toMatch(/not owned/)
    expect(windowsAclProblem('O:S-1-5-21-1-2-3-1001G:SYD:(A;;FA;;;BA)', 'file')).toMatch(
      /not owned/
    )
  })

  it('refuses rights that let others change, replace or remove the file', () => {
    for (const rights of [
      'FA',
      'FW',
      'GA',
      'GW',
      'SD',
      'WD',
      'WO',
      'DC',
      '0x2',
      '0x4',
      '0x10000'
    ]) {
      expect(windowsAclProblem(`O:BAG:SYD:(A;;FA;;;BA)(A;;${rights};;;BU)`, 'file')).toMatch(
        /can be changed by BU/
      )
    }
  })

  it('refuses rights that let others delete entries in, or rename, the folder', () => {
    for (const rights of ['FA', 'GA', 'SD', 'WD', 'WO', 'DT', '0x40']) {
      expect(windowsAclProblem(`O:BAG:SYD:(A;;FA;;;BA)(A;;${rights};;;AU)`, 'folder')).toMatch(
        /can be changed by AU/
      )
    }
    // Creating new files in the folder cannot replace the existing one.
    expect(
      windowsAclProblem('O:BAG:SYD:(A;;FA;;;BA)(A;CI;0x100116;;;BU)', 'folder')
    ).toBeUndefined()
  })

  it('ignores deny entries and inherit-only entries for children', () => {
    expect(
      windowsAclProblem('O:BAG:SYD:(D;;FA;;;WD)(A;;FA;;;BA)(A;OICIIO;FA;;;BU)', 'file')
    ).toBeUndefined()
  })

  it('names a personal account only as "another account"', () => {
    const problem = windowsAclProblem('O:BAG:SYD:(A;;FA;;;BA)(A;;FA;;;S-1-5-21-1-2-3-1001)', 'file')
    expect(problem).toBe('can be changed by another account')
    expect(windowsAclProblem('O:S-1-5-21-1-2-3-1001G:SYD:(A;;FA;;;BA)', 'file')).not.toMatch(
      /S-1-5-21/
    )
    expect(windowsAclProblem('O:BAG:SYD:(A;;FA;;;BA)(A;;FA;;;S-1-5-32-545)', 'file')).toMatch(
      /S-1-5-32-545/
    )
  })

  it('fails closed on entries it does not understand', () => {
    // A conditional entry would hide everything after it.
    expect(
      windowsAclProblem(
        'O:BAG:SYD:(A;;FA;;;BA)(XA;;FR;;;WD;(Member_of {SID(BA)}))(A;;FA;;;BU)',
        'file'
      )
    ).toMatch(/cannot be read/)
    expect(windowsAclProblem('O:BAG:SYD:(A;;FA;;;BA)(AU;SA;FA;;;WD)', 'file')).toMatch(
      /cannot be read/
    )
    expect(windowsAclProblem('O:BAG:SYD:(A;;FA;;BA)', 'file')).toMatch(/cannot be read/)
  })

  it('fails closed on anything after the access list, such as an audit section', () => {
    expect(
      windowsAclProblem('O:BAG:SYD:P(A;;FA;;;BA)(A;;FR;;;BU)S:AI(AU;SA;FA;;;WD)', 'file')
    ).toMatch(/cannot be read/)
    expect(windowsAclProblem('O:BAG:SYD:(OA;;FA;;;BU)', 'file')).toMatch(/cannot be read/)
  })

  it('fails closed on a missing or unreadable access list', () => {
    expect(windowsAclProblem('O:BAG:SYD:NO_ACCESS_CONTROL', 'file')).toMatch(/no access control/)
    expect(windowsAclProblem('O:BAG:SY', 'file')).toMatch(/no access control/)
    expect(windowsAclProblem('O:BAG:SYD:(A;;ZZ;;;BU)', 'file')).toMatch(/cannot be read/)
    expect(windowsAclProblem('garbage', 'file')).toMatch(/not owned/)
  })
})
