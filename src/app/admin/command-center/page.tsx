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

type PanelState = { ok: boolean; data?: any; error?: string; label?: string; at?: string; stale_data?: any }
type Alert = { level: 'red' | 'amber'; key: string; title: string; detail?: string; where?: string }
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

function Panel({ span, title, tag, pip, children }: {
  span: number; title: string; tag?: string; pip?: Tone; children: React.ReactNode
}) {
  return (
    <section className="panel" style={{ gridColumn: `span ${span}` }}>
      <h2>
        {pip ? <span className={`pip ${pip}`} /> : null}
        {title}
        {tag ? <span className="tag">{tag}</span> : null}
      </h2>
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
        <Kpi v={num(d.people_this_hour)}
          k={`People this hour · ${num(d.minutes_into_hour)} min in`} />
        <Kpi v={num(d.requests_this_hour)} k="Requests this hour" />
        <Kpi v={`${num(rate, 1)}%`} k="Failing" tone={tone} />
        <Kpi v={<>{num(d.avg_ms_this_hour)}<span style={{ fontSize: 14 }}> ms</span></>}
          k="Average wait" tone={d.avg_ms_this_hour > 1000 ? 'amber' : ''} />
      </div>
      <div style={{ flex: 1, minHeight: 36 }}>
        <Spark values={(series || []).map(p => p.requests)} color="#2E6BE6" />
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <Kpi small v={num(d.people_24h)} k="People today" />
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
      <div className="rows" style={{ marginTop: 'auto' }}>
        <Row label="Firms paying" value={`${num(d.paying_firms)} · ${num(d.firm_seats)} seats`} />
        <Row label="Renewing in 30 days" value={`${num(d.renewing_30d)} · ${money(d.renewing_30d_value)}`} />
        <Row label="On a free trial" value={num(d.trialing + (d.firms_trialing || 0))} />
        <Row label="Payment failed" value={num(d.past_due_people)} tone={d.past_due_people ? 'red' : ''} />
        <Row label="Started minus cancelled, 30 days"
          value={`${d.net_30d >= 0 ? '+' : ''}${num(d.net_30d)}`} />
      </div>
      <div className="note">
        Every plan is billed once a year. {d.revenue_caveat}
      </div>
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
      <div className="rows" style={{ flex: '1 1 auto', overflow: 'hidden' }}>
        {recent.slice(0, 3).map((u: any) => (
          <div className="row" key={u.email}>
            <span className="l">{u.name || u.email}</span>
            <span className="r" style={{ color: 'var(--muted)' }}>{u.state || '—'} · {ago(u.signed_up)}</span>
          </div>
        ))}
        <More total={recent.length} shown={3} />
      </div>
      {/* Says out loud what this number is not, so it can't be over-read. */}
      <div className="note" style={{ flex: 'none' }}>{d.funnel_caveat}</div>
    </>
  )
}

