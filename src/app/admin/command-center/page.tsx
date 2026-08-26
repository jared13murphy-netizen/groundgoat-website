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
 *           Below 1700px there isn't enough height to keep everything
 *           readable, so the grid relaxes and the page is allowed to
 *           scroll — the no-scrolling promise is for the monitor it was
 *           built for, not for a phone.
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

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

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

const CHART_TITLES: Record<string, string> = {"pulse": "Right now", "money": "Money", "crashes": "App crashes", "regrid": "Regrid budget", "failing_endpoints": "What is erroring", "people": "People", "storage": "Storage", "pipeline": "Scraper & staging"}

const EMPTY: Snapshot = { ready: false, generated_at: null, revision: 0, alerts: [], panels: {} }

/* ── Formatting. Every number on this screen goes through one of these ── */

const num = (v: any, d = 0) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

const money = (v: any) =>
  v === null || v === undefined ? '—' : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })

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

function Panel({ span, title, tag, pip, onChart, infoId, panelState, children }: {
  span: number; title: string; tag?: string; pip?: Tone
  onChart?: () => void; infoId?: string; panelState?: PanelState
  children: React.ReactNode
}) {
  const [showInfo, setShowInfo] = useState(false)
  return (
    <section className="panel" style={{ gridColumn: `span ${span}` }}>
      <h2>
        {pip ? <span className={`pip ${pip}`} /> : null}
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

/** Area sparkline with an emphasised endpoint. */
function Spark({ values, color }: { values: number[]; color: string }) {
  if (!values || values.length < 2) return null
  const W = 100, H = 100
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - (v / max) * (H - 6) - 3])
  const line = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,${H} ${line} ${W},${H}`} fill={color} opacity=".12" stroke="none" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.4" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/* ── The panels ───────────────────────────────────────────────────── */

function RightNow({ d, series }: { d: any; series: any[] | null }) {
  const rate = d.error_rate_hour_pct || 0
  const tone: Tone = rate >= 5 ? 'red' : rate >= 2 ? 'amber' : ''
  const signups = (series || []).reduce((a, p) => a + (p.signups || 0), 0)
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {d.presence_available
          ? <Kpi v={num(d.people_now)} k="People on now · last 5 min" />
          : <Kpi v={num(d.people_this_hour)}
              k={`People this hour · ${num(d.minutes_into_hour)} min in`} />}
        <Kpi v={num(d.requests_this_hour)} k="Requests this hour" />
        <Kpi v={`${num(rate, 1)}%`} k="Failing" tone={tone} />
        <Kpi v={<>{num(d.avg_ms_this_hour)}<span style={{ fontSize: 14 }}> ms</span></>}
          k="Average wait" tone={d.avg_ms_this_hour > 1000 ? 'amber' : ''} />
      </div>
      <div style={{ flex: 1, minHeight: 36 }}>
        <Spark values={(series || []).map(p => p.requests)} color="#2E6BE6" />
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <Kpi small v={d.presence_available ? num(d.people_15_min) : num(d.people_24h)}
          k={d.presence_available ? 'Last 15 minutes' : 'People today'} />
        <Kpi small v={num(d.requests_24h)} k="Requests today" />
        <Kpi small v={num(d.server_errors_24h)} k="Our bugs today" tone={d.server_errors_24h > 100 ? 'red' : ''} />
        <Kpi small v={num(signups)} k="Signups today" />
      </div>
    </>
  )
}

function Money({ d }: { d: any }) {
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Kpi v={money(d.annual_revenue)} k="Individual plans, per year" />
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
        <Row label="Renewing in 30 days" value={`${num(d.renewing_30d)} · ${money(d.renewing_30d_value)}`} />
        <Row label="Payment failed" value={num(d.past_due_people)} tone={d.past_due_people ? 'red' : ''} />
      </div>

      {/* Trials are money that has not arrived yet. While a subscription is
          trialing, its period end IS the trial end, so "ending" means "about
          to charge". */}
      {d.trials && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div className="more" style={{ marginBottom: 2 }}>Trials becoming paid</div>
          <Row label="On a free trial"
            value={`${num(d.trials.total)} · ${money(d.trials.value_all)} if all convert`} />
          <Row label="Charging within 7 days" value={num(d.trials.ending_7d)}
            tone={d.trials.ending_7d ? 'green' : ''} />
          <Row label="Charging within 30 days"
            value={`${num(d.trials.ending_30d)} · ${money(d.trials.value_30d)}`} />
          {(d.trials.soon || []).slice(0, 3).map((t: any) => (
            <div className="row" key={t.email}>
              <span className="l clamp1" style={{ color: 'var(--muted)' }}>{t.name}</span>
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

function Regrid({ d }: { d: any }) {
  const known = d.known !== false
  const pc = d.combined_pct || 0
  const tone: Tone = !known ? '' : pc >= 90 ? 'red' : pc >= 75 ? 'amber' : 'green'
  const rate = (v: number | null | undefined) =>
    v === null || v === undefined ? <span className="dim">not yet</span> : `${num(v, 1)}%`
  return (
    <>
      {/* Regrid bills the combined fraction of records AND parcel tiles, so
          that is the headline. Either half alone understates the bill. */}
      <Kpi v={known ? `${num(pc, 1)}%` : 'unknown'}
        k={`Of the year's Regrid contract · ${d.source}`}
        tone={tone === 'green' ? '' : tone} />
      {known && <div className="bar"><i className={tone} style={{ width: `${Math.min(100, pc)}%` }} /></div>}
      {!known && (
        <div className="note" style={{ color: 'var(--amber)' }}>
          {/* A count that FAILED is not a small number. Say which. */}
          {d.floor_error
            ? `Could not count the year from our own data — ${d.floor_error}.`
            : (d.cycle_note || `Regrid has not answered and our own counters started on ${d.counting_since}.`)}
          {' '}Showing 0% here would read as &ldquo;plenty left&rdquo;, which is the
          worst thing this card could get wrong.
        </div>
      )}
      <div className="rows">
        {/* The percentage is only printed when the backend says the figure
            actually covers the contract year. One day of counting shown as
            "0.1%" of an annual cap reads as "barely touched it", which is
            the worst thing this card can get wrong — so when the share is
            unknown the row carries the basis instead of a number. */}
        <Row label={`Parcel records${d.records_pct == null ? '' : ` · ${num(d.records_pct, 1)}%`}`}
          value={d.records == null
            ? <span className="dim">{d.records_basis}</span>
            : <>
                {`${d.is_floor ? '≥ ' : ''}${num(d.records)} of ${num(d.records_cap)}`}
                {d.records_pct == null && (
                  <span className="dim"> · {d.records_basis}</span>)}
              </>} />
        <Row label={`Map tiles${d.tiles_pct == null ? '' : ` · ${num(d.tiles_pct, 1)}%`}`}
          value={d.tiles == null
            ? <span className="dim">{d.tiles_basis}</span>
            : <>
                {`${d.is_floor ? '≥ ' : ''}${num(d.tiles)} of ${num(d.tiles_cap)}`}
                {d.tiles_pct == null && (
                  <span className="dim"> · {d.tiles_basis}</span>)}
              </>} />
        <Row label="Days into the year" value={num(d.days_into_year)} />
        {/* What we can answer without Regrid. The year-to-date total is not
            recoverable — the meter only starts on 25 Aug — but the rate is
            measured exactly, and "at this rate, do I blow the contract?" is
            the question that actually matters. Labelled a pace, never a
            total, with the unmeasured days stated beside it. */}
        {d.pace && (
          <Row label="On pace for"
            tone={d.pace.combined_pct >= 90 ? 'red' : d.pace.combined_pct >= 75 ? 'amber' : ''}
            value={`${num(d.pace.combined_pct, 1)}% of the year`} />
        )}
      </div>
      {d.pace && (
        <div className="note">
          {num(d.pace.records_per_day, 1)} records and {num(d.pace.tiles_per_day, 1)} tiles a day,
          measured over {num(d.pace.measured_days, 1)} day{d.pace.measured_days === 1 ? '' : 's'}
          {d.pace.unmeasured_days > 0 && <> · the {num(d.pace.unmeasured_days)} days before
            that were never counted, so this is a rate, not a year-to-date total</>}.
        </div>
      )}
      {/* Counted from our own caches when Regrid does not answer. It is a
          floor: both caches are keyed on what they cache and a re-fetch
          updates the timestamp, so a parcel bought twice is counted once. */}
      {d.is_floor && (
        <div className="note" style={{ color: 'var(--amber)' }}>
          Counted from our own cache, so these are a minimum — a parcel or
          tile bought twice this year is counted once. Records from{' '}
          {d.records_basis}, tiles from {d.tiles_basis}.
        </div>
      )}
      {/* Regrid's own figure, when the window it reports is shorter than the
          contract year. Useful, but not an answer to "how much of the year
          have I used" — so it sits here rather than in the headline. */}
      {d.regrid_cycle_days != null && d.regrid_cycle_days < 350 && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          <div className="more" style={{ marginBottom: 2 }}>
            Regrid&rsquo;s own {num(d.regrid_cycle_days)}-day cycle
          </div>
          <Row label="Records they counted" value={num(d.regrid_cycle_records)} />
          <Row label="Tiles they counted" value={num(d.regrid_cycle_tiles)} />
        </div>
      )}
      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <Row label="Parcel lookups today" value={num(d.parcel_lookups_24h)} />
        <Row label="Saved by our cache" value={rate(d.parcel_cache_pct)} />
        <Row label="Map tiles today" value={num(d.tiles_24h)} />
        <Row label="Tiles saved by our cache" value={rate(d.tile_cache_pct)} />
      </div>
      <div className="note">
        {d.cycle_note
          ? <span style={{ color: 'var(--amber)' }}>{d.cycle_note} </span>
          : `Contract year started ${d.contract_year_start}. `}
        Cache counting started {d.counting_since}.
      </div>
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
  const sorted = [...jobs].sort((a, b) => (bad.has(b.raw_name) ? 1 : 0) - (bad.has(a.raw_name) ? 1 : 0))
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
                  {failing ? <Chip tone="red">failed {num(j.consecutive_failures)}x</Chip>
                    : stuck ? <Chip tone="amber">stuck</Chip>
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
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi v={num(d.last_hour)} k="Last hour" tone={d.last_hour ? 'red' : ''} />
        <Kpi small v={num(d.last_24h)} k="Last 24 hours" />
        <Kpi small v={num(d.last_7d)} k="Last 7 days" tone={d.last_7d ? 'amber' : ''} />
      </div>
      {/* "Last 24 hours" is a rolling window, so it falls as crashes age out
          of it. The 7-day and all-time figures sit beside it so a drop can
          always be told apart from data going missing. */}
      <div className="rows">
        <Row label="Signed-in people hit, 24 hours" value={num(d.users_affected_24h)}
          tone={d.users_affected_24h ? 'red' : ''} />
        <Row label="Crashes with nobody signed in, 24 hours" value={num(d.signed_out_24h)}
          tone={d.signed_out_24h ? 'amber' : ''} />
        <Row label="Ever recorded"
          value={`${num(d.all_time)} · newest ${d.newest_report ? ago(d.newest_report) + ' ago' : 'none'}`} />
      </div>
      {/* The list below spans 7 days, not the 24 hours above it — labelled,
          because mixing the two silently is how a 59-crash row ended up
          under a headline of 12. */}
      <div className="more" style={{ marginTop: 2 }}>Who it hit · last 7 days</div>
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
          {/* A "phone" with 16 GB or more is a Mac running the simulator —
              your own testing, not a customer. Worth separating before
              treating a burst as a fleet-wide problem. */}
          {d.diagnosis.simulator_like > 0 && (
            <Row label="On the simulator, not a phone"
              value={`${num(d.diagnosis.simulator_like)} · ${num(d.diagnosis.simulator_pct, 0)}%`}
              tone="amber" />
          )}
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

function Storage({ d, trend }: { d: any; trend: any }) {
  return (
    <>
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
                {s.live ? null : <Chip>measured {s.measured_at}</Chip>}
                <span className="pc" style={tone === 'red' ? { color: 'var(--red)' } : undefined}>
                  {capped ? `${num(pc, 1)}%` : `${num(s.used_gb)} GB`}
                </span>
              </div>
              {capped && <div className="bar"><i className={tone} style={{ width: `${Math.min(100, pc)}%` }} /></div>}
              <div className="note">
                {capped ? `${num(s.used_gb)} of ${num(s.cap_gb)} GB · ${num(s.free_gb)} GB left · ${s.note}` : s.note}
              </div>
            </div>
          )
        })}
      </div>
      {trend && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <Row label="Main database is growing" value={`${num(trend.growth_gb_per_day, 2)} GB a day`} />
          {trend.days_to_cap !== null && trend.days_to_cap !== undefined && (
            <Row label="Full in" value={`about ${num(trend.days_to_cap)} days`}
              tone={trend.days_to_cap <= 120 ? 'red' : ''} />
          )}
          <div className="more" style={{ margin: '6px 0 3px' }}>Biggest tables</div>
          {(trend.biggest_tables || []).slice(0, 3).map((t: any) => (
            <div className="row" key={t.table}>
              {/* state_parcels is retired. It is only ever shown as wasted space. */}
              <span className="l" style={t.table === 'state_parcels' ? { color: 'var(--amber)' } : undefined}>
                {t.table}{t.table === 'state_parcels' ? ' — retired, pure waste' : ''}
              </span>
              <span className="r">{num(t.gb, 0)} GB</span>
            </div>
          ))}
        </div>
      )}
      <div className="note">A Railway database disk cannot go past 1,000 GB. There is no bigger size to buy.</div>
    </>
  )
}

