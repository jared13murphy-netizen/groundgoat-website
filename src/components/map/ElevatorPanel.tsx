'use client'

/**
 * ElevatorPanel — right-hand slide-out for a grain elevator pin (owner 11/9).
 *
 * The tapped elevator's cash bids (every commodity, every delivery period it
 * posts), then the 15 closest elevators within 75 miles with their current
 * bid (nearest delivery per commodity). Tapping one of those moves the panel
 * to it. Same size and surface as SavedTractPanel / LandDetailPanel.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import useSlide from '@/lib/useSlide'
import {
  commodityLabel, fmtBasis, fmtCash, fmtChange, fmtTime, getElevatorDetail,
  type Elevator, type ElevatorDetail, type GrainBid,
} from '@/lib/grainBids'
import { Section } from './parcelDetailFields'
import { LAND_DETAIL_PANEL_WIDTH } from './LandDetailPanel'

interface Props {
  /** Elevator (Barchart location) id to show; null = closed. */
  elevatorId: number | null
  onClose: () => void
  /** A nearby elevator was tapped: open it and centre the map on it. */
  onSelect: (e: { id: number; lat: number; lng: number }) => void
}

const th: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase',
  color: 'rgba(0,0,0,0.45)', padding: '4px 0', textAlign: 'right',
}
const td: React.CSSProperties = { fontSize: 13, padding: '6px 0', textAlign: 'right', color: '#1a1a1a' }

function changeColor(v: number | null) {
  if (v == null || Math.abs(v) < 0.0001) return 'rgba(0,0,0,0.45)'
  return v > 0 ? '#15803d' : '#b91c1c'
}

function groupByCommodity(bids: GrainBid[]): [string, GrainBid[]][] {
  const out = new Map<string, GrainBid[]>()
  for (const b of bids) {
    const list = out.get(b.commodity) ?? []
    list.push(b)
    out.set(b.commodity, list)
  }
  return Array.from(out.entries())
}

