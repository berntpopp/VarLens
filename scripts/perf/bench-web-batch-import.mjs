#!/usr/bin/env node
/**
 * Batch-import throughput benchmark for the PostgreSQL web server.
 *
 * Drives a RUNNING web server over its HTTP API exactly as the browser does:
 * sign in, upload N files, start one batch import, and record when each case
 * becomes visible. Point it at a server on a scratch schema.
 *
 * Usage:
 *   VARLENS_BENCH_PASSWORD=... node scripts/perf/bench-web-batch-import.mjs \
 *     --dir tests/.cache/sim-cohort --count 20 --label baseline
 *
 * Options:
 *   --dir <path>     Directory with *.vcf.gz files (default tests/.cache/sim-cohort)
 *   --count <n>      Number of files to import (default: all)
 *   --offset <n>     Skip the first n files (default 0)
 *   --label <name>   Artifact name under .planning/artifacts/perf/batch-import/
 *   --url <base>     Server base URL (default http://127.0.0.1:8787)
 *   --user <name>    Username (default admin; password from VARLENS_BENCH_PASSWORD)
 */
import { createReadStream, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'

function parseArgs(argv) {
  const options = {
    dir: 'tests/.cache/sim-cohort',
    count: undefined,
    offset: 0,
    label: `run-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    url: 'http://127.0.0.1:8787',
    user: 'admin'
  }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    if (!(key in options)) throw new Error(`Unknown option ${argv[i]}`)
    options[key] = argv[++i]
  }
  if (options.count !== undefined) options.count = Number(options.count)
  options.offset = Number(options.offset)
  return options
}

class Session {
  constructor(baseUrl) {
    this.baseUrl = baseUrl
    this.cookie = ''
  }

  /** The server only accepts unsafe API requests that look same-origin, as a browser's do. */
  sameOriginHeaders() {
    return { origin: this.baseUrl, 'sec-fetch-site': 'same-origin', cookie: this.cookie }
  }

  rememberCookies(setCookieHeaders) {
    const jar = new Map(
      this.cookie
        .split('; ')
        .filter(Boolean)
        .map((pair) => [pair.split('=')[0], pair])
    )
    for (const header of setCookieHeaders) {
      const pair = header.split(';')[0]
      jar.set(pair.split('=')[0], pair)
    }
    this.cookie = [...jar.values()].join('; ')
  }

  /**
   * POST one RPC. Uses node:http rather than fetch: an older server holds the
   * batch-import call open for the whole batch and fetch gives up after 5 minutes.
   */
  async invoke(domain, method, args = []) {
    const body = JSON.stringify({ args })
    const { status, text, setCookie } = await new Promise((resolvePromise, reject) => {
      const req = httpRequest(
        `${this.baseUrl}/api/${domain}/${method}`,
        {
          method: 'POST',
          timeout: 0,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            ...this.sameOriginHeaders()
          }
        },
        (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () =>
            resolvePromise({
              status: res.statusCode ?? 0,
              text: Buffer.concat(chunks).toString('utf8'),
              setCookie: res.headers['set-cookie'] ?? []
            })
          )
          res.on('error', reject)
        }
      )
      req.on('error', reject)
      req.end(body)
    })
    this.rememberCookies(setCookie)
    if (status < 200 || status >= 300) throw new Error(`${domain}.${method}: ${status} ${text}`)
    return text === '' ? undefined : JSON.parse(text)
  }

  async upload(path, fileName) {
    const response = await fetch(`${this.baseUrl}/api/import/upload`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(statSync(path).size),
        'x-varlens-file-name': fileName,
        ...this.sameOriginHeaders()
      },
      body: createReadStream(path),
      duplex: 'half'
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`upload ${fileName}: ${response.status} ${text}`)
    return JSON.parse(text).ref
  }
}

function caseCount(listResult) {
  if (Array.isArray(listResult)) return listResult.length
  if (Array.isArray(listResult?.data)) return listResult.data.length
  return 0
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const password = process.env.VARLENS_BENCH_PASSWORD
  if (!password) throw new Error('Set VARLENS_BENCH_PASSWORD to the test admin password')

  const dir = resolve(options.dir)
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.vcf.gz'))
    .sort()
    .slice(options.offset, options.count === undefined ? undefined : options.offset + options.count)
  if (files.length === 0) throw new Error(`No *.vcf.gz files in ${dir}`)

  const session = new Session(options.url)
  const login = await session.invoke('auth', 'login', [options.user, password])
  if (login?.success !== true) throw new Error('Login failed')

  const before = caseCount(await session.invoke('cases', 'list'))

  const uploadStart = performance.now()
  const refs = []
  for (const name of files) refs.push(await session.upload(join(dir, name), name))
  const uploadMs = performance.now() - uploadStart

  const importStart = performance.now()
  const visibleAt = []
  let polling = true
  const poller = (async () => {
    while (polling) {
      const visible = caseCount(await session.invoke('cases', 'list')) - before
      while (visibleAt.length < visible) visibleAt.push(performance.now() - importStart)
      await new Promise((done) => setTimeout(done, 200))
    }
  })()

  const runId = randomUUID()
  let result = await session.invoke('batchImport', 'start', [refs, 'skip', undefined, runId])
  // The server accepts the batch and answers with a job id; the result is
  // read from the status call (a browser gets it by event). An older server
  // held the request open and returned the result directly.
  if (result?.accepted === true) {
    for (;;) {
      const status = await session.invoke('batchImport', 'status', [runId])
      if (status?.state === 'completed') {
        result = status.result
        break
      }
      if (status?.state !== 'running') {
        throw new Error(`Batch import ${status?.state}: ${JSON.stringify(status?.error ?? null)}`)
      }
      await new Promise((done) => setTimeout(done, 500))
    }
  }
  const totalMs = performance.now() - importStart
  polling = false
  await poller
  const finalVisible = caseCount(await session.invoke('cases', 'list')) - before
  while (visibleAt.length < finalVisible) visibleAt.push(totalMs)

  const gaps = visibleAt.map((at, index) => at - (index === 0 ? 0 : visibleAt[index - 1]))
  const summary = {
    label: options.label,
    files: files.length,
    succeeded: result?.succeeded,
    failed: result?.failed,
    skipped: result?.skipped,
    uploadSeconds: +(uploadMs / 1000).toFixed(2),
    importSeconds: +(totalMs / 1000).toFixed(2),
    samplesPerMinute: +((files.length / totalMs) * 60000).toFixed(2),
    firstFiveMedianGapSeconds: +(median(gaps.slice(0, 5)) / 1000).toFixed(2),
    lastFiveMedianGapSeconds: +(median(gaps.slice(-5)) / 1000).toFixed(2),
    visibleAtSeconds: visibleAt.map((at) => +(at / 1000).toFixed(1))
  }

  const outDir = resolve('.planning/artifacts/perf/batch-import')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, `${options.label}.json`), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
  if (result?.failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
