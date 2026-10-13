/**
 * Annotations IPC handler integration tests
 *
 * Tests annotation repository methods with real SQLite backend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'

// ── Electron mock (hoisted) ──────────────────────────────────────────────────
// The broadcast describe block below registers the real IPC handlers and
// verifies `BrowserWindow.getAllWindows()[*].webContents.send(...)` is called.
// We capture sent messages into a module-level array so each test can assert.
const sentMessages: Array<{ channel: string; payload: unknown }> = []

vi.mock('electron', () => {
  const mockWebContents = {
    send: (channel: string, payload: unknown): void => {
      sentMessages.push({ channel, payload })
    }
  }
  const mockWindow = {
    isDestroyed: (): boolean => false,
    webContents: mockWebContents
  }
  return {
    BrowserWindow: {
      getAllWindows: (): Array<typeof mockWindow> => [mockWindow]
    },
    // ipcMain is never used directly by the handler module (it receives an
    // injected ipcMain via HandlerDependencies), but MainLogger imports
    // `electron` dynamically so we keep a placeholder.
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn()
    },
    app: {
      getPath: vi.fn(() => '/tmp/varlens-test')
    }
  }
})

describe('annotation IPC handlers', () => {
  let db: DatabaseService
  let caseId: number
  let variantId: number

  // Helper to insert a case
  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/path/${name}.json`, 1000, 0, Date.now())
    return result.lastInsertRowid as number
  }

  // Helper to insert a variant and return its id
  const insertVariant = (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): number => {
    const result = db.database
      .prepare(
        `INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(caseId, chr, pos, ref, alt, '0/1')
    return result.lastInsertRowid as number
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
    caseId = insertCase('Test Case')
    variantId = insertVariant(caseId, '1', 12345, 'A', 'G')
  })

  afterEach(() => {
    db.close()
  })

  describe('getAnnotationsForVariant (annotations:getForVariant)', () => {
    it('returns null annotations when none exist', () => {
      const result = db.annotations.getAnnotationsForVariant(caseId, '1', 12345, 'A', 'G')

      expect(result).toHaveProperty('global')
      expect(result).toHaveProperty('perCase')
      expect(result.global).toBeNull()
      expect(result.perCase).toBeNull()
    })

    it('returns global and per-case annotations for a variant', () => {
      // Create global annotation
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', {
        global_comment: 'Global note',
        starred: 1,
        acmg_classification: 'Pathogenic'
      })

      // Create per-case annotation
      db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'Per-case note',
        starred: 0,
        acmg_classification: 'Likely Pathogenic'
      })

      const result = db.annotations.getAnnotationsForVariant(caseId, '1', 12345, 'A', 'G')

      expect(result.global).not.toBeNull()
      expect(result.global!.global_comment).toBe('Global note')
      expect(result.global!.starred).toBe(1)
      expect(result.global!.acmg_classification).toBe('Pathogenic')

      expect(result.perCase).not.toBeNull()
      expect(result.perCase!.per_case_comment).toBe('Per-case note')
      expect(result.perCase!.starred).toBe(0)
      expect(result.perCase!.acmg_classification).toBe('Likely Pathogenic')
    })
  })

  describe('upsertGlobalAnnotation (annotations:upsertGlobal)', () => {
    it('creates a new global annotation', () => {
      const result = db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', {
        global_comment: 'Test comment',
        acmg_classification: 'Pathogenic'
      })

      expect(result).toHaveProperty('id')
      expect(result.chr).toBe('1')
      expect(result.pos).toBe(12345)
      expect(result.ref).toBe('A')
      expect(result.alt).toBe('G')
      expect(result.global_comment).toBe('Test comment')
      expect(result.acmg_classification).toBe('Pathogenic')
      expect(result.starred).toBe(0) // default
    })

    it('updates an existing global annotation', () => {
      // Create initial
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', {
        global_comment: 'Initial comment'
      })

      // Update
      const result = db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', {
        global_comment: 'Updated comment',
        starred: 1
      })

      expect(result.global_comment).toBe('Updated comment')
      expect(result.starred).toBe(1)
    })

    it('handles updating annotation for nonexistent variant coordinates gracefully', () => {
      // Upserting for coordinates that have no variant row should still work
      // because global annotations are keyed by chr/pos/ref/alt, not variant id
      const result = db.annotations.upsertGlobalAnnotation('99', 99999, 'C', 'T', 'GRCh38', {
        global_comment: 'Annotation for unknown variant'
      })

      expect(result.chr).toBe('99')
      expect(result.pos).toBe(99999)
      expect(result.global_comment).toBe('Annotation for unknown variant')
    })
  })

  describe('upsertPerCaseAnnotation (annotations:upsertPerCase)', () => {
    it('creates a new per-case annotation', () => {
      const result = db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'Case-specific note',
        acmg_classification: 'VUS'
      })

      expect(result).toHaveProperty('id')
      expect(result.case_id).toBe(caseId)
      expect(result.variant_id).toBe(variantId)
      expect(result.per_case_comment).toBe('Case-specific note')
      expect(result.acmg_classification).toBe('VUS')
      expect(result.starred).toBe(0)
    })

    it('updates existing per-case annotation', () => {
      db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'First note'
      })

      const result = db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'Updated note',
        starred: 1
      })

      expect(result.per_case_comment).toBe('Updated note')
      expect(result.starred).toBe(1)
    })
  })

  describe('deleteGlobalAnnotation (annotations:deleteGlobal)', () => {
    it('deletes an existing global annotation', () => {
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', {
        global_comment: 'To be deleted'
      })

      db.annotations.deleteGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38')

      const result = db.annotations.getGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38')
      expect(result).toBeNull()
    })
  })

  describe('deletePerCaseAnnotation (annotations:deletePerCase)', () => {
    it('deletes an existing per-case annotation', () => {
      db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
        per_case_comment: 'To be deleted'
      })

      db.annotations.deletePerCaseAnnotation(caseId, variantId)

      const result = db.annotations.getPerCaseAnnotation(caseId, variantId)
      expect(result).toBeNull()
    })
  })

  describe('getBatch (annotations:batchGet)', () => {
    it('returns empty record for empty variantKeys array', () => {
      const result = db.annotations.getBatch(caseId, [])
      expect(result).toEqual({})
    })

    it('returns annotations keyed by chr:pos:ref:alt for case mode', () => {
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', { starred: 1 })

      const result = db.annotations.getBatch(caseId, [{ chr: '1', pos: 12345, ref: 'A', alt: 'G' }])

      expect(result).toHaveProperty('1:12345:A:G')
      expect(result['1:12345:A:G'].global).not.toBeNull()
      expect(result['1:12345:A:G'].global!.starred).toBe(1)
      expect(result['1:12345:A:G'].perCase).toBeNull()
    })

    it('returns global-only annotations when caseId is null', () => {
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', { starred: 1 })

      const result = db.annotations.getBatch(
        null,
        [{ chr: '1', pos: 12345, ref: 'A', alt: 'G' }],
        'GRCh38'
      )

      expect(result['1:12345:A:G'].global).not.toBeNull()
      expect(result['1:12345:A:G'].perCase).toBeNull()
    })

    it('returns null entries for variants with no annotations', () => {
      const result = db.annotations.getBatch(caseId, [{ chr: '1', pos: 99999, ref: 'C', alt: 'T' }])

      expect(result['1:99999:C:T']).toEqual({ global: null, perCase: null })
    })

    it('handles multiple variants in a single batch', () => {
      db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', 'GRCh38', { starred: 1 })

      const result = db.annotations.getBatch(caseId, [
        { chr: '1', pos: 12345, ref: 'A', alt: 'G' },
        { chr: '2', pos: 67890, ref: 'T', alt: 'C' }
      ])

      expect(Object.keys(result)).toHaveLength(2)
      expect(result['1:12345:A:G'].global).not.toBeNull()
      expect(result['2:67890:T:C'].global).toBeNull()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 1.E — variants:annotationChanged broadcast
// ─────────────────────────────────────────────────────────────────────────────
//
// The `annotations:upsertPerCase` handler wrapper emits a broadcast on every
// non-destroyed BrowserWindow via `webContents.send('variants:annotationChanged',
// { caseId, variantId, kind })` AFTER the `upsertPerCaseAnnotation(...)` logic
// call returns successfully. These tests verify:
//   1. Successful upsert emits the broadcast with the correct kind mapping
//   2. Thrown errors from the logic layer suppress the broadcast
//   3. The kind is derived from the update shape (star / comment / acmg / evidence)
//
// The handler wrapper receives an injected `ipcMain` via `HandlerDependencies`,
// so we build a fake ipcMain that captures registered handler callbacks, then
// invoke them directly with a stub `IpcMainInvokeEvent`.

describe('annotations:upsertPerCase — variants:annotationChanged broadcast', () => {
  let db: DatabaseService
  let caseId: number
  let variantId: number
  type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown
  const capturedHandlers = new Map<string, HandlerCallback>()

  // Fake ipcMain that records every registered handler so tests can invoke
  // them directly. Mimics the shape of `HandlerDependencies.ipcMain`.
  const fakeIpcMain = {
    handle: (channel: string, cb: HandlerCallback): void => {
      capturedHandlers.set(channel, cb)
    }
  } as unknown as import('electron').IpcMain

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = capturedHandlers.get(channel)
    if (!handler) throw new Error(`No handler registered for ${channel}`)
    // Pass a minimal stub for IpcMainInvokeEvent — the handler body only
    // destructures the remaining parameters.
    return handler({} as unknown, ...args)
  }

  beforeEach(async () => {
    // Fresh DB + single case/variant
    db = new DatabaseService(':memory:')
    caseId = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('Broadcast Test Case', '/tmp/bc.json', 1, 0, Date.now()).lastInsertRowid as number
    variantId = db.database
      .prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(caseId, '1', 200, 'A', 'T', '0/1').lastInsertRowid as number

    // Reset broadcast capture and handler registry for every test
    sentMessages.length = 0
    capturedHandlers.clear()

    // Register real handlers against the fake ipcMain
    const { registerAnnotationHandlers } =
      await import('../../../src/main/ipc/handlers/annotations')
    registerAnnotationHandlers({
      ipcMain: fakeIpcMain,
      getDb: () => db,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'sqlite' },
          getWriteExecutor: () => ({
            execute: vi.fn().mockResolvedValue({
              id: 1,
              case_id: caseId,
              variant_id: variantId,
              starred: 0,
              per_case_comment: null,
              acmg_classification: null,
              acmg_evidence: null
            })
          })
        })
      })) as unknown as () => import('../../../src/main/services/DatabaseManager').DatabaseManager
    })
  })

  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  it('emits variants:annotationChanged with kind="star" after successful starred upsert', async () => {
    const result = await invoke('annotations:upsertPerCase', caseId, variantId, {
      starred: true
    })

    // Handler must return the DB row (not a SerializableError)
    expect(result).toBeDefined()
    expect(result).not.toHaveProperty('code')

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]).toEqual({
      channel: 'variants:annotationChanged',
      payload: { caseId, variantId, kind: 'star' }
    })
  })

  it('emits kind="comment" when only per_case_comment is updated', async () => {
    await invoke('annotations:upsertPerCase', caseId, variantId, {
      per_case_comment: 'A note'
    })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].channel).toBe('variants:annotationChanged')
    expect(sentMessages[0].payload).toEqual({
      caseId,
      variantId,
      kind: 'comment'
    })
  })

  it('emits kind="acmg" when acmg_classification is updated', async () => {
    await invoke('annotations:upsertPerCase', caseId, variantId, {
      acmg_classification: 'Pathogenic'
    })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].payload).toEqual({
      caseId,
      variantId,
      kind: 'acmg'
    })
  })

  it('emits kind="evidence" when acmg_evidence is updated (no classification, no star)', async () => {
    await invoke('annotations:upsertPerCase', caseId, variantId, {
      acmg_evidence: 'PS1,PM2'
    })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].payload).toEqual({
      caseId,
      variantId,
      kind: 'evidence'
    })
  })

  it('does NOT broadcast when the upsert throws', async () => {
    // Force a failure by making the write executor reject. The handler now
    // routes through `upsertPerCaseAnnotationWithEvent` →
    // `getSession().getWriteExecutor().execute(...)`, so a rejected executor
    // is the correct injection point for the error path.
    capturedHandlers.clear()
    const { registerAnnotationHandlers } =
      await import('../../../src/main/ipc/handlers/annotations')
    registerAnnotationHandlers({
      ipcMain: fakeIpcMain,
      getDb: () => db,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'sqlite' },
          getWriteExecutor: () => ({
            execute: vi.fn().mockRejectedValue(new Error('boom'))
          })
        })
      })) as unknown as () => import('../../../src/main/services/DatabaseManager').DatabaseManager
    })

    const result = await invoke('annotations:upsertPerCase', caseId, variantId, {
      starred: true
    })

    // wrapHandler catches the throw and returns a SerializableError
    expect(result).toMatchObject({ code: expect.any(String), message: 'boom' })

    // Critically: no broadcast fired on the error path
    expect(sentMessages).toHaveLength(0)
  })

  it('does NOT broadcast on validation failure (invalid caseId)', async () => {
    const result = await invoke('annotations:upsertPerCase', 'not-a-number', variantId, {
      starred: true
    })

    // Handler throws inside wrapHandler → serializable error
    expect(result).toHaveProperty('code')
    expect(sentMessages).toHaveLength(0)
  })

  // ── annotations:batchGet — variantId survives Zod validation ───────────────
  // The handler validates variantKeys through VariantKeysSchema before they
  // reach getBatch. Because z.object strips unknown keys by default, an optional
  // `variantId` field must be declared in the schema or it is silently dropped,
  // permanently disabling the per-case `AND v.id IN (...)` narrowing in the live
  // IPC path. These tests exercise the full handler → Zod → getBatch path so a
  // regression that removes variantId from the schema fails here.
  it('threads variantId through Zod validation into the per-case join', async () => {
    db.annotations.upsertPerCaseAnnotation(caseId, variantId, {
      per_case_comment: 'Per-case note',
      starred: 1
    })

    const result = (await invoke('annotations:batchGet', caseId, [
      { chr: '1', pos: 200, ref: 'A', alt: 'T', variantId }
    ])) as Record<
      string,
      {
        global: unknown | null
        perCase: { per_case_comment: string | null } | null
      }
    >

    expect(result).not.toHaveProperty('code')
    expect(result['1:200:A:T'].perCase).not.toBeNull()
    expect(result['1:200:A:T'].perCase!.per_case_comment).toBe('Per-case note')
  })

  it('rejects a spoofed variantId that belongs to another case (defensive join)', async () => {
    // Annotation lives on (caseId, variantId).
    db.annotations.upsertPerCaseAnnotation(caseId, variantId, { starred: 1 })

    // A second case with its own variant at the SAME coordinates.
    const otherCaseId = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('Other Case', '/tmp/other.json', 1, 0, Date.now()).lastInsertRowid as number
    db.database
      .prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(otherCaseId, '1', 200, 'A', 'T', '0/1')

    // Renderer spoofs caseId=otherCaseId but passes the FIRST case's variantId.
    const result = (await invoke('annotations:batchGet', otherCaseId, [
      { chr: '1', pos: 200, ref: 'A', alt: 'T', variantId }
    ])) as Record<string, { perCase: unknown | null }>

    // The dual case_id predicate rejects the cross-case variantId → no leak.
    expect(result['1:200:A:T'].perCase).toBeNull()
  })
})

describe('annotation PostgreSQL audit routing', () => {
  it('uses one audited postgres storage write for global annotation mutations', async () => {
    const readExecute = vi.fn().mockResolvedValue({ starred: 0 })
    const writeExecute = vi.fn().mockResolvedValue({ starred: 1 })
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    }
    const { registerAnnotationHandlers } =
      await import('../../../src/main/ipc/handlers/annotations')

    registerAnnotationHandlers({
      ipcMain: ipcMain as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres annotations')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'postgres' },
          getReadExecutor: () => ({ execute: readExecute }),
          getWriteExecutor: () => ({ execute: writeExecute })
        })
      })) as never
    })

    await expect(
      handlers.get('annotations:upsertGlobal')!(
        undefined,
        '1',
        123,
        'A',
        'G',
        { starred: true, user_name: 'analyst' },
        'GRCh38'
      )
    ).resolves.toEqual({ starred: 1 })

    expect(readExecute).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'annotations:upsertGlobalWithAudit',
      params: [
        { chr: '1', pos: 123, ref: 'A', alt: 'G', genome_build: 'GRCh38' },
        { starred: true, user_name: 'analyst' }
      ]
    })
  })
})