function Regrid({ d }: { d: any }) {
  const pc = d.combined_pct || 0
  const tone: Tone = pc >= 90 ? 'red' : pc >= 75 ? 'amber' : 'green'
  const rate = (v: number | null | undefined) =>
    v === null || v === undefined ? <span className="dim">not yet</span> : `${num(v, 1)}%`
  return (
    <>
      {/* Regrid bills the combined fraction of records AND parcel tiles, so
          that is the headline. Either half alone understates the bill. */}
      <Kpi v={`${num(pc, 1)}%`} k={`Of the year's Regrid contract · per ${d.source}`}
        tone={tone === 'green' ? '' : tone} />
      <div className="bar"><i className={tone} style={{ width: `${Math.min(100, pc)}%` }} /></div>
      <div className="rows">
        <Row label={`Parcel records · ${num(d.records_pct, 1)}%`}
          value={`${num(d.records)} of ${num(d.records_cap)}`} />
        <Row label={`Map tiles · ${num(d.tiles_pct, 1)}%`}
          value={`${num(d.tiles)} of ${num(d.tiles_cap)}`} />
        <Row label="Days into the year" value={num(d.days_into_year)} />
      </div>
      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <Row label="Parcel lookups today" value={num(d.parcel_lookups_24h)} />
        <Row label="Saved by our cache" value={rate(d.parcel_cache_pct)} />
        <Row label="Map tiles today" value={num(d.tiles_24h)} />
        <Row label="Tiles saved by our cache" value={rate(d.tile_cache_pct)} />
      </div>
      <div className="note" style={{ marginTop: 'auto' }}>
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
      <div className="note" style={{ marginTop: 'auto' }}>
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
      <div className="note" style={{ marginTop: 'auto' }}>
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
        <Row label="People hit in 24 hours" value={num(d.users_affected_24h)}
          tone={d.users_affected_24h ? 'red' : ''} />
        <Row label="Ever recorded"
          value={`${num(d.all_time)} · newest ${d.newest_report ? ago(d.newest_report) + ' ago' : 'none'}`} />
      </div>
      {affected.length === 0
        ? <div className="allgood">No crashes in the last 7 days</div>
        : (
          <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7,
                                         flex: '1 1 auto', overflow: 'hidden' }}>
            {affected.slice(0, 7).map((a, i) => (
              <div key={a.user_id || `anon-${i}`} style={{ display: 'grid', gap: 1 }}>
                <div className="row">
                  <span className="l" style={{ fontWeight: 600 }}>
                    {a.name || a.email || 'Signed-out user'}
                  </span>
                  <span className="r" style={a.fatal ? { color: 'var(--red)' } : undefined}>
                    {num(a.crashes)}× · {ago(a.last_seen)} ago
                  </span>
                </div>
                <div className="note" style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {[a.email && a.name ? a.email : null, a.screen, a.platform,
                    a.app_version && `v${a.app_version}`, a.error]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
            <More total={affected.length} shown={7} />
          </div>
        )}
    </>
  )
}

function Storage({ d, trend }: { d: any; trend: any }) {
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
                    minHeight: 0, flex: '1 1 auto', overflow: 'hidden' }}>
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
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8, flex: 'none' }}>
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
      <div className="note" style={{ marginTop: 'auto' }}>
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

function Quality({ d }: { d: any }) {
  const line = (label: string, v: number) => (
    <Row key={label} label={label} value={num(v)} tone={v ? 'amber' : ''} />
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
      <div className="note" style={{ marginTop: 'auto' }}>Things a subscriber would notice before we do.</div>
    </>
  )
}

function Reach({ notif, email }: { notif: any; email: any }) {
  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Kpi small v={num(notif?.pushed_24h)} k="Pushes sent today" />
        <Kpi small v={num(email?.sent_24h)} k="Emails sent today" />
      </div>
      <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
        <Row label="Pushes running late" value={num(notif?.overdue)} tone={notif?.overdue ? 'red' : ''} />
        <Row label="Waiting in the queue" value={num(notif?.queued)} />
        <Row label="Payment-failed emails" value={num(email?.dunning_24h)} tone={email?.dunning_24h ? 'amber' : ''} />
      </div>
      {(email?.by_category || []).length > 0 && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          {(email.by_category || []).slice(0, 4).map((c: any) => (
            <Row key={c.category} label={c.category} value={num(c.sent)} />
          ))}
        </div>
      )}
    </>
  )
}

/* ── Alert strip ──────────────────────────────────────────────────────
   The only part of this page that has to work when nobody is looking at
   it. Reds sort first; the verdict block on the left carries the totals
   so nothing is hidden by the strip scrolling sideways. */

