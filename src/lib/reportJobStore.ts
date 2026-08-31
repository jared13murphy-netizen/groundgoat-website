// A tiny cross-component signal for "a report just started building".
//
// The indicator lives in the root layout so it survives navigation; the
// buttons that start a report live all over the app. This is how they
// talk without threading a context through every page.
//
// The BACKEND is the source of truth — GET /api/reports/jobs returns
// whatever this user is waiting on, so the indicator works after a reload
// and in a second tab without anything being stored here. All this does
// is wake the poller immediately instead of leaving it to its next tick.

type Listener = () => void

const listeners = new Set<Listener>()

/** Tell the indicator a job was just queued, so it starts polling now. */
export function reportJobStarted(): void {
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* one bad listener must not stop the others */
    }
  })
}

export function onReportJobStarted(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
