'use client'

/**
 * Configurable Mapping seats — the firm admin's assignment panel.
 *
 * The toggle IS the purchase. There is no separate checkout for this
 * add-on; switching a user on adds a paid seat to the firm's existing
 * subscription. So the flow here is deliberately: click → see the exact
 * cost → confirm → charged. Never wire a toggle straight to setSeat().
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, Loader2, Map as MapIcon } from 'lucide-react'
import {
  fetchSeats, previewSeat, setSeat,
  type SeatMember, type SeatPreview, type SeatSummary,
} from '@/lib/configurableMapping'

export default function MappingSeats({ firmId }: { firmId?: string }) {
  const [data, setData] = useState<SeatSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ member: SeatMember; next: boolean } | null>(null)
  const [preview, setPreview] = useState<SeatPreview | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await fetchSeats(firmId))
      setError('')
    } catch (e: any) {
      setError(e?.message || 'Could not load Configurable Mapping seats')
    } finally {
      setLoading(false)
    }
  }, [firmId])

  useEffect(() => { load() }, [load])

  const ask = async (member: SeatMember, next: boolean) => {
    setPending({ member, next })
    setPreview(null)
    try {
      setPreview(await previewSeat(next, firmId))
    } catch {
      setPreview(null)
    }
  }

  const confirm = async () => {
    if (!pending) return
    setSaving(true)
    try {
      const res = await setSeat(pending.member.id, pending.next, firmId)
      setNote(
        res.charged_now
          ? `${pending.member.name} now has Configurable Mapping. Your add-on is ${res.annual_total} per year, renewing with the rest of your subscription.`
          : `${pending.member.name} ${pending.next ? 'now has' : 'no longer has'} Configurable Mapping. ${res.note || ''}`.trim()
      )
      setPending(null)
      setPreview(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Could not update that seat')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="card flex items-center gap-3 text-gg-gray-400">
        <Loader2 size={18} className="animate-spin" />
        Loading Configurable Mapping…
      </div>
    )
  }
  if (error && !data) {
    return (
      <div className="card flex items-start gap-3 text-red-400">
        <AlertCircle size={18} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    )
  }
  if (!data) return null

  const per = data.price.amount

  return (
    <div className="card">
      {/* Title and price are separate rows on purpose: the description
          is long enough that a single justify-between row wraps into a
          stranded, left-aligned price at ordinary card widths. */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gg-pink/20 rounded-lg flex items-center justify-center shrink-0">
          <MapIcon className="text-gg-pink" size={20} />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-white">
            Configurable Mapping
          </h2>
          <p className="text-sm text-gg-gray-400">
            Draw your own boundaries, classify the ground, and build reports from it.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-gg-gray-800 pt-4">
        <span className="text-sm text-gg-gray-400">
          {per ? `${per} per user, per year` : 'Pricing not set up yet'}
        </span>
        {/* "0 users · $595/yr" reads as a contradiction. Name what the
            money bought — seats — and how many are in use. */}
        <span className="text-lg font-semibold text-white">
          {data.seats_paid > 0
            ? `${data.seats_in_use} of ${data.seats_paid} ${data.seats_paid === 1 ? 'seat' : 'seats'} in use`
            : 'No seats yet'}
          {data.seats_paid > 0 && data.annual_total ? ` · ${data.annual_total}/yr` : ''}
        </span>
      </div>

      {/* A spare seat is money already spent — say so plainly, or the
          admin re-buys capacity they are holding. */}
      {data.seats_spare > 0 && (
        <p className="mt-2 text-sm text-gg-gray-400">
          {data.seats_spare} paid {data.seats_spare === 1 ? 'seat is' : 'seats are'}{' '}
          free to assign to anyone below at no extra cost
          {data.renewal_total ? `. Renews at ${data.renewal_total}/yr unless reassigned.` : '.'}
        </p>
      )}

      {!data.billable && (
        <div className="mt-4 flex items-start gap-2 text-sm text-yellow-400 bg-yellow-500/10 rounded-lg p-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            {data.price.configured
              ? 'No active billing is on file for this firm, so these seats are not being charged.'
              : 'Configurable Mapping is not available for purchase yet.'}
          </span>
        </div>
      )}

      {note && (
        <div className="mt-4 flex items-start gap-2 text-sm text-green-400 bg-green-500/10 rounded-lg p-3">
          <Check size={16} className="mt-0.5 shrink-0" />
          <span>{note}</span>
        </div>
      )}

      <div className="mt-5 divide-y divide-gg-gray-800">
        {data.members.map((m) => (
          <div key={m.id} className="flex items-center justify-between py-3 gap-4">
            <div className="min-w-0">
              <div className="text-white truncate">
                {m.name}
                {m.account_type === 'firm_admin' && (
                  <span className="ml-2 text-xs bg-gg-pink/20 text-gg-pink px-2 py-0.5 rounded">
                    Admin
                  </span>
                )}
              </div>
              <div className="text-sm text-gg-gray-500 truncate">{m.email}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={m.enabled}
              aria-label={`Configurable Mapping for ${m.name}`}
              onClick={() => ask(m, !m.enabled)}
              disabled={!data.price.configured}
              className={`relative w-12 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${
                m.enabled ? 'bg-gg-pink' : 'bg-gg-gray-700'
              }`}
            >
              <span
                className={`absolute left-0 top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  m.enabled ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {pending && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gg-gray-900 rounded-xl p-6 max-w-md w-full border border-gg-gray-700">
            <h3 className="text-xl font-semibold text-white mb-3">
              {pending.next
                ? preview?.will_be_charged
                  ? 'Add Configurable Mapping'
                  : 'Turn on Configurable Mapping'
                : 'Turn off Configurable Mapping'}
            </h3>
            <p className="text-gg-gray-400 mb-4">
              {pending.next ? 'Turn on' : 'Turn off'} Configurable Mapping for{' '}
              <span className="text-white">{pending.member.name}</span>?
            </p>

            <div
              className={`rounded-lg p-3 mb-6 text-sm ${
                preview?.will_be_charged
                  ? 'bg-yellow-500/10 text-yellow-300'
                  : 'bg-gg-gray-800 text-gg-gray-300'
              }`}
            >
              {preview ? preview.message : 'Checking what this costs…'}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setPending(null); setPreview(null) }}
                disabled={saving}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={saving || !preview}
                className="flex-1 btn-primary inline-flex items-center justify-center gap-2 whitespace-nowrap px-3"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                {pending.next
                  ? preview?.will_be_charged ? 'Add seat and pay' : 'Turn on'
                  : 'Turn off'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
