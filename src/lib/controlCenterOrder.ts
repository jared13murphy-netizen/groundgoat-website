// Control Center row order (owner 11/23): with ~50 auctions on screen the
// order must never change while staff work the page. Rows are sorted once
// on load by auction date/time, then listing id (many auctions share the
// same start time, so the id tiebreak keeps them fixed). After that, saves,
// status changes and the 20 s live refresh update rows IN PLACE; a new
// auction that appears on refresh slots into its sorted spot without moving
// any other row relative to the rest.

export interface OrderedRow {
  id: string
  auction_datetime?: string | null
}

const timeOf = (row: OrderedRow): number => {
  const t = row.auction_datetime ? Date.parse(row.auction_datetime) : NaN
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

export function compareAuctionRows(a: OrderedRow, b: OrderedRow): number {
  const ta = timeOf(a)
  const tb = timeOf(b)
  if (ta !== tb) return ta < tb ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortAuctionRows<T extends OrderedRow>(rows: T[]): T[] {
  return [...rows].sort(compareAuctionRows)
}

/**
 * Lay `fresh` rows out in the order already on screen (`currentIds`).
 * Rows still present keep their exact relative order (even if their time
 * changed on the server); rows that disappeared are dropped; new rows are
 * inserted before the first on-screen row that sorts after them.
 */
export function keepScreenOrder<T extends OrderedRow>(currentIds: string[], fresh: T[]): T[] {
  const freshById = new Map(fresh.map(r => [r.id, r]))
  const out: T[] = []
  currentIds.forEach(id => {
    const row = freshById.get(id)
    if (row) out.push(row)
  })
  const onScreen = new Set(out.map(r => r.id))
  sortAuctionRows(fresh.filter(r => !onScreen.has(r.id))).forEach(row => {
    const at = out.findIndex(r => compareAuctionRows(row, r) < 0)
    if (at === -1) out.push(row)
    else out.splice(at, 0, row)
  })
  return out
}
