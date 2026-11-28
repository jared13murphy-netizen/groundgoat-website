/**
 * Many reports from one press (owner 11/28): the Reports panel lets a person
 * tick several reports AND several pieces of ground, then Download or Email
 * once. This file is the pure part — which jobs that is, and how to work
 * through them without tripping the server's "4 reports building at once per
 * person" limit. No React, no fetch: ReportsPanel supplies the function that
 * actually builds one report.
 */

/** Reports that print the whole project in ONE file (not one per ground). */
export const WHOLE_PROJECT_KINDS: readonly string[] = ['aerial']

export interface BatchJob {
  kind: string
  /** The saved ground this job is for; null = the panel's own target (a parcel,
   *  a tract, one farm) or the whole project (Aerial Map). */
  groundId: string | null
  groundName: string | null
}

/**
 * The jobs one press makes, in a stable order: report by report in the order
 * the cards are shown, and within a report ground by ground in list order.
 *
 * - A project target: one job per ticked report per ticked ground, except
 *   whole-project reports (Aerial Map), which are one job however much ground
 *   is ticked.
 * - Any other target (parcel, tract, one farm): one job per ticked report.
 */
export function buildBatchJobs(opts: {
  isProject: boolean
  kindsInOrder: readonly string[]
  pickedKinds: ReadonlySet<string>
  grounds: readonly { id: string; name: string }[]
  pickedGroundIds: ReadonlySet<string>
}): BatchJob[] {
  const out: BatchJob[] = []
  for (const kind of opts.kindsInOrder) {
    if (!opts.pickedKinds.has(kind)) continue
    if (!opts.isProject || WHOLE_PROJECT_KINDS.includes(kind)) {
      out.push({ kind, groundId: null, groundName: null })
      continue
    }
    for (const g of opts.grounds) {
      if (opts.pickedGroundIds.has(g.id)) out.push({ kind, groundId: g.id, groundName: g.name })
    }
  }
  return out
}

/** Does this pick need ground chosen before it can be sent? */
export function needsGround(isProject: boolean, pickedKinds: ReadonlySet<string>): boolean {
  if (!isProject) return false
  return Array.from(pickedKinds).some((k) => !WHOLE_PROJECT_KINDS.includes(k))
}

export interface BatchResult { done: number; failed: { job: BatchJob; error: string }[] }

/** True for the server's "too many building, wait" answers. */
export function isBusyError(e: unknown): boolean {
  const m = String((e as any)?.message ?? e ?? '').toLowerCase()
  return (e as any)?.status === 429 || m.includes('reports building') || m.includes('too many reports')
    || m.includes('wait for one to finish')
}

/**
 * Work through the jobs, at most `concurrency` at a time. A job the server
 * turns away as "too many building" is tried again after `waitMs` (up to
 * `maxWaits` times) — it is a queue, not a failure. One job failing never
 * stops the rest. `onProgress` fires after every job with how many are
 * finished (done + failed) of the total.
 */
export async function runBatch(
  jobs: readonly BatchJob[],
  runOne: (job: BatchJob) => Promise<void>,
  opts: {
    concurrency?: number
    waitMs?: number
    maxWaits?: number
    onProgress?: (finished: number, total: number, failed: number) => void
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<BatchResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  const waitMs = opts.waitMs ?? 5000
  const maxWaits = opts.maxWaits ?? 120
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const result: BatchResult = { done: 0, failed: [] }
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      let waits = 0
      for (;;) {
        try {
          await runOne(job)
          result.done++
          break
        } catch (e) {
          if (isBusyError(e) && waits < maxWaits) { waits++; await sleep(waitMs); continue }
          result.failed.push({ job, error: String((e as any)?.message ?? e ?? 'failed') })
          break
        }
      }
      opts.onProgress?.(result.done + result.failed.length, jobs.length, result.failed.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker))
  return result
}

/** "3 reports", "1 report". */
export function countLabel(n: number): string { return `${n} report${n === 1 ? '' : 's'}` }
