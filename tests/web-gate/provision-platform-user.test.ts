import { describe, expect, test } from 'vitest'

import { parseOptions } from '../../src/web/provision-platform-user'

describe('provision-platform-user CLI', () => {
  test('binds only an OIDC subject, display name, and optional local role', () => {
    expect(
      parseOptions(['--subject', 'oidc-subject-1', '--display-name', 'Alice Example'])
    ).toEqual({
      subject: 'oidc-subject-1',
      displayName: 'Alice Example',
      role: 'user'
    })

    expect(
      parseOptions([
        '--subject',
        'oidc-subject-1',
        '--display-name',
        'Alice Example',
        '--role',
        'admin'
      ])
    ).toMatchObject({ role: 'admin' })
  })

  test('rejects database, workspace, password, and annotation provisioning arguments', () => {
    for (const name of [
      '--private-db-secret-ref',
      '--workspace',
      '--password-file',
      '--public-annotation-snapshot-id'
    ]) {
      expect(() =>
        parseOptions([
          '--subject',
          'oidc-subject-1',
          '--display-name',
          'Alice Example',
          name,
          'value'
        ])
      ).toThrow(/Unknown argument/)
    }
  })
})