function Pipeline({ d }: { d: any }) {
  const poly = d.polygon_pct
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi v={num(d.found)} k="Found last night"
          tone={d.run_anchored_to_job && d.found === 0 ? 'amber' : ''} />
        <Kpi small v={num(d.waiting)} k="Waiting for you" />
        <Kpi small v={num(d.verified_today)} k="Verified today" />
      </div>
      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <Row label="Auctions / private treaty"
          value={`${num(d.found_auctions)} / ${num(d.found_private_treaty)}`} />
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
              {!d.run_anchored_to_job && ' No job record, so this counts from midnight.'}</>
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
        {line('Tillable acres bigger than total acres', d.tillable_over_total)}
        {line('Acres recorded as zero or less', d.bad_acres)}
        {line('Listing with no location on the map', d.listings_no_location)}
      </div>
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

function Reach({ notif, email, fixes }: { notif: any; email: any; fixes?: any }) {
  // Only really_failed_24h is a fault. The other three reasons are facts
  // about the audience — no device, notifications off, malformed token — and
  // lumping them together as "tried but did not send" is what produced a
  // wildly wrong 182.
  const failing = (notif?.really_failed_24h || 0) > 0
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Kpi small v={num(notif?.pushed_24h)} k="Pushes sent today" />
        <Kpi small v={num(email?.sent_24h)} k="Emails sent today" />
      </div>
      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <Row label="Pushes in the last hour" value={num(notif?.pushed_1h)} />
        <Row label="Last push"
          value={notif?.last_push ? `${ago(notif.last_push)} ago` : <span className="dim">none yet</span>} />
        <div className="row">
          <span className="l" style={failing ? { color: 'var(--red)' } : undefined}>
            Failed to send
          </span>
          <span className="r" style={failing ? { color: 'var(--red)' } : undefined}>
            {num(notif?.really_failed_24h)}
          </span>
          {failing && <FixButton compact fixes={fixes}
            issue={{ key: 'push:failed', title: 'Push notifications are failing to send',
              where: 'Notifications',
              detail: `${num(notif.really_failed_24h)} notifications in the last day went to users with a live device, notifications on and a valid token, and still did not send.`,
              evidence: notif }} />}
        </div>
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
type CardInfo = { covers: string; source: string; caveat?: string }

const CARD_INFO: Record<string, CardInfo> = {
  pulse: {
    covers: 'Traffic and errors for the clock hour in progress, with the last full day underneath.',
    source: 'hourly_endpoint_metrics and hourly_user_activity, written by the request middleware and flushed about every 10 seconds.',
    caveat: '"People on now" is a true rolling five minutes, from a Redis set the request middleware keeps — not an hourly bucket. If Redis is unavailable it falls back to the clock hour and the label says so. Failed requests exclude 401 and 403 — an expired token is not a fault.',
  },
  money: {
    covers: 'Annual value of every live subscription, plus trials about to charge and who has cancelled. A firm counts once, at its admin\u2019s row.',
    source: 'user_subscriptions. When billing_cycle is annual, monthly_price already holds the annual figure — for Stripe plans, Apple IAP, and firms alike.',
    caveat: 'Trials are shown separately and are not in the total — while a subscription is trialing its period end IS the trial end, so "charging within 7 days" means it is about to bill. Past-due subscriptions are still counted: that money is in dunning, not lost. Cancellations are ones that have already happened; there is no cancel-at-renewal flag stored, so a subscription set to lapse at its next renewal still looks live until it does.',
  },
  people: {
    covers: 'Accounts, who actually used the product, and who never subscribed.',
    source: 'users for the counts; hourly_user_activity for "used it", which is real requests.',
    caveat: 'Not last_login — that column is only written by the password sign-in handler, so anyone on the phone app never touches it. "Never subscribed" is not a drop-off rate: checkout starts are not logged yet.',
  },
  crashes: {
    covers: 'Crashes reported by the phone app, and who they happened to.',
    source: 'mobile_crash_reports, posted by the app\u2019s global error handler.',
    caveat: '"Last 24 hours" is a rolling window, so crashes age out of it and the number falls — the 7-day and all-time figures beside it exist so that can never look like data going missing. "What they had on screen" comes from the app\u2019s own black box, which records the map state before each death; an iOS memory kill runs no JavaScript, so that snapshot is the only evidence such a crash ever leaves. Crashes with nobody signed in are counted separately, since they carry no user to attribute.',
  },
  regrid: {
    covers: 'How much of the annual Regrid contract is used: parcel records and map tiles, combined the way Regrid bills.',
    source: 'Regrid\u2019s own /api/v2/usage endpoint where reachable, our own counters otherwise. The card says which.',
    caveat: 'Records alone understate it — tiles are usually the larger half of the bill. Regrid\u2019s own endpoint reports whatever billing cycle they are running, which may be far shorter than the contract year; when it is, the year is counted from our own caches instead and their figure is shown separately. Cache counts are a minimum: a parcel bought twice in the year is stored once, so it is counted once.',
  },
  failing_endpoints: {
    covers: 'Endpoints that returned errors in the last three hours.',
    source: 'hourly_endpoint_metrics.',
    caveat: 'Excludes 401 and 403, which are usually expired tokens rather than faults. Red marks a 5xx — our bug, not a bad request.',
  },
  slow_endpoints: {
    covers: 'The slowest endpoints over the last day, by how long an unlucky request takes.',
    source: 'The latency histogram in hourly_endpoint_metrics.',
    caveat: '"Slowest 5%" is read off histogram bucket edges, so it is the top of the bucket rather than an exact figure. Endpoints under 20 requests are left out as too noisy to rank.',
  },
  jobs: {
    covers: 'Every scheduled job, when it last ran and whether it worked.',
    source: 'system_job_runs, written automatically by the scheduler wrapper.',
    caveat: 'Only jobs that run through the scheduler, plus anything that posts to the report endpoint (backups do). Something triggered by hand does not appear. "Stuck" means it claimed to be running for over an hour.',
  },
  storage: {
    covers: 'Every place data is kept, as a share of its ceiling.',
    source: 'pg_database_size for databases the backend connects to; the rest were measured by hand on the date shown.',
    caveat: 'A Railway Postgres disk cannot exceed 1,000 GB, so percentage matters more than gigabytes. Rows marked with a date are not live readings.',
  },
  pipeline: {
    covers: 'What the overnight scrape found, what published, and what is waiting for review.',
    source: 'listing_staging and listings, with the window anchored to the nightly job\u2019s own recorded start.',
    caveat: 'If the job never recorded a run, the window falls back to midnight Central and the card says so. A tract without a boundary cannot be published, which is why boundary coverage is shown rather than a raw count.',
  },
  data_quality: {
    covers: 'Records that contradict themselves — the sort of thing a subscriber notices first.',
    source: 'listings and tracts.',
    caveat: 'Duplicates are matched on identical title, county and state; source URLs are unique, so a genuine duplicate only gets in through differently-encoded URLs for one page.',
  },
  reach: {
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

function TrendsDrawer({ openFor, title, series, onClose }:
  { openFor: string | null; title: string; series: any[]; onClose: () => void }) {
  const open = openFor !== null
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}
        style={{ width: 'min(760px,74vw)', gridTemplateRows: 'auto minmax(0,1fr)' }}
        aria-label={`${title} over time`}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <span className="sub">last 14 days</span>
          <button type="button" className="drawer-close" onClick={onClose}>Close ·  Esc</button>
        </div>
        <div className="charts">
          {(series || []).length === 0
            ? <div className="note">No history for this card yet.</div>
            : series.map((sr: any, i: number) => {
              const pts = sr.points || []
              const cur = pts.length ? pts[pts.length - 1].v : null
              // Compare the last three days with the three before them —
              // steadier than yesterday-versus-today on low-volume series.
              const tail = pts.slice(-3), prev = pts.slice(-6, -3)
              const avg = (a: any[]) => a.length ? a.reduce((s, p) => s + p.v, 0) / a.length : null
              const now = avg(tail), was = avg(prev)
              const pct = (now !== null && was) ? ((now - was) / was) * 100 : null
              return (
                <div className="chartcard" key={i}>
                  <h4>{sr.label}</h4>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span className="cur">{cur === null ? '—' : num(cur, sr.unit === 'GB' ? 1 : 0)}</span>
                    {sr.unit && <span className="note">{sr.unit}</span>}
                    {pct !== null && Math.abs(pct) >= 1 && (
                      <span className={`delta ${pct > 0 ? 'up' : 'down'}`}>
                        {pct > 0 ? '▲' : '▼'} {num(Math.abs(pct), 0)}% vs the three days before
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
          </span>
          <button type="button" className="drawer-close" onClick={onClose}>Close ·  Esc</button>
        </div>
        <div className="drawer-body">
          {runs.length === 0 ? (
            <div className="drawer-empty" style={{ display: 'block', textAlign: 'left', color: 'var(--ink)' }}>
              <p style={{ margin: '0 0 10px' }}>Nothing has been looked at yet.</p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--faint)' }}>
                Press Diagnose on any problem. Opus 5 reads the code and reports
                what is wrong and the change it would make. It cannot edit or deploy.
              </p>
            </div>
          ) : (
            <div className="agent-list" style={{ color: 'var(--ink)' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {runs.map(r => (
                  <button key={r.id} type="button" onClick={() => setPicked(r.id)}
                    className="fixbtn"
                    style={{
                      background: current?.id === r.id ? tone(r) : 'transparent',
                      borderColor: tone(r),
                      color: current?.id === r.id ? '#fff' : 'var(--ink)',
                    }}>
                    {(r.issue?.title || 'untitled').slice(0, 34)}
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
                  </div>
                  {current.error && (
                    <div style={{ color: 'var(--red)', marginBottom: 10 }}>{current.error}</div>
                  )}
                  <pre style={{
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
                    fontSize: 12, lineHeight: 1.5, color: 'var(--ink)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}>
                    {(current.output || []).join('\n\n') ||
                      (current.status === 'working' ? 'Reading the code…' : '(nothing reported)')}
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

function AlertStrip({ alerts, fixes, onOpenFindings }:
  { alerts: Alert[]; fixes?: any; onOpenFindings?: () => void }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(true)
  const reds = alerts.filter(a => a.level === 'red').length
  // A finished diagnosis rides in this strip so it cannot be lost, but it is
  // an answer, not a problem — counting it would inflate "things to look at".
  const ambers = alerts.filter(a => a.level === 'amber').length

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const check = () => setFits(el.scrollWidth <= el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [alerts])

  return (
    <section className="alerts" aria-label="Alerts" aria-live="polite">
      <div className={`verdict ${reds ? '' : ambers ? 'warn' : 'clear'}`}>
        <span className="big">
          {reds ? `${reds} problem${reds === 1 ? '' : 's'}` : ambers ? `${ambers} to look at` : 'All clear'}
        </span>
        <span className="small">
          {reds ? (ambers ? `and ${ambers} more to look at` : 'needing you now')
            : ambers ? 'nothing urgent' : 'nothing needs you'}
        </span>
      </div>
      <div className={`alert-row ${fits ? 'fits' : ''}`} ref={rowRef}>
        {alerts.length === 0
          ? <div className="all-clear">Nothing is broken. Every check passed.</div>
          : alerts.map(a => (
            <article className={`alert ${a.level}`} key={a.key}>
              <div className="where">{a.where}</div>
              <div className="title">{a.title}</div>
              <div className="detail">{a.detail}</div>
              {a.level === 'info'
                ? <button type="button" className="fixbtn" onClick={onOpenFindings}>
                    Read it
                  </button>
                : <FixButton compact issue={{ key: a.key, title: a.title, detail: a.detail,
                    where: a.where }} fixes={fixes} />}
            </article>
          ))}
      </div>
    </section>
  )
}

/* ── The screen ───────────────────────────────────────────────────────
   Twelve columns, three rows. Panel order is by "would this wake him at
   2am": failures first, money second, everything else after. */

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

  const pulse = P('pulse'), moneyD = P('money'), peopleD = P('people'), regridD = P('regrid')
  const erroringD = P('failing_endpoints'), slowD = P('slow_endpoints'), jobsD = P('jobs'), crashD = P('crashes')
  const storageD = P('storage'), pipelineD = P('pipeline'), qualityD = P('data_quality')
  const notifD = P('notifications'), emailD = P('email')
  const agentsD = P('agents')
  const trendsD = P('trends') || {}
  const fixesD = P('fixes')
  /* A chart button appears only where the backend returned a series. */
  const chart = (key: string) =>
    (trendsD[key] || []).length ? () => setChartFor(key) : undefined

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="shell">
        <header className="rail">
          <div className="mark">
            <h1>Ground Goat <em>Command Center</em></h1>
            <span className="sub">Admins only</span>
          </div>
          <button type="button" className="devbtn" onClick={() => setDevOpen(true)}
            aria-expanded={devOpen}>
            Developers{(agentsD?.working || 0) + (fixesD?.working || 0)
              ? <> · <span className="count">{num((agentsD?.working || 0) + (fixesD?.working || 0))}</span></>
              : null}
          </button>
          <button type="button" className="devbtn" onClick={() => setFixOpen(true)}
            aria-expanded={fixOpen}>
            Findings{fixesD?.working ? <> · <span className="count">{num(fixesD.working)}</span></> : null}
          </button>
          <a className="back" href="/admin/dashboard">&larr; Admin</a>
          <div className="rail-spacer" />
          <span className={`pill ${connected ? '' : 'off'}`}>
            <span className="dot" />
            {connected ? 'Live' : 'Reconnecting'}
          </span>
          <div className="stat">
            Last updated <b>{snap.generated_at ? ago(snap.generated_at) : '—'}</b> ago
          </div>
          {snap.stale && <div className="stat stale">Updates have stopped</div>}
          <div className="clock">{clock}</div>
        </header>

        <AlertStrip alerts={snap.alerts || []} fixes={fixesD}
          onOpenFindings={() => setFixOpen(true)} />

        <main className="field">
          <Panel span={4} title="Right now" tag="last 24 hours below" infoId="pulse" panelState={st('pulse')} onChart={chart('pulse')}
            pip={!pulse ? undefined : pulse.error_rate_hour_pct >= 5 ? 'red' : pulse.error_rate_hour_pct >= 2 ? 'amber' : 'green'}>
            {pulse ? <RightNow d={pulse} series={P('traffic_series')} /> : <Unavailable why={whyMissing('pulse')} />}
          </Panel>

          <Panel span={3} title="Money" tag="per year" infoId="money" panelState={st('money')} onChart={chart('money')} pip={!moneyD ? undefined : moneyD.past_due_people ? 'amber' : 'green'}>
            {moneyD ? <Money d={moneyD} /> : <Unavailable why={whyMissing('money')} />}
          </Panel>

          <Panel span={3} title="App crashes" infoId="crashes" panelState={st('crashes')} onChart={chart('crashes')}
            pip={!crashD ? undefined : crashD.last_hour ? 'red' : crashD.last_24h ? 'amber' : 'green'}>
            {crashD ? <Crashes d={crashD} /> : <Unavailable why={whyMissing('crashes')} />}
          </Panel>

          <Panel span={2} title="Regrid budget" infoId="regrid" panelState={st('regrid')} onChart={chart('regrid')}
            pip={!regridD ? undefined : regridD.records_used_pct >= 90 ? 'red' : regridD.records_used_pct >= 75 ? 'amber' : 'green'}>
            {regridD ? <Regrid d={regridD} /> : <Unavailable why={whyMissing('regrid')} />}
          </Panel>

          <Panel span={3} title="What is erroring" infoId="failing_endpoints" panelState={st('failing_endpoints')} onChart={chart('failing_endpoints')} pip={!erroringD ? undefined : erroringD.length ? 'red' : 'green'}>
            {erroringD ? <Erroring d={erroringD} /> : <Unavailable why={whyMissing('failing_endpoints')} />}
          </Panel>

          <Panel span={3} title="Slowest things" infoId="slow_endpoints" panelState={st('slow_endpoints')}
            pip={!slowD ? undefined : slowD.some((e: any) => e.p95_ms >= 5000) ? 'amber' : 'green'}>
            {slowD ? <Slowest d={slowD} /> : <Unavailable why={whyMissing('slow_endpoints')} />}
          </Panel>

          <Panel span={3} title="Background jobs" infoId="jobs" panelState={st('jobs')}
            pip={!jobsD ? undefined : (jobsD.failing || []).length ? 'red' : (jobsD.stuck || []).length ? 'amber' : 'green'}>
            {jobsD ? <Jobs d={jobsD} /> : <Unavailable why={whyMissing('jobs')} />}
          </Panel>

          <Panel span={3} title="People" infoId="people" panelState={st('people')} onChart={chart('people')} pip={peopleD ? 'green' : undefined}>
            {peopleD ? <People d={peopleD} /> : <Unavailable why={whyMissing('people')} />}
          </Panel>

          <Panel span={4} title="Storage" tag="share of the ceiling" infoId="storage" panelState={st('storage')} onChart={chart('storage')}
            pip={!storageD ? undefined : (storageD.stores || []).some((s: any) => (s.pct_of_cap || 0) >= 90) ? 'red' : 'amber'}>
            {storageD ? <Storage d={storageD} trend={P('storage_trend')} /> : <Unavailable why={whyMissing('storage')} />}
          </Panel>

          <Panel span={3} title="Scraper & staging" infoId="pipeline" panelState={st('pipeline')} onChart={chart('pipeline')}
            pip={!pipelineD ? undefined
              : pipelineD.run_failures ? 'red'
              : pipelineD.listings_missing_main_image || pipelineD.tracts_boundary_missing_image ? 'amber' : 'green'}>
            {pipelineD ? <Pipeline d={pipelineD} /> : <Unavailable why={whyMissing('pipeline')} />}
          </Panel>

          <Panel span={3} title="Data quality" infoId="data_quality" panelState={st('data_quality')}
            pip={!qualityD ? undefined
              : qualityD.valid_but_no_boundary || qualityD.past_auctions_no_price ? 'amber' : 'green'}>
            {qualityD ? <Quality d={qualityD} fixes={fixesD} /> : <Unavailable why={whyMissing('data_quality')} />}
          </Panel>

          <Panel span={2} title="Notifications &amp; email" infoId="reach" panelState={st('notifications')} pip={notifD?.overdue ? 'amber' : 'green'}>
            {notifD || emailD ? <Reach notif={notifD} email={emailD} fixes={fixesD} /> : <Unavailable why={whyMissing('notifications')} />}
          </Panel>
        </main>
      </div>
      <AgentDrawer open={devOpen} onClose={() => setDevOpen(false)} data={agentsD} fixes={fixesD} />
      <FixDrawer open={fixOpen} onClose={() => setFixOpen(false)} data={fixesD} />
      <TrendsDrawer openFor={chartFor} onClose={() => setChartFor(null)}
        title={chartFor ? (CHART_TITLES[chartFor] || 'Trend') : ''}
        series={chartFor ? (trendsD[chartFor] || []) : []} />
    </>
  )
}

/* ── Styles ───────────────────────────────────────────────────────────
   Kept as one string rather than a Tailwind soup: this is a fixed-height
   instrument panel, and its grid, density and light palette are the
   design, not incidental utility classes. */
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
  /* Ground Goat: pink, black and white, with blue as the one highlight.
     The pink and black are the site's own brand values; pink only shifts
     darker where it has to carry text on white. */
  --paper:#F7F7F8;          /* flat fallback for --page */
  /* White at the top falling to grey at the bottom. The cards nearest the
     top separate on their shadow alone, which is why the shadow does the
     lifting here and the border is only a hairline. */
  /* Mission Control sits on a flat near-white, not a gradient — the
     cards do the separating. */
  --page:linear-gradient(180deg,#FAFAFB 0%,#F4F4F6 100%);
  --card:#FFFFFF;
  --card-2:#FFFFFF;         /* card headers: white, like Mission Control */
  --head-line:#ECECEF;      /* the hairline under a card header */
  --track:#EAEAEE;          /* unfilled part of a progress bar */
  --ink:#0A0A0A;            /* gg-black */
  --ink-2:#2A2A2A;          /* gg-gray-700 */
  --muted:#555555;          /* gg-gray-500 */
  --faint:#888888;          /* gg-gray-400 */
  --line:#E6E6EA; --line-2:#D8D8DE;

  /* Brand pink. #f58cde is the site's value and is too light to carry
     text on white, so type and strokes use the dark tone and fills use
     the bright one. */
  --pink:#B84C97; --pink-bright:#F58CDE; --pink-tint:#F8DAF1;
  /* The top bar. Black, with everything on it in white — the one place
     on this page that inverts, so the panels below read as the content. */
  --bar:#0A0A0A; --on-bar:#FFFFFF; --on-bar-dim:rgba(255,255,255,.68);
  --bar-line:#0A0A0A; --pill:rgba(255,255,255,.10); --pill-line:rgba(255,255,255,.28);

  /* The highlight. Deliberately used twice on the whole screen — the
     traffic line and the live dot — so it stays a highlight. */
  --blue:#2E6BE6;
  --blue-pill:#DCE9FF; --blue-pill-hi:#B4D0FF; --blue-pill-line:#A9C6F5;
  --blue-ink:#12459E;
  /* Royal blue, for the info and chart buttons. */
  --royal:#2B4FCB; --royal-hi:#1E3BA6; --royal-line:#1B379B;

  /* State colours, kept apart from the brand on purpose: if something on
     this screen is red, something is actually wrong. */
  --red:#C8102E; --red-bg:#FDEEF1; --red-line:#F2C3CD;
  --amber:#9A6400; --amber-bg:#FDF4E5; --amber-line:#EBD7A8;
  --green:#2E7D46; --green-bg:#EFF6F1;
  --r:7px;
  --lift:0 1px 2px rgba(16,16,20,.10), 0 4px 12px rgba(16,16,20,.16);
  --lift-hi:0 2px 4px rgba(16,16,20,.14), 0 8px 22px rgba(16,16,20,.22);
  /* DM Sans is the website's own body face (globals.css), so the dashboard
     reads as part of Ground Goat rather than as a separate tool. It carries
     the wordmark, every label and all running text.
     IBM Plex Mono stays for figures only — digits have to line up in
     columns, and a proportional face cannot do that. */
  --sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;
  --label:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace;
}
/* Scoped to the page's own subtree — this file must not restyle the rest
   of the admin app, which is still on the site's dark shell. */
.shell,.shell *,.booting{box-sizing:border-box;}
body:has(.shell){overflow:hidden;}
.shell,.booting{
  background:var(--paper);
  background-image:var(--page);
  background-attachment:fixed;
  color:var(--ink);
  font-family:var(--sans); font-size:13px; line-height:1.35;
  -webkit-font-smoothing:antialiased;
}
.booting{display:flex;align-items:center;justify-content:center;height:100dvh;
  color:var(--muted);font-family:var(--label);letter-spacing:.06em;text-transform:uppercase;}
.dot.off{background:var(--amber);}
.stat.stale{color:#FF8A8A;font-weight:700;}
.back{font-family:var(--label);font-size:11px;letter-spacing:.07em;text-transform:uppercase;
  color:var(--on-bar);text-decoration:none;border:1px solid var(--pill-line);border-radius:999px;
  padding:4px 12px;background:var(--pill);}
.back:hover{background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.6);}
.back:focus-visible{outline:2px solid var(--pink);outline-offset:2px;}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;font-feature-settings:"tnum";}

/* ── Frame: three bands, the last one fills whatever is left ── */
.shell{
  /* Covers the site's fixed navigation and footer. This page is an
     instrument panel, not a page in the site — sharing the chrome would
     cost it the two things it was asked for, the full width and the
     absence of scrolling. The Admin link in the rail is the way back. */
  position:fixed;inset:0;z-index:60;
  display:grid;grid-template-rows:auto auto minmax(0,1fr);gap:9px;padding:0;
}

/* ── Header rail ── */
.rail{display:flex;align-items:center;gap:14px;
  /* Runs edge to edge: no radius, no margin, and the shell below carries
     the page inset instead of wrapping this bar in it. */
  padding:9px 16px;border-radius:0;
  background:var(--bar);border-bottom:1px solid var(--bar-line);
  position:relative;z-index:2;}
.mark{display:flex;align-items:baseline;gap:9px;}
.mark h1{
  font-family:var(--sans);font-weight:700;font-size:18px;letter-spacing:.055em;
  margin:0;text-transform:uppercase;color:var(--on-bar);
}
.mark h1 em{font-style:normal;font-weight:500;color:var(--pink-bright);}
.mark .sub{font-family:var(--label);font-size:11px;color:var(--on-bar-dim);font-weight:600;
  letter-spacing:.09em;text-transform:uppercase;}
.rail-spacer{flex:1;}
.stat{display:flex;align-items:center;gap:6px;font-family:var(--label);font-size:11.5px;
      letter-spacing:.05em;text-transform:uppercase;color:var(--on-bar-dim);}
.stat b{font-family:var(--mono);font-weight:600;color:var(--on-bar);letter-spacing:0;text-transform:none;}
/* The live indicator. A pill rather than a dot so it reads at a glance
   from across the room, and the background pulses so a frozen page is
   obvious: if this stops moving, the numbers have stopped too. */
.pill{
  display:inline-flex;align-items:center;gap:6px;
  padding:3px 11px;border-radius:999px;
  font-family:var(--label);font-size:11px;font-weight:700;
  letter-spacing:.12em;text-transform:uppercase;
  background:var(--blue-pill);color:var(--blue-ink);
  border:1px solid var(--blue-pill-line);
  animation:livepulse 2.2s ease-in-out infinite;
}
.pill .dot{width:6px;height:6px;border-radius:50%;background:var(--blue-ink);flex:none;}
.pill.off{
  background:var(--amber-bg);color:var(--amber);border-color:var(--amber-line);
  animation:none;
}
.pill.off .dot{background:var(--amber);}
@keyframes livepulse{
  0%,100%{background:var(--blue-pill);}
  50%    {background:var(--blue-pill-hi);}
}
@media (prefers-reduced-motion:reduce){.pill{animation:none;}}
.clock{font-family:var(--mono);font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--on-bar);}
.seg{display:flex;border:1px solid rgba(255,255,255,.28);border-radius:var(--r);overflow:hidden;}
.seg button{
  font-family:var(--label);font-size:11px;letter-spacing:.06em;text-transform:uppercase;
  padding:4px 9px;border:0;background:rgba(255,255,255,.10);color:var(--on-bar-dim);cursor:pointer;
}
.seg button+button{border-left:1px solid rgba(255,255,255,.28);}
.seg button[aria-pressed="true"]{background:#fff;color:var(--ink);}
.seg button:focus-visible{outline:2px solid var(--pink);outline-offset:-2px;}

/* ── Alert strip: the one thing that must be impossible to miss ── */
.alerts{
  display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:stretch;
  /* Room below for the cards' shadows, pulled back with a negative margin so
     the strip still occupies the same height. Without it the shadow was
     sliced flat against the row underneath. */
  padding:0 9px 16px;
  margin-bottom:-16px;
}
.verdict{
  display:flex;flex-direction:column;justify-content:center;gap:1px;
  padding:9px 16px;border-radius:var(--r);min-width:190px;
  border:1px solid var(--red-line);background:var(--red-bg);
  box-shadow:var(--lift-hi);
}
.verdict .big{font-family:var(--sans);font-weight:700;font-size:24px;line-height:1.05;
  letter-spacing:.01em;text-transform:uppercase;color:var(--red);}
.verdict .small{font-family:var(--label);font-size:11px;letter-spacing:.05em;
  text-transform:uppercase;color:var(--muted);}
.verdict.clear{border-color:#C6DECF;background:var(--green-bg);}
.verdict.clear .big{color:var(--green);}
.verdict.warn{border-color:var(--amber-line);background:var(--amber-bg);}
.verdict.warn .big{color:var(--amber);}

.alert-row{display:flex;gap:7px;overflow-x:auto;overflow-y:hidden;
  scrollbar-width:thin;position:relative;
  /* overflow-x:auto forces overflow-y to compute as auto, so anything drawn
     past this box is clipped — a shadow included. The bottom padding is the
     shadow's room to exist inside the scroller; the negative margin keeps
     the strip its original height, letting the shadow fall behind the cards
     on the row below rather than being cut off against them. */
  padding:3px 2px 22px;
  margin-bottom:-18px;
  -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 52px),transparent 100%);
  mask-image:linear-gradient(90deg,#000 calc(100% - 52px),transparent 100%);}
.alert-row.fits{-webkit-mask-image:none;mask-image:none;}
.alert{
  flex:0 0 auto;max-width:296px;min-width:186px;
  border:1px solid var(--line);border-left:4px solid var(--faint);
  border-radius:var(--r);background:var(--card);padding:7px 11px;
  box-shadow:var(--lift-hi);
}
.alert.red{border-left-color:var(--red);background:var(--red-bg);border-color:var(--red-line);}
.alert.amber{border-left-color:var(--amber);background:var(--amber-bg);border-color:var(--amber-line);}
.alert.info{border-left-color:var(--royal);background:#EEF2FF;border-color:#C7D2FE;}
.alert .where{font-family:var(--label);font-size:9.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
.alert .title{font-weight:600;font-size:13px;margin:1px 0 2px;line-height:1.2;text-wrap:balance;}
.alert.red .title{color:var(--red);}
.alert.amber .title{color:var(--amber);}
.alert.info .title{color:var(--royal);}
.alert .detail{font-size:11.5px;color:var(--ink-2);line-height:1.3;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.all-clear{display:flex;align-items:center;padding:0 14px;border:1px solid #C6DECF;
  border-radius:var(--r);background:var(--green-bg);color:var(--green);font-size:13px;
  box-shadow:var(--lift-hi);}

/* ── Panel field ── */
.field{display:grid;padding:0 9px 9px;grid-template-columns:repeat(12,minmax(0,1fr));
  grid-template-rows:minmax(0,1.12fr) minmax(0,.64fr) minmax(0,1.24fr);gap:9px;min-height:0;}
.panel{
  min-height:0;display:flex;flex-direction:column;overflow:hidden;
  background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  box-shadow:var(--lift);
}
.panel > h2{
  flex:none;margin:0;display:flex;align-items:center;gap:7px;
  padding:7px 11px;border-bottom:1px solid var(--line-2);
  background:linear-gradient(180deg,#FFFFFF 0%,#F4F4F7 55%,#E9E9EE 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9), 0 1px 0 rgba(16,16,20,.04);
  font-family:var(--label);font-weight:700;font-size:11px;
  letter-spacing:.085em;text-transform:uppercase;color:var(--ink);
  text-shadow:0 1px 0 rgba(255,255,255,.75);
}
.panel > h2 .tag{margin-left:auto;font-size:10px;letter-spacing:.06em;
  color:var(--faint);font-weight:600;}
.panel > h2 .pip{width:7px;height:7px;border-radius:50%;background:var(--pink-bright);flex:none;}
.panel > h2 .pip.red{background:var(--red);} .panel > h2 .pip.amber{background:var(--amber);}
.panel > h2 .pip.green{background:var(--green);}
.body{min-height:0;flex:1;overflow-y:auto;overflow-x:hidden;padding:9px 11px;
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
td{padding:3.5px 0;border-bottom:1px solid #F1F1F3;vertical-align:baseline;}
tr:last-child td{border-bottom:0;}
td.n,th.n{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;
   white-space:nowrap;padding-left:14px;}
th.n{font-family:var(--label);}
td.t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0;width:100%;}
td.red,.red-t{color:var(--red);} td.amber{color:var(--amber);} td.dim{color:var(--muted);}

.rows{display:flex;flex-direction:column;gap:5px;min-height:0;}
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
.drawer-close{margin-left:8px;background:var(--pill);color:var(--on-bar);
  border:1px solid var(--pill-line);border-radius:999px;cursor:pointer;
  font-family:var(--label);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
  padding:4px 10px;}
.drawer-close:hover{background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.6);}
.drawer-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,420px);
  min-height:0;gap:1px;background:var(--line);}
.agent-list{overflow-y:auto;background:var(--paper);color:var(--ink);padding:10px;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:9px;align-content:start;}
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
.chartbtn{
  flex:none;width:20px;height:20px;padding:0;margin-left:6px;cursor:pointer;
  border:1px solid var(--royal-line);border-radius:5px;background:var(--royal);
  color:#fff;display:inline-flex;align-items:center;justify-content:center;
}
.chartbtn:hover{background:var(--royal-hi);border-color:#122a7d;}
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
  border:1px solid var(--royal-line);border-radius:50%;background:var(--royal);
  color:#fff;display:inline-flex;align-items:center;justify-content:center;
  font-family:var(--sans);font-size:11px;font-weight:700;line-height:1;
}
.infobtn:hover{background:var(--royal-hi);border-color:#122a7d;}
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

.runrow{display:flex;gap:8px;align-items:center;margin:0 0 10px;flex-wrap:wrap;}
.runbtn{
  font-family:var(--label);font-size:12px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;padding:7px 15px;border-radius:999px;cursor:pointer;
  color:#fff;background:var(--pink);border:1px solid var(--pink);
}
.runbtn:hover{background:#a3427f;border-color:#a3427f;}
.runbtn:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.runbtn.ghost{background:var(--pill);color:var(--ink);border-color:var(--pill-line);}
.runbtn.ghost:hover{background:#fff;border-color:var(--faint);}
.runnote{font-size:11px;color:var(--faint);}

/* ── Fix button ─────────────────────────────────────────────────────
   Starts a Claude Code agent on the problem beside it. Deliberately not
   the loudest thing on the card: it is an action with a cost, offered
   where a problem is already visible, not a call to action. */
.fixbtn{
  flex:none;margin-left:8px;padding:2px 9px;border-radius:999px;cursor:pointer;
  font-family:var(--label);font-size:9.5px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;white-space:nowrap;
  background:var(--royal);color:#fff;border:1px solid var(--royal-line);
}
.fixbtn:hover{background:var(--royal-hi);}
.fixbtn:disabled{background:var(--pill);color:var(--faint);
  border-color:var(--pill-line);cursor:default;}
.fixbtn:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.alert .fixbtn{margin:5px 0 0;align-self:flex-start;}
.alert{display:flex;flex-direction:column;}
.fixnote{font-size:10px;color:var(--faint);margin-top:3px;}

/* Below a widescreen there is not enough height to hold everything at a
   readable size, so the grid narrows and the page is allowed to scroll.
   The no-scrolling promise is for the 2560-wide monitor it was built for. */
@media (max-width:1700px){
  body:has(.shell){overflow:auto;}
  .shell{position:absolute;inset:auto;width:100%;height:auto;min-height:100dvh;}
  .field{grid-template-rows:none;grid-auto-rows:minmax(240px,auto);}
}
@media (max-width:1100px){
  .field{grid-template-columns:repeat(6,minmax(0,1fr));}
  .panel{grid-column:span 6!important;}
}
`
