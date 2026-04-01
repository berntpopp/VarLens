import { parentPort } from 'worker_threads'
import { createWriteStream } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import * as XLSX from 'xlsx'
import type { ExportMainMessage, ExportWorkerMessage } from '../../shared/types/export-worker'

const EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: 'chr', header: 'Chromosome' },
  { key: 'pos', header: 'Position' },
  { key: 'ref', header: 'Reference' },
  { key: 'alt', header: 'Alternate' },
  { key: 'gt_num', header: 'Genotype' },
  { key: 'gene_symbol', header: 'Gene' },
  { key: 'func', header: 'Function' },
  { key: 'consequence', header: 'Consequence' },
  { key: 'transcript', header: 'Transcript' },
  { key: 'cdna', header: 'cDNA' },
  { key: 'aa_change', header: 'AA Change' },
  { key: 'gnomad_af', header: 'gnomAD AF' },
  { key: 'cadd', header: 'CADD' },
  { key: 'qual', header: 'Quality' },
  { key: 'clinvar', header: 'ClinVar' },
  { key: 'hpo_sim_score', header: 'HPO Similarity' },
  { key: 'moi', header: 'MOI' }
]

function postMsg(msg: ExportWorkerMessage): void {
  parentPort?.postMessage(msg)
}

/** Format a cell value — applies numeric formatting for specific columns. */
export function formatCellValue(key: string, value: unknown): string | number | null {
  if (value === null || value === undefined) return ''
  if (key === 'gnomad_af' && typeof value === 'number') {
    return value.toExponential(2)
  }
  if (key === 'cadd' && typeof value === 'number') {
    return value.toFixed(2)
  }
  if (key === 'hpo_sim_score' && typeof value === 'number') {
    return value.toFixed(4)
  }
  return value as string | number | null
}

/**
 * Escape a value for RFC 4180 CSV.
 * Wraps in double-quotes if the value contains a comma, double-quote, or newline.
 * Internal double-quotes are escaped by doubling them.
 */
export function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

function openDb(msg: ExportMainMessage & { type: 'start' }): Database.Database {
  const db = new Database(msg.dbPath, { readonly: true })
  if (msg.encryptionKey !== undefined && msg.encryptionKey !== '') {
    const escapedKey = msg.encryptionKey.replace(/'/g, "''")
    db.pragma(`key='${escapedKey}'`)
  }
  db.pragma('journal_mode = WAL')
  return db
}

async function runCsv(msg: ExportMainMessage & { type: 'start' }): Promise<void> {
  let db: Database.Database | null = null

  try {
    db = openDb(msg)

    const stmt = db.prepare(msg.compiledSql)
    const iterator = stmt.iterate(...msg.compiledParams) as IterableIterator<
      Record<string, unknown>
    >

    // total is unknown for streaming — report 0
    postMsg({ type: 'progress', current: 0, total: 0 })

    const stream = createWriteStream(msg.outputFilePath, { encoding: 'utf8' })

    // Write header row
    const headerRow = EXPORT_COLUMNS.map((col) => csvEscape(col.header)).join(',')
    const headerOk = stream.write(headerRow + '\r\n')
    if (!headerOk) {
      await new Promise<void>((resolve) => stream.once('drain', resolve))
    }

    let rowCount = 0
    for (const row of iterator) {
      const cells = EXPORT_COLUMNS.map((col) => csvEscape(formatCellValue(col.key, row[col.key])))
      const ok = stream.write(cells.join(',') + '\r\n')
      if (!ok) {
        await new Promise<void>((resolve) => stream.once('drain', resolve))
      }
      rowCount++

      if (rowCount % 1000 === 0) {
        postMsg({ type: 'progress', current: rowCount, total: 0 })
      }
    }

    // Wait for the write stream to flush to disk before reporting completion
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve)
      stream.on('error', reject)
      stream.end()
    })

    postMsg({
      type: 'complete',
      filePath: msg.outputFilePath,
      rowCount
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    postMsg({ type: 'error', error: err.message, stack: err.stack })
  } finally {
    db?.close()
  }
}

function runXlsx(msg: ExportMainMessage & { type: 'start' }): void {
  let db: Database.Database | null = null

  try {
    db = openDb(msg)

    const stmt = db.prepare(msg.compiledSql)
    const iterator = stmt.iterate(...msg.compiledParams) as IterableIterator<
      Record<string, unknown>
    >

    postMsg({ type: 'progress', current: 0, total: 0 })

    // XLSX requires all rows in memory for aoa_to_sheet — unlike CSV, this path
    // cannot stream to disk. The memory win here is using .iterate() instead of
    // .all() to avoid a second copy, not true streaming.
    const headers = EXPORT_COLUMNS.map((col) => col.header)
    const rows: (string | number | null)[][] = []

    let i = 0
    for (const variant of iterator) {
      rows.push(EXPORT_COLUMNS.map((col) => formatCellValue(col.key, variant[col.key])))
      i++

      if (i % 1000 === 0) {
        postMsg({ type: 'progress', current: i, total: 0 })
      }
    }

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = EXPORT_COLUMNS.map((col) => ({
      wch: col.key === 'aa_change' ? 20 : 15
    }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Variants')

    // Metadata sheet (includes active filter summary)
    const { filterSummary } = msg
    const metaData: (string | number)[][] = [
      ['Export Information'],
      ['Case Name', msg.caseName],
      ['Total Variants', i],
      ['Export Date', new Date().toISOString()],
      [''],
      ['Active Filters'],
      ...(filterSummary.gene_symbol !== undefined && filterSummary.gene_symbol !== ''
        ? [['Gene', filterSummary.gene_symbol]]
        : []),
      ...(filterSummary.consequences !== undefined && filterSummary.consequences.length > 0
        ? [['Consequences', filterSummary.consequences.join(', ')]]
        : []),
      ...(filterSummary.funcs !== undefined && filterSummary.funcs.length > 0
        ? [['Functions', filterSummary.funcs.join(', ')]]
        : []),
      ...(filterSummary.clinvars !== undefined && filterSummary.clinvars.length > 0
        ? [['ClinVar', filterSummary.clinvars.join(', ')]]
        : []),
      ...(filterSummary.gnomad_af_max !== undefined
        ? [['Max gnomAD AF', filterSummary.gnomad_af_max]]
        : []),
      ...(filterSummary.cadd_min !== undefined ? [['Min CADD', filterSummary.cadd_min]] : [])
    ]
    const metaWs = XLSX.utils.aoa_to_sheet(metaData)
    XLSX.utils.book_append_sheet(wb, metaWs, 'Export Info')

    // Write file
    XLSX.writeFile(wb, msg.outputFilePath)

    postMsg({
      type: 'complete',
      filePath: msg.outputFilePath,
      rowCount: i
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    postMsg({ type: 'error', error: err.message, stack: err.stack })
  } finally {
    db?.close()
  }
}

async function run(msg: ExportMainMessage & { type: 'start' }): Promise<void> {
  if (msg.format === 'csv') {
    await runCsv(msg)
  } else {
    runXlsx(msg)
  }
}

// Listen for messages from main thread
parentPort?.on('message', (msg: ExportMainMessage) => {
  if (msg.type === 'start') {
    run(msg)
  }
  // Note: cancel is not supported — the entire query+XLSX/CSV generation
  // runs synchronously in the worker. The main thread can terminate
  // the worker if cancellation is needed.
})
