'use client'

/**
 * Configurable Mapping — the add-on summary that appears on every
 * subscription surface.
 *
 * Seats are bought per user from the team page (see MappingSeats), so
 * this card never charges anything itself. Its job is to make the
 * add-on visible wherever a customer is looking at what they pay for,
 * and to say plainly whether it is on and what it costs.
 *
 * Renders nothing for accounts that cannot have it — a dead upsell on
 * an individual plan is worse than no upsell.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Map as MapIcon } from 'lucide-react'
import { fetchMappingAccess, fetchSeats, type SeatSummary } from '@/lib/configurableMapping'

export default function MappingAddOnCard({ accountType }: { accountType?: string }) {
  const [summary, setSummary] = useState<SeatSummary | null>(null)
  const [mine, setMine] = useState<boolean | null>(null)
  const [ready, setReady] = useState(false)

  const isAdmin = accountType === 'firm_admin'
  const isMember = accountType === 'firm_user'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (isAdmin) {
          const s = await fetchSeats()
          if (!cancelled) setSummary(s)
        } else if (isMember) {
          const enabled = await fetchMappingAccess()
          if (!cancelled) setMine(enabled)
        }
      } catch {
        /* leave it hidden rather than show a broken card */
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [isAdmin, isMember])

  if (!ready) return null
  if (!isAdmin && !isMember) return null
  if (isAdmin && !summary) return null

  return (
    <div className="card mb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gg-pink/20 rounded-lg flex items-center justify-center shrink-0">
            <MapIcon className="text-gg-pink" size={20} />
          </div>
          <div>
            <h2 className="font-semibold text-white">Configurable Mapping</h2>
            <p className="text-sm text-gg-gray-400">
              {isAdmin
                ? summary!.seats_paid > 0
                  ? `${summary!.seats_in_use} of ${summary!.seats_paid} ${summary!.seats_paid === 1 ? 'seat' : 'seats'} in use · ${summary!.annual_total}/yr`
                  : 'Not on any of your users yet'
                : mine
                  ? 'Included on your account'
                  : 'Not enabled on your account'}
            </p>
          </div>
        </div>

        {isAdmin ? (
          <Link href="/account/team" className="text-gg-pink hover:underline text-sm">
            {summary!.seats_paid > 0 ? 'Manage users' : 'Add it to a user'}
            {summary!.price.amount ? ` · ${summary!.price.amount}/user/yr` : ''}
          </Link>
        ) : (
          <span className="text-sm text-gg-gray-500">
            {mine ? 'Ready to use' : 'Ask your firm administrator to turn it on'}
          </span>
        )}
      </div>
    </div>
  )
}
