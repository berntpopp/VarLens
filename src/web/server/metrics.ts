import { createServer, type Server } from 'http'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { buildDocumentedDispatcherPathSet } from './routes/openapi-paths'
import { toTaskDomain } from './task-types'

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
const documentedApiPaths = buildDocumentedDispatcherPathSet()
const NON_DISPATCHER_API_PATHS = new Set<string>(['/api/import/upload'])

type LabelValue = string | number
type Labels = Record<string, LabelValue>

interface HistogramState {
  buckets: Map<number, number>
  count: number
  sum: number
}

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${String(labels[key])}`)
    .join('\n')
}

function escapeLabelValue(value: LabelValue): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/"/g, '\\"')
}

function labelText(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}="${escapeLabelValue(labels[key])}"`)
    .join(',')
}

function metricLine(name: string, labels: Labels, value: number): string {
  const text = labelText(labels)
  return `${name}${text === '' ? '' : `{${text}}`} ${value}`
}

function pushSeries(
  lines: string[],
  name: string,
  metrics: IterableIterator<{ labels: Labels; value: number }>
): void {
  for (const metric of metrics) {
    lines.push(metricLine(name, metric.labels, metric.value))
  }
}

function pushHistogram(
  lines: string[],
  name: string,
  metrics: IterableIterator<{ labels: Labels; state: HistogramState }>
): void {
  for (const metric of metrics) {
    for (const bucket of DEFAULT_BUCKETS) {
      lines.push(
        metricLine(
          `${name}_bucket`,
          { ...metric.labels, le: bucket },
          metric.state.buckets.get(bucket) ?? 0
        )
      )
    }
    lines.push(metricLine(`${name}_bucket`, { ...metric.labels, le: '+Inf' }, metric.state.count))
    lines.push(metricLine(`${name}_sum`, metric.labels, metric.state.sum))
    lines.push(metricLine(`${name}_count`, metric.labels, metric.state.count))
  }
}

function pathName(url: string): string {
  try {
    return new URL(url, 'http://varlens.local').pathname
  } catch {
    return 'unknown'
  }
}

function normalizeMetricsPath(path: string | undefined): string {
  const raw = path ?? '/metrics'
  const trimmed = raw.trim()
  if (
    trimmed === '' ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('?') ||
    trimmed.includes('#')
  ) {
    throw new Error(
      'VARLENS_METRICS_PATH must be an absolute URL path without query or fragment, ' +
        `got: ${JSON.stringify(raw)}`
    )
  }
  return trimmed
}

export function resolveMetricsRoute(method: string, url: string): string {
  const pathname = pathName(url)
  if (
    pathname === '/livez' ||
    pathname === '/readyz' ||
    pathname === '/healthz' ||
    pathname === '/api/openapi.json'
  ) {
    return pathname
  }

  if (method === 'POST' && /^\/api\/[^/]+\/[^/]+$/.test(pathname)) {
    return documentedApiPaths.has(pathname) ? pathname : 'unknown'
  }

  if (pathname.startsWith('/api/')) return 'unknown'
  return 'static'
}

export function resolveMetricsIpc(method: string, url: string): string | undefined {
  if (method !== 'POST') return undefined

  const pathname = pathName(url)
  const match = /^\/api\/([^/]+)\/([^/]+)$/.exec(pathname)
  if (match === null) return undefined
  if (NON_DISPATCHER_API_PATHS.has(pathname)) return undefined
  if (!documentedApiPaths.has(pathname)) return 'unknown'

  const [, domain, ipcMethod] = match
  return `${toTaskDomain(domain)}:${ipcMethod}`
}

export type OperationMetricName =
  | 'auth-change-password'
  | 'auth-login'
  | 'batch-import'
  | 'import'
  | 'upload-stage'

export type OperationMetricResult = 'success' | 'error'

export class AppMetrics {
  private readonly baseLabels: Labels
  private readonly requests = new Map<string, { labels: Labels; value: number }>()
  private readonly inFlight = new Map<string, { labels: Labels; value: number }>()
  private readonly durations = new Map<string, { labels: Labels; state: HistogramState }>()
  private readonly ipcRequests = new Map<string, { labels: Labels; value: number }>()
  private readonly ipcInFlight = new Map<string, { labels: Labels; value: number }>()
  private readonly ipcDurations = new Map<string, { labels: Labels; state: HistogramState }>()
  private readonly ipcLastSuccess = new Map<string, { labels: Labels; value: number }>()
  private readonly operationEvents = new Map<string, { labels: Labels; value: number }>()
  private dbHealthy = 0
  private readonly startedAt = Date.now() / 1000

  constructor(options: { app: string; environment: string }) {
    this.baseLabels = {
      app: options.app,
      environment: options.environment
    }
  }

  beginRequest(method: string, route: string): void {
    const labels = { ...this.baseLabels, method, route }
    const key = labelKey(labels)
    const current = this.inFlight.get(key)
    this.inFlight.set(key, { labels, value: (current?.value ?? 0) + 1 })
  }