function BidTable({ commodity, bids }: { commodity: string; bids: GrainBid[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a1a', marginBottom: 2 }}>{commodityLabel(commodity)}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Delivery</th>
            <th style={th}>Cash</th>
            <th style={th}>Basis</th>
            <th style={th}>Change</th>
          </tr>
        </thead>
        <tbody>
          {bids.map((b, i) => (
            <tr key={i} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <td style={{ ...td, textAlign: 'left', color: 'rgba(0,0,0,0.7)' }}>{b.delivery || '—'}</td>
              <td style={{ ...td, fontWeight: 700 }}>{fmtCash(b.cash_price)}</td>
              <td style={td}>{fmtBasis(b.basis_cents, b.futures_month)}</td>
              <td style={{ ...td, color: changeColor(b.change) }}>{fmtChange(b.change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NearbyRow({ e, onClick }: { e: Elevator; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', background: '#fff', cursor: 'pointer',
        border: '1px solid #E2E0E6', borderRadius: 12, padding: '10px 12px', marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1a1a', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {e.company || e.name}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.5)', flexShrink: 0 }}>
          {e.distance_mi != null ? `${e.distance_mi.toFixed(1)} mi` : ''}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 1 }}>
        {[e.name && e.name !== e.company ? e.name : null, [e.city, e.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
      </div>
      {e.bids.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
          {e.bids.map((b, i) => (
            <span key={i} style={{ fontSize: 12.5, color: '#1a1a1a' }}>
              <span style={{ color: 'rgba(0,0,0,0.55)' }}>{commodityLabel(b.commodity)} {b.delivery}</span>{' '}
              <b>{fmtCash(b.cash_price)}</b>{' '}
              <span style={{ color: 'rgba(0,0,0,0.5)' }}>{fmtBasis(b.basis_cents, b.futures_month)}</span>
            </span>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 6, fontStyle: 'italic' }}>No bids posted</div>
      )}
    </button>
  )
}

export default function ElevatorPanel({ elevatorId, onClose, onSelect }: Props) {
  const isOpen = elevatorId !== null
  const { shown } = useSlide(isOpen, 220)
  const [detail, setDetail] = useState<ElevatorDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (id: number) => {
    const my = ++seq.current
    setError(null); setLoading(true)
    try {
      const d = await getElevatorDetail(id)
      if (my === seq.current) { setDetail(d); bodyRef.current?.scrollTo({ top: 0 }) }
    } catch (e: any) {
      if (my === seq.current) setError(e?.message || 'Could not load this elevator.')
    } finally { if (my === seq.current) setLoading(false) }
  }, [])
  useEffect(() => { if (elevatorId != null) void load(elevatorId) }, [elevatorId, load])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const el = detail && detail.elevator.id === elevatorId ? detail.elevator : detail?.elevator ?? null
  const asOf = el?.bids.map(b => b.as_of).filter(Boolean).sort().pop() ?? null
  const site = el?.url ? (el.url.startsWith('http') ? el.url : `https://${el.url}`) : null

  return (
    <div
      data-gg-elevator-panel
      role="dialog"
      aria-label="Grain elevator"
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: LAND_DETAIL_PANEL_WIDTH, maxWidth: '100%',
        zIndex: 400,
        background: 'linear-gradient(180deg,#FFFFFF 0%,#F7F7FA 45%,#E8E8EF 100%)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
        display: 'flex', flexDirection: 'column',
        transform: shown && isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 220ms cubic-bezier(0.2,0,0.1,1)',
        pointerEvents: isOpen ? 'auto' : 'none',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ flexShrink: 0, padding: '16px 44px 8px 18px', position: 'relative' }}>
        <div style={{ fontSize: 18.5, fontWeight: 700, lineHeight: '24px', color: '#1a1a1a', wordBreak: 'break-word' }}>
          {el ? (el.company || el.name) : 'Grain elevator'}
        </div>
        {el && (
          <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,0.55)', marginTop: 2, lineHeight: 1.35 }}>
            {[el.name && el.name !== el.company ? el.name : null, el.facility_type].filter(Boolean).join(' · ')}
          </div>
        )}
        {el && (
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', marginTop: 6, lineHeight: 1.4 }}>
            {[el.address, [el.city, el.state].filter(Boolean).join(', ')].filter(Boolean).join(', ')}
            {el.county ? ` · ${el.county}` : ''}
          </div>
        )}
        {el && (el.phone || site) && (
          <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 13 }}>
            {el.phone && <a href={`tel:${el.phone.replace(/[^\d+]/g, '')}`} style={{ color: '#a0307f', fontWeight: 600 }}>{el.phone}</a>}
            {site && <a href={site} target="_blank" rel="noopener noreferrer" style={{ color: '#a0307f', fontWeight: 600 }}>Website</a>}
          </div>
        )}
        <button
          onClick={onClose} aria-label="Close panel"
          style={{
            position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: '50%', border: 'none',
            background: 'rgba(0,0,0,0.06)', color: '#444', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1, padding: 0,
          }}
        >✕</button>
      </div>

      {/* Body */}
      <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', paddingBottom: 24, opacity: loading && detail ? 0.55 : 1 }}>
        {loading && !detail && (
          <div style={{ padding: 16, color: 'rgba(0,0,0,0.45)', fontSize: 12, fontStyle: 'italic', textAlign: 'center' }}>
            Loading bids…
          </div>
        )}
        {error && (
          <div style={{ padding: '16px 18px', color: '#d33', fontSize: 12.5 }}>
            {error}{' '}
            {elevatorId != null && (
              <button type="button" onClick={() => void load(elevatorId)}
                      style={{ background: 'none', border: 'none', color: '#a0307f', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>
                Try again
              </button>
            )}
          </div>
        )}

        {el && detail && (
          <>
            <Section title={asOf ? `Cash bids · ${fmtTime(asOf)}` : 'Cash bids'}>
              {el.bids.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,0.5)', fontStyle: 'italic', padding: '4px 0 8px' }}>
                  This elevator has not posted bids recently.
                </div>
              ) : (
                groupByCommodity(el.bids).map(([c, list]) => <BidTable key={c} commodity={c} bids={list} />)
              )}
            </Section>

            <Section title={`${detail.nearby.length} closest elevators · within ${Math.round(detail.radius_mi)} mi`}>
              {detail.nearby.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,0.5)', fontStyle: 'italic' }}>
                  No other elevators within {Math.round(detail.radius_mi)} miles.
                </div>
              ) : (
                detail.nearby.map(n => (
                  <NearbyRow key={n.id} e={n} onClick={() => onSelect({ id: n.id, lat: n.lat, lng: n.lng })} />
                ))
              )}
            </Section>

            <div style={{ padding: '6px 18px 0', fontSize: 11, color: 'rgba(0,0,0,0.4)', lineHeight: 1.4 }}>
              Bids from {detail.source}{detail.updated_at ? `, updated ${fmtTime(detail.updated_at)}` : ''}.
              Basis is cents over or under the futures month shown. Call the elevator to confirm before you haul.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
