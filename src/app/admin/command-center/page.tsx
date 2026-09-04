'use client'

/**
 * Ground Goat Command Center — one screen, everything, no scrolling.
 *
 * Three things drive every decision in this file:
 *
 *   LIGHT.  Jared has a Health Monitor and does not use it, in his words,
 *           because it is dark. So this page is light in every viewer's
 *           theme. There is no dark variant to fall into.
 *
 *   ONE SCREEN.  Designed for a 2560x1440 widescreen opened full width:
 *           `height: 100dvh; overflow: hidden`, a twelve-column grid, and
 *           three rows weighted to what each band of panels actually needs.
 *           That layout needs BOTH the width and the height, so it is asked
 *           for both: min-width 1700 AND min-height 1200. Anything smaller —
 *           a laptop, a phone — gets a page that scrolls with every card at
 *           its natural size. Gating on width alone was the bug: a laptop is
 *           wide enough to clear 1700 and nowhere near tall enough to hold
 *           three bands, so the grid squashed and every card silently cut
 *           off its own contents.
 *
 *   NO DATABASE ON THE PAGE PATH.  This page never causes a Postgres
 *           query. The backend computes every panel on a timer and parks
 *           the result in Redis (command_center.py); this page reads that
 *           blob and nothing else. That decoupling is why it can update
 *           this often at all — a backup job reading the live database
 *           once made Goat Search take 48 seconds during a customer
 *           presentation, and a dashboard polling twenty panels a second
 *           would be a much larger version of the same mistake.
 *
 * Transport is Server-Sent Events, read with fetch() rather than
 * EventSource. EventSource cannot send an Authorization header, and the
 * alternative — putting the admin's token in a query string — writes it
 * into every proxy access log. If the stream fails for any reason the page
 * falls back to polling the same endpoint once a second, which costs one
 * Redis read and is a perfectly good second-best.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.groundgoat.com'

/* ── Types ────────────────────────────────────────────────────────── */

type PanelState = {
  ok: boolean; data?: any; error?: string; label?: string; at?: string
  stale_data?: any; refresh_seconds?: number
}
type Alert = { level: 'red' | 'amber' | 'info'; key: string; title: string; detail?: string; where?: string }
type Snapshot = {
  ready: boolean
  generated_at: string | null
  revision: number
  age_seconds?: number | null
  stale?: boolean
  alerts: Alert[]
  worst_level?: string
  panels: Record<string, PanelState>
  message?: string
}

const CHART_TITLES: Record<string, string> = {"pulse": "Right now", "money": "Money", "crashes": "App crashes", "failing_endpoints": "What is erroring", "people": "People", "storage": "Storage", "pipeline": "Scraper & staging"}

const EMPTY: Snapshot = { ready: false, generated_at: null, revision: 0, alerts: [], panels: {} }

/* ── Formatting. Every number on this screen goes through one of these ── */

const num = (v: any, d = 0) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

const money = (v: any) =>
  v === null || v === undefined ? '—' : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })

/** Money that may be small. Whole dollars above ten, cents below — the AWS
    breakdown was printing "$0" against six real cents of Cost Explorer
    charges, which reads as a line that costs nothing. */
const moneyFine = (v: any) => {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (n === 0) return '$0'
  if (Math.abs(n) < 10) return '$' + n.toFixed(2)
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** Plain English. Nobody should have to read a timestamp off this screen. */
function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return `${Math.max(0, Math.round(s))}s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${Math.round(s / 3600)} hr`
  return `${Math.round(s / 86400)} days`
}

/* ── Small shared pieces ──────────────────────────────────────────── */

type Tone = 'red' | 'amber' | 'green' | ''

function Panel({ span, title, tag, pip, onChart, onOpen, flush, infoId, panelState, children }: {
  span: number; title: string; tag?: string; pip?: Tone
  onChart?: () => void
  /** Jump to the section that shows this card in full. */
  onOpen?: () => void
  /** Let the body run to the panel's edges — for the map, which has its own
      padding and looks wrong inset. */
  flush?: boolean
  infoId?: string; panelState?: PanelState
  children: React.ReactNode
}) {
  const [showInfo, setShowInfo] = useState(false)
  return (
    <section className={`panel ${flush ? 'flush' : ''}`} style={{ gridColumn: `span ${span}` }}>
      <h2>
        {/* The status dot beside each title is gone — the owner does not
            want it, and the cards already carry their state in the numbers
            and the alert strip. The prop stays so call sites need no edit. */}
        {title}
        {tag ? <span className="tag">{tag}</span> : null}
        {/* Only shown where a trend actually exists, so the icon never
            promises history a card does not have. */}
        {infoId && CARD_INFO[infoId] && (
          <button type="button" className="infobtn" onClick={() => setShowInfo(v => !v)}
            title={`What ${title} means`} aria-label={`What ${title} means`}
            aria-expanded={showInfo}>i</button>
        )}
        {onChart && (
          <button type="button" className="chartbtn" onClick={onChart}
            title={`${title} over time`} aria-label={`${title} over time`}>
            <ChartIcon />
          </button>
        )}
        {onOpen && (
          <button type="button" className="openbtn" onClick={onOpen}
            title={`Open ${title}`} aria-label={`Open ${title}`}>→</button>
        )}
      </h2>
      {showInfo && infoId && (
        <InfoPop id={infoId} title={title} panel={panelState}
          onClose={() => setShowInfo(false)} />
      )}
      <div className="body">{children}</div>
    </section>
  )
}

/** A panel that could not be computed says so where its numbers would be.
    It never renders zeroes — a zero is a claim, and a broken panel has
    nothing to claim. */
const Unavailable = ({ why }: { why?: string }) => (
  <div className="dead">
    Not available right now
    <br />
    <span style={{ textTransform: 'none', letterSpacing: 0 }}>{(why || '').slice(0, 90)}</span>
  </div>
)

const Kpi = ({ v, k, tone = '', small = false }: { v: React.ReactNode; k: string; tone?: Tone; small?: boolean }) => (
  <div className="kpi">
    <div className={`v ${small ? 'sm' : ''} ${tone}`}>{v}</div>
    <div className="k">{k}</div>
  </div>
)

const Row = ({ label, value, tone = '' }: { label: React.ReactNode; value: React.ReactNode; tone?: Tone }) => (
  <div className="row">
    <span className="l" style={tone ? { color: `var(--${tone})` } : undefined}>{label}</span>
    <span className="r" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</span>
  </div>
)

/** Truncated lists always say how many were left out — a silent cap reads
    as "that's all of them". */
const More = ({ total, shown }: { total: number; shown: number }) =>
  total > shown ? <div className="more">+ {num(total - shown)} more</div> : null

const Chip = ({ tone = '', children }: { tone?: Tone; children: React.ReactNode }) => (
  <span className={`chip ${tone}`}>{children}</span>
)

/** A number on a card that can be opened to see what it is made of.

    A figure nobody can drill into is a figure nobody can check, and this
    dashboard has already carried several that were wrong for months. Renders
    as the value with a dotted underline; click shows the rows behind it. */
function Detail({ value, title, rows, tone = '' }:
  { value: React.ReactNode; title: string
    rows: { l: React.ReactNode; r?: React.ReactNode; note?: React.ReactNode }[]
    tone?: Tone }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!rows.length) return <>{value}</>
  return (
    <>
      <button type="button" className="drill" onClick={() => setOpen(true)}
        style={tone ? { color: `var(--${tone})` } : undefined}
        aria-label={`${title} — show the ${rows.length} behind it`}>{value}</button>
      {open && (
        <div className="popwrap" onClick={() => setOpen(false)}>
          <div className="pop" role="dialog" aria-modal="true" aria-label={title}
            onClick={e => e.stopPropagation()}>
            <button type="button" className="close" onClick={() => setOpen(false)}
              aria-label="Close">×</button>
            <h5>{title}</h5>
            <dl>
              {rows.map((x, i) => (
                <React.Fragment key={i}>
                  <dt>{x.l}</dt>
                  <dd>{x.r}{x.note ? <div className="more" style={{ marginTop: 2 }}>{x.note}</div> : null}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        </div>
      )}
    </>
  )
}

/** Hourly traffic with real axes.

    The previous version stretched a 100x100 box across the card with
    preserveAspectRatio="none", which squashes the TEXT along with the line —
    that is why the numbers looked smeared. This measures the box and draws
    at true pixel size, so nothing is scaled and the labels are the shape
    they were written. */
function Spark({ values, color, hours, unit }:
  { values: number[]; color: string; hours?: string[]; unit?: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 720, h: 150 })

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const read = () => setBox({
      w: Math.max(240, el.clientWidth),
      h: Math.max(90, el.clientHeight),
    })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!values || values.length < 2) {
    return <div ref={wrap} style={{ width: '100%', height: '100%' }} />
  }

  const { w: W, h: H } = box
  const PAD_L = 46, PAD_R = 10, PAD_T = 10, PAD_B = 24
  const plotW = Math.max(10, W - PAD_L - PAD_R)
  const plotH = Math.max(10, H - PAD_T - PAD_B)

  /* Round tick steps, so the axis reads 0/100/200/... or 0/2/4/... rather
     than whatever the peak happened to be divided by three. */
  const rawMax = Math.max(...values, 1)
  const niceStep = (max: number, target: number) => {
    // Small numbers get whole-number steps. A peak of 12 labelled 0/5/10/15
    // tells you nothing you could not already see; 0/2/4/…/12 does.
    if (max <= 8) return 1
    if (max <= 20) return 2
    if (max <= target) return 1
    const raw = max / target
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    const n = raw / mag
    const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
    return Math.max(1, Math.round(mult * mag))
  }
  const step = niceStep(rawMax, 5)
  const axisMax = Math.max(step, Math.ceil(rawMax / step) * step)
  const ticks: number[] = []
  for (let v = 0; v <= axisMax + 1e-9; v += step) ticks.push(v)

  const x = (i: number) => PAD_L + (i / (values.length - 1)) * plotW
  const y = (v: number) => PAD_T + plotH - (v / axisMax) * plotH
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const lastI = values.length - 1
  const fmt = (n: number) => n >= 1000 ? n.toLocaleString('en-US') : String(n)

  /* A tick for every point, and a LABEL on every point that fits. At a
     narrow width it thins to every other hour rather than overlapping. */
  const perLabel = 34
  const labelEvery = Math.max(1, Math.ceil(values.length / Math.floor(plotW / perLabel)))
  const hhmm = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
        .replace(' ', '').replace(':00', '')
    } catch { return '' }
  }

  return (
    <div ref={wrap} style={{ width: '100%', height: '100%' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        role="img" aria-label={`Requests an hour over ${values.length} hours, peak ${fmt(rawMax)}`}>
        {ticks.map(v => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)}
              stroke="#E2E2E9" strokeWidth="1" />
            <text x={PAD_L - 6} y={y(v) + 3.5} className="axis" textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        <polyline points={`${PAD_L},${y(0)} ${line} ${x(lastI)},${y(0)}`}
          fill={color} opacity=".12" stroke="none" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.8"
          strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(lastI)} cy={y(values[lastI])} r="3" fill={color} />
        <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} stroke="#B9B9C4" strokeWidth="1" />
        {values.map((_, i) => (
          <line key={i} x1={x(i)} x2={x(i)} y1={y(0)} y2={y(0) + (i % labelEvery === 0 ? 4 : 2)}
            stroke="#B9B9C4" strokeWidth="1" />
        ))}
        {hours && hours.length === values.length && values.map((_, i) => (
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={H - 8} className="axis" textAnchor="middle">
              {hhmm(hours[i])}
            </text>
          ) : null
        ))}
        {unit && (
          <text x={PAD_L - 6} y={PAD_T - 2} className="axis" textAnchor="end">{unit}</text>
        )}
      </svg>
    </div>
  )
}

function Outside({ d, fixes }: { d: any; fixes?: any }) {
  const services: any[] = d.services || []
  if (!d.instrumented) {
    return <div className="drawer-empty">Nothing has called an outside service in 24 hours.</div>
  }
  return (
    <div className="rows">
      {services.map(x => {
        const bad = (x.error_rate_pct ?? 0) >= 10
        const some = (x.errors_24h || 0) > 0
        return (
          <div key={x.api}>
            <Row label={x.api.charAt(0).toUpperCase() + x.api.slice(1)}
              tone={bad ? 'red' : some ? 'amber' : ''}
              value={`${num(x.calls_24h)} calls · ${num(x.errors_24h)} failed${
                x.error_rate_pct == null ? '' : ` · ${num(x.error_rate_pct, 1)}%`}`} />
            {/* The message is the whole point: "146 failed" is a number,
                "the domain is not verified" is something to go and fix. */}
            {x.last_message && (
              <div className="fixnote" style={{ color: bad ? 'var(--red)' : 'var(--faint)' }}>
                {x.last_message}
              </div>
            )}
            {some && <FixButton compact fixes={fixes}
              issue={{ key: `outside:${x.api}`, title: `${x.api} is failing`,
                where: 'Outside services',
                detail: x.last_message || `${x.errors_24h} of ${x.calls_24h} calls failed in 24 hours`,
                evidence: x }} />}
          </div>
        )
      })}
      {(d.by_operation || []).length > 0 && (
        <>
          <div className="more" style={{ marginTop: 4 }}>Which call is failing</div>
          {(d.by_operation || []).slice(0, 4).map((o: any) => (
            <Row key={`${o.api}.${o.operation}`} label={`${o.api} · ${o.operation}`}
              tone="amber" value={`${num(o.errors)} of ${num(o.calls)}`} />
          ))}
        </>
      )}
    </div>
  )
}

/* ── The panels ───────────────────────────────────────────────────── */

function RightNow({ d, series }: { d: any; series: any[] | null }) {
  // NOTHING MEASURED IS NOT ZERO. An hour with no requests used to print
  // "0 ms" and "0.0% failing", which read as instant and perfect. The panel
  // sends null now, and null prints an em dash.
  const rate = d.error_rate_hour_pct
  const measured = d.requests_this_hour > 0
  const tone: Tone = !measured ? '' : rate >= 5 ? 'red' : rate >= 2 ? 'amber' : ''
  const ours = d.requests_this_hour_ours || 0
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {/* We are counted here on purpose. This is the operations view — is
            anyone using it this second — and the People card is where we
            come out. Until 2026-08-27 the claim in this comment was not
            true: the middleware dropped every staff request before it was
            recorded, so the owner using his own product produced a card of
            zeroes. He is counted now, and said out loud. */}
        {d.presence_available
          ? <Kpi v={num(d.people_now)}
              k={d.staff_now
                ? `People on now · last 5 min · ${num(d.staff_now)} of them us`
                : 'People on now · last 5 min'} />
          : <Kpi v={num(d.people_this_hour)}
              k={`People this hour · ${num(d.minutes_into_hour)} min in`} />}
        <Kpi v={num(d.requests_this_hour)}
          k={ours ? `Requests this hour · ${num(ours)} ours` : 'Requests this hour'} />
        <Kpi v={measured ? `${num(rate, 1)}%` : '—'}
          k={measured ? 'Failing' : 'Failing · nothing yet this hour'} tone={tone} />
        <Kpi v={measured
                 ? <>{num(d.avg_ms_this_hour)}<span style={{ fontSize: 14 }}> ms</span></>
                 : '—'}
          k={measured ? 'Average wait' : 'Average wait · nothing yet this hour'}
          tone={measured && d.avg_ms_this_hour > 1000 ? 'amber' : ''} />
      </div>
      {/* The chart needs real height now that it carries axes — 36px was
          enough for a bare line and nothing else. */}
      <div style={{ flex: 1, minHeight: 118 }}>
        <Spark values={(series || []).map(p => p.requests)} color="#2E6BE6"
          hours={(series || []).map(p => p.hour)} unit="requests" />
      </div>
      {/* TODAY IS A DAY. Every figure on this row used to be a rolling 24
          hours wearing the word "today": it said 884 requests on a day that
          held 10. They are calendar-day figures now, in the timezone the
          business runs on, which is the one the clock above is showing. */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
        <Kpi small v={d.presence_available ? num(d.people_15_min) : num(d.people_rolling_24h)}
          k={d.presence_available ? 'People · last 15 min' : 'People · last 24 hours'} />
        {/* "4" over "Active today · 0 customers" read as a contradiction.
            It was not one — 4 people used the product today and none were
            customers — but the label has to say that, not leave you to work
            it out. Phrased like "People on now · 3 of them us" above. */}
        <Kpi small v={num(d.people_today)}
          k={(() => {
            const ours = (d.people_today ?? 0) - (d.customers_today ?? 0)
            if (!d.people_today) return 'Active today'
            if (!d.customers_today) return `Active today · all ${num(ours)} us`
            return ours ? `Active today · ${num(ours)} of them us` : 'Active today · all customers'
          })()} />
        <Kpi small v={num(d.requests_today)} k="Requests today" />
        <Kpi small v={num(d.server_errors_today)} k="Our bugs today"
          tone={d.server_errors_today > 100 ? 'red' : ''} />
        <Kpi small v={num(d.signups_today)} k="Signups today" />
      </div>
    </>
  )
}

/** Is every database actually backed up?

    THERE WAS NO CARD HERE AT ALL. The backend has computed this panel all
    along and the page never rendered it, so the only trace of backups on the
    screen was one amber line in the strip saying the age "is not being
    checked". Behind that line on 2026-08-27, the soils database — tillable
    polygons, soil ratings, deed corrections, none of which exist anywhere
    else — had had no successful backup for eleven nights.

    So this lists every database we expect to be backed up, whether or not it
    has ever reported. A database that has said nothing reads as overdue, not
    as absent: silence is the failure mode that actually happened. */