function AlertStrip({ alerts }: { alerts: Alert[] }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(true)
  const reds = alerts.filter(a => a.level === 'red').length
  const ambers = alerts.length - reds

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

  if (!authorised) {
    return <><style dangerouslySetInnerHTML={{ __html: CSS }} /><div className="booting">Checking your access…</div></>
  }

  const pulse = P('pulse'), moneyD = P('money'), peopleD = P('people'), regridD = P('regrid')
  const erroringD = P('failing_endpoints'), slowD = P('slow_endpoints'), jobsD = P('jobs'), crashD = P('crashes')
  const storageD = P('storage'), pipelineD = P('pipeline'), qualityD = P('data_quality')
  const notifD = P('notifications'), emailD = P('email')

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="shell">
        <header className="rail">
          <div className="mark">
            <h1>Ground Goat <em>Command Center</em></h1>
            <span className="sub">Admins only</span>
          </div>
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

        <AlertStrip alerts={snap.alerts || []} />

        <main className="field">
          <Panel span={4} title="Right now" tag="last 24 hours below"
            pip={!pulse ? undefined : pulse.error_rate_hour_pct >= 5 ? 'red' : pulse.error_rate_hour_pct >= 2 ? 'amber' : 'green'}>
            {pulse ? <RightNow d={pulse} series={P('traffic_series')} /> : <Unavailable why={whyMissing('pulse')} />}
          </Panel>

          <Panel span={3} title="Money" tag="per year" pip={!moneyD ? undefined : moneyD.past_due_people ? 'amber' : 'green'}>
            {moneyD ? <Money d={moneyD} /> : <Unavailable why={whyMissing('money')} />}
          </Panel>

          <Panel span={3} title="App crashes"
            pip={!crashD ? undefined : crashD.last_hour ? 'red' : crashD.last_24h ? 'amber' : 'green'}>
            {crashD ? <Crashes d={crashD} /> : <Unavailable why={whyMissing('crashes')} />}
          </Panel>

          <Panel span={2} title="Regrid budget"
            pip={!regridD ? undefined : regridD.records_used_pct >= 90 ? 'red' : regridD.records_used_pct >= 75 ? 'amber' : 'green'}>
            {regridD ? <Regrid d={regridD} /> : <Unavailable why={whyMissing('regrid')} />}
          </Panel>

          <Panel span={3} title="What is erroring" pip={!erroringD ? undefined : erroringD.length ? 'red' : 'green'}>
            {erroringD ? <Erroring d={erroringD} /> : <Unavailable why={whyMissing('failing_endpoints')} />}
          </Panel>

          <Panel span={3} title="Slowest things"
            pip={!slowD ? undefined : slowD.some((e: any) => e.p95_ms >= 5000) ? 'amber' : 'green'}>
            {slowD ? <Slowest d={slowD} /> : <Unavailable why={whyMissing('slow_endpoints')} />}
          </Panel>

          <Panel span={3} title="Background jobs"
            pip={!jobsD ? undefined : (jobsD.failing || []).length ? 'red' : (jobsD.stuck || []).length ? 'amber' : 'green'}>
            {jobsD ? <Jobs d={jobsD} /> : <Unavailable why={whyMissing('jobs')} />}
          </Panel>

          <Panel span={3} title="People" pip={peopleD ? 'green' : undefined}>
            {peopleD ? <People d={peopleD} /> : <Unavailable why={whyMissing('people')} />}
          </Panel>

          <Panel span={4} title="Storage" tag="share of the ceiling"
            pip={!storageD ? undefined : (storageD.stores || []).some((s: any) => (s.pct_of_cap || 0) >= 90) ? 'red' : 'amber'}>
            {storageD ? <Storage d={storageD} trend={P('storage_trend')} /> : <Unavailable why={whyMissing('storage')} />}
          </Panel>

          <Panel span={3} title="Scraper & staging"
            pip={!pipelineD ? undefined
              : pipelineD.run_failures ? 'red'
              : pipelineD.listings_missing_main_image || pipelineD.tracts_boundary_missing_image ? 'amber' : 'green'}>
            {pipelineD ? <Pipeline d={pipelineD} /> : <Unavailable why={whyMissing('pipeline')} />}
          </Panel>

          <Panel span={3} title="Data quality"
            pip={!qualityD ? undefined
              : qualityD.valid_but_no_boundary || qualityD.past_auctions_no_price ? 'amber' : 'green'}>
            {qualityD ? <Quality d={qualityD} /> : <Unavailable why={whyMissing('data_quality')} />}
          </Panel>

          <Panel span={2} title="Notifications &amp; email" pip={notifD?.overdue ? 'amber' : 'green'}>
            {notifD || emailD ? <Reach notif={notifD} email={emailD} /> : <Unavailable why={whyMissing('notifications')} />}
          </Panel>
        </main>
      </div>
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
  --paper:#F4F4F7;          /* flat fallback for --page */
  /* White at the top falling to grey at the bottom. The cards nearest the
     top separate on their shadow alone, which is why the shadow does the
     lifting here and the border is only a hairline. */
  --page:linear-gradient(180deg,#FFFFFF 0%,#FBFBFC 20%,#EFEFF3 60%,#DDDDE4 100%);
  --card:#FFFFFF;
  --card-2:#F58CDE;         /* panel title bars — the brand pink itself */
  --track:#EAEAEE;          /* unfilled part of a progress bar */
  --ink:#0A0A0A;            /* gg-black */
  --ink-2:#2A2A2A;          /* gg-gray-700 */
  --muted:#555555;          /* gg-gray-500 */
  --faint:#888888;          /* gg-gray-400 */
  --line:#E4E4E8; --line-2:#CFCFD5;

  /* Brand pink. #f58cde is the site's value and is too light to carry
     text on white, so type and strokes use the dark tone and fills use
     the bright one. */
  --pink:#B84C97; --pink-bright:#F58CDE; --pink-tint:#F8DAF1;
  /* The top bar. Black, with everything on it in white — the one place
     on this page that inverts, so the panels below read as the content. */
  --bar:#0A0A0A; --on-bar:#FFFFFF; --on-bar-dim:rgba(255,255,255,.66);

  /* The highlight. Deliberately used twice on the whole screen — the
     traffic line and the live dot — so it stays a highlight. */
  --blue:#2E6BE6;
  --blue-pill:#DCE9FF; --blue-pill-hi:#B4D0FF; --blue-pill-line:#A9C6F5;
  --blue-ink:#12459E;

  /* State colours, kept apart from the brand on purpose: if something on
     this screen is red, something is actually wrong. */
  --red:#C8102E; --red-bg:#FDEEF1; --red-line:#F2C3CD;
  --amber:#9A6400; --amber-bg:#FDF4E5; --amber-line:#EBD7A8;
  --green:#2E7D46; --green-bg:#EFF6F1;
  --r:7px;
  --lift:0 1px 2px rgba(10,10,10,.08), 0 5px 16px rgba(10,10,10,.13);
  --lift-hi:0 2px 4px rgba(10,10,10,.10), 0 9px 26px rgba(10,10,10,.17);
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
  color:var(--on-bar);text-decoration:none;border:1px solid rgba(255,255,255,.30);border-radius:var(--r);
  padding:3px 9px;background:rgba(255,255,255,.10);}
.back:hover{background:rgba(255,255,255,.20);border-color:rgba(255,255,255,.55);}
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
  background:var(--bar);box-shadow:var(--lift);
  position:relative;z-index:2;}