  endRequest(method: string, route: string, status: number, durationSeconds: number): void {
    const inFlightLabels = { ...this.baseLabels, method, route }
    const inFlightKey = labelKey(inFlightLabels)
    const current = this.inFlight.get(inFlightKey)
    this.inFlight.set(inFlightKey, {
      labels: inFlightLabels,
      value: Math.max(0, (current?.value ?? 0) - 1)
    })

    const requestLabels = { ...this.baseLabels, method, route, status }
    const requestKey = labelKey(requestLabels)
    const request = this.requests.get(requestKey)
    this.requests.set(requestKey, { labels: requestLabels, value: (request?.value ?? 0) + 1 })

    const duration = this.durations.get(requestKey) ?? {
      labels: requestLabels,
      state: {
        buckets: new Map(DEFAULT_BUCKETS.map((bucket) => [bucket, 0])),
        count: 0,
        sum: 0
      }
    }
    duration.state.count += 1
    duration.state.sum += durationSeconds
    for (const bucket of DEFAULT_BUCKETS) {
      if (durationSeconds <= bucket) {
        duration.state.buckets.set(bucket, (duration.state.buckets.get(bucket) ?? 0) + 1)
      }
    }
    this.durations.set(requestKey, duration)
  }

  beginIpc(ipc: string): void {
    const labels = { ...this.baseLabels, ipc }
    const key = labelKey(labels)
    const current = this.ipcInFlight.get(key)
    this.ipcInFlight.set(key, { labels, value: (current?.value ?? 0) + 1 })
  }

  endIpc(ipc: string, status: 'success' | 'error', durationSeconds: number): void {
    const inFlightLabels = { ...this.baseLabels, ipc }
    const inFlightKey = labelKey(inFlightLabels)
    const current = this.ipcInFlight.get(inFlightKey)
    this.ipcInFlight.set(inFlightKey, {
      labels: inFlightLabels,
      value: Math.max(0, (current?.value ?? 0) - 1)
    })

    const requestLabels = { ...this.baseLabels, ipc, status }
    const requestKey = labelKey(requestLabels)
    const request = this.ipcRequests.get(requestKey)
    this.ipcRequests.set(requestKey, { labels: requestLabels, value: (request?.value ?? 0) + 1 })

    const duration = this.ipcDurations.get(requestKey) ?? {
      labels: requestLabels,
      state: {
        buckets: new Map(DEFAULT_BUCKETS.map((bucket) => [bucket, 0])),
        count: 0,
        sum: 0
      }
    }
    duration.state.count += 1
    duration.state.sum += durationSeconds
    for (const bucket of DEFAULT_BUCKETS) {
      if (durationSeconds <= bucket) {
        duration.state.buckets.set(bucket, (duration.state.buckets.get(bucket) ?? 0) + 1)
      }
    }
    this.ipcDurations.set(requestKey, duration)

    if (status === 'success') {
      this.ipcLastSuccess.set(inFlightKey, { labels: inFlightLabels, value: Date.now() / 1000 })
    }
  }

  setDatabaseHealthy(value: boolean): void {
    this.dbHealthy = value ? 1 : 0
  }

  recordOperationEvent(params: {
    operation: OperationMetricName
    result: OperationMetricResult
    failureClass?: string
  }): void {
    const labels = {
      ...this.baseLabels,
      operation: params.operation,
      result: params.result,
      failure_class:
        params.result === 'success' ? 'none' : normalizeFailureClass(params.failureClass)
    }
    const key = labelKey(labels)
    const current = this.operationEvents.get(key)
    this.operationEvents.set(key, { labels, value: (current?.value ?? 0) + 1 })
  }

  contentType(): string {
    return 'text/plain; version=0.0.4; charset=utf-8'
  }

