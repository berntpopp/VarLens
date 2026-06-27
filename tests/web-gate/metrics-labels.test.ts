import { describe, expect, test } from 'vitest'

import {
  AppMetrics,
  resolveMetricsIpc,
  resolveMetricsRoute,
  startMetricsServer
} from '../../src/web/server/metrics'

describe('web metrics route labels', () => {
  test('uses documented OpenAPI paths as stable API route labels', () => {
    expect(resolveMetricsRoute('GET', '/livez')).toBe('/livez')
    expect(resolveMetricsRoute('GET', '/readyz')).toBe('/readyz')
    expect(resolveMetricsRoute('GET', '/healthz')).toBe('/healthz')
    expect(resolveMetricsRoute('POST', '/api/auth/login')).toBe('/api/auth/login')
    expect(resolveMetricsRoute('POST', '/api/cases/list')).toBe('/api/cases/list')
    expect(resolveMetricsRoute('GET', '/api/openapi.json')).toBe('/api/openapi.json')
  })

  test('groups unknown API routes without raw-path cardinality', () => {
    expect(resolveMetricsRoute('POST', '/api/not-a-domain/not-a-method')).toBe('unknown')
    expect(resolveMetricsRoute('GET', '/api/cases/list')).toBe('unknown')
    expect(resolveMetricsRoute('POST', '/api/cases/list/extra')).toBe('unknown')
  })

  test('uses documented dispatcher paths as stable IPC labels', () => {
    expect(resolveMetricsIpc('POST', '/api/auth/login')).toBe('auth:login')
    expect(resolveMetricsIpc('POST', '/api/case-metadata/createCohort')).toBe(
      'case-metadata:createCohort'
    )
    expect(resolveMetricsIpc('POST', '/api/not-a-domain/not-a-method')).toBe('unknown')
    expect(resolveMetricsIpc('GET', '/api/cases/list')).toBeUndefined()
    expect(resolveMetricsIpc('POST', '/api/cases/list/extra')).toBeUndefined()
  })

  test('does not classify raw upload staging as dispatcher IPC', () => {
    expect(resolveMetricsRoute('POST', '/api/import/upload')).toBe('/api/import/upload')
    expect(resolveMetricsIpc('POST', '/api/import/upload')).toBeUndefined()
  })

  test('renders Prometheus text with app and environment labels', () => {
    const metrics = new AppMetrics({ app: 'varlens', environment: 'test' })
    metrics.beginRequest('POST', '/api/auth/login')
    metrics.endRequest('POST', '/api/auth/login', 200, 0.021)
    metrics.setDatabaseHealthy(true)

    const text = metrics.metricsText()
    expect(text).toContain(
      'http_requests_total{app="varlens",environment="test",method="POST",route="/api/auth/login",status="200"} 1'
    )
    expect(text).toContain('http_request_duration_seconds_bucket')
    expect(text).toContain('http_requests_in_flight')
    expect(text).toContain('varlens_database_healthy{app="varlens",environment="test"} 1')
    expect(text).toContain('process_resident_memory_bytes')
  })

  test('renders IPC metrics with stable method labels', () => {
    const metrics = new AppMetrics({ app: 'varlens', environment: 'dev' })
    metrics.beginIpc('cases:list')
    metrics.endIpc('cases:list', 'success', 0.021)

    const text = metrics.metricsText()
    expect(text).toContain(
      'varlens_ipc_requests_total{app="varlens",environment="dev",ipc="cases:list",status="success"} 1'
    )
    expect(text).toContain(
      'varlens_ipc_duration_seconds_bucket{app="varlens",environment="dev",ipc="cases:list",le="0.025",status="success"} 1'
    )
    expect(text).toContain(
      'varlens_ipc_in_flight{app="varlens",environment="dev",ipc="cases:list"} 0'
    )
    expect(text).toMatch(
      /varlens_ipc_last_success_timestamp_seconds\{app="varlens",environment="dev",ipc="cases:list"\} \d+/
    )
  })

  test('renders bounded operation metrics for support triage', () => {
    const metrics = new AppMetrics({ app: 'varlens', environment: 'test' })

    metrics.recordOperationEvent({
      operation: 'auth-login',
      result: 'error',
      failureClass: 'invalid-credentials'
    })
    metrics.recordOperationEvent({ operation: 'upload-stage', result: 'success' })

    const text = metrics.metricsText()
    expect(text).toContain(
      'varlens_operation_events_total{app="varlens",environment="test",failure_class="invalid-credentials",operation="auth-login",result="error"} 1'
    )
    expect(text).toContain(
      'varlens_operation_events_total{app="varlens",environment="test",failure_class="none",operation="upload-stage",result="success"} 1'
    )
  })

  test('escapes line breaks in label values', () => {
    const metrics = new AppMetrics({ app: 'varlens', environment: 'prod\ncanary' })
    metrics.beginRequest('POST', '/api/auth/login')
    metrics.endRequest('POST', '/api/auth/login', 200, 0.021)
    metrics.beginIpc('cases\nlist')
    metrics.endIpc('cases\nlist', 'error', 0.021)

    const text = metrics.metricsText()
    expect(text).toContain('environment="prod\\ncanary"')
    expect(text).toContain('ipc="cases\\nlist"')
    expect(text).not.toContain('environment="prod\ncanary"')
    expect(text).not.toContain('ipc="cases\nlist"')
  })

  test('rejects invalid metrics scrape paths before binding', async () => {
    const result = await startMetricsServer({
      metrics: new AppMetrics({ app: 'varlens', environment: 'test' }),
      host: '127.0.0.1',
      port: 0,
      path: 'metrics'
    }).then(
      async (server) => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error !== undefined) reject(error)
            else resolve()
          })
        })
        return 'resolved'
      },
      (error: unknown) => error
    )

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('VARLENS_METRICS_PATH')
  })
})
