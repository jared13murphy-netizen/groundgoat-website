'use client'

import { useEffect, useState } from 'react'
import { fetchScraperProxy } from '@/lib/fetchWithAuth'
import { tractNum, renumberSteps } from '@/lib/tractNumber'

/** Owner 2026-11-25: one box on each tract row to change the tract number.
 *  Everything on the tract (acres, tillable, soil, price, land types,
 *  boundary, pictures, notes) stays with it — only the number changes.
 *  If another tract already has the number typed, the two tracts trade
 *  numbers. */

async function setNumber(stagingId: number, index: number, number: string) {
  const res = await fetchScraperProxy(
    `/api/staging/${stagingId}/tracts/${index}/tract-number`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tract_number: number }) },
  )
  let data: any = {}
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
}

export default function TractNumberBox({
  stagingId, index, numbers, onSaved,
}: {
  stagingId: number
  index: number
  /** every tract's current number, by position */
  numbers: (string | number | null | undefined)[]
  /** called once per number that was saved on the server */
  onSaved: (index: number, number: string) => void
}) {
  const nums = numbers.map(n => (n == null ? null : String(n)))
  const current = tractNum(nums[index]) ?? String(index + 1)
  const [draft, setDraft] = useState(current)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { setDraft(current) }, [current])

  const want = tractNum(draft)
  const dirty = !!want && want !== current
  const other = want ? nums.findIndex((n, i) => i !== index && tractNum(n) === want) : -1

  const save = async () => {
    if (!dirty || busy || !want) return
    const steps = renumberSteps(nums.map((n, i) => n ?? String(i + 1)), index, want)
    if (!steps.length) return
    if (other >= 0 && !window.confirm(
      `Tract ${want} already exists.\n\nThis tract becomes Tract ${want}, and the current Tract ${want} becomes Tract ${current}.\nEverything on each tract stays with it.`)) {
      setDraft(current)
      return
    }
    setBusy(true); setMsg(null)
    let done = 0
    try {
      for (const s of steps) {
        await setNumber(stagingId, s.index, s.number)
        onSaved(s.index, s.number)
        done++
      }
      setMsg({ ok: true, text: other >= 0 ? `✓ Tract ${current} ⇄ Tract ${want}` : `✓ Saved as Tract ${want}` })
    } catch (e: any) {
      setMsg({ ok: false, text: `✗ Not saved: ${e?.message || e}${done ? ' — refresh the page and check the numbers' : ''}` })
      if (!done) setDraft(current)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
      <span className="text-base text-white font-bold tracking-tight">Tract</span>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setDraft(current) }}
        disabled={busy}
        aria-label="Tract number"
        title="Type the correct tract number and press Save"
        style={{ backgroundColor: '#ffffff', color: '#000000' }}
        className={`w-12 px-1.5 py-0.5 text-base font-bold rounded border ${dirty ? 'border-gg-pink' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-gg-pink`}
      />
      {dirty && (
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-2.5 py-1 text-xs font-medium rounded bg-gg-pink text-gg-black disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      )}
      {msg && (
        <span className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>
      )}
    </span>
  )
}