  metricsText(): string {
    const lines: string[] = []
    lines.push('# HELP http_requests_total Total HTTP requests.')
    lines.push('# TYPE http_requests_total counter')
    pushSeries(lines, 'http_requests_total', this.requests.values())

    lines.push('# HELP http_request_duration_seconds HTTP request duration.')
    lines.push('# TYPE http_request_duration_seconds histogram')
    pushHistogram(lines, 'http_request_duration_seconds', this.durations.values())

    lines.push('# HELP http_requests_in_flight Current in-flight HTTP requests.')
    lines.push('# TYPE http_requests_in_flight gauge')
    pushSeries(lines, 'http_requests_in_flight', this.inFlight.values())

    lines.push('# HELP varlens_database_healthy Database health from the latest health check.')
    lines.push('# TYPE varlens_database_healthy gauge')
    lines.push(metricLine('varlens_database_healthy', this.baseLabels, this.dbHealthy))

    lines.push('# HELP varlens_ipc_requests_total Total VarLens web IPC calls.')
    lines.push('# TYPE varlens_ipc_requests_total counter')
    pushSeries(lines, 'varlens_ipc_requests_total', this.ipcRequests.values())

    lines.push('# HELP varlens_ipc_duration_seconds VarLens web IPC call duration.')
    lines.push('# TYPE varlens_ipc_duration_seconds histogram')
    pushHistogram(lines, 'varlens_ipc_duration_seconds', this.ipcDurations.values())

    lines.push('# HELP varlens_ipc_in_flight Current in-flight VarLens web IPC calls.')
    lines.push('# TYPE varlens_ipc_in_flight gauge')
    pushSeries(lines, 'varlens_ipc_in_flight', this.ipcInFlight.values())

    lines.push(
      '# HELP varlens_ipc_last_success_timestamp_seconds Last successful VarLens web IPC call timestamp.'
    )
    lines.push('# TYPE varlens_ipc_last_success_timestamp_seconds gauge')
    pushSeries(lines, 'varlens_ipc_last_success_timestamp_seconds', this.ipcLastSuccess.values())

    lines.push(
      '# HELP varlens_operation_events_total Bounded VarLens operation outcomes for support triage.'
    )
    lines.push('# TYPE varlens_operation_events_total counter')
    pushSeries(lines, 'varlens_operation_events_total', this.operationEvents.values())

    lines.push('# HELP process_start_time_seconds Start time of the Node.js process.')
    lines.push('# TYPE process_start_time_seconds gauge')
    lines.push(metricLine('process_start_time_seconds', this.baseLabels, this.startedAt))

    lines.push('# HELP process_uptime_seconds Uptime of the Node.js process.')
    lines.push('# TYPE process_uptime_seconds gauge')
    lines.push(metricLine('process_uptime_seconds', this.baseLabels, process.uptime()))

    const memory = process.memoryUsage()
    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.')
    lines.push('# TYPE process_resident_memory_bytes gauge')
    lines.push(metricLine('process_resident_memory_bytes', this.baseLabels, memory.rss))
    lines.push('# HELP nodejs_heap_size_used_bytes Node.js heap used in bytes.')
    lines.push('# TYPE nodejs_heap_size_used_bytes gauge')
    lines.push(metricLine('nodejs_heap_size_used_bytes', this.baseLabels, memory.heapUsed))

    return `${lines.join('\n')}\n`
  }
}

function normalizeFailureClass(value: string | undefined): string {
  const raw = value?.trim().toLowerCase()
  if (raw === undefined || raw === '') return 'unknown'
  const normalized = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized === '' ? 'unknown' : normalized.slice(0, 64)
}

export function createAppMetricsFromEnv(env: NodeJS.ProcessEnv = process.env): AppMetrics {
  const app = nonEmptyTrimmed(env.VARLENS_OBSERVABILITY_APP) ?? 'varlens'
  const environment =
    nonEmptyTrimmed(env.VARLENS_OBSERVABILITY_ENVIRONMENT) ??
    nonEmptyTrimmed(env.NODE_ENV) ??
    'unknown'

  return new AppMetrics({
    app,
    environment
  })
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed === '') return undefined
  return trimmed
}

export function registerRequestMetrics(app: FastifyInstance, metrics: AppMetrics): void {
  const requests = new WeakMap<
    FastifyRequest,
    { start: bigint; method: string; route: string; ipc?: string }
  >()

  app.addHook('onRequest', async (request) => {
    const method = request.method
    const route = resolveMetricsRoute(method, request.url)
    const ipc = resolveMetricsIpc(method, request.url)
    requests.set(request, { start: process.hrtime.bigint(), method, route, ipc })
    metrics.beginRequest(method, route)
    if (ipc !== undefined) {
      metrics.beginIpc(ipc)
    }
  })

  app.addHook('onResponse', async (request, reply) => {
    recordResponse(metrics, requests, request, reply)
  })
}

function recordResponse(
  metrics: AppMetrics,
  requests: WeakMap<FastifyRequest, { start: bigint; method: string; route: string; ipc?: string }>,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const state = requests.get(request)
  if (state === undefined) return
  const durationSeconds = Number(process.hrtime.bigint() - state.start) / 1_000_000_000
  metrics.endRequest(state.method, state.route, reply.statusCode, durationSeconds)
  if (state.ipc !== undefined) {
    metrics.endIpc(state.ipc, reply.statusCode >= 400 ? 'error' : 'success', durationSeconds)
  }
  requests.delete(request)
}

export async function startMetricsServer(options: {
  metrics: AppMetrics
  host: string
  port: number
  path?: string
}): Promise<Server> {
  const metricsPath = normalizeMetricsPath(options.path)
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || pathName(request.url ?? '/') !== metricsPath) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
      return
    }
    response.writeHead(200, { 'content-type': options.metrics.contentType() })
    response.end(options.metrics.metricsText())
  })

  return await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
