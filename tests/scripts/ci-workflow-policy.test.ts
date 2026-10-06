import { describe, expect, test } from 'vitest'
import { evaluateHostedResults, validateActionPins } from '../../scripts/ci/workflow-policy.mjs'

function results(code = 'true', web = 'true', docker = 'true') {
  return {
    changes: { result: 'success', outputs: { code, web, docker } },
    'secrets-scan': { result: 'success' },
    workflows: { result: 'success' },
    checks: { result: 'success' },
    package: { result: 'success' },
    'web-ci': { result: 'success' },
    docker: { result: 'success' }
  }
}

describe('hosted aggregate fails closed', () => {
  test.each(['pull_request', 'push', 'workflow_dispatch'])(
    '%s accepts successful selected lanes',
    (eventName) => {
      expect(evaluateHostedResults({ eventName, event: {}, needs: results() })).toEqual([])
    }
  )

  test('docs-only PR deliberately skips code lanes', () => {
    const needs = results('false', 'false', 'false')
    for (const job of ['checks', 'package', 'web-ci', 'docker'] as const)
      needs[job].result = 'skipped'
    expect(evaluateHostedResults({ eventName: 'pull_request', event: {}, needs })).toEqual([])
  })

  test('draft PR keeps policy and secrets required but permits heavy skips', () => {
    const needs = results()
    for (const job of ['checks', 'package', 'web-ci', 'docker'] as const)
      needs[job].result = 'skipped'
    const input = { eventName: 'pull_request', event: { pull_request: { draft: true } }, needs }
    expect(evaluateHostedResults(input)).toEqual([])
    needs['secrets-scan'].result = 'cancelled'
    expect(evaluateHostedResults(input)).not.toEqual([])
  })

  test.each(['failure', 'cancelled', 'skipped', '', 'queued'])(
    'selected lane %s is rejected',
    (result) => {
      const needs = results()
      needs.package.result = result
      expect(evaluateHostedResults({ eventName: 'pull_request', event: {}, needs })).not.toEqual([])
    }
  )

  test('missing classifier output cannot skip a lane', () => {
    const needs = results('', 'false', 'false')
    expect(evaluateHostedResults({ eventName: 'pull_request', event: {}, needs })).not.toEqual([])
  })

  test('main and dispatch cannot report narrow selection', () => {
    for (const eventName of ['push', 'workflow_dispatch']) {
      expect(
        evaluateHostedResults({ eventName, event: {}, needs: results('false', 'false', 'false') })
      ).not.toEqual([])
    }
  })

  test('SHA pins require both immutable SHA and readable version comment', () => {
    expect(validateActionPins('steps:\n - uses: actions/checkout@v4\n')).toHaveLength(1)
    expect(
      validateActionPins(
        `steps:\n - uses: actions/checkout@${'a'.repeat(40)} # actions/checkout@v4\n`
      )
    ).toEqual([])
    expect(validateActionPins('steps:\n - uses: ./local-action\n')).toEqual([])
  })
})
