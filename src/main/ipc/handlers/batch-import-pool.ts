/**
 * Scheduling for a batch import whose files load concurrently.
 *
 * Pure coordination, no storage access: grouping files into chains that must
 * stay sequential, running chains on a bounded number of slots, and turning
 * per-file events into the batch progress the UI shows.
 */
import type { BatchProgress } from '../../../shared/types/api'

/**
 * Group file indexes into chains. Files that map to the same case name form
 * one chain and run in their original order, so the outcome of a batch with
 * duplicate names is the same as importing the files one by one (the first
 * wins under `skip`, the last under `overwrite`) and two workers never race
 * to create the same case. Chains are ordered by their first file.
 */
export function groupIntoChains(caseNames: readonly string[]): number[][] {
  const byName = new Map<string, number[]>()
  caseNames.forEach((name, index) => {
    const chain = byName.get(name)
    if (chain === undefined) byName.set(name, [index])
    else chain.push(index)
  })
  return [...byName.values()]
}

/**
 * Run `chains` on at most `concurrency` slots. Items of a chain run one after
 * another; `shouldStop` is checked before every item, so an aborted batch
 * starts nothing new. `runItem` must not reject: it records its own outcome.
 */
export async function runChains(
  chains: readonly number[][],
  concurrency: number,
  runItem: (index: number) => Promise<void>,
  shouldStop: () => boolean
): Promise<void> {
  let next = 0
  const slot = async (): Promise<void> => {
    while (next < chains.length) {
      const chain = chains[next++]
      for (const index of chain) {
        if (shouldStop()) return
        await runItem(index)
      }
    }
  }
  const slots = Math.max(1, Math.min(concurrency, chains.length))
  await Promise.all(Array.from({ length: slots }, slot))
}

type FileProgress = NonNullable<BatchProgress['fileProgress']>

/**
 * Batch progress over files that may be in flight at the same time.
 *
 * `overallPercent` counts finished files only, so the bar reaches 100% when
 * the last file is done rather than when it starts.
 */
export class BatchProgressTracker {
  private finished = 0
  private readonly inFlight = new Map<number, FileProgress | undefined>()

  constructor(
    private readonly fileNames: readonly string[],
    private readonly emit: (progress: BatchProgress) => void
  ) {}

  get finishedFiles(): number {
    return this.finished
  }

  /** Names of the files being imported right now, in file order. */
  runningFileNames(): string[] {
    return [...this.inFlight.keys()].sort((a, b) => a - b).map((index) => this.fileNames[index])
  }

  start(index: number): void {
    this.inFlight.set(index, undefined)
    this.publish(index)
  }

  update(index: number, fileProgress: FileProgress): void {
    if (!this.inFlight.has(index)) return
    this.inFlight.set(index, fileProgress)
    this.publish(index)
  }

  finish(index: number): void {
    if (!this.inFlight.delete(index)) return
    this.finished++
    this.publish(index)
  }

  private publish(index: number): void {
    const total = this.fileNames.length
    const fileProgress = this.inFlight.get(index)
    this.emit({
      currentIndex: index,
      totalFiles: total,
      currentFileName: this.fileNames[index],
      overallPercent: total === 0 ? 100 : Math.round((this.finished / total) * 100),
      completedFiles: this.finished,
      inFlight: [...this.inFlight.entries()]
        .sort(([a], [b]) => a - b)
        .map(([fileIndex, progress]) => ({
          index: fileIndex,
          fileName: this.fileNames[fileIndex],
          phase: progress?.phase ?? 'starting',
          count: progress?.count ?? 0
        })),
      ...(fileProgress !== undefined ? { fileProgress } : {})
    })
  }
}