function Backups({ d }: { d: any }) {
  const runs = (d.runs || []) as any[]
  const bad = runs.filter(r => r.verdict !== 'ok')
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Kpi v={bad.length === 0 ? 'All backed up' : num(bad.length)}
          k={bad.length === 0 ? 'every database, on schedule' : 'databases without a good backup'}
          tone={bad.length === 0 ? '' : 'red'} />
        <Kpi small
          v={(() => {
            const ok = runs.filter(r => r.verdict === 'ok' && r.hours_ago !== null)
            if (!ok.length) return '—'
            return `${Math.round(Math.min(...ok.map(r => r.hours_ago)))}h`
          })()}
          k="since the most recent one" />
      </div>
      <table>
        <thead><tr><th>Database</th><th className="n">Last good</th><th className="n">State</th></tr></thead>
        <tbody>
          {runs.map((r: any) => (
            <tr key={r.name}>
              <td className="t">
                {r.name}
                {/* What is actually in it, because "soils is 11 days old" does
                    not tell you that the thing at risk is irreplaceable. */}
                {r.what ? <div className="more" style={{ marginTop: 1 }}>{r.what}</div> : null}
              </td>
              <td className="n dim">
                {r.hours_ago === null || r.hours_ago === undefined
                  ? 'never'
                  : r.hours_ago < 48
                    ? `${Math.round(r.hours_ago)}h ago`
                    : `${Math.round(r.hours_ago / 24)}d ago`}
              </td>
              {/* SAME RULE AS THE STRIP, or the same event is red at the top
                  of the screen and amber in this table. A run that FAILED is
                  red whether or not the data could be rebuilt: the backend's
                  alert uses `irreplaceable OR failed` and this must match it. */}
              <td className="n" style={{
                color: r.verdict === 'ok' ? undefined
                  : (r.failed || r.irreplaceable) ? 'var(--red)' : 'var(--amber)',
              }}>{r.verdict === 'ok' ? 'ok' : r.verdict}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Said plainly rather than left as an empty table: if nothing has ever
          reported, the rows above are overdue because nothing can confirm
          otherwise, which is a different sentence from "the backups failed". */}
      {d.how ? <div className="rows"><Row label="Why every line says overdue" value={<span className="dim">nothing reports yet</span>} tone="amber" /></div> : null}
      {(d.unexpected_jobs || []).length > 0 && (
        <div className="rows">
          <Row label="Reporting under another name" tone="amber"
            value={(d.unexpected_jobs || []).join(', ')} />
        </div>
      )}
    </>
  )
}

function Money({ d }: { d: any }) {
  // CHECKED AGAINST THE PROCESSORS, NOT AGAINST OURSELVES.
  // Everything on this card used to come from user_subscriptions, which is a
  // cache of Stripe's and Apple's ledgers and drifts from both. On 2026-08-27
  // it was understating the year by $3,645.24 of $16,389.17. The headline is
  // now Stripe's own figure plus the App Store price list; our table's answer
  // stays on screen underneath so the two can be compared rather than one
  // quietly replacing the other.
  const v = d.verified || {}
  const checked = v.ok && v.annual_revenue !== null && v.annual_revenue !== undefined
  const gap = checked ? Number(v.gap || 0) : 0
  const disagreements = (v.disagreements || []) as any[]
  const chargedNotLive = (v.charged_not_live || []) as any[]
  const stale = (v.stale_period_ends || []) as any[]
  const renewRows = (v.renewing_30d_rows || []) as any[]
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Kpi v={checked
          ? <Detail value={money(v.annual_revenue)} title="Where the year's revenue comes from"
              rows={[
                { l: 'Stripe subscriptions', r: money(v.stripe_annual) },
                { l: 'Apple subscriptions', r: money(v.apple_annual) },
                { l: 'Our own table says', r: money(v.table_annual),
                  note: gap ? `${gap > 0 ? 'short' : 'over'} by ${money(Math.abs(gap))} — ${v.matched} of ${v.compared} subscriptions match Stripe exactly` : 'agrees exactly' },
                { l: 'Checked', r: ago(v.as_of) + ' ago' },
              ]} />
          : money(d.annual_revenue)}
          k={checked ? 'Per year · confirmed with Stripe' : 'Per year · our records only'} />
        {/* PAYING MEANS PAYING. This counted anyone with a live entitlement,
            trials included, so on 2026-08-26 it read 26 when 18 people had
            paid anything — the other eight are listed a few rows down under
            "Trials becoming paid". The panel now publishes the two
            separately; `live_people` is the old number if it is ever wanted. */}
        <Kpi small v={num(d.paying_people)} k="Paying customers" />
      </div>
      <table>
        <thead><tr><th>Plan</th><th className="n">Paying</th><th className="n">Per year</th></tr></thead>
        <tbody>
          {(d.by_tier || []).length === 0
            ? <tr><td className="dim">No active plans</td></tr>
            : (d.by_tier || []).map((t: any) => (
              <tr key={t.tier}>
                <td className="t">{(t.tier || '').replace(/_/g, ' ')}</td>
                <td className="n dim">{num(t.rows)}</td>
                {/* Firm rows carry no price in this database, so a zero here
                    would read as "this firm pays nothing" rather than "we do
                    not hold the number". */}
                <td className="n">{t.priced ? money(t.annual_revenue) : <span className="dim">in Stripe</span>}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="rows">
        <Row label="Firms paying" value={`${num(d.paying_firms)} · ${num(d.firm_seats)} seats`} />
        {d.firms_trialing > 0 && (
          /* These used to be counted as paying, so this row and the plan
             table above disagreed about how many firms there are. */
          <Row label="Firms on trial, not yet paying"
            value={`${num(d.firms_trialing)}${d.firm_trial_seats ? ` · ${num(d.firm_trial_seats)} seats` : ''}`}
            tone="amber" />
        )}
        {/* A trial charging for the first time is not a renewal. While a
            subscription trials, current_period_end IS the trial end, so every
            trial fell inside 30 days by construction and this read 22 ·
            $18,804.80 when 13 subscriptions worth $10,370.05 were up for
            renewal — the other nine being the trials listed just below.
            Then the 13 turned out to be wrong too: the window had no lower
            bound, so nine subscriptions whose period had ENDED — the oldest
            189 days earlier — counted as renewing. And our own period ends
            are a whole billing cycle behind on half the book, so the figure
            here is Stripe's dates, not ours. */}
        <Row label="Renewing in 30 days" value={checked
          ? <Detail value={`${num(v.renewing_30d)} · ${money(v.renewing_30d_value)}`}
              title="Renewing in the next 30 days"
              rows={renewRows.map(r => ({
                l: r.email || '—',
                r: money(r.worth),
                note: `renews ${new Date(r.ends).toLocaleDateString()}${r.cancelling ? ' · set to cancel' : ''}`,
              }))} />
          : `${num(d.renewing_30d)} · ${money(d.renewing_30d_value)}`} />
        <Row label="Payment failed" value={num(d.past_due_people)} tone={d.past_due_people ? 'red' : ''} />
      </div>

      {/* WHERE OUR RECORDS AND THE PROCESSOR DISAGREE.
          Every one of these is money, not a display quirk: a customer being
          billed for something our database has wrong, or in the worst case
          billed for something our database says was cancelled. */}
      {checked && (disagreements.length > 0 || chargedNotLive.length > 0 || stale.length > 0) && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div className="more" style={{ marginBottom: 2 }}>Our records vs Stripe</div>
          {chargedNotLive.length > 0 && (
            <Row label="Being charged, nothing live our side" tone="red"
              value={<Detail tone="red" title="Stripe is billing these, we show no live subscription"
                value={`${num(chargedNotLive.length)} · ${money(chargedNotLive.reduce((a, x) => a + Number(x.theirs || 0), 0))}`}
                rows={chargedNotLive.map(x => ({ l: x.email || x.id, r: money(x.theirs) + '/yr',
                  note: 'they are paying — check they still have access' }))} />} />
          )}
          {disagreements.length > 0 && (
            <Row label="Priced wrongly in our database" tone="amber"
              value={<Detail tone="amber" title="Our price is not the price Stripe charges"
                value={`${num(disagreements.length)} · ${money(disagreements.reduce((a, x) => a + Math.abs(Number(x.gap ?? ((x.theirs || 0) - (x.ours || 0)))), 0))}`}
                rows={disagreements.map(x => ({
                  l: x.email,
                  r: `${money(x.ours)} → ${money(x.theirs)}`,
                  note: x.reason,
                }))} />} />
          )}
          {stale.length > 0 && (
            /* The money agrees; only the DATE is behind. Every one checked
               had in fact renewed and nothing wrote the new date back, which
               is what made renewed subscriptions look overdue. */
            <Row label="Renewal date a billing cycle behind"
              value={<Detail title="Renewed at Stripe, our date never moved"
                value={`${num(stale.length)} of ${num(v.compared)}`}
                rows={stale.map(x => ({ l: x.email,
                  r: `${x.days_behind} days behind`,
                  note: `ours ${new Date(x.ours).toLocaleDateString()} · Stripe ${new Date(x.theirs).toLocaleDateString()}` }))} />} />
          )}
        </div>
      )}

      {/* APPLE CANNOT BE CHECKED, AND SAYS SO.
          Verifying an Apple subscription needs the original receipt (we store
          none) or an App Store Server API key (not configured — only the app
          id, bundle id and shared secret are). The PRICE is checked against
          the App Store price list; the STATUS is only as current as the last
          notification Apple sent us. A green tick here would be a lie. */}
      {v.apple && (
        <div className="rows">
          <Row label="Apple subscriptions"
            value={`${money(v.apple.paid_annual)}${v.apple.trial_annual ? ` · ${money(v.apple.trial_annual)} trialing` : ''}`} />
          {v.apple.price_mismatches?.length > 0 && (
            <Row label="— priced differently to the App Store" tone="red"
              value={<Detail tone="red" title="Our price is not Apple's price"
                value={num(v.apple.price_mismatches.length)}
                rows={v.apple.price_mismatches.map((x: any) => ({
                  l: x.email, r: `${money(x.ours)} → ${money(x.theirs)}`, note: x.reason }))} />} />
          )}
          <Row label="— renewals confirmed with Apple" tone="amber"
            value={<Detail tone="amber" title="Why Apple cannot be checked"
              value="not possible"
              rows={[{ l: 'Reason', r: v.apple.why_not },
                     { l: 'Prices checked', r: `${num(v.apple.prices_checked)} of ${num(v.apple.rows)}` }]} />} />
        </div>
      )}

      {/* A Stripe outage must not read as "no revenue". */}
      {!checked && (
        <div className="rows">
          <Row label="Stripe could not be reached" tone="amber"
            value={v.error ? String(v.error).slice(0, 60) : 'showing our own records'} />
        </div>
      )}

      {/* Trials are money that has not arrived yet. While a subscription is
          trialing, its period end IS the trial end, so "ending" means "about
          to charge". */}
      {d.trials && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div className="more" style={{ marginBottom: 2 }}>Trials becoming paid</div>
          {/* PEOPLE, not rows. Somebody trialing two states holds two
              subscription rows, so this read 9 when eight people were on a
              trial and one of them appeared twice in the list below. The
              money stays per row, because he is charged for both states. */}
          <Row label="On a free trial"
            value={`${num(d.trials.people ?? d.trials.total)} · ${money(d.trials.charge_all)} if all convert`} />
          {/* A single total here is unreadable: a couple of firm trials at a
              few thousand each dominate it, and there was no way to see that
              from the card. Broken out, the number can be checked by adding
              it up. */}
          {(d.trials.by_tier || []).map((t: any) => (
            <div className="row" key={t.tier}>
              {/* ROWS here, not people: the figure beside it is the sum of
                  those rows' prices, so counting people would make the line
                  fail to add up against its own money. */}
              <span className="l clamp1" style={{ color: 'var(--muted)', paddingLeft: 8 }}>
                — {(t.tier || '').replace(/_/g, ' ')} × {num(t.rows ?? t.people)}
              </span>
              <span className="r dim" style={{ color: 'var(--muted)' }}>{money(t.charge)}</span>
            </div>
          ))}
          {d.trials.unpriced > 0 && (
            <Row label="— trials with no price set" value={num(d.trials.unpriced)} tone="amber" />
          )}
          {d.trials.monthly_cycle > 0 && (
            /* Every plan is sold annually, so a monthly-cycle row is a data
               fault, not a plan. Worth saying rather than quietly averaging in. */
            <Row label="— not on an annual cycle (should be none)"
              value={num(d.trials.monthly_cycle)} tone="red" />
          )}
          {/* Both "charging" lines count CHARGES, not people, because the
              money beside them is per subscription. The headline above
              counts people, which is a different question and says so. */}
          <Row label="Charging within 7 days" value={num(d.trials.ending_7d)}
            tone={d.trials.ending_7d ? 'green' : ''} />
          <Row label="Charging within 30 days"
            value={`${num(d.trials.ending_30d)} · ${money(d.trials.charge_30d)}`} />
          {/* Keyed on email + state: somebody trialing two states appears
              twice here, and React silently drops the second row when both
              carry the same key. The state is shown for the same reason —
              the same name twice with two dates is not readable. */}
          {(d.trials.soon || []).slice(0, 3).map((t: any, i: number) => (
            <div className="row" key={`${t.email}:${t.state ?? i}`}>
              <span className="l clamp1" style={{ color: 'var(--muted)' }}>
                {t.name}{t.state && t.state !== 'ALL' ? ` · ${t.state}` : ''}
              </span>
              <span className="r dim" style={{ color: 'var(--muted)' }}>
                {t.ends ? new Date(t.ends).toLocaleDateString('en-US',
                  { month: 'short', day: 'numeric' }) : '—'} · {money(t.worth)}
              </span>
            </div>
          ))}
        </div>
      )}

      {d.churn && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div className="more" style={{ marginBottom: 2 }}>Cancellations</div>
          <Row label="Cancelled in 30 days" value={num(d.churn.cancelled_30d)}
            tone={d.churn.cancelled_30d ? 'red' : ''} />
          <Row label="Cancelled in 90 days"
            value={`${num(d.churn.cancelled_90d)} · ${money(d.churn.lost_90d)} lost`}
            tone={d.churn.cancelled_90d ? 'amber' : ''} />
          <Row label="Trials that went on to pay"
            value={`${num(d.churn.conversion_pct, 0)}% · ${num(d.churn.converted)} of ${num(d.churn.converted + d.churn.lapsed)}`}
            tone={d.churn.conversion_pct < 50 ? 'red' : ''} />
          {(d.churn.who || []).slice(0, 3).map((w: any, i: number) => (
            <div className="row" key={`${w.email}-${i}`}>
              <span className="l clamp1" style={{ color: 'var(--muted)' }}>{w.name}</span>
              <span className="r dim" style={{ color: 'var(--muted)' }}>
                {w.tier?.replace(/_/g, ' ')} · {ago(w.when)} ago
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <Row label="Started minus cancelled, 30 days"
          value={`${d.net_30d >= 0 ? '+' : ''}${num(d.net_30d)}`}
          tone={d.net_30d < 0 ? 'red' : ''} />
      </div>
      <div className="note">{d.revenue_caveat}</div>
    </>
  )
}

function People({ d }: { d: any }) {
  const recent = d.recent_no_subscription || []
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi v={num(d.total)} k="Accounts" />
        <Kpi small v={num(d.new_7d)} k="New this week" />
        <Kpi small v={num(d.seen_7d)} k="Used it this week" />
      </div>
      <div className="kpi" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <div className="v sm amber">{num(d.never_subscribed)}</div>
        <div className="k">
          Signed up, never subscribed &nbsp;·&nbsp; {num(d.never_subscribed_new_30d)} of them in the last 30 days
        </div>
      </div>
      <div className="rows">
        {recent.slice(0, 2).map((u: any) => (
          <div className="row" key={u.email}>
            <span className="l">{u.name || u.email}</span>
            <span className="r" style={{ color: 'var(--muted)' }}>{u.state || '—'} · {ago(u.signed_up)}</span>
          </div>
        ))}
        <More total={recent.length} shown={2} />
      </div>
      {/* Says out loud what this number is not, so it can't be over-read. */}
      <div className="note">{d.funnel_caveat}</div>
    </>
  )
}

function Erroring({ d }: { d: any[] }) {
  if (!d.length) return <div className="allgood">Nothing is erroring</div>
  return (
    <>
      <table>
        <thead><tr><th>Endpoint</th><th className="n">Calls</th><th className="n">Failed</th><th className="n">Rate</th></tr></thead>
        <tbody>
          {d.slice(0, 8).map(e => (
            <tr key={e.endpoint}>
              <td className="t">{e.endpoint}</td>
              <td className="n dim">{num(e.requests)}</td>
              <td className={`n ${e.server_errors > 0 ? 'red' : ''}`}>{num(e.errors)}</td>
              <td className={`n ${e.error_rate_pct >= 5 ? 'red' : e.error_rate_pct >= 2 ? 'amber' : 'dim'}`}>
                {num(e.error_rate_pct, 1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="note">
        Last three hours. Red means the failure is ours, not a bad request.
      </div>
    </>
  )
}

function Slowest({ d }: { d: any[] }) {
  if (!d.length) return <div className="dead">Nothing measured yet</div>
  return (
    <>
      <table>
        <thead><tr><th>Endpoint</th><th className="n">Calls</th><th className="n">Usual</th><th className="n">Slowest 5%</th></tr></thead>
        <tbody>
          {d.slice(0, 8).map(e => (
            <tr key={e.endpoint}>
              <td className="t">{e.endpoint}</td>
              <td className="n dim">{num(e.requests)}</td>
              <td className="n dim">{num(e.p50_ms)} ms</td>
              <td className={`n ${e.p95_ms >= 5000 ? 'red' : e.p95_ms >= 2000 ? 'amber' : ''}`}>{num(e.p95_ms)} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="note">
        Over the last day. &ldquo;Slowest 5%&rdquo; is what an unlucky customer waits.
      </div>
    </>
  )
}

function Jobs({ d }: { d: any }) {
  const jobs: any[] = d.jobs || []
  const bad = new Set([...(d.failing || []), ...(d.stuck || [])].map((j: any) => j.raw_name))
  // Problems first, then live jobs, then ones that have stopped running —
  // a retired job should never push a running one off the visible nine.
  const rank = (j: any) => bad.has(j.raw_name) ? 0 : j.stale ? 2 : 1
  const sorted = [...jobs].sort((a, b) => rank(a) - rank(b))
  return (
    <>
      <table>
        <thead><tr><th>Job</th><th className="n">Last ran</th><th className="n">Result</th></tr></thead>
        <tbody>
          {sorted.slice(0, 9).map(j => {
            const failing = (j.consecutive_failures || 0) > 0
            const stuck = j.status === 'running' && (j.running_for_minutes === null || j.running_for_minutes > 60)
            return (
              <tr key={j.raw_name}>
                <td className={`t ${failing ? 'red' : ''}`}>{j.name}</td>
                <td className="n dim">{j.minutes_ago === null ? 'never' : `${ago(j.finished_at)} ago`}</td>
                <td className="n">
                  {/* A JOB THAT STOPPED RUNNING IS NOT A SUCCESS.
                      The last outcome is kept for ever, so a retired job read
                      "ok" in green with nothing saying the success was 85 days
                      old — beside jobs that had run two minutes earlier. */}
                  {failing ? <Chip tone="red">failed {num(j.consecutive_failures)}x</Chip>
                    : stuck ? <Chip tone="amber">stuck</Chip>
                      : j.stale ? <Chip>stopped · {num(j.stale_days)}d</Chip>
                        : j.status === 'success' ? <Chip tone="green">ok</Chip>
                          : <Chip>{j.status || '—'}</Chip>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <More total={sorted.length} shown={9} />
    </>
  )
}

function Crashes({ d }: { d: any }) {
  const affected: any[] = d.affected || []
  return (
    <>
      {/* A CRASH IS THE APP SHUTTING DOWN. Nothing else on this card is a
          crash. The app's reporter sends every JS error its global handler
          sees — unhandled promise rejections included — and counting those
          together produced "40 app crashes today" for a day on which the app
          died twice. The headline is fatal only; the rest is below it,
          labelled as what it is. */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi v={num(d.fatal_24h_only)} k="App shut down · 24h"
          tone={d.fatal_24h_only ? 'red' : 'green'} />
        {/* A NUMBER, AND A TRUE ONE. This printed the words "not signed
            in", then briefly printed 0 — which the owner rightly called
            impossible: the app cannot shut down unless somebody is holding
            it. Both were wrong in the same way, reporting what the table
            said rather than what could be true.

            There is no device or install identifier anywhere in the crash
            data, so the number of PEOPLE is genuinely unknowable. The
            number of PHONES has a floor: two crashes on an iPhone 14 and an
            iPhone 17 Pro cannot be the same handset. Distinct model + OS +
            app version is that floor, it is at least 1 whenever a crash
            exists, and the label says "at least" so it is never read as a
            count. */}
        {/* WHO IT HIT, NOT JUST HOW MANY.
            Until 2026-08-27 the app never told the server who was signed in,
            so this could only ever count distinct PHONES and the label had to
            say so. Now that the reporter attaches the id, the number opens
            into the actual customers and the times it hit them — a figure
            nobody can drill into is a figure nobody can check. Reports from
            builds older than the fix still arrive anonymous, so the phone
            floor stays the headline and the named people sit inside it. */}
        <Kpi small
          v={(d.who || []).length > 0
            ? <Detail tone="red" value={num(d.who.length)}
                title="Who the app crashed on, and when"
                rows={(d.who || []).map((w: any) => ({
                  l: w.name || w.email,
                  r: `${num(w.crashes)}×`,
                  note: `${new Date(w.last_hit).toLocaleString()}${
                    w.crashes > 1 ? ` · first ${new Date(w.first_hit).toLocaleString()}` : ''
                  }${w.device_model ? ` · ${w.device_model}` : ''}${
                    w.app_version ? ` · v${w.app_version}` : ''}`,
                }))} />
            : num(d.phones_24h_at_least)}
          k={(d.who || []).length > 0
               ? 'People it hit · last 7 days'
               : d.identity_ever_recorded === false
                 ? 'Phones it hit · at least · nobody was signed in'
                 : 'Phones it hit · at least'}
          tone={(d.who || []).length || d.phones_24h_at_least ? 'red' : ''} />
        <Kpi small v={num(d.fatal_7d)} k="Shut down · 7 days"
          tone={d.fatal_7d ? 'amber' : ''} />
      </div>
      <div className="rows">
        <Row label="Errors the app survived, 24 hours"
          value={num((d.rejections_24h || 0) + (d.nonfatal_24h || 0))}
          tone={(d.rejections_24h || 0) + (d.nonfatal_24h || 0) ? 'amber' : ''} />
        <Row label="— of those, unhandled promise rejections"
          value={num(d.rejections_24h)} />
        <Row label="Crashes with nobody signed in, 24 hours" value={num(d.signed_out_24h)}
          tone={d.signed_out_24h ? 'amber' : ''} />
        <Row label="Ever recorded, crashes and errors"
          value={`${num(d.all_time)} · ${num(d.fatal_all)} were crashes · newest ${d.newest_report ? ago(d.newest_report) + ' ago' : 'none'}`} />
      </div>
      {d.what_counts && <div className="note">{d.what_counts}</div>}
      {/* "Who it hit · last 7 days" used to sit HERE, immediately above the
          diagnosis block it does not describe, with the list it does
          describe rendering further down. It has moved to sit on its list. */}
      {/* What the crashes have in common. The app's black box records the
          map state before every death; without this the card could only say
          how many, which is a statistic rather than a lead. */}
      {d.diagnosis?.reports_with_evidence > 0 && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div className="more" style={{ marginBottom: 2 }}>What they had on screen</div>
          {d.diagnosis.every_parcel_pct !== null && (
            <Row label="Every parcel being drawn"
              value={`${num(d.diagnosis.every_parcel_pct, 0)}% of them`}
              tone={d.diagnosis.every_parcel_pct >= 60 ? 'red' : ''} />
          )}
          <Row label="Zoom when it died"
            value={`avg ${num(d.diagnosis.avg_zoom, 1)}, up to ${num(d.diagnosis.max_zoom, 1)}`} />
          <Row label="Most sale dots loaded" value={num(d.diagnosis.max_dots)}
            tone={(d.diagnosis.max_dots || 0) > 5000 ? 'red' : ''} />
          <Row label="Phone memory"
            value={`${num(d.diagnosis.smallest_device_gb, 1)}–${num(d.diagnosis.largest_device_gb, 1)} GB`} />
          {/* The "on the simulator, not a phone" row is gone with the data
              behind it. Owner 2026-08-27: simulator crashes do not affect
              customers, so they are not recorded on this card at all — the
              panel excludes them from every query rather than counting them
              and then apologising for them in a row. */}
          {(d.diagnosis.devices || []).length > 0 && (
            <Row label="Devices"
              value={(d.diagnosis.devices || []).slice(0, 2)
                .map((x: any) => `${x.model} ${x.count}`).join(' · ')} />
          )}
          {(d.diagnosis.overlays || []).length > 0 && (
            <Row label="Overlay"
              value={(d.diagnosis.overlays || []).map((o: any) => `${o.overlay} ${o.count}`).join(' · ')} />
          )}
        </div>
      )}
      {affected.length === 0
        ? <div className="allgood">No crashes in the last 7 days</div>
        : (
          <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
            {/* The header belongs to THIS list — it spans 7 days while the
                headline above spans 24 hours, and mixing the two silently is
                how a 59-crash row once sat under a headline of 12. */}
            <div className="more" style={{ marginBottom: 2 }}>Who it hit · last 7 days</div>
            {affected.slice(0, 5).map((a, i) => (
              <div key={a.user_id || `anon-${i}`} style={{ display: 'grid', gap: 1 }}>
                <div className="row">
                  <span className="l clamp1" style={{ fontWeight: 600 }}>
                    {/* "Nobody signed in" is the honest label: the report
                        arrived without a user attached. It does NOT mean the
                        crash signed anyone out. */}
                    {a.signed_in ? (a.name || a.email) : 'Nobody signed in'}
                  </span>
                  <span className="r" style={a.fatal ? { color: 'var(--red)' } : undefined}>
                    {num(a.crashes)} crash{a.crashes === 1 ? '' : 'es'} · {ago(a.last_seen)} ago
                  </span>
                </div>
                <div className="note clamp2">
                  {[a.signed_in && a.name ? a.email : null, a.screen, a.platform,
                    a.app_version && `v${a.app_version}`, a.error]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
            <More total={affected.length} shown={5} />
          </div>
        )}
    </>
  )
}

/** A gigabyte figure that does not round small things away.
    "0 GB" against a bucket holding 100 MB reads as an empty bucket. */
const gb = (v: any) => {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  return n > 0 && n < 10 ? `${num(n, 1)} GB` : `${num(n)} GB`
}

function Storage({ d, trend }: { d: any; trend: any }) {
  const vp = d.volume_pct
  const vtone: Tone = vp == null ? '' : vp >= 90 ? 'red' : vp >= 80 ? 'amber' : 'green'
  return (
    <>
      {/* THE DISK, FIRST. Every database shares one RDS volume now, so the
          total is the number that runs out — a row at 22% is not 22% of its
          own disk, it is 22% of everybody's. */}
      {vp != null && (
        <div className="store">
          <div className="top">
            <span>All databases, one disk</span>
            <Chip>AWS RDS</Chip>
            <span className="pc" style={vtone === 'red' ? { color: 'var(--red)' } : undefined}>
              {num(vp, 1)}%
            </span>
          </div>
          <div className="bar"><i className={vtone} style={{ width: `${Math.min(100, vp)}%` }} /></div>
          <div className="note">
            {gb(d.volume_used_gb)} of {gb(d.volume_gb)}
            {d.volume_used_measured
              ? ' — RDS\u2019s own figure, so it counts the sandbox database and the write-ahead logs too'
              : ' — the databases we can reach; the disk holds more than this'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(d.stores || []).map((s: any) => {
          const pc = s.pct_of_cap
          const capped = pc !== null && pc !== undefined
          const tone: Tone = !capped ? '' : pc >= 90 ? 'red' : pc >= 80 ? 'amber' : 'green'
          return (
            <div className="store" key={s.key}>
              <div className="top">
                <span>{s.label}</span>
                {s.provider ? <Chip>{s.provider}</Chip> : null}
                {s.live === false ? <Chip>measured {s.measured_at}</Chip> : null}
                <span className="pc" style={tone === 'red' ? { color: 'var(--red)' } : undefined}>
                  {capped ? `${num(pc, 1)}%` : gb(s.used_gb)}
                </span>
              </div>
              {capped && <div className="bar"><i className={tone} style={{ width: `${Math.min(100, pc)}%` }} /></div>}
              <div className="note">
                {capped
                  ? `${gb(s.used_gb)} of the shared ${gb(s.cap_gb)} disk · ${s.note}`
                  : s.note}
              </div>
            </div>
          )
        })}
      </div>

      {trend && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <Row label={(trend.growth_gb_per_day ?? 0) < 0 ? 'Main database is shrinking' : 'Main database is growing'}
            value={`${num(Math.abs(trend.growth_gb_per_day ?? 0), 2)} GB a day`} />
          {trend.days_to_cap !== null && trend.days_to_cap !== undefined && (
            <Row label="Full in" value={`about ${num(trend.days_to_cap)} days`}
              tone={trend.days_to_cap <= 120 ? 'red' : ''} />
          )}
          {(trend.biggest_tables || []).length > 0 && (
            <>
              <div className="more" style={{ margin: '6px 0 3px' }}>Biggest tables</div>
              {(trend.biggest_tables || []).slice(0, 3).map((t: any) => (
                <div className="row" key={t.table}>
                  {/* state_parcels is retired. It is only ever shown as wasted space. */}
                  <span className="l" style={t.table === 'state_parcels' ? { color: 'var(--amber)' } : undefined}>
                    {t.table}{t.table === 'state_parcels' ? ' — retired, pure waste' : ''}
                  </span>
                  <span className="r">{gb(t.gb)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* The old note here said a Railway disk cannot grow past 1,000 GB.
          There is no Railway disk any more, and an RDS volume CAN be grown —
          which changes the whole meaning of the bar above from a deadline
          into a bill. */}
      <div className="note">
        One RDS volume holds every database. AWS can grow it, so filling it is
        a bigger bill rather than an outage — but nothing shrinks it back on its own.
      </div>
    </>
  )
}

function Pipeline({ d }: { d: any }) {
  const poly = d.polygon_pct
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        {/* THE NUMBER IS NOW WHAT THE RUN WORKED THROUGH.
            listing_staging keys on a unique source_url_hash, so it only ever
            holds listings we had never seen — which is how this card came to
            say 3 on a night the scraper worked through 3,850 auctions across
            356 companies. scraper_run_log has the real funnel, written by the
            scraper itself, one row per company per phase. The label follows
            whichever source the number came from. */}
        <Kpi v={num(d.found)}
          k={d.found_is_new_only ? 'New to us last night' : 'Auctions scraped last night'}
          tone={d.run_anchored_to_job && !d.found ? 'amber' : ''} />
        <Kpi small v={num(d.waiting)} k="Waiting for you" />
        <Kpi small v={num(d.verified_today)} k="Verified today" />
      </div>

      {/* THE FUNNEL, START TO FINISH. Every step is a count the scraper
          wrote down during the run. The drop between what it worked through
          and what reached review is the thing worth watching, so it is a row
          on the card rather than something you have to infer from a small
          headline. */}
      {d.run_has_funnel && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div className="more" style={{ marginBottom: 2 }}>
            What last night&rsquo;s run did · {num(d.run_companies)} companies
          </div>
          <Row label="Auction cards seen" value={num(d.run_cards_seen)} />
          <Row label="Auctions worked through" value={num(d.run_auctions_worked)} />
          <Row label="New to us" value={num(d.run_new_urls)} />
          {/* THE SCRAPER'S TALLY AND THE REVIEW QUEUE ARE DIFFERENT THINGS.
              "Reached review" used to show the scraper's count of newly
              SCRAPED urls: on 2026-08-28 that read 46 while listing_staging
              had taken nothing since the 25th. Both are shown now, and when
              they disagree the card says so instead of letting one stand in
              for the other. */}
          <Row label="Newly scraped" value={num(d.run_newly_scraped)} />
          <Row label="Reached review"
            value={num(d.run_reached_review)}
            tone={d.scraped_but_not_queued > 0 ? 'amber' : ''} />
          {d.scraped_but_not_queued > 0 && (
            <Row label="— scraped but never queued for review"
              value={num(d.scraped_but_not_queued)} tone="amber" />
          )}
          {d.review_queue_last_arrival && (
            <Row label="— review queue last received anything"
              value={ago(d.review_queue_last_arrival) + ' ago'} />
          )}
          {d.run_failed_companies > 0 && (
            <Row label="Companies that failed outright"
              value={num(d.run_failed_companies)} tone="red" />
          )}
        </div>
      )}

      {/* WHAT THE FILTER THREW AWAY BEFORE ANY OF THAT.
          The rule is: skip car, equipment, construction and antique auctions;
          keep every real estate and land auction. A count of what survived
          cannot tell you whether that is happening, so the filter's own
          tallies go on the card. "Not land" is the one to watch — it climbing
          means the filter has started eating real listings.

          The coverage line is not decoration: until every company records its
          breakdown these totals cover only part of the run, and a partial
          number presented as a total is exactly the sort of thing this
          dashboard was wrong about before. */}
      {d.run_skip_coverage_pct != null && d.run_skip_coverage_pct > 0 && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div className="more" style={{ marginBottom: 2 }}>Cards the filter skipped</div>
          <Row label="Not land — cars, equipment, antiques"
            value={num(d.run_skipped_nonland)} />
          <Row label="No auction date on the card" value={num(d.run_skipped_no_date)} />
          <Row label="Navigation and search pages" value={num(d.run_skipped_nav)} />
          <Row label="Already past" value={num(d.run_skipped_past)} />
          {d.run_skip_coverage_pct < 100 && (
            <div className="note">
              Reasons recorded by {num(d.run_skip_coverage_pct)}% of companies, so
              these cover part of the run, not all of it.
            </div>
          )}
        </div>
      )}

      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <Row label="Auctions / private treaty"
          value={`${num(d.reported?.auctions ?? d.found_auctions)} / ${num(d.reported?.private_treaty ?? d.found_private_treaty)}`} />
        {/* `new_to_us` is always the staging count; `found` is the headline.
            Reading `found` here would have shown the same number twice. */}
        {!d.found_is_new_only && (
          <Row label="— new rows in staging"
            value={num(d.new_to_us ?? d.found)} />
        )}
        {/* Seven nights, so "is 3 normal?" answers itself. A run of similar
            numbers means this is what new-to-us looks like; one small number
            after a run of large ones means last night broke. */}
        {(d.new_by_night || []).length > 1 && (
          <div className="row">
            <span className="l" style={{ color: 'var(--muted)' }}>New each night · last 7</span>
            <span className="r dim" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {(d.new_by_night || []).map((b: any) => num(b.n)).join(' · ')}
            </span>
          </div>
        )}
        <Row label="Published from that run" value={num(d.published_from_run)} />
        <Row label="Tracts that got a boundary"
          value={poly === null || poly === undefined
            ? <span className="dim">none yet</span>
            : `${num(d.tracts_with_polygon)} of ${num(d.tracts_from_run)} · ${num(poly, 0)}%`}
          tone={poly !== null && poly !== undefined && poly < 60 ? 'amber' : ''} />
        <Row label="Still marked incomplete" value={num(d.waiting_incomplete)} />
        <Row label="No main photo" value={num(d.listings_missing_main_image)}
          tone={d.listings_missing_main_image ? 'red' : ''} />
        <Row label="Boundary but no map image" value={num(d.tracts_boundary_missing_image)}
          tone={d.tracts_boundary_missing_image ? 'red' : ''} />
        <Row label="Selling in the next 24 hours" value={num(d.auctions_next_24h)}
          tone={d.auctions_next_24h ? 'amber' : ''} />
      </div>
      <div className="note">
        {d.run_started
          ? <>Last scrape {ago(d.run_started)} ago
              {d.run_minutes ? `, took ${num(d.run_minutes, 0)} min` : ''}
              {d.run_status ? ` · ${d.run_status}` : ''}.
              {/* This said "counts from midnight", which was wrong twice:
                  the fallback is a rolling 24 hours, and it was in force
                  every single night because the job lookup never matched. */}
              {!d.run_anchored_to_job
                && ' No scraper run on record, so this counts a rolling 24 hours and may span two nights.'}</>
          : 'No scrape recorded yet.'}
        {d.oldest_waiting && <> Oldest waiting: {ago(d.oldest_waiting)}.</>}
      </div>
    </>
  )
}

function Quality({ d, fixes }: { d: any; fixes?: any }) {
  // Each row is a distinct, fixable defect, so each gets its own button
  // rather than one button for "data quality" in general.
  const line = (label: string, v: number) => (
    <div className="row" key={label}>
      <span className="l" style={v ? { color: 'var(--amber)' } : undefined}>{label}</span>
      <span className="r" style={v ? { color: 'var(--amber)' } : undefined}>{num(v)}</span>
      {v > 0 && <FixButton compact fixes={fixes}
        issue={{ key: `quality:${label}`, title: label, where: 'Data quality',
          detail: `${num(v)} records affected.`, evidence: d }} />}
    </div>
  )
  return (
    <>
      <div className="rows">
        {line('Says the boundary is good, but has none', d.valid_but_no_boundary)}
        {line('Boundary flagged as wrong', d.boundary_flagged_bad)}
        {line('Auction already happened, no price', d.past_auctions_no_price)}
        {/* "Tillable acres bigger than total acres" was here, 519 of them,
            in amber with a Fix button. It is not a defect: the owner ruled on
            2026-07-01 that it is legitimate and common ("I know it seems off,
            but this is common even though it doesn't make sense") and the
            rule was deleted — see the first line of docs/DATA_RULEBOOK.md in
            the backend repo. Do not add it back. */}
        {line('Acres recorded as zero or less', d.bad_acres)}
        {line('On the market with no location on the map', d.listings_no_location)}
      </div>
      {/* Deliberately outside the list: these are closed listings from old
          imports, not something a subscriber is looking at. Counted with the
          live ones they buried them, 1,413 to 629. */}
      {d.closed_no_location > 0 && (
        <div className="note">
          {num(d.closed_no_location)} sold or withdrawn listings also have no
          coordinates. Backlog, not a fault on anything currently for sale.
        </div>
      )}
      {(d.duplicate_titles || []).length > 0 && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div className="more" style={{ marginBottom: 4 }}>Same listing twice</div>
          <div className="rows">
            {(d.duplicate_titles || []).slice(0, 3).map((x: any, i: number) => (
              <div className="row" key={i}>
                <span className="l">{x.title}</span>
                <span className="r" style={{ color: 'var(--muted)' }}>{x.county} · {num(x.hits)}x</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="note">Things a subscriber would notice before we do.</div>
    </>
  )
}

function Reach({ notif, email, fixes, onOpenEmails }:
  { notif: any; email: any; fixes?: any; onOpenEmails?: () => void }) {
  // Only really_failed_24h is a fault. The other three reasons are facts
  // about the audience — no device, notifications off, malformed token — and
  // lumping them together as "tried but did not send" is what produced a
  // wildly wrong 182.
  const failing = (notif?.really_failed_24h || 0) > 0
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Kpi small v={num(notif?.pushed_24h)} k="Pushes sent today" />
        {/* Opens the list of who actually received them. */}
        <Kpi small
          v={onOpenEmails
            ? <button type="button" className="drill" onClick={onOpenEmails}
                aria-label="Show who we emailed">{num(email?.sent_24h)}</button>
            : num(email?.sent_24h)}
          k="Emails sent today" />
      </div>
      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <Row label="Pushes in the last hour" value={num(notif?.pushed_1h)} />
        <Row label="Last push"
          value={notif?.last_push ? `${ago(notif.last_push)} ago` : <span className="dim">none yet</span>} />
        {/* A bare failure count is alarming and unactionable at the same
            time. Expo says exactly why each one failed, so the row opens to
            show the reasons and real examples. */}
        <details className="row" style={{ display: 'block' }}>
          <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex' }}>
            <span className="l" style={failing ? { color: 'var(--red)' } : undefined}>
              Failed to send{' '}
              <span className="dim" style={{ fontSize: 10 }}>· click for why</span>
            </span>
            {/* PEOPLE, NOT JUST MESSAGES. "237" reads like an outage;
                "237 · 30 people" says what actually happened. */}
            <span className="r" style={failing ? { color: 'var(--red)' } : undefined}>
              {num(notif?.really_failed_24h)}
              {notif?.really_failed_people_24h
                ? <span className="dim" style={{ fontSize: 10 }}>
                    {' · '}{num(notif.really_failed_people_24h)} {notif.really_failed_people_24h === 1 ? 'person' : 'people'}
                  </span>
                : null}
            </span>
          </summary>
          <div style={{ padding: '4px 0 2px' }}>
            {(notif?.failure_reasons?.reasons || []).length === 0 ? (
              <div className="fixnote">
                {notif?.failure_reasons?.available === false
                  ? 'Reasons are not being recorded — Redis is unavailable.'
                  : notif?.failure_reasons?.counting_note ||
                    'No reason recorded for these yet.'}
              </div>
            ) : (
              <>
                {(notif.failure_reasons.reasons || []).map((r: any) => (
                  <div className="row" key={r.reason}>
                    <span className="l clamp1" style={{ color: 'var(--muted)', paddingLeft: 8 }}>
                      — {r.reason}
                    </span>
                    <span className="r dim">{num(r.count)}</span>
                  </div>
                ))}
                {(notif.failure_reasons.recent || []).slice(0, 3).map((x: any, i: number) => (
                  <div className="fixnote" key={i} style={{ paddingLeft: 8 }}>
                    {x.at ? `${ago(x.at)} ago` : ''} · {x.reason}
                    {x.detail ? ` · ${String(x.detail).slice(0, 90)}` : ''}
                  </div>
                ))}
              </>
            )}
            {failing && <FixButton compact fixes={fixes}
              issue={{ key: 'push:failed', title: 'Push notifications are failing to send',
                where: 'Notifications',
                detail: `${num(notif.really_failed_24h)} notifications in the last day went to users with a live device, notifications on and a valid token, and still did not send.`,
                evidence: notif }} />}
          </div>
        </details>
      </div>
      {/* Not faults — who we could not reach, and why. */}
      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <div className="more" style={{ marginBottom: 2 }}>Not sent, and why</div>
        <Row label="No device registered" value={num(notif?.no_device_24h)} />
        <Row label="Notifications turned off" value={num(notif?.opted_out_24h)} />
        <Row label="Device token is invalid" value={num(notif?.bad_token_24h)}
          tone={notif?.bad_token_24h ? 'amber' : ''} />
      </div>
      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <Row label="Pushes running late" value={num(notif?.overdue)}
          tone={notif?.overdue ? 'red' : ''} />
        <Row label="Waiting in the queue" value={num(notif?.queued)} />
        <Row label="Payment-failed emails" value={num(email?.dunning_24h)}
          tone={email?.dunning_24h ? 'amber' : ''} />
      </div>
      <div className="note">
        {notif?.reasons_reconcile === false
          ? <span style={{ color: 'var(--amber)' }}>
              These reasons do not add up to the {num(notif?.created_24h)} notifications
              created today — something is being counted twice or missed.
            </span>
          : <>All {num(notif?.created_24h)} notifications created today are accounted
             for exactly once. Refreshes every 15 seconds.</>}
      </div>
    </>
  )
}

/* ── What each card means ──────────────────────────────────────────────
   Written out per card because the audit that produced these notes is the
   thing that makes the numbers trustworthy. `covers` is what the figure
   includes, `source` is the table or service behind it, and `caveat` is
   what it deliberately does NOT tell you. A caveat is not an apology —
   a number whose limits are stated can be relied on; one without them
   cannot. */
type CardInfo = {
  covers: string
  source: string
  caveat?: string
  /* What every line on the card actually means. Without this the reader is
     guessing at labels like "every parcel being drawn", which is a real
     lead when you are chasing a crash and gibberish otherwise. */
  lines?: { l: string; d: string }[]
}

const CARD_INFO: Record<string, CardInfo> = {
  backups: {
    covers: 'Whether every database actually has a recent backup sitting in S3.',
    lines: [
      { l: 'Last good',
        d: 'How long since that database was dumped AND the file confirmed present in S3 by size. "never" means nothing has ever reported for it.' },
      { l: 'overdue',
        d: 'No confirmed backup inside its own schedule \u2014 nightly for most, Sunday for the 116 GB of reference tables. Silence counts as overdue on purpose: a database that stops reporting looks exactly like one that stopped being backed up, because usually it is.' },
      { l: 'failed',
        d: 'The job ran and said the dump did not work. The soils dump did this every night from 16 to 27 August 2026, killed at the 90-minute limit, and nothing on this screen surfaced it.' },
    ],
    source: 'system_job_runs, written by the nightly backup job after it confirms each object in S3.',
    caveat: 'The job checks the SIZE of each object, not just that a file with the right name exists \u2014 a killed upload once left a 53.6 GB partial dump that read as a real backup in a bucket listing. If the job never runs at all, nothing reports and every line here goes overdue, which is the intended behaviour rather than a fault.',
  },
  pulse: {
    lines: [
      { l: 'What a "request" is',
        d: 'One thing the app or website asked the backend for. Opening the map, tapping a parcel, loading map tiles, signing in, pulling a listing — each is one request. A single screen usually makes several. It is not a person and not a page view: it is one question asked of the server.' },
      { l: 'People on now · last 5 min',
        d: 'Distinct people who made at least one request in the last five minutes, counted continuously rather than in hourly buckets. Staff are included here and the label says how many are us — this card is asking whether anyone is using it right now, not who the customers are.' },
      { l: 'Requests this hour',
        d: 'Requests since the top of the current clock hour, ours included, with the number that were us shown beside it. It resets on the hour, so a small number early in the hour is normal — compare it with "requests today".' },
      { l: 'Failing',
        d: 'The share of those requests that came back an error. 401 and 403 are left out: an expired login is not a fault. Anything above about 2% is worth looking at. An em dash means the hour has measured nothing yet — which is not the same as nothing failing.' },
      { l: 'Average wait',
        d: 'How long the backend took to answer, averaged across the hour. Server time only — it does not include the phone\u2019s network or drawing time. An em dash means nothing has been measured this hour; it used to print "0 ms", which reads as instant.' },
      { l: 'People · last 15 min',
        d: 'PEOPLE — distinct human beings, not requests — over a longer window than the five-minute figure, so a quiet few minutes does not read as nobody being there. The label used to say only "last 15 minutes" and left you to guess what it was counting.' },
      { l: 'Active today',
        d: 'Distinct people who made at least one request today, us included, with the customer-only count beside it when the two differ. "Today" is a calendar day in the timezone the business runs on — the same day the clock at the top of this screen is showing.' },
      { l: 'Requests today',
        d: 'Requests since midnight, ours included. This used to be a rolling 24 hours wearing the word "today": on 27 August it read 884 on a day that had actually seen 10.' },
      { l: 'Our bugs today',
        d: 'Requests that failed with a 500-class error since midnight — the backend broke, rather than the caller asking for something wrong. These are ours to fix.' },
      { l: 'Signups today',
        d: 'New accounts created since midnight.' },
      { l: 'The chart',
        d: 'Requests per hour for the last 24 hours. Every hour is a point; the left axis is requests, the bottom axis is the hour.' },
    ],
    covers: 'Traffic and errors for the clock hour in progress, with the last full day underneath.',
    source: 'hourly_endpoint_metrics and hourly_user_activity, written by the request middleware and flushed about every 10 seconds.',
    caveat: 'Logged-out visitors are NOT here — this counts signed-in use of the product, and anonymous website traffic belongs to web analytics. Our own usage IS counted, in its own columns, and every figure that includes it says so; before 27 August it was thrown away before being recorded, so the owner using the product produced a card of zeroes. "People on now" is a true rolling five minutes from a Redis set, not an hourly bucket; if Redis is unavailable it falls back to the clock hour and the label says so. Failed requests exclude 401 and 403 — an expired token is not a fault.',
  },
  money: {
    lines: [
      { l: 'Individual plans, per year',
        d: 'What every live subscription is worth over a year. Every plan is sold annually, so this is the actual yearly total, not a projection.' },
      { l: 'Paying customers',
        d: 'People who have actually paid — active or past due. Trials are NOT in here; they are counted under "On a free trial", because somebody on a free trial has paid nothing. A firm counts once, at its admin, not once per seat.' },
      { l: 'The plan table',
        d: 'The same money split by plan, so the total can be checked by adding it up.' },
      { l: 'Firms paying',
        d: 'Firms that have actually paid — active or past due — and how many seats they cover. Firms still on trial are on their own line, because they have paid nothing yet.' },
      { l: 'Renewing in 30 days',
        d: 'Paid subscriptions whose period ends within a month, and what they are worth — money that has to be re-earned. Trials are excluded: while a subscription is trialing its period end is the TRIAL end, so counting them here listed the same people twice on one card.' },
      { l: 'Payment failed',
        d: 'People whose card was declined and who are now past due. They still have access, and they will lose it if this is not resolved.' },
      { l: 'On a free trial · if all convert',
        d: 'How many PEOPLE are on a trial, and what Stripe will actually charge when those trials end — not an annualised projection. The count is people and the money is per subscription, because somebody trialing two states holds two rows and is charged for both. Broken out by plan underneath, because one firm trial can be worth more than every individual trial put together.' },
      { l: 'Charging within 7 / 30 days',
        d: 'Trials about to become real money. While a subscription is trialing, its period end IS the trial end.' },
    ],
    covers: 'Annual value of every live subscription, plus trials about to charge and who has cancelled. A firm counts once, at its admin\u2019s row.',
    source: 'user_subscriptions. When billing_cycle is annual, monthly_price already holds the annual figure — for Stripe plans, Apple IAP, and firms alike.',
    caveat: 'Trials are shown separately and are not in the total — while a subscription is trialing its period end IS the trial end, so "charging within 7 days" means it is about to bill. Past-due subscriptions are still counted: that money is in dunning, not lost. Cancellations are ones that have already happened; there is no cancel-at-renewal flag stored, so a subscription set to lapse at its next renewal still looks live until it does.',
  },
  people: {
    lines: [
      { l: 'Accounts',
        d: 'Everyone signed up, excluding our own staff accounts and the test accounts the scripts create.' },
      { l: 'Used it · 24 hours / 7 days / 30 days',
        d: 'People who actually made a request in that window. This comes from real traffic, not from a last-login column — someone using the app daily with a saved login would never touch that column.' },
      { l: 'Signed up, never subscribed',
        d: 'Accounts with no subscription row of any kind, ever. It is not a drop-off rate: someone who signed up this morning is in here too.' },
      { l: 'Recent signups with no subscription',
        d: 'The follow-up list — who joined lately and has not subscribed, with when they were last active. A blank means they never came back.' },
    ],
    covers: 'Accounts, who actually used the product, and who never subscribed.',
    source: 'users for the counts; hourly_user_activity for "used it", which is real requests.',
    caveat: 'Not last_login — that column is only written by the password sign-in handler, so anyone on the phone app never touches it. "Never subscribed" is not a drop-off rate: checkout starts are not logged yet.',
  },
  crashes: {
    lines: [
      { l: 'App shut down · 24h',
        d: 'Times the app actually died and closed itself in the last 24 hours. This is the only number here that is a crash. It should always be zero.' },
      { l: 'Phones it hit · at least',
        d: 'A FLOOR, not a count. The crash reports carry no device or install id and have never carried a signed-in user — 0 of 184 since the first one in August — so how many PEOPLE were affected is genuinely unknowable. What is provable is that crashes on different phone models cannot be the same handset, so distinct model + OS + app version is the smallest number of phones this could be. It is at least 1 whenever a crash exists, which is why it can no longer say 0 for a day the app died.' },
      { l: 'Shut down · 7 days',
        d: 'The same count over a week, so you can tell a one-off from something that keeps happening.' },
      { l: 'Errors the app survived',
        d: 'The app reports every JavaScript error it sees, not just fatal ones. These are the ones it recovered from. Worth fixing, but the app did not close.' },
      { l: '— of those, unhandled promise rejections',
        d: 'A background task failed and nothing caught it — usually a network call. The user may have seen a blank area or a stuck spinner rather than a crash.' },
      { l: 'Crashes with nobody signed in',
        d: 'Crashes we cannot attribute to a person. Often the app dying before sign-in finished, which is worse than it sounds because the user never got in.' },
      { l: 'Ever recorded',
        d: 'Everything the crash table holds, and how many of those were real crashes. Here so a falling 24-hour number can be told apart from data going missing.' },
      { l: 'What they had on screen',
        d: 'Not a health metric — evidence. When the app dies it records what the map was doing, so these lines answer "what were they all doing when it died". A crash needs fixing whatever these say; they are here to tell you WHERE to look.' },
      { l: '— every parcel being drawn',
        d: 'The share of crashes where the map was drawing every parcel rather than a filtered set. A high number points at the map being asked to draw too much.' },
      { l: '— zoom when it died',
        d: 'How far in the map was zoomed. Deep zoom loads far more detail, so a cluster at high zoom points at load rather than a code fault.' },
      { l: '— most sale dots loaded',
        d: 'The largest number of sale dots held in memory when a crash happened. This one is the strongest lead: the dots accumulate deliberately and never unload, so a very large number here suggests the app ran out of memory.' },
      { l: '— phone memory',
        d: 'The range of device memory across the crashes. A crash only on small-memory phones is a memory problem; one across all sizes is a code fault.' },
      { l: 'Simulator crashes are not here at all',
        d: 'A crash on the iOS simulator is one of us testing, not a customer, so none of the numbers on this card include them. They were more than half of everything ever recorded — 102 of 184 reports — which is why the headline used to read far worse than reality.' },
    ],
    covers: 'Crashes reported by the phone app, and who they happened to.',
    source: 'mobile_crash_reports, posted by the app\u2019s global error handler.',
    caveat: '"Last 24 hours" is a rolling window, so crashes age out of it and the number falls — the 7-day and all-time figures beside it exist so that can never look like data going missing. "What they had on screen" comes from the app\u2019s own black box, which records the map state before each death; an iOS memory kill runs no JavaScript, so that snapshot is the only evidence such a crash ever leaves. Crashes with nobody signed in are counted separately, since they carry no user to attribute.',
  },
  failing_endpoints: {
    lines: [
      { l: 'Endpoint',
        d: 'The API address that failed — this is what the app was asking for when it broke.' },
      { l: 'Failed / Total',
        d: 'How many calls to it failed, out of how many were made in the last three hours.' },
      { l: 'Rate',
        d: 'The share failing. A high rate on a low-traffic endpoint can matter more than a low rate on a busy one, so read both.' },
      { l: 'Empty is the good state',
        d: 'This card shows only things that are actually failing. Nothing listed means nothing failed, which is why it does not list healthy endpoints.' },
    ],
    covers: 'Endpoints that returned errors in the last three hours.',
    source: 'hourly_endpoint_metrics.',
    caveat: 'Excludes 401 and 403, which are usually expired tokens rather than faults. Red marks a 5xx — our bug, not a bad request.',
  },
  slow_endpoints: {
    lines: [
      { l: 'p95',
        d: 'The wait that 95 out of 100 calls came in under. It is the number that matches "the app feels slow" far better than an average, because an average hides the bad tail.' },
      { l: 'Average',
        d: 'The mean wait. Shown next to p95 so a big gap between them tells you a few calls are much slower than the rest.' },
      { l: 'Calls',
        d: 'How many times it was called in the window. A slow endpoint nobody uses matters less than a slightly slow one used constantly.' },
    ],
    covers: 'The slowest endpoints over the last day, by how long an unlucky request takes.',
    source: 'The latency histogram in hourly_endpoint_metrics.',
    caveat: '"Slowest 5%" is read off histogram bucket edges, so it is the top of the bucket rather than an exact figure. Endpoints under 20 requests are left out as too noisy to rank.',
  },
  jobs: {
    lines: [
      { l: 'Job',
        d: 'A scheduled task that runs in the background — the scraper, backups, cleanups, notification sweeps.' },
      { l: 'Last finished',
        d: 'When it last completed. A job that has not finished for far longer than its schedule is stuck.' },
      { l: 'Failing',
        d: 'Jobs whose last run failed, and how many times in a row. Consecutive failures are what matter — one blip is usually a transient.' },
      { l: 'Stuck',
        d: 'Still claiming to be running an hour after it started. Either it wedged or the process died before recording a finish. Measured from when it STARTED, so a wedged job cannot look merely overdue.' },
    ],
    covers: 'Every scheduled job, when it last ran and whether it worked.',
    source: 'system_job_runs, written automatically by the scheduler wrapper.',
    caveat: 'Only jobs that run through the scheduler, plus anything that posts to the report endpoint (backups do). Something triggered by hand does not appear. "Stuck" means it claimed to be running for over an hour.',
  },
  storage: {
    lines: [
      { l: 'Share of the ceiling',
        d: 'How full each database is against the largest it can ever be. The percentage is the headline, not the gigabytes: Railway cannot grow a volume past its cap, so 91% is a deadline rather than a number.' },
      { l: 'Railway / AWS tags',
        d: 'Which provider holds it, so you know where to go when one fills up.' },
      { l: 'Measured vs stated',
        d: 'Anything we hold a live connection to is measured now. Anything we do not carries the date it was last measured by hand, so a stale figure can never pass as a reading.' },
      { l: 'Days to full',
        d: 'At the rate it is actually growing. This is the number worth acting on — "71 GB" is trivia, "full in 69 days" is a decision.' },
    ],
    covers: 'Every place data is kept, as a share of its ceiling.',
    source: 'pg_database_size for databases the backend connects to; the rest were measured by hand on the date shown.',
    caveat: 'A Railway Postgres disk cannot exceed 1,000 GB, so percentage matters more than gigabytes. Rows marked with a date are not live readings.',
  },
  outside: {
    covers: 'Every outside service we depend on — Stripe, Resend and Anthropic — with how many calls failed and WHY.',
    source: 'hourly_external_api_calls, written by the wrappers around each service.',
    lines: [
      { l: 'Calls · failed · rate',
        d: 'How many times we called that service in the last 24 hours, how many came back an error, and the share. A service nobody called shows no rate rather than 0%.' },
      { l: 'The message underneath',
        d: 'The last error the service actually returned. That is the point of the card: "146 failed" is a number, "the domain is not verified" is something you can go and fix.' },
      { l: 'Which call is failing',
        d: 'Narrows it to the specific operation — creating a checkout, sending an email — so a failing service does not send you hunting through everything it does.' },
      { l: 'Why it matters',
        d: 'Stripe failing means someone is not being billed. Resend failing means someone is not being told. Both were invisible on this dashboard until now.' },
    ],
  },
  pipeline: {
    lines: [
      { l: 'Last run',
        d: 'When the scraper last ran and how long it took.' },
      { l: 'Found / staged',
        d: 'Auction listings the scraper found and put into staging for review.' },
      { l: 'Waiting',
        d: 'Rows sitting in staging that nobody has reviewed yet, and how long the oldest has waited.' },
      { l: 'Published today',
        d: 'Staged rows that were reviewed and turned into live listings in the last 24 hours.' },
      { l: 'Listings live',
        d: 'Listings a subscriber can actually see. Bulk-import comparable-sales rows are excluded, exactly as the app excludes them, so this matches what you see in the product.' },
      { l: 'Polygons',
        d: 'Tracts with a drawn boundary. A tract with no boundary shows as a pin rather than a shape, which is the thing subscribers notice.' },
    ],
    covers: 'What the overnight scrape found, what published, and what is waiting for review.',
    source: 'listing_staging and listings, with the window anchored to the nightly job\u2019s own recorded start.',
    caveat: 'If the job never recorded a run, the window falls back to midnight Central and the card says so. A tract without a boundary cannot be published, which is why boundary coverage is shown rather than a raw count.',
  },
  data_quality: {
    lines: [
      { l: 'Valid boundary but no map image',
        d: 'A tract marked as having a good boundary but with no stored image — it will look broken in the app.' },
      { l: 'Past auctions with no sale price',
        d: 'An auction whose date has passed and which still has no result recorded. Subscribers see a stale listing until it is filled in.' },
      { l: 'Bad acres',
        d: 'Tracts with zero or negative acreage. Tillable acres greater than total acres is NOT counted here and is not a defect — the owner ruled on 2026-07-01 that it is legitimate and common.' },
      { l: 'On the market with no location',
        d: 'Currently for sale, with no latitude or longitude, so it cannot be placed on the map. Sold and withdrawn listings are counted separately underneath: there are thousands of those from old imports and they swamped the ones that matter. Bulk-import rows are excluded — they were never meant to appear.' },
      { l: 'Duplicate titles',
        d: 'The same auction scraped twice under differently-encoded URLs, so it shows up twice in the app.' },
    ],
    covers: 'Records that contradict themselves — the sort of thing a subscriber notices first.',
    source: 'listings and tracts.',
    caveat: 'Duplicates are matched on identical title, county and state; source URLs are unique, so a genuine duplicate only gets in through differently-encoded URLs for one page.',
  },
  reach: {
    lines: [
      { l: 'Created',
        d: 'Notifications the system decided to send in the last day. Everything below adds up to exactly this.' },
      { l: 'Sent',
        d: 'Reached the person\u2019s phone.' },
      { l: 'No device',
        d: 'They have never opened the app on a phone, so there is nothing to send to. Not a fault.' },
      { l: 'Notifications off',
        d: 'They turned notifications off. Not a fault — a choice.' },
      { l: 'Bad token',
        d: 'The stored push token is malformed, so it can never be delivered. This one is worth clearing.' },
      { l: 'Failed to send',
        d: 'The only genuine fault: a live device, notifications on, a valid token, and it still did not go. Click the row to see the reason Expo gave for each one.' },
    ],
    covers: 'Push notifications and email sent in the last day.',
    source: 'notifications, email_send_log and dunning_email_log.',
    caveat: 'A push not sending is usually not a fault: send_push_notification returns false when the user has no device, has notifications off, or has a malformed token, as well as when a send genuinely fails. Those four are counted separately and only the last is treated as a problem. The reasons are mutually exclusive and are checked against the day\u2019s total, so a miscount shows on the card rather than hiding.',
  },
}

function InfoPop({ id, title, onClose, panel }:
  { id: string; title: string; onClose: () => void; panel?: PanelState }) {
  const info = CARD_INFO[id]
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!info) return null
  return (
    <div className="popwrap" onClick={onClose}>
      <div className="pop" role="dialog" aria-modal="true" aria-label={`About ${title}`}
        onClick={e => e.stopPropagation()}>
      <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
      <h5>{title}</h5>
      <p>{info.covers}</p>
      {info.lines && (
        <dl>
          {info.lines.map(x => (
            <React.Fragment key={x.l}>
              <dt>{x.l}</dt><dd>{x.d}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <dl>
        <dt>From</dt><dd>{info.source}</dd>
        {panel?.refresh_seconds && (
          <>
            <dt>Updates</dt>
            <dd>
              every {panel.refresh_seconds < 60
                ? `${panel.refresh_seconds} seconds`
                : `${Math.round(panel.refresh_seconds / 60)} minutes`}
              {panel.at && ` · last ${ago(panel.at)} ago`}
            </dd>
          </>
        )}
        {info.caveat && <><dt>Careful</dt><dd className="warn">{info.caveat}</dd></>}
      </dl>
      </div>
    </div>
  )
}

/* ── Trends drawer ─────────────────────────────────────────────────────
   Opened from the chart button on a card. Shows that card's series over
   the last fortnight — the shape of the thing, not just today's value. */

const ChartIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 13V3M2 13h12" /><path d="M4.5 10.5l3-3.5 2.5 2 3.5-4.5" />
  </svg>
)

/** Line chart with a faint grid and an emphasised last point. */
function TrendChart({ points, unit }: { points: any[]; unit?: string }) {
  if (!points || points.length < 2) {
    return <div className="note" style={{ padding: '18px 0' }}>Not enough history yet.</div>
  }
  const W = 600, H = 120, PAD = 4
  const vals = points.map(p => p.v)
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0)
  const span = max - min || 1
  const x = (i: number) => (i / (points.length - 1)) * W
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <svg className="plot" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      role="img" aria-label={`${points.length} points, latest ${last.v}${unit || ''}`}
      style={{ width: '100%' }}>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--line)" strokeWidth="1"
          vectorEffect="non-scaling-stroke" />
      ))}
      <polyline points={`0,${H} ${line} ${W},${H}`} fill="var(--pink-bright)" opacity=".16" stroke="none" />
      <polyline points={line} fill="none" stroke="var(--pink)" strokeWidth="2"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last.v)} r="3" fill="var(--pink)"
        vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Every email we sent, and to whom.

    The card counted emails and never named a recipient, so "1 sent today"
    could not be checked against anything. Worse, the count itself was only a
    slice: until 2026-08-28 the only sends written down were the three
    campaign categories, while verification codes, password resets, firm
    invites and reports went out unrecorded. Both halves are fixed — this is
    the half you can read. */
function EmailDrawer({ open, onClose, email }:
  { open: boolean; onClose: () => void; email: any }) {
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const all: any[] = email?.recipients || []
  const needle = q.trim().toLowerCase()
  const rows = needle
    ? all.filter(r => [r.email, r.name, r.subject, r.category, r.kind]
        .some((v: any) => (v || '').toLowerCase().includes(needle)))
    : all

  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}
        aria-label="Email — who we sent it to">
        <div className="drawer-head">
          <h2>Email</h2>
          <span className="sub">
            {num(all.length)} in the last {num(email?.recipients_window_days ?? 30)} days
            {/* A silent cap reads as "that is everyone". */}
            {email?.recipients_total > all.length &&
              <span style={{ color: 'var(--amber)' }}>
                {' '}· showing the newest {num(all.length)} of {num(email.recipients_total)}
              </span>}
          </span>
          <button type="button" className="drawer-close" onClick={onClose}>Close ·  Esc</button>
        </div>
        <div className="fixdrawer-body">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Filter by person, address or subject"
            aria-label="Filter emails"
            style={{
              width: '100%', marginBottom: 12, padding: '7px 10px', fontSize: 12,
              borderRadius: 'var(--r)', border: '1px solid var(--line-2)',
              background: 'var(--card)', color: 'var(--ink)', fontFamily: 'inherit',
            }}
          />
          {rows.length === 0 ? (
            <p style={{ color: 'var(--faint)', fontSize: 12 }}>
              {all.length === 0
                ? 'Nothing recorded in this window.'
                : 'Nothing matches that.'}
            </p>
          ) : (
            <table className="mailtable">
              {/* Explicit widths, plus .mailtable to undo the cards' single
                  text-column rule — without both, "What" collapsed to "sub…"
                  and "aba…", which is the one column that says what was sent. */}
              <colgroup>
                <col style={{ width: '42%' }} />
                <col style={{ width: '43%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead>
                <tr><th>Who</th><th>What</th><th className="n">When</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="t">
                      {r.name || <span className="dim">no name</span>}
                      <div className="more" style={{ marginTop: 1 }}>{r.email}</div>
                    </td>
                    <td className="t" style={{ whiteSpace: 'normal' }}>
                      {r.subject || (r.kind || '').replace(/_/g, ' ')}
                      {/* A send we decided NOT to make is the more interesting
                          half, so it stays in the list and says why. */}
                      {!r.sent && (
                        <div className="more" style={{ color: 'var(--amber)', marginTop: 1 }}>
                          not sent — {r.skipped_reason}
                        </div>
                      )}
                    </td>
                    <td className="n dim" style={{ whiteSpace: 'nowrap' }}>
                      {r.sent_at ? `${ago(r.sent_at)} ago` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  )
}

function TrendsDrawer({ openFor, title, series, errors, onClose }:
  { openFor: string | null; title: string; series: any[]; errors?: string[]; onClose: () => void }) {
  const open = openFor !== null
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // DAY / WEEK / MONTH.
  // A nightly figure cannot show a trend: every night looks like every other
  // night until something has been drifting for a month. A series that
  // carries `points_week` and `points_month` gets the toggle; the rest are
  // daily-only and render exactly as they always did, with no toggle shown.
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day')
  const hasBuckets = (series || []).some((sr: any) => sr.points_week || sr.points_month)
  // Back to daily whenever a different card's drawer is opened, so the
  // granularity never carries over to a card that cannot honour it.
  useEffect(() => { setBucket('day') }, [openFor])

  const pointsFor = (sr: any) =>
    (bucket === 'week' ? sr.points_week : bucket === 'month' ? sr.points_month : sr.points)
    || sr.points || []

  // UTC, or the labels slip a bucket. The backend truncates in UTC, so
  // 2026-02-01T00:00:00Z formatted in America/Chicago is 31 January and the
  // month axis read "Jan 26 → Jul 26" for data that runs February to August.
  // The daily axis was off by one for the same reason and nobody noticed.
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US',
      bucket === 'month'
        ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
        : { month: 'short', day: 'numeric', timeZone: 'UTC' })

  const span = hasBuckets
    ? { day: 'last 60 days', week: 'last 26 weeks', month: 'last 12 months' }[bucket]
    : 'last 14 days'

  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}
        style={{ width: 'min(760px,74vw)', gridTemplateRows: 'auto minmax(0,1fr)' }}
        aria-label={`${title} over time`}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <span className="sub">{span}</span>
          {hasBuckets && (
            <div className="buckets" role="group" aria-label="Group by">
              {(['day', 'week', 'month'] as const).map(b => (
                <button key={b} type="button"
                  className={bucket === b ? 'on' : ''}
                  aria-pressed={bucket === b}
                  onClick={() => setBucket(b)}>{b}</button>
              ))}
            </div>
          )}
          <button type="button" className="drawer-close" onClick={onClose}>Close ·  Esc</button>
        </div>
        <div className="charts">
          {(series || []).length === 0
            ? <div className="note">
                {errors?.length
                  ? <>These graphs could not be built: {errors.join(', ')}. The rest
                     of the dashboard is unaffected — each graph is queried on its
                     own, so this is the only one missing.</>
                  : 'No history for this card yet.'}
              </div>
            : series.map((sr: any, i: number) => {
              const pts = pointsFor(sr)
              const cur = pts.length ? pts[pts.length - 1].v : null
              // A week looked at on a Wednesday holds three days. Drawn
              // beside finished weeks it is a cliff, and averaged in with
              // them it reads as a 10% collapse when nothing has happened.
              // The backend flags it; the number says "so far" and the
              // comparison is made between COMPLETE buckets only.
              const partial = pts.length ? pts[pts.length - 1].partial === true : false
              const done = partial ? pts.slice(0, -1) : pts
              const tail = done.slice(-3), prev = done.slice(-6, -3)
              const avg = (a: any[]) => a.length ? a.reduce((s, p) => s + p.v, 0) / a.length : null
              const now = avg(tail), was = avg(prev)
              const pct = (now !== null && was) ? ((now - was) / was) * 100 : null
              return (
                <div className="chartcard" key={i}>
                  <h4>{sr.label}</h4>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span className="cur">{cur === null ? '—' : num(cur, sr.unit === 'GB' ? 1 : 0)}</span>
                    {sr.unit && <span className="note">{sr.unit}</span>}
                    {partial && <span className="note">
                      this {bucket} so far</span>}
                    {pct !== null && Math.abs(pct) >= 1 && (
                      <span className={`delta ${pct > 0 ? 'up' : 'down'}`}>
                        {pct > 0 ? '▲' : '▼'} {num(Math.abs(pct), 0)}% vs the three {bucket === 'day' ? 'days' : bucket === 'week' ? 'weeks' : 'months'} before
                      </span>
                    )}
                  </div>
                  <TrendChart points={pts} unit={sr.unit} />
                  <div className="axis">
                    <span>{pts.length ? day(pts[0].t) : ''}</span>
                    <span>{pts.length ? day(pts[pts.length - 1].t) : ''}</span>
                  </div>
                </div>
              )
            })}
        </div>
      </aside>
    </>
  )
}


/** The Run button.

    A web page cannot execute anything on a laptop — nothing can, and any
    button claiming otherwise would be lying. What it can do is hand over a
    file that runs itself: macOS opens a .command in Terminal on
    double-click. The backend fills in this server's URL and the signed-in
    admin's email before sending it, so there is no path to get right and no
    token to find; it asks for the password on launch and stores nothing.

    Copy is kept alongside for anyone who would rather paste a line. */
/* Pairs with the Run button: a downloaded file arrives without the execute
   bit, so double-clicking it in Finder does not run it. This makes it
   executable and starts it, and works from any directory — the old copy
   command was a relative path that only worked inside the repo. */
const DOWNLOAD_CMD =
  'chmod +x ~/Downloads/groundgoat-agents.command && ~/Downloads/groundgoat-agents.command'

function RunReporter({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'working' | 'ready' | 'failed'>('idle')
  const [copied, setCopied] = useState(false)

  const download = async () => {
    setState('working')
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/agents/reporter-script`)
      if (!res.ok) throw new Error(String(res.status))
      const blob = new Blob([await res.text()], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'groundgoat-agents.command'
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke on the next tick — revoking synchronously can cancel the
      // download in some browsers before it has started reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setState('ready')
    } catch {
      setState('failed')
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(DOWNLOAD_CMD)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* clipboard blocked — the button simply does not confirm */ }
  }

  if (compact) {
    return (
      <button type="button" className="runbtn" onClick={download}
        disabled={state === 'working'} style={{ marginLeft: 'auto', padding: '5px 13px', fontSize: 11 }}
        title="Download a file you can double-click to start reporting">
        {state === 'working' ? 'Preparing…' : state === 'ready' ? 'Downloaded ✓' : 'Run on my laptop'}
      </button>
    )
  }
  return (
    <>
      <div className="runrow">
        <button type="button" className="runbtn" onClick={download}
          disabled={state === 'working'}>
          {state === 'working' ? 'Preparing…' : 'Run on my laptop'}
        </button>
        <button type="button" className="runbtn ghost" onClick={copy}>
          {copied ? 'Copied' : 'Copy command'}
        </button>
      </div>
      <p className="runnote" style={{ margin: '-4px 0 10px' }}>
        Download first, then paste this in Terminal — a downloaded file has no
        permission to run until you give it one:
        <br />
        <code style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>{DOWNLOAD_CMD}</code>
      </p>
      {state === 'ready' && (
        <p className="runnote" style={{ margin: '0 0 10px' }}>
          Downloaded <b>groundgoat-agents.command</b>. Paste the command above
          into Terminal to make it runnable and start it — it will ask for your
          Ground Goat password, then report every ten seconds.
        </p>
      )}
      {state === 'failed' && (
        <p className="runnote" style={{ margin: '0 0 10px', color: 'var(--red)' }}>
          Could not build the file. Use the copied command instead.
        </p>
      )}
    </>
  )
}

/* ── DEVELOPERS drawer ─────────────────────────────────────────────────
   The agent cards and detail pane from mission-control.html, fed by
   scripts/agent_reporter.py running on the machine where the agents run.
   Claude Code exposes no API a deployed page can poll, so the reporter
   pushes; without it this panel says so rather than looking broken. */

function AgentDrawer({ open, onClose, data, fixes }:
  { open: boolean; onClose: () => void; data: any; fixes?: any }) {
  /* Diagnose runs are agents too, and this is where you look for "what is
     running". They come from the backend rather than the reporter on the
     Mac, so they are reshaped to match and shown in the same list — the
     alternative was pressing Diagnose and finding an empty panel. */
  const fixAgents: any[] = (fixes?.runs || []).map((r: any) => ({
    session_id: r.id,
    status: r.status === 'done' ? 'idle' : r.status,
    model: r.model,
    repo: 'ground-goat-backend',
    branch: r.issue?.where || 'Command Center',
    started_at: r.started_at,
    last_active: r.updated_at || r.finished_at,
    log_file: 'Command Center · Diagnose',
    assignment: [r.issue?.title, r.issue?.detail].filter(Boolean).join(' — '),
    messages: (r.output || []).map((t: string) => ({ at: r.updated_at, text: t })),
    _diagnose: true,
  }))
  const agents: any[] = [...fixAgents, ...(data?.agents || [])]
  const [picked, setPicked] = useState<string | null>(null)

  // Default to the most recently active agent, and follow it as reports
  // arrive — but never yank the pane away from one being read.
  const current = agents.find(a => a.session_id === picked) || agents[0] || null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const busy = (a: any) => ['working', 'running', 'active'].includes((a.status || '').toLowerCase())

  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}
        aria-label="Developers — live agent activity">
        <div className="drawer-head">
          <h2>Developers</h2>
          <span className="sub">
            {data?.available === false && !fixAgents.length ? 'unavailable'
              : `${num((data?.working || 0) + (fixes?.working || 0))} working of ${num(agents.length)}`}
          </span>
          <RunReporter compact />
          <button type="button" className="drawer-close" onClick={onClose}>Close ·  Esc</button>
        </div>
        <div className="drawer-body">
          <div className="agent-list">
            {agents.length === 0 ? (
              <div className="drawer-empty" style={{ display: 'block', textAlign: 'left' }}>
                <p style={{ margin: '0 0 10px' }}>
                  Nothing has reported in the last 15 minutes.
                </p>
                <p style={{ margin: '0 0 10px' }}>
                  Claude Code keeps its transcripts on the machine it runs on, and
                  offers no API a website can read. So the machine has to push. On
                  your Mac, in the backend repo:
                </p>
                <RunReporter />
                <p style={{ margin: 0, fontSize: 11, color: 'var(--faint)' }}>
                  Leave it running. Every Claude Code session on that Mac appears
                  here within about ten seconds. Sessions running in Anthropic&rsquo;s
                  cloud cannot reach your backend, so they will not appear.
                </p>
              </div>
            ) : agents.map(a => {
              const last = (a.messages || [])[(a.messages || []).length - 1]
              return (
                <button type="button" key={a.session_id}
                  className={`agent-card ${busy(a) ? 'busy' : ''} ${current?.session_id === a.session_id ? 'on' : ''}`}
                  onClick={() => setPicked(a.session_id)}>
                  <div className="top">
                    <span className="nm">{a.name}</span>
                    <Chip tone={busy(a) ? 'green' : ''}>{busy(a) ? 'working' : (a.status || 'idle')}</Chip>
                    <span className="r num" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--faint)' }}>
                      {a.tokens ? `${num(a.tokens)} tok` : ''}
                    </span>
                  </div>
                  <div className="meta">
                    {[a.repo, a.branch, a.model, a.last_active && `${ago(a.last_active)} ago`]
                      .filter(Boolean).join(' · ')}
                  </div>
                  {last?.text && <div className="say">{last.text}</div>}
                </button>
              )
            })}
          </div>

          <div className="agent-detail">
            {!current ? (
              <div className="note">Pick an agent to see what it is doing.</div>
            ) : (
              <>
                <dl>
                  <dt>Status</dt><dd>{current.status}</dd>
                  <dt>Model</dt><dd>{current.model || '—'}</dd>
                  <dt>Repo</dt><dd>{[current.repo, current.branch].filter(Boolean).join(' · ') || '—'}</dd>
                  <dt>Session</dt><dd>{current.session_id}</dd>
                  <dt>Started</dt><dd>{current.started_at ? `${ago(current.started_at)} ago` : '—'}</dd>
                  <dt>Last active</dt><dd>{current.last_active ? `${ago(current.last_active)} ago` : '—'}</dd>
                  <dt>Tokens</dt><dd>{current.tokens ? num(current.tokens) : '—'}</dd>
                  <dt>Log file</dt><dd>{current.log_file || '—'}</dd>
                </dl>
                {current.assignment && (
                  <>
                    <h3>Assignment</h3>
                    <div className="assign">{current.assignment}</div>
                  </>
                )}
                <h3>Agent messages</h3>
                <div className="feed">
                  {(current.messages || []).length === 0
                    ? <div className="note">Nothing captured yet.</div>
                    : [...(current.messages || [])].reverse().map((m: any, i: number) => (
                      <div className="msg" key={i}>
                        <time>{m.at ? `${ago(m.at)} ago` : ''}</time>
                        {m.text}
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

/* ── Fix button ────────────────────────────────────────────────────────
   Hands one problem to a Claude Code agent running on Opus 5, through the
   backend. The agent reads, diagnoses and patches — it never deploys, never
   pushes and never merges, because every deploy is the owner's call.

   When the backend is not configured for it, the button says what is
   missing rather than failing when pressed. */

function CopyHandoff({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div style={{ margin: '0 0 12px' }}>
      <button type="button" className="fixbtn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setDone(true)
            setTimeout(() => setDone(false), 4000)
          } catch { /* clipboard blocked — the text is shown below anyway */ }
        }}>
        {done ? 'Copied — now paste it into Claude Code' : 'Copy the fix brief'}
      </button>
      <div className="fixnote">
        <strong>This is the next step.</strong> Paste it into Claude Code on your
        Mac and say “do this”. It carries the problem, the evidence and the exact
        change, so nothing has to be explained again. Nothing is fixed until you
        do — this panel only reads.
      </div>
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--faint)' }}>
          Show the brief
        </summary>
        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11,
          lineHeight: 1.45, color: 'var(--ink-2)', margin: '6px 0 0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>{text}</pre>
      </details>
    </div>
  )
}

/* ── Findings drawer ──────────────────────────────────────────────────
   Where the Diagnose button's answers actually land. Without this the
   agent would investigate into a void — the run would finish and nobody
   would ever read it. */

function FixDrawer({ open, onClose, data }: { open: boolean; onClose: () => void; data: any }) {
  const runs: any[] = data?.runs || []
  const [picked, setPicked] = useState<string | null>(null)
  const current = runs.find(r => r.id === picked) || runs[0] || null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const tone = (r: any) => r.status === 'done' ? 'var(--green)'
    : r.status === 'working' ? 'var(--amber)' : 'var(--red)'

  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}
        aria-label="Findings — what the agent worked out">
        <div className="drawer-head">
          <h2>Findings</h2>
          <span className="sub">
            {data?.ready === false ? 'not configured'
              : `${num(data?.working)} working of ${runs.length}`}
            {/* Whether the agent can read the app and website code, not just
                the backend. A crash diagnosed without the crashing code is a
                guess, so this needs to be visible rather than assumed. */}
            {data?.ready !== false && (
              data?.reads_mobile_and_website
                ? <span style={{ color: 'var(--green)' }}> · reads backend, app and website</span>
                : <span style={{ color: 'var(--amber)' }}> · backend code only — app crashes will be guesswork</span>
            )}
          </span>
          <button type="button" className="drawer-close" onClick={onClose}>Close ·  Esc</button>
        </div>
        <div className="fixdrawer-body">
          {runs.length === 0 ? (
            <div style={{ color: 'var(--ink)' }}>
              <p style={{ margin: '0 0 10px' }}>Nothing has been looked at yet.</p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--faint)' }}>
                Press Diagnose on any problem. Opus 5 reads the code and reports
                what is wrong and the change it would make. It cannot edit or deploy.
              </p>
            </div>
          ) : (
            <div style={{ color: 'var(--ink)' }}>
              {/* One row, at the top. Selecting a pill swaps the finding below
                  it — which is the whole point of having more than one. */}
              <div className="fixpills">
                {runs.map(r => (
                  <button key={r.id} type="button" onClick={() => setPicked(r.id)}
                    className="fixpill"
                    style={current?.id === r.id
                      ? { background: tone(r), borderColor: tone(r), color: '#fff' }
                      : { borderColor: tone(r) }}>
                    {(r.issue?.title || 'untitled').slice(0, 44)}
                  </button>
                ))}
              </div>

              {current && (
                <div style={{ color: 'var(--ink)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{current.issue?.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 10 }}>
                    {current.status}
                    {current.stage ? ` · ${current.stage}` : ''}
                    {current.model ? ` · ${current.model}` : ''}
                    {current.started_by ? ` · started by ${current.started_by}` : ''}
                    {/* HOW LONG, AND WHEN IT LAST MOVED. Without these a run
                        that is thinking and a run that has died look the same. */}
                    {current.started_at ? ` · running ${ago(current.started_at)}` : ''}
                    {current.status === 'working' && current.updated_at
                      ? ` · moved ${ago(current.updated_at)} ago` : ''}
                  </div>

                  {/* WHAT IT IS ACTUALLY DOING, IN ORDER.
                      These investigations run for minutes and the model
                      narrates once, at the start, then works in silence — so
                      this drawer showed one sentence and never changed again,
                      and there was no way to tell progress from a hang. The
                      prose is below; this is the trail. */}
                  {(current.steps || []).length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      {(current.steps || []).slice(-12).map((st: any, i: number) => (
                        <div key={i} style={{
                          display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.6,
                          color: 'var(--muted)',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        }}>
                          <span style={{ color: 'var(--faint)', flex: '0 0 auto' }}>
                            {st.round}/{st.of}
                          </span>
                          <span style={{ wordBreak: 'break-word' }}>{st.what}</span>
                        </div>
                      ))}
                      {current.status === 'working' && (
                        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                          still reading…
                        </div>
                      )}
                    </div>
                  )}
                  {current.error && (
                    <div style={{ color: 'var(--red)', marginBottom: 10 }}>{current.error}</div>
                  )}

                  {/* WHAT HAPPENED, AND WHAT DID NOT.
                      The owner pressed Diagnose, watched the panel, and could
                      not tell whether the crashes had been FIXED or merely
                      explained. This agent is read-only — it has no tool that
                      writes a file, commits, or deploys — so the honest answer
                      is that nothing changed, and the panel has to say so
                      before anything else, not leave it to be inferred from a
                      wall of code. */}
                  <div className={`fixverdict ${
                    current.status === 'working' ? 'working'
                      : current.status === 'done' ? 'done' : 'bad'}`}>
                    <h4>
                      {current.status === 'working' ? 'Still reading. Nothing has been changed.'
                        : current.status === 'done' ? 'Diagnosed. Nothing has been changed.'
                        : current.status === 'timed_out' ? 'Gave up. Nothing has been changed.'
                        : 'Failed. Nothing has been changed.'}
                    </h4>
                    <p>
                      {current.status === 'working'
                        ? 'It is reading the backend, app and website code. It cannot edit or deploy — when it finishes it hands you a brief to fix from.'
                        : current.status === 'done'
                          ? (current.handoff
                              ? 'Your app is still crashing. Copy the brief below into Claude Code on your Mac and it will make the change and ship it.'
                              : 'It finished without producing a brief. The notes below are all it has.')
                          : 'The app is still crashing. Press Diagnose again, or take the notes below to Claude Code.'}
                    </p>
                  </div>
                  {/* The agent here can only read and diagnose. The fixing
                      happens in Claude Code on the Mac, so the diagnosis
                      leaves as a brief that carries the evidence with it —
                      nothing has to be re-explained over there. */}
                  {current.handoff && <CopyHandoff text={current.handoff} />}
                  <pre style={{
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
                    fontSize: 12, lineHeight: 1.5, color: 'var(--ink)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}>
                    {(current.output || []).join('\n\n') ||
                      (current.status === 'working'
                        ? 'Reading the code — it reports what it finds when it has something to say.'
                        : '(nothing reported)')}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

function FixButton({ issue, fixes, compact }:
  { issue: any; fixes?: any; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'starting' | 'started' | 'failed'>('idle')
  const [why, setWhy] = useState<string>('')
  const ready = fixes?.ready !== false

  // Already working on this exact issue? Then say so instead of offering
  // to start a second agent on it.
  const running = (fixes?.runs || []).find(
    (r: any) => r.status === 'working' && r.issue?.title === issue.title)

  const start = async () => {
    setState('starting')
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/fix/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(issue),
      })
      if (res.ok) { setState('started'); return }
      const body = await res.json().catch(() => ({}))
      setWhy(body?.detail || `HTTP ${res.status}`)
      setState('failed')
    } catch (e) {
      setWhy('could not reach the backend')
      setState('failed')
    }
  }

  if (running) {
    return <span className="fixbtn" style={{ background: 'var(--amber)', borderColor: 'var(--amber)' }}>
      Agent working
    </span>
  }
  if (state === 'started') {
    return <span className="fixbtn" style={{ background: 'var(--green)', borderColor: 'var(--green)' }}>
      Agent started
    </span>
  }
  return (
    <>
      <button type="button" className="fixbtn" onClick={start}
        disabled={state === 'starting' || !ready}
        title={ready
          ? 'Opus 5 reads the code and reports what is wrong and the exact change to make. It cannot edit or deploy.'
          : (fixes?.missing || []).join('; ')}>
        {state === 'starting' ? 'Starting…' : 'Diagnose'}
      </button>
      {state === 'failed' && !compact && (
        <div className="fixnote" style={{ color: 'var(--red)' }}>{why}</div>
      )}
      {!ready && !compact && (
        <div className="fixnote">{(fixes?.missing || []).join('; ')}</div>
      )}
    </>
  )
}

/* ── Alert strip ──────────────────────────────────────────────────────
   The only part of this page that has to work when nobody is looking at
   it. Reds sort first; the verdict block on the left carries the totals
   so nothing is hidden by the strip scrolling sideways. */

/* PROBLEMS ARE A CARD NOW, NOT A BANNER.
   They used to run across the top as a horizontal strip of boxes, which ate
   the height every other card needed and pushed the Diagnose buttons off
   the right-hand edge as soon as there were more than four. As a card they
   scroll vertically in their own box, every Diagnose button is reachable,
   and the rest of the board keeps its room. */
function Problems({ alerts, fixes, onOpenFindings }:
  { alerts: Alert[]; fixes?: any; onOpenFindings?: () => void }) {
  const reds = alerts.filter(a => a.level === 'red').length
  const ambers = alerts.filter(a => a.level === 'amber').length

  if (alerts.length === 0) {
    return (
      <div className="allgood">
        <b>Nothing is broken.</b>
        <span>Every check passed.</span>
      </div>
    )
  }

  return (
    <div className="problems">
      <div className={`verdict ${reds ? '' : ambers ? 'warn' : 'clear'}`}>
        <span className="big">
          {reds ? `${reds} problem${reds === 1 ? '' : 's'}` : `${ambers} to look at`}
        </span>
        <span className="small">
          {reds ? (ambers ? `and ${ambers} more to look at` : 'needing you now')
            : 'nothing urgent'}
        </span>
      </div>

      {alerts.map(a => (
        <article className={`alert ${a.level}`} key={a.key}>
          <div className="where">{a.where}</div>
          <div className="title">{a.title}</div>
          <div className="detail">{a.detail}</div>
          {a.level === 'info'
            ? <button type="button" className="fixbtn" onClick={onOpenFindings}>Read it</button>
            : <div className="alert-actions">
                <FixButton compact issue={{ key: a.key, title: a.title, detail: a.detail,
                  where: a.where }} fixes={fixes} />
              </div>}
        </article>
      ))}
    </div>
  )
}

/* ── The screen ───────────────────────────────────────────────────────
   Twelve columns, three rows. Panel order is by "would this wake him at
   2am": failures first, money second, everything else after. */

/* ── The map ──────────────────────────────────────────────────────────
   Three layers, three different kinds of truth, and the card says which
   is which:

     Selling / Upcoming   one dot per TRACT, at that tract's own recorded
                          coordinate. Never an average of several tracts —
                          a sale of four parcels forty miles apart would
                          otherwise pin itself in a field nobody is selling.

     Sold                 the same, for ground that has already changed
                          hands in the last year. Capped, and the legend
                          says so when the cap bites.

     Our people           NOT a location. We do not record a device
                          position and we do not geolocate anyone's IP.
                          This is a count per state, drawn at the state's
                          centre, and it is labelled that way on screen so
                          it can never be read as "where our users are".

   The pins arrive from their own endpoint rather than the snapshot,
   because a quarter of a megabyte of coordinates has no business riding
   on a blob that is re-pushed every fifteen seconds. */

const BASEMAP_DARK =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const BASEMAP_AERIAL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
/* State lines and place names, drawn over the imagery. Esri's own reference
   layer — the same one the boundary editor uses — so it lines up with the
   aerial tiles exactly. */
const REF_BOUNDARIES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
/* COUNTY LINES COME FROM THE CENSUS, NOT FROM ESRI.
   Esri's reference layer stops at states. Counties are the unit this
   business actually works in — every listing is filed by county — so they
   come from TIGERweb, the Census Bureau's own boundary service, as a
   transparent overlay rendered per tile. */
const REF_COUNTIES =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/export' +
  '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512' +
  '&format=png32&transparent=true&dpi=96&f=image'
const BASEMAP_ATTRIBUTION = '© Esri · county lines © US Census TIGERweb'

// The lower 48, with room to breathe. Alaska and Hawaii have no farmland
// listings and dragging the view out to hold them would shrink the corn
// belt to a smudge.
const US_BOUNDS: [[number, number], [number, number]] = [[-125.5, 24.0], [-66.5, 49.8]]

type MapPoints = {
  available?: boolean
  auctions?: any[]
  sold?: any[]
  people?: any[]
  live_count?: number
  upcoming_count?: number
  live_pins?: number
  upcoming_pins?: number
  sold_shown?: number
  sold_total?: number
  sold_truncated?: boolean
  /** People who made a request in the last five minutes, by home state. */
  online_now?: number
  people_basis?: string
  generated_at?: string
  reason?: string
}

function useMapPoints(active: boolean) {
  const [data, setData] = useState<MapPoints | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let stop = false
    const load = async () => {
      try {
        const r = await fetchWithAuth(`${API_URL}/api/admin/command-center/map`)
        if (!r.ok) throw new Error(`the map endpoint answered ${r.status}`)
        const j = await r.json()
        if (!stop) { setData(j); setError(null) }
      } catch (e: any) {
        if (!stop) setError(e?.message || 'could not load the pins')
      }
    }
    load()
    // The pins are cached for a minute on the server; asking more often
    // than that would buy nothing.
    const t = setInterval(load, 60000)
    return () => { stop = true; clearInterval(t) }
  }, [active])

  return { data, error }
}

function LiveMap({ points }: { points: MapPoints | null }) {
  const wrap = useRef<HTMLDivElement | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const map = useRef<any>(null)
  const [ready, setReady] = useState(false)
  /* Aerial by default: the owner's call. Ground is the subject of
     this business and a plain map of it is an abstraction. */
  const [aerial, setAerial] = useState(true)
  const [labels, setLabels] = useState(true)
  const [show, setShow] = useState({ upcoming: true, live: true, sold: false, people: true })
  const [picked, setPicked] = useState<any>(null)

  /* Build the map once.

     THE LOAD HANDLER MUST NOT RESURRECT A REMOVED MAP.
     React runs effects twice in development. The first map was created,
     torn down by the cleanup, and then its own `load` callback fired a
     moment later and wrote that dead instance back into map.current — so
     every layer, source and camera call afterwards went to a map with no
     style attached and the canvas painted nothing at all, silently. The
     `alive` flag is what stops a callback from a previous run touching
     anything, and map.current is set once, here, never from a callback. */
  useEffect(() => {
    const container = box.current
    if (!container) return
    let alive = true

    const m = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          base: { type: 'raster', tiles: [BASEMAP_DARK], tileSize: 256, attribution: BASEMAP_ATTRIBUTION },
          aerial: { type: 'raster', tiles: [BASEMAP_AERIAL], tileSize: 256, attribution: BASEMAP_ATTRIBUTION },
          /* COUNTIES ONLY WHEN THEY MEAN SOMETHING.
             Every county line in the country at national zoom is a grey
             haze, and the Census service was also holding the map's `load`
             event open at those zooms — the style never finished, so no
             pins and no markers ever appeared, silently. minzoom 6 is about
             the point a county fills a useful part of the card. */
          counties: { type: 'raster', tiles: [REF_COUNTIES], tileSize: 512, minzoom: 6 },
          boundaries: { type: 'raster', tiles: [REF_BOUNDARIES], tileSize: 256 },
        },
        layers: [
          { id: 'base', type: 'raster', source: 'base', layout: { visibility: 'none' } },
          /* THE IMAGERY IS KNOCKED BACK BY ITS OWN OPACITY.
             Green pins on green farmland is the whole problem with drawing
             data over an aerial — the sales vanished into the crop — so the
             photograph has to sit back while the pins do not. Three other
             ways were tried and each failed: a background layer covered the
             imagery entirely, raster-brightness/saturation left the map
             black, and a CSS filter on the canvas dimmed the pins too,
             because they are drawn on the same canvas. Opacity against the
             dark card behind it dims the photograph and nothing else. */
          { id: 'aerial', type: 'raster', source: 'aerial',
            paint: { 'raster-opacity': 0.62 } },
          // County fills under the state lines and labels, dimmed so they
          // read as a grid rather than competing with the pins.
          { id: 'counties', type: 'raster', source: 'counties', minzoom: 6,
            paint: { 'raster-opacity': 0.5 } },
          { id: 'boundaries', type: 'raster', source: 'boundaries',
            paint: { 'raster-opacity': 0.85 } },
        ],
      },
      bounds: US_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: false,
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    /* NOTHING TOUCHES THE MAP UNTIL ITS STYLE IS UP.
       A ResizeObserver fires once the moment it starts observing, which is
       before `load`. Calling resize() into a style that is still being
       built left maplibre throwing "There is no tile manager with ID
       'base'" and abandoning the style — getStyle() came back undefined on
       a live map, the basemap never drew, and there was no error on screen
       to say why. Everything below waits for this flag. */
    /* READY MEANS THE STYLE IS UP — AND `load` IS NOT A RELIABLE WAY TO
       HEAR THAT. It waits on the first frame's tiles as well, so one slow
       or unhappy raster source (the Census county service, say) can leave
       it un-fired for ever: the map sat there with imagery drawn, no pins,
       no markers and nothing in the console. `styledata` fires whenever the
       style changes and isStyleLoaded() answers the actual question, so
       both are checked, and the style may already be up by the time this
       runs. */
    let styled = false
    const onStyled = () => {
      if (!alive || styled || !m.isStyleLoaded()) return
      styled = true
      m.resize()
      m.fitBounds(US_BOUNDS, { padding: 24, animate: false })
      setReady(true)
    }
    m.on('load', onStyled)
    m.on('styledata', onStyled)
    if (m.isStyleLoaded()) onStyled()

    /* WATCH THE WRAPPER, NOT THE MAP'S OWN CONTAINER.
       MapLibre resizes the element it was given, so observing that element
       and calling resize() from the callback feeds itself. The wrapper's
       size is decided by the card, not by the map. */
    const ro = new ResizeObserver(() => {
      if (alive && styled) m.resize()
    })
    if (wrap.current) ro.observe(wrap.current)

    return () => {
      alive = false
      ro.disconnect()
      m.remove()
      map.current = null
      setReady(false)
    }
  }, [])

  // Basemap and reference toggles.
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const vis = (id: string, on: boolean) =>
      m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    vis('aerial', aerial)
    vis('base', !aerial)
    vis('counties', labels)
    vis('boundaries', labels)
  }, [aerial, labels, ready])

  /* Feed the layers. Sources are created on first data and updated in
     place afterwards, so panning never flickers. */
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !points) return

    const fc = (features: any[]) => ({ type: 'FeatureCollection', features })
    const pt = (lng: number, lat: number, props: any) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props,
    })

    const auctions = points.auctions || []
    const sets: Record<string, any> = {
      cc_sold: fc((points.sold || []).map(s => pt(s.lng, s.lat, { ppa: s.ppa ?? null }))),
      cc_upcoming: fc(auctions.filter(a => a.phase === 'upcoming').map(a =>
        pt(a.lng, a.lat, { ...a, kind: 'upcoming' }))),
      cc_live: fc(auctions.filter(a => a.phase === 'live').map(a =>
        pt(a.lng, a.lat, { ...a, kind: 'live' }))),
    }

    for (const [id, data] of Object.entries(sets)) {
      const existing = m.getSource(id)
      if (existing) { existing.setData(data as any); continue }
      m.addSource(id, { type: 'geojson', data } as any)
    }

    if (!m.getLayer('cc_sold_dots')) {
      m.addLayer({
        id: 'cc_sold_dots', type: 'circle', source: 'cc_sold',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 8, 4],
          'circle-color': '#64748b', 'circle-opacity': 0.55,
        },
      })
      m.addLayer({
        id: 'cc_upcoming_glow', type: 'circle', source: 'cc_upcoming',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            3, ['interpolate', ['linear'], ['coalesce', ['get', 'acres'], 40], 10, 6, 400, 13],
            9, ['interpolate', ['linear'], ['coalesce', ['get', 'acres'], 40], 10, 12, 400, 32]],
          'circle-color': '#22c55e', 'circle-opacity': 0.16, 'circle-blur': 0.7,
        },
      })
      m.addLayer({
        id: 'cc_upcoming_dots', type: 'circle', source: 'cc_upcoming',
        paint: {
          // Sized by acreage, because a 600-acre sale and a 12-acre one
          // are not the same event.
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            3, ['interpolate', ['linear'], ['coalesce', ['get', 'acres'], 40], 10, 3, 400, 7],
            9, ['interpolate', ['linear'], ['coalesce', ['get', 'acres'], 40], 10, 6, 400, 18]],
          'circle-color': '#4ade80', 'circle-opacity': 0.92,
          'circle-stroke-width': 1.2, 'circle-stroke-color': 'rgba(4,12,20,.9)',
        },
      })
      // Two rings behind each sale happening today, driven by the frame
      // loop below. A sale in progress should catch the eye from across
      // the room; a static dot does not.
      m.addLayer({
        id: 'cc_live_pulse2', type: 'circle', source: 'cc_live',
        paint: { 'circle-radius': 14, 'circle-color': '#fbbf24', 'circle-opacity': 0.1 },
      })
      m.addLayer({
        id: 'cc_live_pulse1', type: 'circle', source: 'cc_live',
        paint: {
          'circle-radius': 10, 'circle-color': '#fbbf24', 'circle-opacity': 0.2,
          'circle-stroke-width': 1, 'circle-stroke-color': '#fde68a',
          'circle-stroke-opacity': 0.35,
        },
      })
      m.addLayer({
        id: 'cc_live_dots', type: 'circle', source: 'cc_live',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 9, 12],
          'circle-color': '#fbbf24', 'circle-opacity': 0.95,
          'circle-stroke-width': 1.5, 'circle-stroke-color': '#111827',
        },
      })

      /* FRAME ON THE PINS, ONCE.
         A fixed lower-48 rectangle fit to whichever axis the panel is
         longer in, so a tall map padded the extra height with Canada and
         Venezuela and left the corn belt small in the middle. The sales
         themselves are the subject; fit to those. */
      const lngs: number[] = [], lats: number[] = []
      for (const a of auctions) { lngs.push(a.lng); lats.push(a.lat) }
      if (lngs.length >= 2) {
        m.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 48, animate: false, maxZoom: 7 })
      }

      for (const id of ['cc_upcoming_dots', 'cc_live_dots']) {
        m.on('click', id, (e: any) => {
          const f = e.features?.[0]
          if (f) setPicked({ ...f.properties, lng: e.lngLat.lng, lat: e.lngLat.lat })
        })
        m.on('mouseenter', id, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', id, () => { m.getCanvas().style.cursor = '' })
      }
    }
  }, [points, ready])


  /* PEOPLE ARE HTML MARKERS, NOT A GL SYMBOL LAYER.
     A symbol layer with text needs a glyph server, and this style has no
     `glyphs` URL — the labels would simply never draw, silently. There are
     only ever fifty of these at most, so a div each is cheaper than taking
     on a font dependency to render two digits. */
  const markers = useRef<any[]>([])
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    for (const mk of markers.current) mk.remove()
    markers.current = []
    if (!show.people) return
    for (const p of (points?.people || [])) {
      const el = document.createElement('button')
      el.type = 'button'
      // A state with somebody on the product THIS MINUTE pulses; the rest
      // sit still. That difference is the whole point of the layer.
      el.className = `peoplepin${p.online_now ? ' live' : ''}`
      el.textContent = String(p.people)
      el.title = p.online_now
        ? `${p.state}: ${p.online_now} on right now, of ${p.people}`
        : `${p.state}: ${p.people} ${p.people === 1 ? 'person' : 'people'}`
      // Scaled by headcount, floored so a single person is still clickable.
      const size = Math.max(24, Math.min(52, 20 + Math.sqrt(p.people) * 6))
      el.style.width = `${size}px`
      el.style.height = `${size}px`
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        setPicked({ ...p, kind: 'people' })
      })
      markers.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m))
    }
    return () => { for (const mk of markers.current) mk.remove(); markers.current = [] }
  }, [points, ready, show.people])

  // Layer switches.
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !m.getLayer('cc_sold_dots')) return
    const vis = (layer: string, on: boolean) =>
      m.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none')
    vis('cc_sold_dots', show.sold)
    vis('cc_upcoming_dots', show.upcoming)
    vis('cc_upcoming_glow', show.upcoming)
    vis('cc_live_dots', show.live)
    vis('cc_live_pulse1', show.live)
    vis('cc_live_pulse2', show.live)
  }, [show, ready])

  /* THE PULSE.
     Two rings expanding out of each live sale, half a cycle apart, fading
     as they grow. Driven by requestAnimationFrame rather than CSS because
     these are GL circles on a map that pans and zooms — a CSS animation
     would be pinned to the screen, not to the ground.

     The loop stops when the tab is hidden and when the live layer is
     switched off, so an idle dashboard is not spinning a frame loop all
     day for something nobody is looking at. */
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !show.live) return
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let stopped = false
    const CYCLE = 2200

    const frame = (t: number) => {
      if (stopped) return
      if (!document.hidden && m.getLayer('cc_live_pulse1')) {
        for (const [id, offset] of [['cc_live_pulse1', 0], ['cc_live_pulse2', 0.5]] as const) {
          const phase = (((t % CYCLE) / CYCLE) + offset) % 1
          m.setPaintProperty(id, 'circle-radius', 7 + phase * 30)
          // Fades as it grows, so the ring reads as leaving the dot.
          m.setPaintProperty(id, 'circle-opacity', 0.34 * (1 - phase))
          m.setPaintProperty(id, 'circle-stroke-opacity', 0.5 * (1 - phase))
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { stopped = true; cancelAnimationFrame(raf) }
  }, [ready, show.live, points])

  const toggle = (k: keyof typeof show) => () => setShow(s => ({ ...s, [k]: !s[k] }))

  return (
    <div className="mapwrap" ref={wrap}>
      <div ref={box} className="mapbox" />

      <div className="maplegend">
        <button type="button" className={`lg ${show.live ? 'on' : ''}`} onClick={toggle('live')}>
          <i style={{ background: '#fbbf24' }} />
          Selling today <b>{points?.live_count ?? '—'}</b>
        </button>
        <button type="button" className={`lg ${show.upcoming ? 'on' : ''}`} onClick={toggle('upcoming')}>
          <i style={{ background: '#22c55e' }} />
          Upcoming <b>{points?.upcoming_count ?? '—'}</b>
        </button>
        <button type="button" className={`lg ${show.sold ? 'on' : ''}`} onClick={toggle('sold')}>
          <i style={{ background: '#64748b' }} />
          Sold, past year <b>{points?.sold_shown ?? '—'}</b>
        </button>
        <button type="button" className={`lg ${show.people ? 'on' : ''}`} onClick={toggle('people')}>
          <i style={{ background: '#38bdf8' }} />
          Our people <b>{(points?.people || []).reduce((n, p: any) => n + (p.people || 0), 0) || '—'}</b>
        </button>
        {!!points?.online_now && (
          <span className="lg onair">
            <i className="beacon" />
            On right now <b>{num(points.online_now)}</b>
          </span>
        )}
        <div className="lgswitches">
          <button type="button" className="lg base" onClick={() => setAerial(a => !a)}>
            {aerial ? 'Plain map' : 'Aerial'}
          </button>
          <button type="button" className={`lg base ${labels ? 'on' : ''}`}
            onClick={() => setLabels(v => !v)}>
            {labels ? 'Hide lines' : 'State & county lines'}
          </button>
        </div>
      </div>

      {points?.sold_truncated && show.sold && (
        <div className="mapnote">
          Showing the {num(points.sold_shown)} most recent of {num(points.sold_total)} sales.
        </div>
      )}

      {picked && (
        <div className="mappop">
          <button type="button" className="x" onClick={() => setPicked(null)} aria-label="Close">×</button>
          {picked.kind === 'people' ? (
            <>
              <h4>{picked.state}</h4>
              <div className="pk">{num(picked.people)} {picked.people === 1 ? 'person' : 'people'}</div>
              {picked.online_now > 0 && (
                <Row label="On right now" value={<span className="live-now">{num(picked.online_now)}</span>} />
              )}
              <Row label="Active this week" value={num(picked.active_7d)} />
              <Row label="Active today" value={num(picked.active_24h)} />
              {/* Said on every single popup, not once in a footnote. */}
              <p className="basis">This is the state they entered at signup — not where their device is.</p>
            </>
          ) : (
            <>
              <h4>{picked.title || 'Untitled sale'}</h4>
              <div className="pk">
                {[picked.county && `${picked.county} County`, picked.state].filter(Boolean).join(', ')}
              </div>
              <Row label="Sells" value={picked.at ? new Date(picked.at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'} />
              {picked.acres != null && <Row label="Acres" value={num(picked.acres, 1)} />}
              {picked.tillable_acres != null &&
                <Row label="Tillable acres" value={num(picked.tillable_acres, 1)} />}
              {picked.soil_rating != null &&
                <Row label="Soil rating" value={num(picked.soil_rating, 1)} />}
              <Row label="Coordinates"
                value={<span className="mono">{Number(picked.lat).toFixed(5)}, {Number(picked.lng).toFixed(5)}</span>} />
              {picked.url && <a className="popl" href={picked.url} target="_blank" rel="noreferrer">Open the sale ↗</a>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MapSummary({ d, points }: { d: any; points: MapPoints | null }) {
  if (!d) return <Unavailable why="no reading yet" />
  return (
    <div className="mapsum">
      <div className="kpirow">
        <Kpi v={num(d.today)} k="selling today" tone={d.today ? 'amber' : ''} />
        <Kpi v={num(d.next_7)} k="in the next 7 days" />
        <Kpi v={num(d.next_30)} k="in the next 30 days" />
        <Kpi v={num(d.states)} k="states with a sale coming" />
      </div>
      {d.upcoming_without_a_location > 0 && (
        <Row label="Upcoming sales with no location"
          value={num(d.upcoming_without_a_location)} tone="amber" />
      )}
      <div className="statebars">
        {(d.auctions_by_state || []).slice(0, 8).map((s: any) => {
          const top = d.auctions_by_state[0]?.n || 1
          return (
            <div className="sb" key={s.state}>
              <span className="l">{s.state}</span>
              <span className="bar"><i style={{ width: `${Math.max(4, s.n / top * 100)}%` }} /></span>
              <span className="n">{num(s.n)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── AWS ──────────────────────────────────────────────────────────────
   Two halves on two different clocks, and the card says so: spend is a
   paid API read every six hours, health is CloudWatch every five minutes.
   Neither can blank the other. */

function AwsSpend({ d }: { d: any }) {
  const s = d?.spend
  if (!s) return <Unavailable why="no reading yet" />
  if (!s.available) return <Unavailable why={s.reason} />

  const over = s.projected_month != null && s.last_month != null && s.projected_month > s.last_month
  const peak = Math.max(...(s.daily || []).map((x: any) => x.amount), 0.01)

  return (
    <div className="aws">
      <div className="kpirow">
        <Kpi v={money(s.month_to_date)} k={`spent in ${s.this_month_label} so far`} />
        <Kpi v={money(s.projected_month)} k="on track for the full month"
          tone={over ? 'amber' : ''} />
        <Kpi v={money(s.last_month)} k={`all of ${s.last_month_label}`} />
        <Kpi v={moneyFine(s.yesterday)} k="yesterday" />
      </div>

      <div className="daily" aria-hidden="true">
        {(s.daily || []).map((x: any) => (
          <span key={x.day} className={`d ${x.partial ? 'partial' : ''}`}
            style={{ height: `${Math.max(3, x.amount / peak * 100)}%` }}
            title={`${x.day} — $${x.amount.toFixed(2)}${x.partial ? ' (today, still running)' : ''}`} />
        ))}
      </div>
      <div className="dailyfoot">
        <span>{(s.daily || [])[0]?.day}</span>
        <span className="dim">a day at a time · today is still counting</span>
        <span>today</span>
      </div>

      <table className="tbl">
        <thead><tr><th>Service</th><th className="n">{s.this_month_label}</th><th className="n">{s.last_month_label}</th></tr></thead>
        <tbody>
          {(s.services || []).slice(0, 8).map((x: any) => (
            <tr key={x.service}>
              <td>{x.label}</td>
              <td className="n">{moneyFine(x.mtd)}</td>
              <td className="n dim">{moneyFine(x.last_month)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="foot">
        Read from AWS every {s.refresh_hours} hours. Cost Explorer charges a cent a
        call, so watching this costs about {moneyFine(s.monitoring_cost_per_month)} a month.
        {s.stale_reason ? ` Last refresh failed: ${s.stale_reason}` : ''}
      </p>
    </div>
  )
}

function AwsHealth({ d }: { d: any }) {
  const h = d?.health
  if (!h) return <Unavailable why="no reading yet" />
  if (!h.available) return <Unavailable why={h.reason} />

  const barTone = (pct: number | null) =>
    pct == null ? '' : pct >= 85 ? 'red' : pct >= 60 ? 'amber' : ''

  return (
    <div className="health">
      {(h.load_balancers || []).map((lb: any) => (
        <div className="lb" key={lb.name}>
          <div className="kpirow">
            <Kpi v={num(lb.requests_per_min, 0)} k="requests a minute" />
            <Kpi v={lb.response_ms == null ? '—' : `${num(lb.response_ms, 0)} ms`} k="typical response"
              tone={(lb.response_ms || 0) > 800 ? 'amber' : ''} />
            <Kpi v={num(lb.errors_3h)} k="server errors, 3 hours"
              tone={lb.errors_3h ? 'red' : ''} />
          </div>
        </div>
      ))}

      <h5>Databases</h5>
      {(h.databases || []).map((db: any) => (
        <div className="mrow" key={db.id}>
          <div className="mtop">
            <span className="l">{db.id}{db.is_replica ? <em> · read copy</em> : null}</span>
            <span className="r">{db.class} · {num(db.connections, 0)} connections</span>
          </div>
          <div className="mbars">
            <Meter label="CPU" pct={db.cpu_pct} tone={barTone(db.cpu_pct)} />
            <Meter label="Disk" pct={db.pct_of_storage}
              note={`${num(db.used_gb, 0)} of ${num(db.storage_gb, 0)} GB`}
              tone={barTone(db.pct_of_storage)} />
          </div>
          <div className="mfoot dim">
            reads {db.read_ms == null ? '—' : `${num(db.read_ms, 1)} ms`} ·
            writes {db.write_ms == null ? '—' : `${num(db.write_ms, 1)} ms`} ·
            {' '}{num(db.freeable_memory_gb, 1)} GB memory free
          </div>
        </div>
      ))}

      <h5>Servers</h5>
      {(h.servers || []).map((s: any) => (
        <div className="mrow" key={s.id}>
          <div className="mtop">
            <span className="l">{s.name}</span>
            <span className="r">{s.type} · {s.az}</span>
          </div>
          <div className="mbars">
            <Meter label="CPU" pct={s.cpu_pct} tone={barTone(s.cpu_pct)}
              note={s.cpu_peak_3h != null ? `peaked ${num(s.cpu_peak_3h, 0)}%` : undefined} />
          </div>
        </div>
      ))}

      {(h.buckets || []).length > 0 && (
        <>
          <h5>S3</h5>
          {(h.buckets || []).map((b: any) => (
            <Row key={b.name} label={b.name}
              value={b.size_gb == null ? <span className="dim">not measured</span>
                : <>{num(b.size_gb, 1)} GB<span className="dim"> · {num(b.objects)} files</span></>} />
          ))}
        </>
      )}

      <p className="foot">
        Machine readings refresh every five minutes; S3 sizes are AWS&rsquo;s own daily
        figure. {h.stale_reason ? `Last refresh failed: ${h.stale_reason}` : ''}
      </p>
    </div>
  )
}

function Meter({ label, pct, note, tone = '' }:
  { label: string; pct: number | null | undefined; note?: string; tone?: Tone }) {
  return (
    <div className="meter">
      <span className="ml">{label}</span>
      <span className="mb">
        <i className={tone} style={{ width: `${Math.max(1, Math.min(100, pct ?? 0))}%` }} />
      </span>
      <span className={`mv ${tone}`}>{pct == null ? '—' : `${num(pct, 0)}%`}</span>
      {note && <span className="mn dim">{note}</span>}
    </div>
  )
}

/* ── Railway ──────────────────────────────────────────────────────────
   Kept on the board on purpose after the move to AWS. DNS points at AWS
   and customers reach AWS, but the Railway project was never torn down —
   so this card exists to answer one question: is anything still running
   over there, and therefore still being billed for. */

function RailwayCard({ d }: { d: any }) {
  if (!d) return <Unavailable why="no reading yet" />
  const spend = d.spend || {}
  const hosts = d.hosts || []

  return (
    <div className="railway">
      <div className="kpirow">
        <Kpi v={num(d.still_running)} k={`of ${num(d.checked)} old services still answering`}
          tone={d.still_running ? 'amber' : ''} />
        <Kpi v={spend.available ? moneyFine(spend.this_period) : '—'}
          k={spend.available ? 'billed this period' : 'spend not connected'} />
      </div>

      {d.duplicate_of_aws ? (
        <p className="warn">
          Everything customer-facing moved to AWS, but these are still deployed and
          still answering. Railway bills for a running service whether or not anyone
          is pointed at it.
        </p>
      ) : (
        <p className="good">Nothing is answering on Railway any more.</p>
      )}

      <table className="tbl">
        <tbody>
          {hosts.map((h: any) => (
            <tr key={h.url}>
              <td className="mono trunc">{h.url.replace(/^https:\/\//, '')}</td>
              <td className="n">
                {h.alive
                  ? <Chip tone="amber">answering</Chip>
                  : <Chip tone="green">{h.status ? `gone (${h.status})` : 'gone'}</Chip>}
              </td>
              <td className="n dim">{h.ms == null ? '' : `${h.ms} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {!spend.available && (
        <p className="foot">
          To show what Railway is charging, this needs a Railway API token in
          RAILWAY_API_TOKEN and the project id in RAILWAY_PROJECT_ID. Until then the
          card reports only what it can prove by asking the old hosts directly.
        </p>
      )}
    </div>
  )
}

/* The Overview's small AWS card. Deliberately four numbers and a
   sparkline — the full breakdown lives in its own section. */
function AwsSpendMini({ d }: { d: any }) {
  const s = d?.spend
  if (!s) return <Unavailable why="no reading yet" />
  if (!s.available) return <Unavailable why={s.reason} />
  const peak = Math.max(...(s.daily || []).map((x: any) => x.amount), 0.01)
  const up = s.projected_month != null && s.last_month != null && s.projected_month > s.last_month
  return (
    <div className="awsmini">
      <div className="big">{money(s.month_to_date)}</div>
      <div className="cap">spent so far in {s.this_month_label}</div>
      <div className="proj">
        <span className={up ? 'amber' : 'green'}>
          {up ? '▲' : '▼'} {money(s.projected_month)}
        </span>
        <span className="dim"> on track for the month · {money(s.last_month)} in {s.last_month_label}</span>
      </div>
      <div className="daily small" aria-hidden="true">
        {(s.daily || []).slice(-30).map((x: any) => (
          <span key={x.day} className={`d ${x.partial ? 'partial' : ''}`}
            style={{ height: `${Math.max(3, x.amount / peak * 100)}%` }} />
        ))}
      </div>
      <table className="tbl tight">
        <tbody>
          {(s.services || []).slice(0, 4).map((x: any) => (
            <tr key={x.service}><td>{x.label}</td><td className="n">{moneyFine(x.mtd)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* WHERE OUR PEOPLE SAY THEY ARE.
   The heading and the footnote both say "home state", every time, because
   this is the one number on the board somebody could mistake for a live
   location and it is nothing of the kind. */
function PeopleByState({ d }: { d: any }) {
  if (!d) return <Unavailable why="no reading yet" />
  const rows = d.people_by_state || []
  const top = rows[0]?.people || 1
  const total = rows.reduce((n: number, r: any) => n + r.people, 0)
  return (
    <div className="bystate">
      <div className="kpirow">
        <Kpi v={num(total)} k="customers with a home state on file" />
        <Kpi v={num(rows.reduce((n: number, r: any) => n + r.active_7d, 0))} k="of them active this week" />
        <Kpi v={num(d.people_without_a_state)} k="never told us a state"
          tone={d.people_without_a_state ? 'amber' : ''} />
      </div>
      <div className="statebars">
        {rows.slice(0, 12).map((r: any) => (
          <div className="sb" key={r.state}>
            <span className="l">{r.state}</span>
            <span className="bar">
              <i style={{ width: `${Math.max(4, r.people / top * 100)}%` }} />
              <u style={{ width: `${Math.max(0, r.active_7d / top * 100)}%` }} />
            </span>
            <span className="n">{num(r.people)}<em>{r.active_7d ? ` · ${num(r.active_7d)} active` : ''}</em></span>
          </div>
        ))}
      </div>
      <p className="foot">
        {d.people_location_basis
          ? `Based on ${d.people_location_basis}. We do not record device locations and do not geolocate anyone's connection.`
          : ''}
      </p>
    </div>
  )
}

/* ── The shell ────────────────────────────────────────────────────────
   A left rail of sections instead of one wall of cards.

   The old board put twenty panels on a single non-scrolling screen, which
   worked only on a 2560-wide monitor and cut cards off on anything else.
   Sections mean each view can be as tall as its content needs and the page
   works on a laptop, which is where it actually gets opened. */

type SectionId =
  | 'overview' | 'map' | 'problems' | 'money' | 'people' | 'reach'
  | 'performance' | 'errors' | 'jobs'
  | 'pipeline' | 'quality'
  | 'aws' | 'railway' | 'storage' | 'outside'

const NAV: { group: string | null; items: { id: SectionId; label: string }[] }[] = [
  {
    group: null, items: [
      { id: 'overview', label: 'Overview' },
      { id: 'map', label: 'Live map' },
      { id: 'problems', label: 'Problems' },
    ],
  },
  {
    group: 'Business', items: [
      { id: 'money', label: 'Money' },
      { id: 'people', label: 'People' },
      { id: 'reach', label: 'Notifications & email' },
    ],
  },
  {
    group: 'Platform', items: [
      { id: 'performance', label: 'Performance' },
      { id: 'errors', label: 'Errors & crashes' },
      { id: 'jobs', label: 'Background jobs' },
    ],
  },
  {
    group: 'Data', items: [
      { id: 'pipeline', label: 'Scraper & staging' },
      { id: 'quality', label: 'Data quality' },
    ],
  },
  {
    group: 'Infrastructure', items: [
      { id: 'aws', label: 'AWS' },
      { id: 'railway', label: 'Railway' },
      { id: 'storage', label: 'Storage & backups' },
      { id: 'outside', label: 'Outside services' },
    ],
  },
]

const SECTION_TITLES: Record<SectionId, string> = {
  overview: 'Overview',
  map: 'Where every sale is',
  problems: 'Problems',
  money: 'Money',
  people: 'People',
  reach: 'Notifications & email',
  performance: 'Performance',
  errors: 'Errors & crashes',
  jobs: 'Background jobs',
  pipeline: 'Scraper & staging',
  quality: 'Data quality',
  aws: 'AWS',
  railway: 'Railway',
  storage: 'Storage & backups',
  outside: 'Outside services',
}

function Sidebar({ current, onPick, badges }: {
  current: SectionId
  onPick: (id: SectionId) => void
  badges: Partial<Record<SectionId, { n: number; tone: Tone }>>
}) {
  return (
    <aside className="side">
      <div className="brand">
        {/* The owner's own mark, sized and never otherwise touched. */}
        <img src="/goat-icon-white.png" alt="" width={30} height={31} />
        <div className="brandtext">
          <b>Ground Goat</b>
          <span>Command Center</span>
        </div>
      </div>

      <nav>
        {NAV.map((g, i) => (
          <div className="navgroup" key={g.group || `g${i}`}>
            {g.group && <h6>{g.group}</h6>}
            {g.items.map(item => {
              const badge = badges[item.id]
              return (
                <button type="button" key={item.id}
                  className={`navitem ${current === item.id ? 'on' : ''}`}
                  onClick={() => onPick(item.id)}
                  aria-current={current === item.id ? 'page' : undefined}>
                  <span className="nl">{item.label}</span>
                  {badge && badge.n > 0 && (
                    <span className={`nb ${badge.tone}`}>{num(badge.n)}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidefoot">
        <a className="back" href="/admin/dashboard">← Admin</a>
      </div>
    </aside>
  )
}

/* What has actually happened, newest first. Built from the panels the
   board already computes — nothing here is a second query. */
function ActivityFeed({ pulse, pipeline, money, people, mapD }:
  { pulse: any; pipeline: any; money: any; people: any; mapD: any }) {
  const items: { icon: string; title: string; detail: string; tone: Tone }[] = []

  if (mapD?.today) {
    items.push({
      icon: '◆', tone: 'amber',
      title: `${num(mapD.today)} ${mapD.today === 1 ? 'sale' : 'sales'} selling today`,
      detail: `${num(mapD.next_7)} more inside a week`,
    })
  }
  if (pipeline?.found != null) {
    items.push({
      icon: '↓', tone: '',
      title: `${num(pipeline.found)} listings found overnight`,
      // run_finished, not run_finished_at. The panel publishes the former;
      // reading a key a panel does not publish fails silently and forever.
      detail: pipeline.run_finished ? `${ago(pipeline.run_finished)} ago` : 'last scraper run',
    })
  }
  if (pulse?.signups_today != null) {
    items.push({
      icon: '＋', tone: pulse.signups_today ? 'green' : '',
      title: `${num(pulse.signups_today)} ${pulse.signups_today === 1 ? 'signup' : 'signups'} today`,
      detail: `${num(pulse.customers_today)} customers used the product today`,
    })
  }
  if (people?.new_7d != null) {
    items.push({
      icon: '☺', tone: '',
      title: `${num(people.new_7d)} new ${people.new_7d === 1 ? 'account' : 'accounts'} this week`,
      detail: `${num(people.seen_7d)} people signed in over the same week`,
    })
  }
  if (money?.past_due_people) {
    items.push({
      icon: '!', tone: 'amber',
      title: `${num(money.past_due_people)} past due`,
      detail: 'payment failed and has not recovered',
    })
  }
  if (pulse?.requests_today != null) {
    items.push({
      icon: '≡', tone: '',
      title: `${num(pulse.requests_today)} requests today`,
      detail: pulse.server_errors_today
        ? `${num(pulse.server_errors_today)} of them failed on our side`
        : 'none of them failed on our side',
    })
  }

  if (!items.length) return <Unavailable why="no reading yet" />
  return (
    /* actfeed, not feed: the agent drawer already owns .feed and a shared
       class name would have restyled both. */
    <ul className="actfeed">
      {items.map((it, i) => (
        <li key={i}>
          <span className={`fi ${it.tone}`}>{it.icon}</span>
          <div>
            <b>{it.title}</b>
            <span>{it.detail}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function CommandCenterPage() {
  const router = useRouter()
  const [authorised, setAuthorised] = useState(false)
  const [snap, setSnap] = useState<Snapshot>(EMPTY)
  const [connected, setConnected] = useState(false)
  /* The poll loop reads this instead of the `connected` state. The interval
     closure is created once and would otherwise capture `connected: false`
     forever, polling once a second for the whole session even while the
     stream was healthy — which is exactly what happened the first time this
     ran. A ref is always current. */
  const connectedRef = useRef(false)
  const [clock, setClock] = useState('')
  const [devOpen, setDevOpen] = useState(false)
  const [fixOpen, setFixOpen] = useState(false)
  const [chartFor, setChartFor] = useState<string | null>(null)
  // WITH THE OTHER HOOKS, ABOVE THE ACCESS CHECK.
  // Declared below `if (!authorised) return` it ran only on some renders —
  // "Rendered more hooks than during the previous render" — and the whole
  // Command Center went blank. Hooks cannot sit after a conditional return,
  // and TypeScript will not tell you.
  const [emailOpen, setEmailOpen] = useState(false)
  /* Which section is on screen. Overview on load, and it never
     navigates — the whole board is one route, so switching costs
     nothing and the SSE stream is never torn down. */
  const [section, setSection] = useState<SectionId>('overview')
  /* The rail hides. The owner does not want it taking a fifth of the width
     all day, and on this board width is the map. Remembered across reloads
     because a preference you have to set every time is not a preference. */
  const [railOpen, setRailOpen] = useState(true)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cc.rail')
      if (saved !== null) setRailOpen(saved === '1')
    } catch { /* private windows have no localStorage; the default stands */ }
  }, [])
  const toggleRail = useCallback(() => {
    setRailOpen(v => {
      try { localStorage.setItem('cc.rail', v ? '0' : '1') } catch { /* ignore */ }
      return !v
    })
  }, [])

  /* WITH THE OTHER HOOKS, ABOVE THE ACCESS CHECK.
     Declared below `if (!authorised) return` this ran on some renders and
     not others — "Rendered more hooks than during the previous render" —
     and the whole Command Center went blank. The file has been bitten by
     exactly this before, two hooks up. Nothing that calls a hook may sit
     after a conditional return.

     Pins load only while the map is on screen. Nobody reading the Money
     page should be fetching a quarter of a megabyte of coordinates. */
  const wantsMap = section === 'map' || section === 'overview'
  const { data: mapPoints, error: mapError } = useMapPoints(authorised && wantsMap)

  /* Same admin gate as every other /admin page. The backend enforces it
     again on both endpoints — this only avoids showing an empty shell to
     someone who was never going to get data. */
  useEffect(() => {
    let cancelled = false
    fetchWithAuth(`${API_URL}/api/auth/me`)
      .then(r => (r.ok ? r.json() : null))
      .then(u => {
        if (cancelled) return
        if (!u || u.account_type !== 'groundgoat_admin') { router.replace('/signin'); return }
        setAuthorised(true)
      })
      .catch(() => router.replace('/signin'))
    return () => { cancelled = true }
  }, [router])

  /* Poll fallback: one request a second against the cached blob. Used
     until the stream connects, and whenever it drops. */
  const pollOnce = useCallback(async () => {
    try {
      const r = await fetchWithAuth(`${API_URL}/api/admin/command-center/snapshot`)
      if (r.ok) setSnap(await r.json())
    } catch { /* a blip between reads is not worth surfacing */ }
  }, [])

  /* Server-Sent Events over fetch, so the admin's token rides in a header
     instead of a query string. Reconnects with a short backoff; the poll
     loop keeps the screen current in the meantime. */
  useEffect(() => {
    if (!authorised) return
    let stop = false
    let controller: AbortController | null = null
    let retry = 1000

    async function connect() {
      while (!stop) {
        controller = new AbortController()
        try {
          const token = localStorage.getItem('auth_token')
          const res = await fetch(`${API_URL}/api/admin/command-center/stream`, {
            headers: { Authorization: `Bearer ${token || ''}`, Accept: 'text/event-stream' },
            signal: controller.signal,
          })
          if (!res.ok || !res.body) throw new Error(`stream returned ${res.status}`)

          setConnected(true); connectedRef.current = true
          retry = 1000
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (!stop) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            // SSE frames are separated by a blank line. Keep the tail:
            // a frame can arrive split across two network chunks.
            const frames = buffer.split('\n\n')
            buffer = frames.pop() ?? ''
            for (const frame of frames) {
              const data = frame.split('\n')
                .filter(l => l.startsWith('data:'))
                .map(l => l.slice(5).trim())
                .join('')
              if (!data) continue          // keep-alive comment
              try { setSnap(JSON.parse(data)) } catch { /* partial frame */ }
            }
          }
        } catch {
          /* falls through to the backoff below */
        }
        setConnected(false); connectedRef.current = false
        if (stop) return
        await new Promise(r => setTimeout(r, retry))
        retry = Math.min(retry * 2, 15000)
      }
    }

    pollOnce()
    connect()
    // Keeps the screen current while the stream is down, and costs one
    // cached read when it is up.
    const poll = setInterval(() => { if (!connectedRef.current) pollOnce() }, 1000)
    return () => {
      stop = true; connectedRef.current = false
      controller?.abort(); clearInterval(poll)
    }
  }, [authorised, pollOnce])

  /* One-second tick for the clock and the "numbers from X ago" readout.
     Purely local — it costs nothing and makes staleness visible. */
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }))
    }, 1000)
    setClock(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }))
    return () => clearInterval(t)
  }, [])

  const P = (key: string) => {
    const p = snap.panels?.[key]
    return p && p.ok ? p.data : null
  }
  const whyMissing = (key: string) => snap.panels?.[key]?.error || 'no reading yet'
  const st = (key: string) => snap.panels?.[key]

  if (!authorised) {
    return <><style dangerouslySetInnerHTML={{ __html: CSS }} /><div className="booting">Checking your access…</div></>
  }

  const pulse = P('pulse'), moneyD = P('money'), peopleD = P('people')
  const erroringD = P('failing_endpoints'), slowD = P('slow_endpoints'), jobsD = P('jobs'), crashD = P('crashes')
  const storageD = P('storage'), pipelineD = P('pipeline'), qualityD = P('data_quality')
  const notifD = P('notifications'), emailD = P('email')
  const outsideD = P('outside')
  const backupsD = P('backups')
  const agentsD = P('agents')
  const trendsD = P('trends') || {}
  const fixesD = P('fixes')
  /* The chart button is ALWAYS offered. It used to appear only where the
     backend had returned a series, which meant that when the trends panel
     failed — as it did, for weeks, because eleven queries shared one budget
     and any single slow one killed the lot — every chart button silently
     vanished and the graphs feature looked like it had never been built.
     A feature must not disappear because its data is late. */
  const chart = (key: string) => () => setChartFor(key)

  const mapD = P('map'), awsD = P('aws'), railwayD = P('railway')
  const storageTrendD = P('storage_trend')

  const alerts = snap.alerts || []
  const redCount = alerts.filter(a => a.level === 'red').length
  const amberCount = alerts.filter(a => a.level === 'amber').length

  const badges: Partial<Record<SectionId, { n: number; tone: Tone }>> = {
    map: { n: mapD?.today || 0, tone: 'amber' },
    problems: { n: redCount, tone: 'red' },
    errors: {
      n: (erroringD?.length || 0) + (crashD?.last_24h || 0),
      tone: erroringD?.length ? 'red' : 'amber',
    },
    jobs: { n: (jobsD?.failing || []).length, tone: 'red' },
    railway: { n: railwayD?.still_running || 0, tone: 'amber' },
  }

  /* EVERY SECTION FITS THE SCREEN.
     `rows` is the grid template for that view, so each section states how
     its height is divided instead of letting content push the page into a
     scrollbar. Cards scroll inside themselves; the board never does. */
  const view = () => {
    switch (section) {
      case 'overview':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1.75fr) minmax(0,1fr)' }}>
            {/* The map is the point of this screen, so it gets the most of it. */}
            <Panel span={8} title="Where every sale is"
              tag={mapD ? `${num(mapD.upcoming)} still to come · ${num(mapD.states)} states` : undefined}
              panelState={st('map')} onOpen={() => setSection('map')} flush>
              {mapError ? <Unavailable why={mapError} /> : <LiveMap points={mapPoints} />}
            </Panel>

            <Panel span={4} title="Problems"
              tag={alerts.length ? `${num(alerts.length)} open` : 'all clear'}>
              <Problems alerts={alerts} fixes={fixesD}
                onOpenFindings={() => setFixOpen(true)} />
            </Panel>

            <Panel span={3} title="Right now" infoId="pulse"
              panelState={st('pulse')} onChart={chart('pulse')}>
              {pulse ? <RightNow d={pulse} series={P('traffic_series')} />
                : <Unavailable why={whyMissing('pulse')} />}
            </Panel>

            <Panel span={3} title="Money" tag="per year" infoId="money"
              panelState={st('money')} onChart={chart('money')}>
              {moneyD ? <Money d={moneyD} /> : <Unavailable why={whyMissing('money')} />}
            </Panel>

            <Panel span={3} title="AWS this month" panelState={st('aws')}
              onOpen={() => setSection('aws')}>
              {awsD ? <AwsSpendMini d={awsD} /> : <Unavailable why={whyMissing('aws')} />}
            </Panel>

            <Panel span={3} title="What is happening" panelState={st('pulse')}>
              <ActivityFeed pulse={pulse} pipeline={pipelineD} money={moneyD}
                people={peopleD} mapD={mapD} />
            </Panel>
          </div>
        )

      case 'map':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,2.4fr) minmax(0,1fr)' }}>
            <Panel span={12} title="Every sale, and where our people are"
              tag={mapPoints ? `${num((mapPoints.auctions || []).length)} pins` : undefined}
              panelState={st('map')} flush>
              {mapError ? <Unavailable why={mapError} /> : <LiveMap points={mapPoints} />}
            </Panel>
            <Panel span={4} title="Sales coming up" panelState={st('map')}>
              <MapSummary d={mapD} points={mapPoints} />
            </Panel>
            <Panel span={4} title="Where our people are" panelState={st('map')}>
              <PeopleByState d={mapD} />
            </Panel>
            <Panel span={4} title="Problems"
              tag={alerts.length ? `${num(alerts.length)} open` : 'all clear'}>
              <Problems alerts={alerts} fixes={fixesD}
                onOpenFindings={() => setFixOpen(true)} />
            </Panel>
          </div>
        )

      case 'problems':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={12} title="Everything that needs you"
              tag={alerts.length ? `${num(alerts.length)} open` : 'all clear'}>
              <Problems alerts={alerts} fixes={fixesD}
                onOpenFindings={() => setFixOpen(true)} />
            </Panel>
          </div>
        )

      case 'money':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={7} title="Money" tag="per year" infoId="money"
              panelState={st('money')} onChart={chart('money')}
              pip={!moneyD ? undefined : moneyD.past_due_people ? 'amber' : 'green'}>
              {moneyD ? <Money d={moneyD} /> : <Unavailable why={whyMissing('money')} />}
            </Panel>
            <Panel span={5} title="People" infoId="people" panelState={st('people')}
              onChart={chart('people')}>
              {peopleD ? <People d={peopleD} /> : <Unavailable why={whyMissing('people')} />}
            </Panel>
          </div>
        )

      case 'people':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={7} title="People" infoId="people" panelState={st('people')}
              onChart={chart('people')}>
              {peopleD ? <People d={peopleD} /> : <Unavailable why={whyMissing('people')} />}
            </Panel>
            <Panel span={5} title="Where our people are" panelState={st('map')}>
              <PeopleByState d={mapD} />
            </Panel>
          </div>
        )

      case 'reach':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={6} title="Notifications &amp; email" infoId="reach"
              panelState={st('notifications')} pip={notifD?.overdue ? 'amber' : 'green'}>
              {notifD || emailD
                ? <Reach notif={notifD} email={emailD} fixes={fixesD}
                    onOpenEmails={() => setEmailOpen(true)} />
                : <Unavailable why={whyMissing('notifications')} />}
            </Panel>
          </div>
        )

      case 'performance':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr) minmax(0,1.15fr)' }}>
            <Panel span={6} title="Right now" tag="last 24 hours below" infoId="pulse"
              panelState={st('pulse')} onChart={chart('pulse')}>
              {pulse ? <RightNow d={pulse} series={P('traffic_series')} />
                : <Unavailable why={whyMissing('pulse')} />}
            </Panel>
            <Panel span={6} title="Slowest things" infoId="slow_endpoints"
              panelState={st('slow_endpoints')}
              pip={!slowD ? undefined : slowD.some((e: any) => e.p95_ms >= 5000) ? 'amber' : 'green'}>
              {slowD ? <Slowest d={slowD} /> : <Unavailable why={whyMissing('slow_endpoints')} />}
            </Panel>
            <Panel span={12} title="The machines behind it" panelState={st('aws')}>
              {awsD ? <AwsHealth d={awsD} /> : <Unavailable why={whyMissing('aws')} />}
            </Panel>
          </div>
        )

      case 'errors':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={6} title="What is erroring" infoId="failing_endpoints"
              panelState={st('failing_endpoints')} onChart={chart('failing_endpoints')}
              pip={!erroringD ? undefined : erroringD.length ? 'red' : 'green'}>
              {erroringD ? <Erroring d={erroringD} /> : <Unavailable why={whyMissing('failing_endpoints')} />}
            </Panel>
            <Panel span={6} title="App crashes" infoId="crashes" panelState={st('crashes')}
              onChart={chart('crashes')}
              pip={!crashD ? undefined : crashD.last_hour ? 'red' : crashD.last_24h ? 'amber' : 'green'}>
              {crashD ? <Crashes d={crashD} /> : <Unavailable why={whyMissing('crashes')} />}
            </Panel>
          </div>
        )

      case 'jobs':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={12} title="Background jobs" infoId="jobs" panelState={st('jobs')}
              pip={!jobsD ? undefined
                : (jobsD.failing || []).length ? 'red' : (jobsD.stuck || []).length ? 'amber' : 'green'}>
              {jobsD ? <Jobs d={jobsD} /> : <Unavailable why={whyMissing('jobs')} />}
            </Panel>
          </div>
        )

      case 'pipeline':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={12} title="Scraper &amp; staging" infoId="pipeline"
              panelState={st('pipeline')} onChart={chart('pipeline')}
              pip={!pipelineD ? undefined
                : pipelineD.run_failures ? 'red'
                : pipelineD.listings_missing_main_image || pipelineD.tracts_boundary_missing_image
                  ? 'amber' : 'green'}>
              {pipelineD ? <Pipeline d={pipelineD} /> : <Unavailable why={whyMissing('pipeline')} />}
            </Panel>
          </div>
        )

      case 'quality':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={12} title="Data quality" infoId="data_quality"
              panelState={st('data_quality')}
              pip={!qualityD ? undefined
                : qualityD.valid_but_no_boundary || qualityD.past_auctions_no_price ? 'amber' : 'green'}>
              {qualityD ? <Quality d={qualityD} fixes={fixesD} />
                : <Unavailable why={whyMissing('data_quality')} />}
            </Panel>
          </div>
        )

      case 'aws':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={7} title="What AWS costs" panelState={st('aws')}
              pip={!awsD?.spend?.available ? undefined
                : (awsD.spend.projected_month > awsD.spend.last_month * 1.25 ? 'amber' : 'green')}>
              {awsD ? <AwsSpend d={awsD} /> : <Unavailable why={whyMissing('aws')} />}
            </Panel>
            <Panel span={5} title="How hard it is working" panelState={st('aws')}
              pip={!awsD?.busiest ? undefined
                : awsD.busiest.cpu_pct >= 80 ? 'red'
                : awsD.busiest.cpu_pct >= 60 ? 'amber' : 'green'}>
              {awsD ? <AwsHealth d={awsD} /> : <Unavailable why={whyMissing('aws')} />}
            </Panel>
          </div>
        )

      case 'railway':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={7} title="Railway" tag="what is left of it"
              panelState={st('railway')}
              pip={!railwayD ? undefined : railwayD.duplicate_of_aws ? 'amber' : 'green'}>
              {railwayD ? <RailwayCard d={railwayD} /> : <Unavailable why={whyMissing('railway')} />}
            </Panel>
          </div>
        )

      case 'storage':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={7} title="Storage" tag="one shared disk" infoId="storage"
              panelState={st('storage')} onChart={chart('storage')}
              pip={!storageD || storageD.volume_pct == null ? undefined
                : storageD.volume_pct >= 90 ? 'red'
                : storageD.volume_pct >= 80 ? 'amber' : 'green'}>
              {storageD ? <Storage d={storageD} trend={storageTrendD} />
                : <Unavailable why={whyMissing('storage')} />}
            </Panel>
            <Panel span={5} title="Backups" tag="every database" infoId="backups"
              panelState={st('backups')}
              pip={!backupsD ? undefined
                : backupsD.worst === 'ok' ? 'green'
                : backupsD.irreplaceable_at_risk?.length ? 'red' : 'amber'}>
              {backupsD ? <Backups d={backupsD} /> : <Unavailable why={whyMissing('backups')} />}
            </Panel>
          </div>
        )

      case 'outside':
        return (
          <div className="grid" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
            <Panel span={12} title="Outside services" infoId="outside" panelState={st('outside')}>
              {outsideD ? <Outside d={outsideD} fixes={fixesD} />
                : <Unavailable why={whyMissing('outside')} />}
            </Panel>
          </div>
        )
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className={`shell ${railOpen ? '' : 'norail'}`}>
        {railOpen && <Sidebar current={section} onPick={setSection} badges={badges} />}

        <div className="mainwrap">
          <header className="top">
            <button type="button" className="railbtn" onClick={toggleRail}
              aria-expanded={railOpen} aria-label={railOpen ? 'Hide the menu' : 'Show the menu'}
              title={railOpen ? 'Hide the menu' : 'Show the menu'}>
              <span /><span /><span />
            </button>
            {!railOpen && (
              <span className="minibrand">
                <img src="/goat-icon-white.png" alt="" width={18} height={19} />
              </span>
            )}
            <h1>{SECTION_TITLES[section]}</h1>

            <div className="topspacer" />

            <button type="button" className="tbtn" onClick={() => setDevOpen(true)}
              aria-expanded={devOpen}>
              Developers{(agentsD?.working || 0) + (fixesD?.working || 0)
                ? <> · <b>{num((agentsD?.working || 0) + (fixesD?.working || 0))}</b></> : null}
            </button>
            <button type="button" className="tbtn" onClick={() => setFixOpen(true)}
              aria-expanded={fixOpen}>
              Findings{fixesD?.working ? <> · <b>{num(fixesD.working)}</b></> : null}
            </button>

            <div className="stat">
              updated <b>{snap.generated_at ? ago(snap.generated_at) : '—'}</b> ago
            </div>
            <div className="clock">{clock}</div>

            <span className={`status ${redCount ? 'bad' : amberCount ? 'warn' : ''} ${connected ? '' : 'off'}`}>
              <span className="dot" />
              {!connected ? 'Reconnecting'
                : redCount ? `${redCount} ${redCount === 1 ? "thing needs" : "things need"} attention`
                : amberCount ? `${amberCount} worth a look`
                : 'All systems operational'}
            </span>
          </header>

          <main className="view">{view()}</main>
        </div>
      </div>

      <AgentDrawer open={devOpen} onClose={() => setDevOpen(false)} data={agentsD} fixes={fixesD} />
      <FixDrawer open={fixOpen} onClose={() => setFixOpen(false)} data={fixesD} />
      <EmailDrawer open={emailOpen} onClose={() => setEmailOpen(false)} email={emailD} />
      <TrendsDrawer openFor={chartFor} onClose={() => setChartFor(null)}
        title={chartFor ? (CHART_TITLES[chartFor] || 'Trend') : ''}
        series={chartFor ? (trendsD[chartFor] || []) : []}
        errors={trendsD._errors || []} />
    </>
  )
}

/* ── Styles ───────────────────────────────────────────────────────────
   Kept as one string rather than a Tailwind soup: this is an instrument
   panel, and its rail, grid and density are the design, not incidental
   utility classes. Every colour is a variable in :root, so the whole
   palette turns over in one block. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
/* ───────────────────────────────────────────────────────────────
   Deliberately single-theme. Jared has a Health Monitor already and
   does not use it, in his words, because it is dark. So this page is
   light in every viewer's theme — every colour is painted explicitly
   rather than inherited, and there is no dark block to fall into.

   Neutrals are warmed slightly (limestone, not blue-grey) so the
   brand pink and gold sit on them without clashing. Red / amber /
   green are semantic only and never used decoratively — if something
   on this screen is red, something is actually wrong.
   ─────────────────────────────────────────────────────────────── */
:root{
  /* DARK, BY THE OWNER'S OWN CHOICE.
     This screen used to be light on purpose — he had a dark Health Monitor
     and said he did not use it because it was dark. On 4 September 2026 he
     sent a dark reference and asked for this board to look like it, so the
     earlier decision is reversed here deliberately rather than by accident.
     Every colour below is a variable, so reversing it again is one block.

     Ground Goat's own pink stays as the identity accent — the active
     section, the logo lockup, the focus ring. Green, amber and red are
     reserved for state: if something on this screen is red, something is
     actually wrong. */
  --paper:#0A0D13;
  --page:linear-gradient(180deg,#0C1017 0%,#080B10 100%);
  --card:#121822;
  --card-2:#151C28;
  --head-line:#1E2634;
  --track:#1A2230;
  --ink:#E9EEF6;
  --ink-2:#C4CDDB;
  --muted:#8B98AB;
  --faint:#69758A;
  --line:#1D2532; --line-2:#2A3547;

  --pink:#F58CDE; --pink-bright:#F9A8E6; --pink-tint:rgba(245,140,222,.14);

  --bar:#0A0D13; --on-bar:#E9EEF6; --on-bar-dim:rgba(233,238,246,.62);
  --bar-line:#1B2432; --pill:rgba(255,255,255,.06); --pill-line:rgba(255,255,255,.16);

  --blue:#3B82F6;
  --blue-pill:rgba(59,130,246,.16); --blue-pill-hi:rgba(59,130,246,.28);
  --blue-pill-line:rgba(59,130,246,.42);
  --blue-ink:#93C5FD;
  --royal:#3B5BDB; --royal-hi:#4C6EF5; --royal-line:#3B5BDB;

  --red:#F87171; --red-bg:rgba(248,113,113,.13); --red-line:rgba(248,113,113,.32);
  --amber:#FBBF24; --amber-bg:rgba(251,191,36,.13); --amber-line:rgba(251,191,36,.32);
  --green:#34D399; --green-bg:rgba(52,211,153,.13);

  --r:9px;
  --lift:0 1px 2px rgba(0,0,0,.45), 0 6px 18px rgba(0,0,0,.34);
  --lift-hi:0 2px 6px rgba(0,0,0,.5), 0 12px 30px rgba(0,0,0,.45);
  --sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;
  --label:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace;
}
/* Scoped to the page's own subtree — this file must not restyle the rest
   of the admin app, which is still on the site's dark shell. */
.shell,.shell *,.booting{box-sizing:border-box;}
/* Scrolls by default. The locked one-screen layout is an enhancement that
   switches on further down, and only when the screen can actually hold it.

   The site's own chrome is hidden rather than covered. This page is an
   instrument panel, not a page in the site, and the shell used to sit on
   top of the nav and footer by being taken out of flow — which is exactly
   what stopped it scrolling: an out-of-flow element adds no height to its
   parent, so the document reported 2,370px of content and scrollTop would
   not move past 2. Hiding the two siblings lets the shell stay in normal
   flow, where the page grows and scrolls the way a page does. Scoped with
   :has so it applies only while this page is mounted.

   No overflow declaration here on purpose. Setting it to auto put an
   explicit value on body, and the viewport takes its scrolling behaviour
   from body when html is visible — which left the document reporting
   2,370px of content that would not scroll. Left alone, the page scrolls
   the way every other page does. Only the locked layout at the bottom
   turns overflow off. */
body:has(.shell) > nav,
body:has(.shell) > footer{display:none;}
body:has(.shell){overflow:hidden;}
.shell,.booting{
  background:var(--paper);
  background-image:var(--page);
  /* Anchored to the top and sized to one viewport rather than pinned with
     background-attachment:fixed. Fixed attachment was written for a shell
     that never scrolls; on a 2,371px scrolling page it leaves the area
     above the fold unpainted, so the site's near-black body colour showed
     through as a void above the cards. The locked layout below restores
     the pinned version, where there is no scrolling for it to go wrong. */
  background-attachment:scroll;
  background-size:100% 100dvh;
  background-repeat:no-repeat;
  color:var(--ink);
  font-family:var(--sans); font-size:13px; line-height:1.35;
  -webkit-font-smoothing:antialiased;
}
.booting{display:flex;align-items:center;justify-content:center;height:100dvh;
  color:var(--muted);font-family:var(--label);letter-spacing:.06em;text-transform:uppercase;}
/* ── Frame: a rail of sections, and one scrolling view beside it ──
   The old board was one non-scrolling wall of twenty cards, which needed a
   2560x1440 monitor and silently cut cards off on anything smaller. Each
   section now owns its own view and is free to be as tall as it needs. */
/* ONE SCREEN. NOTHING SCROLLS BUT THE CARDS.
   The board is pinned to the viewport and every view divides that height
   between its cards; anything too tall for its card scrolls inside the
   card. The page itself never scrolls in either direction — the owner
   should never have to hunt for a number below the fold or off to the
   right. */
.shell{
  position:fixed;inset:0;z-index:60;
  display:grid;grid-template-columns:216px minmax(0,1fr);
  overflow:hidden;
}
.shell.norail{grid-template-columns:minmax(0,1fr);}

/* ── The rail ── */
.side{
  height:100%;min-height:0;
  display:flex;flex-direction:column;gap:2px;
  padding:16px 12px 12px;
  background:var(--bar);border-right:1px solid var(--bar-line);
  overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--line-2) transparent;
}
.brand{display:flex;align-items:center;gap:10px;padding:0 6px 16px;}
/* The owner's mark, scaled to fit and never cropped, padded or recoloured. */
.brand img{width:30px;height:auto;flex:none;opacity:.94;}
.brandtext{display:flex;flex-direction:column;line-height:1.15;min-width:0;}
.brandtext b{font-size:14px;font-weight:700;letter-spacing:-.01em;color:var(--on-bar);}
.brandtext span{font-family:var(--label);font-size:9.5px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--pink-bright);}

.side nav{display:flex;flex-direction:column;gap:14px;flex:1;}
.navgroup{display:flex;flex-direction:column;gap:1px;}
.navgroup h6{margin:0 0 4px;padding:0 8px;font-family:var(--label);font-size:9.5px;
  font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--faint);}
.navitem{
  display:flex;align-items:center;gap:8px;width:100%;
  padding:7px 9px;border:0;border-radius:7px;background:transparent;
  font-family:var(--sans);font-size:12.5px;font-weight:500;color:var(--on-bar-dim);
  text-align:left;cursor:pointer;
}
.navitem:hover{background:rgba(255,255,255,.05);color:var(--on-bar);}
.navitem.on{background:var(--pink-tint);color:var(--on-bar);font-weight:600;
  box-shadow:inset 2px 0 0 var(--pink-bright);}
.navitem:focus-visible{outline:2px solid var(--pink-bright);outline-offset:-2px;}
.navitem .nl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.navitem .nb{font-family:var(--mono);font-size:10.5px;font-weight:600;
  padding:1px 6px;border-radius:999px;background:var(--pill);color:var(--on-bar);}
.navitem .nb.red{background:var(--red-bg);color:var(--red);}
.navitem .nb.amber{background:var(--amber-bg);color:var(--amber);}
.navitem .nb.green{background:var(--green-bg);color:var(--green);}
.sidefoot{padding-top:12px;border-top:1px solid var(--bar-line);}

.mainwrap{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;}

/* ── Top bar ── */
.top{
  flex:none;z-index:20;
  display:flex;align-items:center;gap:12px;
  padding:9px 14px;
  background:rgba(10,13,19,.86);backdrop-filter:blur(10px);
  border-bottom:1px solid var(--bar-line);
}
.top h1{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em;color:var(--ink);}
.topspacer{flex:1;}
.tbtn{
  font-family:var(--label);font-size:11px;letter-spacing:.05em;
  color:var(--on-bar-dim);background:var(--pill);border:1px solid var(--pill-line);
  border-radius:999px;padding:4px 11px;cursor:pointer;
}
.tbtn:hover{background:rgba(255,255,255,.12);color:var(--on-bar);}
.tbtn b{font-family:var(--mono);color:var(--pink-bright);}
.tbtn:focus-visible{outline:2px solid var(--pink-bright);outline-offset:2px;}
.stat{display:flex;align-items:center;gap:6px;font-family:var(--label);font-size:11.5px;
  color:var(--muted);}
.stat b{font-family:var(--mono);font-weight:600;color:var(--ink-2);}
.stat.stale{color:var(--red);font-weight:700;}
.clock{font-family:var(--mono);font-size:14px;font-weight:600;color:var(--ink-2);}

.status{
  display:inline-flex;align-items:center;gap:7px;
  font-family:var(--label);font-size:11.5px;font-weight:600;
  padding:5px 12px;border-radius:999px;
  background:var(--green-bg);border:1px solid rgba(52,211,153,.3);color:var(--green);
}
.status .dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none;
  animation:livepulse 2.4s ease-in-out infinite;}
.status.warn{background:var(--amber-bg);border-color:var(--amber-line);color:var(--amber);}
.status.bad{background:var(--red-bg);border-color:var(--red-line);color:var(--red);}
.status.off{background:var(--pill);border-color:var(--pill-line);color:var(--muted);}
.railbtn{
  flex:none;width:28px;height:28px;border-radius:7px;cursor:pointer;
  border:1px solid var(--line);background:var(--card);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
}
.railbtn span{display:block;width:13px;height:1.5px;border-radius:1px;background:var(--ink-2);}
.railbtn:hover{background:var(--pink-tint);border-color:var(--pink);}
.railbtn:hover span{background:var(--pink-bright);}
.railbtn:focus-visible{outline:2px solid var(--pink-bright);outline-offset:2px;}
.minibrand{display:flex;align-items:center;}
.minibrand img{opacity:.9;}
.back{font-family:var(--label);font-size:11px;letter-spacing:.07em;text-transform:uppercase;
  color:var(--on-bar-dim);text-decoration:none;display:block;padding:6px 8px;border-radius:7px;}
.back:hover{background:rgba(255,255,255,.06);color:var(--on-bar);}
.back:focus-visible{outline:2px solid var(--pink);outline-offset:2px;}

/* ── The view ── */
.view{flex:1;min-height:0;min-width:0;padding:11px 14px 14px;overflow:hidden;}
.grid{
  height:100%;min-height:0;
  display:grid;grid-template-columns:repeat(12,minmax(0,1fr));
  /* Rows come from each view, which knows how it wants its height split.
     A default of equal rows keeps a view that forgets to say so on screen
     rather than letting it grow a scrollbar. */
  grid-auto-rows:minmax(0,1fr);
  gap:10px;align-items:stretch;
}
.grid > .panel{min-height:0;}

/* ── Problems, as a scrolling card ──
   These used to be a horizontal banner across the top of the board. It ate
   the height every other card needed and pushed the Diagnose buttons off
   the right edge past the fourth alert. Now they stack in a card that
   scrolls, so every button is reachable and the map keeps the room. */
.problems{display:flex;flex-direction:column;gap:7px;}
.verdict{
  display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;
  padding:8px 10px;border-radius:8px;
  background:var(--red-bg);border:1px solid var(--red-line);
}
.verdict.warn{background:var(--amber-bg);border-color:var(--amber-line);}
.verdict.clear{background:var(--green-bg);border-color:rgba(52,211,153,.3);}
.verdict .big{font-family:var(--mono);font-size:17px;font-weight:600;color:var(--red);}
.verdict.warn .big{color:var(--amber);}
.verdict.clear .big{color:var(--green);}
.verdict .small{font-size:11.5px;color:var(--muted);}

.alert{
  display:flex;flex-direction:column;gap:2px;
  padding:8px 10px;border-radius:8px;
  background:var(--card-2);border:1px solid var(--line);
  border-left:3px solid var(--red);
}
.alert.amber{border-left-color:var(--amber);}
.alert.info{border-left-color:var(--royal);}
.alert .where{font-family:var(--label);font-size:9px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:var(--faint);}
.alert .title{font-size:12.5px;font-weight:600;color:var(--ink);line-height:1.3;}
.alert.amber .title{color:var(--ink);}
.alert .detail{font-size:11.5px;line-height:1.45;color:var(--muted);}
.alert-actions{display:flex;gap:6px;margin-top:5px;}
.allgood{
  display:flex;flex-direction:column;gap:3px;align-items:center;justify-content:center;
  height:100%;min-height:80px;text-align:center;
  color:var(--green);
}
.allgood b{font-size:14px;font-weight:600;}
.allgood span{font-size:11.5px;color:var(--muted);}

.panel{
  min-height:0;display:flex;flex-direction:column;overflow:hidden;
  background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  box-shadow:var(--lift);
}
.panel > h2{
  flex:none;margin:0;display:flex;align-items:center;gap:7px;
  padding:9px 13px;border-bottom:1px solid var(--head-line);
  background:var(--card-2);
  font-family:var(--label);font-weight:700;font-size:10.5px;
  letter-spacing:.11em;text-transform:uppercase;color:var(--ink-2);
}
.panel > h2 .tag{margin-left:auto;font-size:10px;letter-spacing:.05em;
  color:var(--faint);font-weight:600;text-transform:none;}
.panel > h2 .pip{width:7px;height:7px;border-radius:50%;background:var(--pink-bright);flex:none;}
.panel > h2 .pip.red{background:var(--red);} .panel > h2 .pip.amber{background:var(--amber);}
.panel > h2 .pip.green{background:var(--green);}
.body{min-height:0;flex:1;overflow-y:auto;overflow-x:hidden;padding:11px 13px;
  display:flex;flex-direction:column;gap:8px;scrollbar-width:thin;
  scrollbar-color:var(--line-2) transparent;}
.body > *{flex:0 0 auto;min-height:0;}
/* A trailing note must sit after the content, never be pushed onto it.
   margin-top:auto inside a scrolling column is what let them collide. */
.body > .note:last-child{margin-top:6px;}
.body::-webkit-scrollbar{width:7px;}
.body::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:4px;}
.body::-webkit-scrollbar-track{background:transparent;}
.dead{display:flex;align-items:center;justify-content:center;height:100%;color:var(--faint);
  font-family:var(--label);letter-spacing:.06em;text-transform:uppercase;font-size:11.5px;text-align:center;}
/* "Nothing is wrong" is not "this panel is broken". Separate class so the
   two can never be mistaken for each other. */
.allgood{display:flex;align-items:center;justify-content:center;height:100%;color:var(--green);
  font-family:var(--label);letter-spacing:.06em;text-transform:uppercase;font-size:11.5px;text-align:center;}

/* ── Shared bits ── */
.kpis{display:grid;gap:8px;}
.kpi .v{font-family:var(--mono);font-variant-numeric:tabular-nums;font-weight:600;
  font-size:27px;line-height:1;letter-spacing:-.025em;}
.kpi .v.sm{font-size:20px;}
.kpi .k{font-family:var(--label);font-size:10px;letter-spacing:.07em;text-transform:uppercase;
  color:var(--muted);margin-top:3px;}
.kpi .v.red{color:var(--red);} .kpi .v.amber{color:var(--amber);} .kpi .v.green{color:var(--green);}

table{width:100%;border-collapse:collapse;font-size:12px;}
th{font-family:var(--label);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;
   color:var(--faint);font-weight:600;text-align:left;padding:0 0 3px;border-bottom:1px solid var(--line);}
td{padding:3.5px 0;border-bottom:1px solid var(--line);vertical-align:baseline;}
tr:last-child td{border-bottom:0;}
td.n,th.n{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;
   white-space:nowrap;padding-left:14px;}
th.n{font-family:var(--label);}
td.t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;width:100%;}
td.red,.red-t{color:var(--red);} td.amber{color:var(--amber);} td.dim{color:var(--muted);}

.rows{display:flex;flex-direction:column;gap:5px;min-height:0;}
/* Regrid halves. The card is two of twelve columns wide, so the count and
   its provenance have to wrap rather than share a line with the label. */
.rghalf{display:flex;flex-direction:column;gap:1px;}
.rghead{display:flex;align-items:baseline;gap:8px;font-size:12px;}
.rghead b{margin-left:auto;font-family:var(--mono);font-variant-numeric:tabular-nums;font-weight:400;}
.rgsub{font-family:var(--mono);font-size:10.5px;color:var(--muted);line-height:1.35;overflow-wrap:anywhere;}
.row{display:flex;align-items:baseline;gap:8px;font-size:12px;}
.row .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.row .r{margin-left:auto;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap;}
.more{font-family:var(--label);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);}

.bar{height:7px;border-radius:3px;background:var(--track);overflow:hidden;border:1px solid var(--line);}
.bar i{display:block;height:100%;background:var(--blue);}
.bar i.red{background:var(--red);} .bar i.amber{background:var(--amber);} .bar i.green{background:var(--green);}
.store{display:grid;gap:2px;}
.store .top{display:flex;align-items:baseline;gap:8px;font-size:12px;}
.store .top .pc{margin-left:auto;font-family:var(--mono);font-variant-numeric:tabular-nums;font-weight:600;}
.store .note{font-size:10.5px;color:var(--faint);overflow:hidden;
  display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow-wrap:anywhere;}

.chip{display:inline-block;padding:1px 6px;border-radius:20px;font-family:var(--label);
  font-size:9.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border:1px solid var(--line-2);color:var(--muted);}
.chip.red{background:var(--red-bg);border-color:var(--red-line);color:var(--red);}
.chip.amber{background:var(--amber-bg);border-color:var(--amber-line);color:var(--amber);}
.chip.green{background:var(--green-bg);border-color:#C6DECF;color:var(--green);}
.note{font-size:10.5px;color:var(--faint);line-height:1.35;}
svg.spark{display:block;width:100%;height:100%;}

@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;}}

/* ── DEVELOPERS slide-out ───────────────────────────────────────────
   Modelled on the owner's mission-control.html: a list of agent cards on
   the left, the selected agent's assignment and message feed on the right.
   It overlays rather than reflows, so opening it never disturbs the
   one-screen layout underneath. */
.devbtn{
  font-family:var(--label);font-size:11px;font-weight:700;letter-spacing:.12em;
  text-transform:uppercase;padding:3px 11px;border-radius:999px;cursor:pointer;
  color:var(--on-bar);background:var(--pill);
  border:1px solid var(--pill-line);
}
.devbtn:hover{background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.6);}
.devbtn:focus-visible{outline:2px solid var(--pink-bright);outline-offset:2px;}
.devbtn .count{color:var(--pink-bright);font-weight:700;font-variant-numeric:tabular-nums;}

.scrim{position:fixed;inset:0;z-index:80;background:rgba(10,10,10,.42);
  opacity:0;pointer-events:none;transition:opacity .18s ease;}
.scrim.open{opacity:1;pointer-events:auto;}

.drawer{
  position:fixed;top:0;right:0;bottom:0;z-index:81;
  width:min(1180px,88vw);display:grid;grid-template-rows:auto minmax(0,1fr);
  background:var(--paper);border-left:1px solid var(--line-2);
  /* Explicit, because this sits outside .shell and would otherwise inherit
     the site's dark-theme white text. */
  color:var(--ink);
  font-family:var(--sans);font-size:13px;line-height:1.35;
  box-shadow:-18px 0 48px rgba(10,10,10,.22);
  transform:translateX(100%);transition:transform .22s cubic-bezier(.4,0,.2,1);
}
.drawer.open{transform:translateX(0);}
@media (prefers-reduced-motion:reduce){
  .drawer{transition:none;} .scrim{transition:none;}
}
.drawer-head{
  display:flex;align-items:center;gap:12px;padding:10px 16px;
  background:var(--bar);color:var(--on-bar);border-bottom:1px solid var(--bar-line);
}
.drawer-head h2{font-family:var(--sans);font-size:15px;font-weight:700;margin:0;
  letter-spacing:.06em;text-transform:uppercase;}
.drawer-head .sub{font-family:var(--label);font-size:11px;color:var(--on-bar-dim);
  letter-spacing:.06em;text-transform:uppercase;}
/* Day / week / month. Pushed to the right of the title so the close button
   stays where the eye already expects it, and built from the same pill
   vocabulary as everything else in this bar. */
.buckets{margin-left:auto;display:flex;gap:4px;}
.buckets button{
  background:var(--pill);color:var(--on-bar-dim);
  border:1px solid var(--pill-line);border-radius:999px;cursor:pointer;
  font-family:var(--label);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
  padding:4px 11px;
}
.buckets button:hover{background:rgba(255,255,255,.22);color:var(--on-bar);}
.buckets button.on{background:rgba(255,255,255,.28);color:var(--on-bar);
  border-color:rgba(255,255,255,.65);font-weight:700;}
.drawer-close{margin-left:8px;background:var(--pill);color:var(--on-bar);
  border:1px solid var(--pill-line);border-radius:999px;cursor:pointer;
  font-family:var(--label);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
  padding:4px 10px;}
.drawer-close:hover{background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.6);}
.drawer-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,420px);
  min-height:0;gap:1px;background:var(--line);}
.agent-list{overflow-y:auto;background:var(--paper);color:var(--ink);padding:10px;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:9px;align-content:start;}

/* THE FINDINGS DRAWER IS NOT THE AGENTS DRAWER.
   It was reusing .drawer-body, a two-column grid whose second 420px column it
   never fills — that was the wide blank strip down the right — and .agent-list,
   an auto-fill card grid, which stretched the single run pill into a green
   block the full height of the panel. It gets its own layout: pills in a row
   at the top, the finding underneath, full width. */
.fixdrawer-body{display:block;overflow-y:auto;background:var(--paper);
  color:var(--ink);min-height:0;padding:12px 16px 20px;}
.fixpills{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start;
  margin:0 0 12px;}
.fixpill{
  flex:0 0 auto;padding:4px 11px;border-radius:999px;cursor:pointer;
  font-family:var(--label);font-size:9.5px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;white-space:nowrap;line-height:1.5;
  background:transparent;border:1px solid var(--line-2);color:var(--ink);
}
.fixpill:hover{border-color:var(--ink);}
/* WHAT HAPPENED, AND WHAT DID NOT. */
.fixverdict{
  border:1px solid var(--line-2);border-left:3px solid var(--amber);
  border-radius:var(--r);padding:9px 12px;margin:0 0 12px;background:var(--card);
}
.fixverdict h4{margin:0 0 3px;font-size:13px;font-weight:700;color:var(--ink);}
.fixverdict p{margin:0;font-size:11.5px;line-height:1.5;color:var(--muted);}
.fixverdict.working{border-left-color:var(--amber);}
.fixverdict.done{border-left-color:var(--green);}
.fixverdict.bad{border-left-color:var(--red);}
.agent-card{
  background:var(--card);border:1px solid var(--line);border-left:3px solid var(--line-2);
  border-radius:var(--r);padding:8px 10px;cursor:pointer;text-align:left;
  box-shadow:var(--lift);min-width:0;font:inherit;
}
.agent-card:hover{border-color:var(--pink);}
.agent-card.on{border-color:var(--pink);border-left-color:var(--pink-bright);
  box-shadow:var(--lift-hi);}
.agent-card.busy{border-left-color:var(--green);}
.agent-card:focus-visible{outline:2px solid var(--pink);outline-offset:1px;}
.agent-card .top{display:flex;align-items:center;gap:6px;margin-bottom:3px;}
.agent-card .nm{font-weight:700;font-size:12.5px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;color:var(--ink);}
.agent-card .meta{font-size:10.5px;color:var(--faint);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;margin-bottom:5px;}
.agent-card .say{font-size:11.5px;color:var(--ink);line-height:1.35;
  display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;
  background:var(--pink-tint);border-radius:4px;padding:5px 7px;white-space:pre-wrap;}
.agent-detail{overflow-y:auto;background:var(--card);color:var(--ink);padding:12px 14px;}
.agent-detail dl{display:grid;grid-template-columns:auto minmax(0,1fr);
  gap:2px 12px;margin:0 0 12px;font-size:11.5px;}
.agent-detail dt{font-family:var(--label);font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--faint);}
.agent-detail dd{margin:0;font-family:var(--mono);font-size:11px;
  overflow-wrap:anywhere;color:var(--ink);}
.agent-detail h3{font-family:var(--label);font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--pink);margin:0 0 5px;}
.agent-detail .assign{font-size:11.5px;line-height:1.4;white-space:pre-wrap;
  background:var(--card-2);border-radius:var(--r);padding:8px 10px;margin-bottom:12px;
  color:var(--ink);}
.feed{display:flex;flex-direction:column;gap:8px;}
.feed .msg{font-size:11.5px;line-height:1.4;white-space:pre-wrap;
  border-left:2px solid var(--line-2);padding-left:8px;overflow-wrap:anywhere;
  color:var(--ink);}
.feed .msg time{display:block;font-family:var(--mono);font-size:9.5px;
  color:var(--faint);margin-bottom:2px;}
.drawer-empty{grid-column:1/-1;display:flex;align-items:center;justify-content:center;
  padding:40px 20px;text-align:center;color:var(--muted);font-size:12.5px;line-height:1.5;}

/* ── Chart button + trends drawer ───────────────────────────────────
   A card that has history gets a small chart button in its header. It only
   appears on cards a trend exists for, so the icon always means something. */
.axis{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;fill:#7A7A88;letter-spacing:0;}
.chartbtn{
  flex:none;width:20px;height:20px;padding:0;margin-left:6px;cursor:pointer;
  border:1px solid var(--line-2);border-radius:5px;background:#B45309;
  color:#0B0B0F;display:inline-flex;align-items:center;justify-content:center;
}
.chartbtn:hover{background:#D97706;border-color:var(--line-2);}
.chartbtn:focus-visible{outline:2px solid var(--pink);outline-offset:1px;}
.chartbtn svg{width:12px;height:12px;display:block;}
.panel > h2 .tag + .chartbtn{margin-left:6px;}
.panel > h2 .chartbtn:first-of-type{margin-left:auto;}

.charts{display:grid;gap:14px;padding:14px 16px;overflow-y:auto;align-content:start;
  color:var(--ink);}
.chartcard{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  box-shadow:var(--lift);padding:10px 12px;}
.chartcard h4{margin:0 0 2px;font-family:var(--label);font-size:11px;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);}
.chartcard .cur{font-family:var(--mono);font-variant-numeric:tabular-nums;
  font-size:22px;font-weight:600;line-height:1.1;letter-spacing:-.02em;}
.chartcard .delta{font-family:var(--label);font-size:11px;letter-spacing:.04em;}
.chartcard .delta.up{color:var(--green);} .chartcard .delta.down{color:var(--red);}
.chartcard .plot{height:120px;margin-top:6px;}
.chartcard .axis{display:flex;justify-content:space-between;font-family:var(--mono);
  font-size:9.5px;color:var(--faint);margin-top:3px;}

/* A detail line that is too long wraps to two lines and ends in a real
   ellipsis. The single-line version cut mid-word with nothing to show for
   it, which read as a rendering fault rather than as truncation. */
.clamp2{
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;white-space:normal;overflow-wrap:anywhere;
}
.clamp1{
  display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;
  overflow:hidden;white-space:normal;overflow-wrap:anywhere;
}

/* ── Info popover ───────────────────────────────────────────────────
   Every card can say what it means, where the number comes from, and what
   it does NOT cover. The caveats are the useful half: a figure whose
   limits are written down can be trusted; one without them cannot. */
.infobtn{
  flex:none;width:20px;height:20px;padding:0;margin-left:5px;cursor:pointer;
  border:1px solid var(--line-2);border-radius:50%;background:var(--royal);
  color:#fff;display:inline-flex;align-items:center;justify-content:center;
  font-family:var(--sans);font-size:11px;font-weight:700;line-height:1;
}
.infobtn:hover{background:var(--royal-hi);border-color:var(--line-2);}
.infobtn:focus-visible{outline:2px solid var(--pink);outline-offset:1px;}
.panel > h2 .infobtn:first-of-type{margin-left:auto;}
.panel{position:relative;}
.popwrap{
  position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;
  background:rgba(10,10,10,.45);padding:24px;
}
.pop{
  position:relative;width:min(620px,100%);max-height:min(74vh,640px);overflow-y:auto;
  background:var(--card);color:var(--ink);border:1px solid var(--line-2);
  border-radius:10px;box-shadow:0 24px 64px rgba(10,10,10,.34);
  padding:20px 22px;text-align:left;
}
.pop h5{font-size:12px;}
.pop p{font-size:13px;}
.pop dd{font-size:12.5px;}
.pop dt{font-size:10.5px;}
.pop h5{margin:0 0 5px;font-family:var(--label);font-size:10px;font-weight:700;
  letter-spacing:.1em;text-transform:uppercase;color:var(--pink);}
.pop p{margin:0 0 8px;font-size:11.5px;line-height:1.45;color:var(--ink-2);}
.pop dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;margin:0 0 8px;}
.pop dt{font-family:var(--label);font-size:9.5px;letter-spacing:.07em;
  text-transform:uppercase;color:var(--faint);}
.pop dd{margin:0;font-size:11px;line-height:1.4;}
.pop .warn{color:var(--amber);}
.pop .close{position:absolute;top:10px;right:12px;border:0;background:none;cursor:pointer;
  color:var(--faint);font-size:20px;line-height:1;padding:2px 6px;}
.pop .close:hover{color:var(--ink);}

/* A figure that can be opened to see what it is made of. Deliberately looks
   like the number beside it, not like a button — the dotted rule is the only
   hint, so a card full of these still reads as a card of numbers. */
.drill{border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;
  border-bottom:1px dotted var(--faint);}

/* The email list is the only two-text-column table on this screen.
   td.t is written for the cards — max-width:0 and width:100% on a single text
   column — so with two of them both cells collapsed to "sub…" and "aba…",
   losing the one column that says what was actually sent. */
.mailtable{table-layout:fixed;}
.mailtable td.t{max-width:none;width:auto;white-space:normal;overflow:visible;
  text-overflow:clip;padding-right:10px;overflow-wrap:anywhere;}
.mailtable td{vertical-align:top;padding:5px 0;}
.drill:hover{border-bottom-color:currentColor;}
.drill:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}

.runrow{display:flex;gap:8px;align-items:center;margin:0 0 10px;flex-wrap:wrap;}
.runbtn{
  font-family:var(--label);font-size:12px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;padding:7px 15px;border-radius:999px;cursor:pointer;
  color:#fff;background:var(--pink);border:1px solid var(--pink);
}
.runbtn:hover{background:#a3427f;border-color:#a3427f;}
.runbtn:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.runbtn.ghost{background:var(--pill);color:var(--ink);border-color:var(--pill-line);}
.runbtn.ghost:hover{background:var(--card-2);border-color:var(--faint);}
.runnote{font-size:11px;color:var(--faint);}

/* ── Fix button ─────────────────────────────────────────────────────
   Starts a Claude Code agent on the problem beside it. Deliberately not
   the loudest thing on the card: it is an action with a cost, offered
   where a problem is already visible, not a call to action. */
.fixbtn{
  flex:none;margin-left:8px;padding:2px 9px;border-radius:999px;cursor:pointer;
  font-family:var(--label);font-size:9.5px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;white-space:nowrap;
  background:#C0201F;color:#fff;border:1px solid #8E1615;
}
.fixbtn:hover{background:#D62A28;}
.fixbtn:disabled{background:var(--pill);color:var(--faint);
  border-color:var(--pill-line);cursor:default;}
.fixbtn:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.alert .fixbtn{margin:5px 0 0;align-self:flex-start;}
.alert{display:flex;flex-direction:column;}
.fixnote{font-size:10px;color:var(--faint);margin-top:3px;}
.alert-actions{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:auto;}

/* ── Narrower screens ──
   The one-screen layout needs the width to hold twelve columns AND the
   height to hold two bands of readable cards. A 2560x1440 monitor has both;
   a laptop does not — and clipping cards to keep a promise about not
   scrolling is worse than scrolling. Below the threshold the cards take
   their natural height and the view scrolls, vertically only, never
   sideways.

   The version before this forced two columns below 1500px WITHOUT relaxing
   the row template, so three rows of cards were pushed into a two-row grid
   and the bottom row was cut off with no scrollbar to say so.  */
@media (max-width:1600px), (max-height:760px){
  .view{overflow-y:auto;overflow-x:hidden;}
  /* ROWS ARE CAPPED, NOT AUTO.
     With auto, the row grew to its tallest card — the Problems list with
     fourteen alerts, 1,772px of it — and every card beside it stretched to
     match. The map card became a 440x1772 sliver with the United States
     somewhere off the top. A row is at most half the viewport; anything
     longer scrolls inside its own card, which is the whole arrangement. */
  .grid{height:auto;grid-template-rows:none!important;
    grid-auto-rows:minmax(260px,48vh);}
}
@media (max-width:1280px){
  .grid > .panel{grid-column:span 6!important;}
  .grid > .panel[style*="span 12"]{grid-column:span 12!important;}
}
@media (max-width:900px){
  .shell{position:static;grid-template-columns:1fr;overflow:visible;}
  body:has(.shell){overflow:auto;}
  .side{height:auto;flex-direction:row;flex-wrap:wrap;
    align-items:center;gap:8px;border-right:0;border-bottom:1px solid var(--bar-line);}
  .side nav{flex-direction:row;flex-wrap:wrap;gap:6px;}
  .navgroup{flex-direction:row;flex-wrap:wrap;}
  .navgroup h6{display:none;}
  .sidefoot{border-top:0;padding-top:0;}
  .mainwrap{overflow:visible;}
  .view{overflow:visible;}
  .grid > .panel{grid-column:span 12!important;}
  .top{flex-wrap:wrap;}
}

/* ── New cards ───────────────────────────────────────────────────── */

/* THE MAP CARD'S BODY IS A BOX, NOT A FLEX COLUMN.
   .body is a scrolling flex column and .body > * is pinned to
   flex:0 0 auto, so a child asking for height:100% was resolving against
   an indefinite height: the map fell back to its min-height and sat in
   part of the card with the rest left blank. Positioning it absolutely
   inside a relative body removes the question entirely — the map is
   exactly the size of the card it is in, at every width.

   NOTE FOR ANYONE EDITING THIS STYLESHEET: it lives inside a template
   literal, so a backtick anywhere in here — even in a comment — ends the
   string and breaks the build. */
.panel.flush > .body{padding:0;position:relative;display:block;overflow:hidden;}
.panel.flush > .body > *{position:absolute;inset:0;}
.openbtn{
  margin-left:6px;flex:none;width:20px;height:20px;border-radius:6px;
  border:1px solid var(--line-2);background:transparent;color:var(--muted);
  font-size:12px;line-height:1;cursor:pointer;
}
.panel > h2 .tag + .openbtn,
.panel > h2 .openbtn:first-of-type{margin-left:auto;}
.openbtn:hover{background:var(--pink-tint);border-color:var(--pink);color:var(--pink-bright);}
.openbtn:focus-visible{outline:2px solid var(--pink-bright);outline-offset:1px;}

/* ── Map ── */
/* ── The map, as a piece of glass ──
   A faint grid, a cool wash and a vignette laid over the imagery, so the
   card reads as an instrument rather than a satellite photo in a box. All
   three are pointer-events:none — they sit on top and change nothing about
   dragging, zooming or clicking a pin. */
.mapwrap{position:relative;height:100%;width:100%;overflow:hidden;
  background:#060B14;}
.mapbox{position:absolute;inset:0;background:#060B14;}
.mapbox canvas{outline:none;}
.mapwrap::before{
  content:'';position:absolute;inset:0;z-index:2;pointer-events:none;
  background:
    repeating-linear-gradient(0deg, rgba(120,200,255,.055) 0 1px, transparent 1px 42px),
    repeating-linear-gradient(90deg, rgba(120,200,255,.055) 0 1px, transparent 1px 42px);
  mix-blend-mode:screen;
}
.mapwrap::after{
  content:'';position:absolute;inset:0;z-index:3;pointer-events:none;
  background:
    radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(4,8,15,.72) 100%),
    linear-gradient(180deg, rgba(56,189,248,.06), transparent 38%, rgba(12,74,110,.14));
}

@media (prefers-reduced-motion:reduce){
  /* The grid is decoration, not information — but it stays, because it does
     not move. Only the pulses below are motion. */
}
.maplegend{
  position:absolute;left:10px;top:10px;z-index:6;
  display:flex;flex-direction:column;gap:3px;align-items:flex-start;
  background:rgba(6,11,20,.66);backdrop-filter:blur(14px) saturate(140%);
  border:1px solid rgba(120,200,255,.18);border-radius:10px;padding:8px;
  box-shadow:0 8px 28px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);
}
.maplegend .lg{
  display:flex;align-items:center;gap:7px;width:100%;
  padding:3px 7px;border:0;border-radius:5px;background:transparent;cursor:pointer;
  font-family:var(--sans);font-size:11.5px;color:var(--muted);text-align:left;
  opacity:.5;
}
.maplegend .lg.on{opacity:1;color:var(--ink-2);}
.maplegend .lg:hover{background:rgba(255,255,255,.06);}
.maplegend .lg:focus-visible{outline:2px solid var(--pink-bright);outline-offset:-2px;}
.maplegend .lg i{width:9px;height:9px;border-radius:50%;flex:none;}
.maplegend .lg b{font-family:var(--mono);font-size:11px;color:var(--ink);margin-left:auto;}
.lgswitches{display:flex;flex-direction:column;gap:2px;width:100%;margin-top:4px;
  border-top:1px solid rgba(120,200,255,.16);padding-top:5px;}
.maplegend .lg.base{justify-content:center;opacity:1;color:var(--blue-ink);
  font-size:11px;}
.maplegend .lg.base.on{color:#BAE6FD;}
.maplegend .lg.onair{opacity:1;color:var(--green);cursor:default;}
.maplegend .lg.onair b{color:var(--green);}
.maplegend .beacon{
  width:9px;height:9px;border-radius:50%;background:var(--green);flex:none;
  box-shadow:0 0 0 0 rgba(52,211,153,.7);
  animation:beacon 2.2s ease-out infinite;
}
@keyframes beacon{
  0%   {box-shadow:0 0 0 0 rgba(52,211,153,.6);}
  100% {box-shadow:0 0 0 9px rgba(52,211,153,0);}
}
@media (prefers-reduced-motion:reduce){.maplegend .beacon{animation:none;}}
.mapnote{
  position:absolute;left:10px;bottom:10px;z-index:6;
  background:rgba(6,11,20,.66);backdrop-filter:blur(14px);
  border:1px solid rgba(120,200,255,.18);border-radius:8px;
  padding:5px 9px;font-size:11px;color:var(--muted);
}
.mappop{
  position:absolute;right:10px;top:10px;z-index:7;width:262px;max-height:calc(100% - 20px);
  overflow-y:auto;background:rgba(9,15,24,.86);backdrop-filter:blur(16px) saturate(140%);
  border:1px solid rgba(120,200,255,.2);
  border-radius:11px;box-shadow:0 12px 40px rgba(0,0,0,.6);padding:12px 13px;
}
.mappop h4{margin:0 4px 3px 0;font-size:13px;font-weight:600;color:var(--ink);line-height:1.3;}
.mappop .pk{font-size:11.5px;color:var(--muted);margin-bottom:8px;}
.mappop .x{
  position:absolute;right:7px;top:6px;width:20px;height:20px;border:0;border-radius:5px;
  background:transparent;color:var(--muted);font-size:16px;line-height:1;cursor:pointer;
}
.mappop .x:hover{background:var(--pill);color:var(--ink);}
.mappop .basis{margin:8px 0 0;font-size:10.5px;line-height:1.45;color:var(--faint);}
.mappop .popl{display:inline-block;margin-top:9px;font-size:11.5px;color:var(--blue-ink);
  text-decoration:none;font-weight:600;}
.mappop .popl:hover{text-decoration:underline;}
/* State headcounts are HTML markers rather than a GL text layer — the map
   style carries no glyph server, so a symbol layer's labels would never
   draw and nothing would say why. */
.peoplepin{
  position:relative;
  display:flex;align-items:center;justify-content:center;
  border-radius:50%;border:1px solid rgba(56,189,248,.55);
  background:rgba(56,189,248,.16);color:#BAE6FD;
  font-family:var(--mono);font-size:11px;font-weight:600;cursor:pointer;
  backdrop-filter:blur(3px);
  box-shadow:0 0 0 1px rgba(8,18,30,.6), 0 0 14px rgba(56,189,248,.25);
}
.peoplepin:hover{background:rgba(56,189,248,.32);}
/* SOMEBODY FROM THIS STATE IS ON THE PRODUCT RIGHT NOW.
   Brighter, and ringed by an expanding pulse. The ring is a pseudo-element
   so it costs no extra DOM node per state. */
.peoplepin.live{
  border-color:rgba(52,211,153,.8);
  background:rgba(52,211,153,.22);color:#D1FAE5;
  box-shadow:0 0 0 1px rgba(8,18,30,.6), 0 0 18px rgba(52,211,153,.45);
}
.peoplepin.live::after{
  content:'';position:absolute;inset:-2px;border-radius:50%;
  border:1.5px solid rgba(52,211,153,.75);
  animation:pinpulse 2.2s ease-out infinite;
  pointer-events:none;
}
@keyframes pinpulse{
  0%   {transform:scale(1);   opacity:.75;}
  100% {transform:scale(2.4); opacity:0;}
}
@media (prefers-reduced-motion:reduce){
  .peoplepin.live::after{animation:none;opacity:.5;}
}
.live-now{color:var(--green);font-weight:700;}

.mapsum{display:flex;flex-direction:column;gap:10px;}
.statebars{display:flex;flex-direction:column;gap:5px;}
.statebars .sb{display:grid;grid-template-columns:26px 1fr auto;align-items:center;gap:8px;}
.statebars .sb .l{font-family:var(--mono);font-size:11px;color:var(--muted);}
.statebars .sb .bar{position:relative;height:7px;border-radius:4px;background:var(--track);
  overflow:hidden;}
.statebars .sb .bar i{position:absolute;left:0;top:0;bottom:0;background:var(--green);
  border-radius:4px;opacity:.75;}
/* The lighter overlay is the "active" subset drawn inside the same bar, so
   the two are read against each other rather than side by side. */
.statebars .sb .bar u{position:absolute;left:0;top:0;bottom:0;background:var(--blue);
  border-radius:4px;}
.statebars .sb .n{font-family:var(--mono);font-size:11.5px;color:var(--ink-2);}
.statebars .sb .n em{font-style:normal;color:var(--faint);font-size:10.5px;}
.bystate{display:flex;flex-direction:column;gap:11px;}

/* ── Activity feed ── */
.actfeed{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;}
.actfeed li{display:flex;gap:10px;align-items:flex-start;padding:8px 4px;
  border-bottom:1px solid var(--line);}
.actfeed li:last-child{border-bottom:0;}
.actfeed .fi{
  flex:none;width:26px;height:26px;border-radius:7px;display:flex;
  align-items:center;justify-content:center;font-size:12px;
  background:var(--pill);color:var(--muted);
}
.actfeed .fi.green{background:var(--green-bg);color:var(--green);}
.actfeed .fi.amber{background:var(--amber-bg);color:var(--amber);}
.actfeed .fi.red{background:var(--red-bg);color:var(--red);}
.actfeed li div{display:flex;flex-direction:column;min-width:0;gap:1px;}
.actfeed li b{font-size:12.5px;font-weight:600;color:var(--ink);}
.actfeed li span{font-size:11.5px;color:var(--muted);}

/* ── AWS ── */
.aws,.health,.railway,.awsmini{display:flex;flex-direction:column;gap:10px;}
.daily{display:flex;align-items:flex-end;gap:2px;height:64px;padding-top:4px;}
.daily.small{height:36px;}
.daily .d{flex:1;min-width:2px;border-radius:2px 2px 0 0;background:var(--blue);opacity:.75;}
.daily .d:hover{opacity:1;}
/* Today is a part-day and always looks like a collapse in spend. Hatched
   rather than solid so it never reads as a finished figure. */
.daily .d.partial{background:repeating-linear-gradient(45deg,
  var(--blue) 0 3px,transparent 3px 6px);opacity:.55;}
.dailyfoot{display:flex;justify-content:space-between;font-family:var(--mono);
  font-size:10px;color:var(--faint);}
.awsmini .big{font-family:var(--mono);font-size:30px;font-weight:600;
  letter-spacing:-.02em;color:var(--ink);line-height:1;}
.awsmini .cap{font-size:11.5px;color:var(--muted);}
.awsmini .proj{font-size:11.5px;}
.awsmini .proj .amber{color:var(--amber);font-weight:600;}
.awsmini .proj .green{color:var(--green);font-weight:600;}

.health h5{margin:6px 0 0;font-family:var(--label);font-size:10px;font-weight:700;
  letter-spacing:.13em;text-transform:uppercase;color:var(--faint);}
.mrow{display:flex;flex-direction:column;gap:5px;padding:8px 0;
  border-bottom:1px solid var(--line);}
.mrow:last-child{border-bottom:0;}
.mtop{display:flex;align-items:baseline;gap:8px;}
.mtop .l{font-size:12.5px;font-weight:600;color:var(--ink);}
.mtop .l em{font-style:normal;font-weight:400;color:var(--faint);}
.mtop .r{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--muted);}
.mbars{display:flex;flex-direction:column;gap:4px;}
.mfoot{font-family:var(--mono);font-size:10.5px;}
.meter{display:grid;grid-template-columns:34px 1fr 40px auto;align-items:center;gap:8px;}
.meter .ml{font-family:var(--label);font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--faint);}
.meter .mb{height:7px;border-radius:4px;background:var(--track);overflow:hidden;}
.meter .mb i{display:block;height:100%;border-radius:4px;background:var(--green);}
.meter .mb i.amber{background:var(--amber);}
.meter .mb i.red{background:var(--red);}
.meter .mv{font-family:var(--mono);font-size:11.5px;color:var(--ink-2);text-align:right;}
.meter .mv.amber{color:var(--amber);} .meter .mv.red{color:var(--red);}
.meter .mn{font-family:var(--mono);font-size:10.5px;}

.railway .warn{margin:0;padding:9px 11px;border-radius:7px;font-size:12px;line-height:1.45;
  background:var(--amber-bg);border:1px solid var(--amber-line);color:var(--ink-2);}
.railway .good{margin:0;padding:9px 11px;border-radius:7px;font-size:12px;
  background:var(--green-bg);border:1px solid rgba(52,211,153,.3);color:var(--ink-2);}
.trunc{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

.foot{margin:2px 0 0;font-size:10.5px;line-height:1.5;color:var(--faint);}
.tbl.tight td{padding:3px 0;}

/* KPI rows: the new cards lay their headline numbers out in a row that
   wraps, where the old .kpis was a column grid. */
.kpirow{display:flex;flex-wrap:wrap;gap:16px 26px;}
.kpirow > .kpi{min-width:96px;}
.lb{display:flex;flex-direction:column;gap:8px;padding-bottom:8px;
  border-bottom:1px solid var(--line);}
.mono,.num{font-family:var(--mono);font-variant-numeric:tabular-nums;
  font-feature-settings:"tnum";}
`