.mark{display:flex;align-items:baseline;gap:9px;}
.mark h1{
  font-family:var(--sans);font-weight:700;font-size:18px;letter-spacing:.055em;
  margin:0;text-transform:uppercase;color:var(--on-bar);
}
.mark h1 em{font-style:normal;font-weight:500;color:rgba(255,255,255,.72);}
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
  padding:0 9px;
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

.alert-row{display:flex;gap:7px;overflow-x:auto;overflow-y:hidden;padding-bottom:2px;
  scrollbar-width:thin;position:relative;
  padding:3px 0 8px;
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
.alert .where{font-family:var(--label);font-size:9.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
.alert .title{font-weight:600;font-size:13px;margin:1px 0 2px;line-height:1.2;text-wrap:balance;}
.alert.red .title{color:var(--red);}
.alert.amber .title{color:var(--amber);}
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
  padding:6px 11px;border-bottom:1px solid rgba(10,10,10,.10);background:var(--card-2);
  font-family:var(--label);font-weight:700;font-size:11px;
  letter-spacing:.085em;text-transform:uppercase;color:var(--ink);
}
.panel > h2 .tag{margin-left:auto;font-size:10px;letter-spacing:.06em;
  color:rgba(10,10,10,.58);font-weight:600;}
.panel > h2 .pip{width:7px;height:7px;border-radius:50%;background:rgba(10,10,10,.3);
  flex:none;box-shadow:0 0 0 1.5px rgba(255,255,255,.8);}
.panel > h2 .pip.red{background:var(--red);} .panel > h2 .pip.amber{background:var(--amber);}
.panel > h2 .pip.green{background:var(--green);}
.body{min-height:0;flex:1;overflow:hidden;padding:9px 11px;display:flex;flex-direction:column;gap:8px;}
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

.rows{display:flex;flex-direction:column;gap:5px;min-height:0;overflow:hidden;}
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
.store .note{font-size:10.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

.chip{display:inline-block;padding:1px 6px;border-radius:20px;font-family:var(--label);
  font-size:9.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border:1px solid var(--line-2);color:var(--muted);}
.chip.red{background:var(--red-bg);border-color:var(--red-line);color:var(--red);}
.chip.amber{background:var(--amber-bg);border-color:var(--amber-line);color:var(--amber);}
.chip.green{background:var(--green-bg);border-color:#C6DECF;color:var(--green);}
.note{font-size:10.5px;color:var(--faint);line-height:1.35;}
svg.spark{display:block;width:100%;height:100%;}

@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;}}

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
