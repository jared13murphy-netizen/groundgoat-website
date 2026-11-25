'use client'

/**
 * Command Center v7 — the Overview screen (owner: "Yes, build v7", 11/24).
 *
 * Design: ~/Documents/claude/proof_tv_1124/command_center_mockup_v7.html.
 * Data:   ~/Documents/claude/proof_tv_1124/v7_contract.md
 *   A. snapshot panel `overview`            -> the `ov` prop
 *   B. /api/admin/command-center/map/growth -> useGrowth()
 *   C. /api/admin/command-center/live       -> useLive(), polled every 2 s
 *
 * Owner rules this file keeps:
 *   - Every number comes from the API. A field that is null shows "—" with
 *     the short reason in muted text; there are no sample numbers anywhere.
 *   - No action buttons and no "N need attention" badges. The segmented
 *     controls only filter, and a Features row opens a read-only drawer.
 *   - Fills the window with no page scroll. Every size is in em, and the
 *     em is a viewport-scaled `--f`, so 1366x768 and 3840x2160 are the same
 *     picture at different sizes.
 *
 * MapLibre traps (the long comments in command-center/page.tsx LiveMap say
 * why, and they were each paid for): nothing touches the map until the
 * style is up (load OR styledata OR isStyleLoaded); sources are created with
 * their data in hand, not at style-ready; a callback from a removed map must
 * not write back into the live one (`alive`); the ResizeObserver watches the
 * wrapper, not the element MapLibre itself resizes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar,
} from 'recharts'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.groundgoat.com'
const TZ = 'America/Chicago'

const BASEMAP_DARK =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const BASEMAP_ATTRIBUTION = '© Esri'

/** IA IL NE MO KS IN MN WI SD, with the overlays' room left on each side. */
const MIDWEST: [[number, number], [number, number]] = [[-104.2, 36.0], [-80.4, 49.4]]

const PINK = '#F58CDE', BLUE = '#3987e5', AQUA = '#199e70', ORANGE = '#d95926'
const GOOD = '#2fbf71', WARN = '#f2b233', BAD = '#ef5350'
const BLANK = '#141a24'
const SEQ = ['#3a2238', '#8f4b83', '#F58CDE', '#ffe4f8']
const DIV = ['#d95926', '#2a2f3a', '#3987e5']

type Mode = 'new' | 'growth' | 'now' | 'all'
type Plan = 'all' | 'basic' | 'premium' | 'county' | 'firm' | 'trial'

const PLAN_NAME: Record<Plan, string> = {
  all: 'all plans', basic: 'Basic State', premium: 'Premium State',
  county: 'County', firm: 'Firm', trial: 'Free trial',
}

/* ── Formatting ───────────────────────────────────────────────────── */

const DASH = '—'
const isNum = (v: any) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
const n0 = (v: any, d = 0) => !isNum(v) ? DASH
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const usd = (v: any) => !isNum(v) ? DASH : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
const usdShort = (v: any) => {
  if (!isNum(v)) return DASH
  const x = Number(v)
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (x >= 1e3) return '$' + Math.round(x / 1e3) + 'k'
  return '$' + Math.round(x)
}
/** Milliseconds as the mockup writes speed: 0.8 s, 2.4 s, 6 s, 22 s. */
const secs = (ms: any) => {
  if (!isNum(ms)) return DASH
  const s = Number(ms) / 1000
  return (s >= 10 ? String(Math.round(s)) : String(Math.round(s * 10) / 10)) + ' s'
}
const secsFromS = (s: any) => isNum(s) ? secs(Number(s) * 1000) : DASH

const timeFull = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: TZ })
}
const timeShort = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(/\s?[AP]M$/, '')
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const weekLabel = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '')
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : DASH
}
const monthLabel = (ym: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(ym || '')
  return m ? MONTHS[Number(m[2]) - 1] : ''
}
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const weekdayNow = () => new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ })
const lastMonthName = () => {
  const m = Number(new Date().toLocaleDateString('en-US', { month: 'numeric', timeZone: TZ }))
  return MONTHS[(m + 10) % 12]
}

const dotClass = (s?: string) => s === 'green' ? 'g' : s === 'amber' ? 'w' : s === 'red' ? 'r' : 'x'

/* ── Colour ramps (client side, per mode / plan) ─────────────────── */

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
function ramp(stops: string[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]), f = x - i
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
/** Round a maximum up to a figure a legend can print. */
function nice(v: number, floor: number): number {
  const x = Math.max(floor, v)
  const steps = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 300, 400, 500, 800, 1000]
  return steps.find(s => s >= x) ?? Math.ceil(x / 100) * 100
}
const pct95 = (vals: number[]) => {
  const v = vals.filter(x => x > 0).sort((a, b) => a - b)
  return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] : 0
}

const pick = (o: any, plan: Plan): number => (o && isNum(o[plan])) ? Number(o[plan]) : 0

type Cfg = { mode: Mode; plan: Plan; per: number; mx: number }

function colorFor(p: any, c: Cfg): string {
  if (c.mode === 'growth') {
    const cur = pick(p.new, c.plan), pri = pick(p.prior, c.plan)
    if (cur + pri < 1) return BLANK
    return ramp(DIV, 0.5 + 0.5 * Math.max(-1, Math.min(1, (cur - pri) / c.mx)))
  }
  const v = c.mode === 'all' ? pick(p.customers, c.plan) : pick(p.new, c.plan)
  if (v < 0.5) return BLANK
  return ramp(SEQ, Math.sqrt(Math.min(c.mx, v) / c.mx))
}

function scaleFor(features: any[], mode: Mode, plan: Plan): number {
  const vals = features.map(f => {
    const p = f.properties || {}
    if (mode === 'growth') return Math.abs(pick(p.new, plan) - pick(p.prior, plan))
    return mode === 'all' ? pick(p.customers, plan) : pick(p.new, plan)
  })
  if (mode === 'growth') return nice(pct95(vals), 3)
  return nice(pct95(vals), mode === 'all' ? 8 : 4)
}

/* ── Data hooks ───────────────────────────────────────────────────── */

/** Endpoint B. Keeps the last good answer on screen while the next period loads. */
function useGrowth(period: number, mode: Mode) {
  const apiMode = mode === 'now' ? 'new' : mode
  const key = `${period}|${apiMode}`
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetchWithAuth(`${API_URL}/api/admin/command-center/map/growth?period=${period}&mode=${apiMode}`)
        if (!r.ok) throw new Error(`the map endpoint answered ${r.status}`)
        const j = await r.json()
        if (!stop) { setData(j); setError(null) }
      } catch (e: any) {
        if (!stop) setError(e?.message || 'could not load the map')
      }
    }
    load()
    const t = setInterval(load, 60000)   // the server caches it for a minute
    return () => { stop = true; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { data, error }
}

/** Endpoint C. Redis only on the server, so every two seconds is cheap. */
function useLive() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const r = await fetchWithAuth(`${API_URL}/api/admin/command-center/live`)
        if (!r.ok) throw new Error(`the live endpoint answered ${r.status}`)
        const j = await r.json()
        if (!stop) { setData(j); setError(null) }
      } catch (e: any) {
        if (!stop) setError(e?.message || 'could not load live activity')
      }
    }
    load()
    const t = setInterval(load, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  return { data, error }
}

/** Font size in px of the screen's em, for chart text that cannot use CSS. */
function useEmPx(ref: React.RefObject<HTMLElement | null>) {
  const [px, setPx] = useState(12)
  useEffect(() => {
    const read = () => {
      if (ref.current) setPx(parseFloat(getComputedStyle(ref.current).fontSize) || 12)
    }
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [ref])
  return px
}

/* ── Small pieces ─────────────────────────────────────────────────── */

function Spark({ vals, color, bars, max }: { vals: number[]; color: string; bars?: boolean; max?: number }) {
  if (!vals || vals.length < 2) return null
  const n = vals.length
  const hi = Math.max(max || 0, ...vals, 1)
  const y = (v: number) => 28 - (v / hi) * 26
  if (bars) {
    const w = 100 / n
    return (
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" width="100%" height="100%">
        {vals.map((v, i) => v > 0 &&
          <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={y(v)} height={29 - y(v)} fill={color} rx={0.6} />)}
      </svg>
    )
  }
  const pts = vals.map((v, i) => `${(i * 100 / (n - 1)).toFixed(2)},${y(v).toFixed(2)}`)
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" width="100%" height="100%">
      <path d={`M0,29 L${pts.join(' L')} L100,29 Z`} fill={color} opacity={0.13} />
      <path d={`M${pts.join(' L')}`} fill="none" stroke={color} strokeWidth={2}
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
const series = (s: any): number[] => Array.isArray(s) ? s.map((p: any) => Number(p?.v) || 0) : []

function Delta({ v, text }: { v: any; text: string }) {
  if (!isNum(v)) return null
  const x = Number(v)
  const cls = x > 0 ? 'v-up' : x < 0 ? 'v-dn' : 'v-fl'
  const arrow = x > 0 ? '▲' : x < 0 ? '▼' : '='
  return <span className={`v-d ${cls}`}>{arrow} {text}</span>
}

/* ── North star ───────────────────────────────────────────────────── */

function NorthStar({ ns, onNow, why }: { ns: any; onNow: any; why: string }) {
  const p = ns?.paying, o = ns?.on_now, nu = ns?.new_users, rv = ns?.revenue
  const ac = ns?.active, cn = ns?.cancels, tp = ns?.trial_pay
  const onNowN = isNum(onNow) ? onNow : o?.now
  const reason = (x: any, text: string) => (x == null ? <span className="v-mut">{text}</span> : null)
  return (
    <section className="v-ns">
      <div className="v-card v-k v-hero">
        <div className="v-lab"><span>Paying subscribers</span><span>vs last week</span></div>
        <div className="v-num">{n0(p?.now)}</div>
        <div className="v-cmp">
          {p ? <><Delta v={p.vs_week} text={n0(Math.abs(Number(p.vs_week)))} />
            <span className="v-sub">{isNum(p.today) ? `+${n0(p.today)} today · ` : ''}{n0(p.trialing)} on trial</span></>
            : <span className="v-mut">{why}</span>}
        </div>
        <div className="v-sp"><Spark vals={series(p?.series_30d)} color={PINK} /></div>
      </div>

      <div className="v-card v-k">
        <div className="v-lab"><span>On now</span></div>
        <div className="v-num">{n0(onNowN)}</div>
        <div className="v-cmp">
          {isNum(o?.vs_same_time_last_week)
            ? <Delta v={o.vs_same_time_last_week} text={`${n0(Math.abs(o.vs_same_time_last_week))} vs this time ${weekdayNow()}`} />
            : reason(null, 'no same-time comparison yet')}
        </div>
        <div className="v-sp"><Spark vals={series(o?.series_24h)} color={PINK} /></div>
      </div>

      <div className="v-card v-k">
        <div className="v-lab"><span>New users</span><span>today</span></div>
        <div className="v-num">{n0(nu?.today)}</div>
        <div className="v-cmp">
          <Delta v={nu?.vs_usual} text={`${n0(Math.abs(Number(nu?.vs_usual)))} vs usual`} />
          {nu && <span className="v-sub">Wk {n0(nu.week)} · Mo {n0(nu.month)}</span>}
        </div>
        <div className="v-sp"><Spark vals={series(nu?.series_30d)} color={AQUA} bars /></div>
      </div>

      <div className="v-card v-k">
        <div className="v-lab"><span>Revenue</span><span>month</span></div>
        <div className="v-num">{usd(rv?.month)}</div>
        <div className="v-cmp">
          {isNum(rv?.month) ? <>
            <Delta v={rv?.vs_last_month_pace_pct} text={`${n0(Math.abs(Number(rv?.vs_last_month_pace_pct)))}% vs ${lastMonthName()} pace`} />
            <span className="v-sub">ARR {usdShort(rv?.arr)}</span></>
            : <span className="v-mut">{rv?.basis || why}</span>}
        </div>
        <div className="v-sp"><Spark vals={series(rv?.series_month)} color={BLUE} /></div>
      </div>

      <div className="v-card v-k">
        <div className="v-lab"><span>Active today</span><span>DAU</span></div>
        <div className="v-num">{n0(ac?.dau)}</div>
        <div className="v-cmp">
          <Delta v={ac?.dau_vs_week_pct} text={`${n0(Math.abs(Number(ac?.dau_vs_week_pct)))}%`} />
          {ac && <span className="v-sub">WAU {n0(ac.wau)} · MAU {n0(ac.mau)}</span>}
        </div>
        <div className="v-sp"><Spark vals={series(ac?.series_30d)} color={BLUE} bars /></div>
      </div>

      <div className="v-card v-k">
        <div className="v-lab"><span>Cancellations</span><span>today</span></div>
        <div className="v-num">{n0(cn?.today)}</div>
        <div className="v-cmp">
          {cn && <><span className="v-d v-fl">Wk {n0(cn.week)} · Mo {n0(cn.month)}</span>
            <span className="v-sub">{isNum(cn.monthly_churn_pct) ? `${n0(cn.monthly_churn_pct, 1)}% monthly churn` : ''}</span></>}
        </div>
        <div className="v-sp"><Spark vals={series(cn?.series_30d)} color={ORANGE} bars max={3} /></div>
      </div>

      <div className="v-card v-k">
        <div className="v-lab"><span>Trials that pay</span><span>30 d</span></div>
        <div className="v-num">{isNum(tp?.pct_30d) ? `${n0(tp.pct_30d)}%` : DASH}</div>
        <div className="v-cmp">
          <Delta v={tp?.vs_prior_pts} text={`${n0(Math.abs(Number(tp?.vs_prior_pts)))} pts`} />
          {tp && <span className="v-sub">{n0(tp.ending_this_week)} trials end this week</span>}
        </div>
        <div className="v-sp"><Spark vals={series(tp?.series_30d)} color={AQUA} /></div>
      </div>
    </section>
  )
}

/* ── The map ──────────────────────────────────────────────────────── */

function CountyMap({ features, nowCounties, cfg }: {
  features: any[] | null; nowCounties: any[] | null; cfg: Cfg
}) {
  const wrap = useRef<HTMLDivElement | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const tip = useRef<HTMLDivElement | null>(null)
  const map = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg

  useEffect(() => {
    const container = box.current
    if (!container) return
    let alive = true
    let touched = false

    const m = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: { base: { type: 'raster', tiles: [BASEMAP_DARK], tileSize: 256, attribution: BASEMAP_ATTRIBUTION } },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#0e131b' } },
          { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 0.55 } },
        ],
      },
      center: [-92, 42], zoom: 4,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    map.current = m
    m.touchZoomRotate.disableRotation()

    const fit = () => {
      const w = container.clientWidth, h = container.clientHeight
      if (!w || !h) return
      m.resize()
      // The same room the mockup leaves: the big number on the left, the
      // lists on the right, the weekly bars at the bottom right.
      m.fitBounds(MIDWEST, {
        padding: { left: w * 0.16, right: w * 0.22, top: h * 0.08, bottom: h * 0.05 }, animate: false,
      })
    }

    let styled = false
    const onStyled = () => {
      if (!alive || styled || !m.isStyleLoaded()) return
      styled = true
      fit()
      setReady(true)
    }
    m.on('load', onStyled)
    m.on('styledata', onStyled)
    if (m.isStyleLoaded()) onStyled()
    // A person moving the map owns the camera from then on.
    m.on('movestart', (e: any) => { if (e.originalEvent) touched = true })

    const ro = new ResizeObserver(() => {
      if (!alive || !styled) return
      if (touched) m.resize(); else fit()
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

  /* Tooltip. Registered once per layer; reads the current filters from a ref. */
  const showTip = useCallback((e: any, html: string) => {
    const t = tip.current
    if (!t) return
    t.innerHTML = html
    t.style.display = 'block'
    const w = box.current?.clientWidth || 0
    const x = e.point.x + 14, y = e.point.y + 14
    t.style.left = Math.min(x, Math.max(0, w - t.offsetWidth - 8)) + 'px'
    t.style.top = y + 'px'
  }, [])
  const hideTip = useCallback(() => { if (tip.current) tip.current.style.display = 'none' }, [])

  /* County fill. Created with data in hand; updated in place afterwards. */
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !features) return
    const data: any = {
      type: 'FeatureCollection',
      features: features.map(f => ({
        type: 'Feature', geometry: f.geometry,
        properties: { ...f.properties, _c: colorFor(f.properties || {}, cfg) },
      })),
    }
    const existing: any = m.getSource('cc7_counties')
    if (existing) existing.setData(data)
    else m.addSource('cc7_counties', { type: 'geojson', data })

    if (!m.getLayer('cc7_fill')) {
      m.addLayer({
        id: 'cc7_fill', type: 'fill', source: 'cc7_counties',
        paint: { 'fill-color': ['get', '_c'], 'fill-opacity': 0.96 },
      })
      m.addLayer({
        id: 'cc7_line', type: 'line', source: 'cc7_counties',
        paint: { 'line-color': '#0e131b', 'line-width': 0.5 },
      })
      m.on('mousemove', 'cc7_fill', (e: any) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        const c = cfgRef.current
        const j = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }
        const cur = pick(j(p.new), c.plan), pri = pick(j(p.prior), c.plan), all = pick(j(p.customers), c.plan)
        const d = cur - pri
        showTip(e, `<b>${esc(p.county)} County, ${esc(p.state)}</b><span>New users ${c.per} d:</span> ${cur} `
          + `<span>· before:</span> ${pri} <span>·</span> ${d >= 0 ? '+' : ''}${d}<br><span>Customers:</span> ${all}`)
      })
      m.on('mouseleave', 'cc7_fill', hideTip)
    }
    const showFill = cfg.mode !== 'now'
    for (const id of ['cc7_fill', 'cc7_line']) {
      m.setLayoutProperty(id, 'visibility', showFill ? 'visible' : 'none')
    }
  }, [features, cfg, ready, showTip, hideTip])

  /* Who is on right now: pink circles at their home county. */
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const on = cfg.mode === 'now'
    const pts = (nowCounties || []).filter(c => isNum(c.lat) && isNum(c.lng))
    const data: any = {
      type: 'FeatureCollection',
      features: pts.map(c => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [Number(c.lng), Number(c.lat)] },
        properties: { n: Number(c.n) || 1, county: c.county, state: c.state, people: JSON.stringify(c.people || []) },
      })),
    }
    const existing: any = m.getSource('cc7_now')
    if (existing) existing.setData(data)
    else if (on) m.addSource('cc7_now', { type: 'geojson', data })
    if (!m.getSource('cc7_now')) return

    if (!m.getLayer('cc7_now_dot')) {
      m.addLayer({
        id: 'cc7_now_halo', type: 'circle', source: 'cc7_now',
        paint: { 'circle-radius': ['+', 8, ['*', ['get', 'n'], 5]], 'circle-color': PINK, 'circle-opacity': 0.18 },
      })
      m.addLayer({
        id: 'cc7_now_dot', type: 'circle', source: 'cc7_now',
        paint: {
          'circle-radius': ['+', 4, ['*', ['get', 'n'], 1.6]], 'circle-color': PINK,
          'circle-stroke-color': '#0b0e13', 'circle-stroke-width': 1.5,
        },
      })
      m.on('mousemove', 'cc7_now_dot', (e: any) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        let people: any[] = []
        try { people = JSON.parse(p.people) } catch { /* none */ }
        const list = people.slice(0, 6).map(x => `${esc(x.name || x.email || 'Someone')}${x.device ? ` <span>· ${esc(x.device)}</span>` : ''}`).join('<br>')
        showTip(e, `<b>${esc(p.county)} County, ${esc(p.state)}</b><span>On now:</span> ${esc(p.n)}${list ? '<br>' + list : ''}`)
      })
      m.on('mouseleave', 'cc7_now_dot', hideTip)
    }
    for (const id of ['cc7_now_halo', 'cc7_now_dot']) {
      m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    if (!on) hideTip()
  }, [nowCounties, cfg.mode, ready, showTip, hideTip])

  return (
    <div className="v-mapwrap" ref={wrap}>
      <div className="v-mapgl" ref={box} />
      <div className="v-tip" ref={tip} />
    </div>
  )
}

/* ── Feature drawer ───────────────────────────────────────────────── */

function Drawer({ f, fs, onClose }: { f: any; fs: number; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const days = useMemo(() => {
    const s: any[] = f?.series_14d || []
    return s.map((v, i) => {
      const d = new Date(Date.now() - (s.length - 1 - i) * 86400000)
      return { d: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ }), v: Number(isNum(v?.v) ? v.v : v) || 0 }
    })
  }, [f])
  const open = !!f
  const wrong: any[] = f?.problems || []
  const top: any[] = f?.top_users || []
  return (
    <>
      <div className={`v-scrim ${open ? 'on' : ''}`} onClick={onClose} />
      <aside className={`v-drawer ${open ? 'on' : ''}`} aria-hidden={!open}>
        {f && <>
          <h2><span className={`v-st ${dotClass(f.status)}`} />{f.name}
            <span className="v-hint">click outside to close</span></h2>
          <div className="v-dk">
            <div><span>People today</span><b>{n0(f.people)}</b></div>
            <div><span>Uses</span><b>{n0(f.uses)}</b></div>
            <div><span>Worked</span><b>{isNum(f.worked_pct) ? `${f.worked_pct}%` : DASH}</b></div>
            <div><span>Speed</span><b>{secs(f.speed_ms)}</b></div>
          </div>
          <div className="v-dchart">
            <div className="v-dtitle">People per day · last {days.length || 14} days</div>
            {days.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={days} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#1d2532" />
                  <XAxis dataKey="d" tick={{ fill: '#6b7788', fontSize: fs * 0.7 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#6b7788', fontSize: fs * 0.7 }} tickLine={false} axisLine={false} width={fs * 2.5} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,.04)' }}
                    contentStyle={{ background: '#0b0e13', border: '1px solid #2b3444', fontSize: fs * 0.8 }} />
                  <Bar dataKey="v" name="People" fill={PINK} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : <span className="v-mut">{DASH} no daily history for this feature yet</span>}
          </div>
          {isNum(f.crashes_today) && (
            <div className="v-dl"><div><span>Crashes today</span><b>{n0(f.crashes_today)}</b></div></div>
          )}
          <div className="v-dl">
            <div><b>What went wrong today</b><span /></div>
            {wrong.length
              ? wrong.map((w, i) => <div key={i}><span>{w.label}</span><b>{n0(w.count)}</b></div>)
              : <div><span className="v-mut">{DASH} not reported for this feature yet</span><b /></div>}
          </div>
          <div className="v-dl">
            <div><b>Top users today</b><span /></div>
            {top.length
              ? top.map((u, i) => <div key={i}><span>{u.name}{u.place ? ` · ${u.place}` : ''}</span><b>{n0(u.count)}</b></div>)
              : <div><span className="v-mut">{DASH} not reported for this feature yet</span><b /></div>}
          </div>
        </>}
      </aside>
    </>
  )
}

/* ── The screen ───────────────────────────────────────────────────── */

const EV: Record<string, [string, string]> = {
  report: ['RPT', 'i-rep'], search: ['GS', 'i-gs'], search_empty: ['GS', 'i-gs'],
  tract: ['MAP', 'i-map'], parcel: ['MAP', 'i-map'], subscribe: ['$', 'i-sub'],
  signup: ['NEW', 'i-sign'], save: ['PIN', 'i-map'], crash: ['ERR', 'i-err'],
  checkout_failed: ['ERR', 'i-err'],
}
const COHORT_RAMP = ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7']

export default function CommandCenterV7({ ov, why, clock, connected, railOpen, onToggleRail }: {
  ov: any | null
  /** Why the overview panel has no data, in a few words. */
  why: string
  clock: string
  connected: boolean
  railOpen: boolean
  onToggleRail: () => void
}) {
  const root = useRef<HTMLDivElement | null>(null)
  const fs = useEmPx(root)
  const [mode, setMode] = useState<Mode>('new')
  const [plan, setPlan] = useState<Plan>('all')
  const [per, setPer] = useState(30)
  const [openFeature, setOpenFeature] = useState<any>(null)

  const growth = useGrowth(per, mode)
  const live = useLive()

  const features: any[] | null = growth.data?.counties?.features || null
  const liveD = live.data
  const mx = useMemo(() => scaleFor(features || [], mode, plan), [features, mode, plan])
  const cfg = useMemo<Cfg>(() => ({ mode, plan, per, mx }), [mode, plan, per, mx])

  /* Headline and the top list, all from endpoint B / C. */
  const head = useMemo(() => {
    const planName = PLAN_NAME[plan]
    if (mode === 'now') {
      const o = ov?.ns?.on_now
      return {
        big: isNum(liveD?.on_now) ? n0(liveD.on_now) : DASH,
        label: isNum(liveD?.states) ? `on now · ${n0(liveD.states)} states` : 'on now',
        delta: isNum(o?.vs_same_time_last_week)
          ? { v: Number(o.vs_same_time_last_week), text: `${n0(Math.abs(o.vs_same_time_last_week))} vs this time ${weekdayNow()}` } : null,
        note: liveD ? '' : (live.error || 'no live reading yet'),
      }
    }
    const g = growth.data
    if (!g) return { big: DASH, label: '', delta: null as any, note: growth.error || 'loading the map' }
    if (mode === 'all') {
      const total = (features || []).reduce((a, f) => a + pick(f.properties?.customers, plan), 0)
      const fresh = pick(g.totals, plan)
      return {
        big: n0(total), label: `customers · ${planName}`,
        delta: { v: fresh, text: `${n0(fresh)} new in the last ${per} days` },
        note: isNum(g.no_home_county) && g.no_home_county > 0 ? `${n0(g.no_home_county)} users have no home county` : '',
      }
    }
    const cur = pick(g.totals, plan), pri = pick(g.prior_totals, plan)
    return {
      big: n0(cur), label: `new users · last ${per} days · ${planName}`,
      delta: pri > 0
        ? { v: cur - pri, text: `${Math.abs(Math.round((cur - pri) / pri * 100))}% vs prior ${per} days` }
        : null,
      note: pri > 0 ? '' : `no sign-ups in the prior ${per} days to compare`,
    }
  }, [mode, plan, per, growth.data, growth.error, features, liveD, live.error, ov])

  const top = useMemo(() => {
    if (mode === 'now') {
      const rows = [...(liveD?.now_counties || [])].sort((a: any, b: any) => (b.n || 0) - (a.n || 0)).slice(0, 7)
      return { title: 'Where people are now', rows: rows.map((c: any) => ({ name: `${c.county}, ${c.state}`, b: n0(c.n), em: '' })) }
    }
    const rows = (features || []).map(f => {
      const p = f.properties || {}
      return { name: `${p.county}, ${p.state}`, cur: pick(p.new, plan), pri: pick(p.prior, plan), all: pick(p.customers, plan) }
    })
    if (mode === 'all') {
      return {
        title: 'Most customers',
        rows: rows.filter(r => r.all > 0).sort((a, b) => b.all - a.all).slice(0, 7)
          .map(r => ({ name: r.name, b: n0(r.all), em: '' })),
      }
    }
    return {
      title: 'Fastest growing counties',
      rows: rows.filter(r => r.cur - r.pri > 0).sort((a, b) => (b.cur - b.pri) - (a.cur - a.pri) || b.cur - a.cur).slice(0, 7)
        .map(r => ({ name: r.name, b: n0(r.cur), em: `+${n0(r.cur - r.pri)}` })),
    }
  }, [mode, plan, features, liveD])

  /* Live feed rows; rows not seen before flash once. */
  const events: any[] = liveD?.events || []
  const seen = useRef<Set<string> | null>(null)
  const keyed = useMemo(() => {
    const used = new Map<string, number>()
    return events.map(e => {
      const base = `${e.t}|${e.type}|${e.email || e.name}|${e.text}`
      const k = used.has(base) ? `${base}#${used.get(base)}` : base
      used.set(base, (used.get(base) || 0) + 1)
      return { e, k }
    })
  }, [events])
  const flash = (k: string) => seen.current !== null && !seen.current.has(k)
  useEffect(() => { seen.current = new Set(keyed.map(x => x.k)) }, [keyed])

  const ns = ov?.ns
  const att: any[] = ov?.attention || []
  const feats: any[] = ov?.features || []
  const ads = ov?.ads
  const q = ov?.quality
  const coh: any[] = ov?.cohorts || []
  const sys: any[] = ov?.systems || []
  const growth12 = (ov?.growth_12m || []).map((r: any) => ({ m: monthLabel(r.m), paying: r.paying, trialing: r.trialing }))
  const weekly = (ov?.weekly_new_users_12w || []).map((r: any) => ({ w: weekLabel(r.w), v: Number(r.v) || 0 }))

  const legend = mode === 'growth'
    ? { t: 'Change in new users vs prior period', lo: 'fewer', hi: 'more', bg: `linear-gradient(90deg,${DIV.join(',')})` }
    : mode === 'now'
      ? { t: 'People on now, at home county', lo: '', hi: '', bg: `linear-gradient(90deg,${PINK},${PINK})` }
      : { t: mode === 'all' ? 'Customers per county' : 'New users per county', lo: '1', hi: `${mx}+`, bg: `linear-gradient(90deg,${SEQ.join(',')})` }

  const Seg = <T extends string | number>({ items, value, on }: { items: [T, string][]; value: T; on: (v: T) => void }) => (
    <div className="v-seg" role="group">
      {items.map(([v, l]) => (
        <span key={String(v)} className={v === value ? 'on' : ''} role="button" tabIndex={0}
          onClick={() => on(v)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') on(v) }}>{l}</span>
      ))}
    </div>
  )

  const trendTick = { fill: '#6b7788', fontSize: fs * 0.7 }

  return (
    <div className="v7" ref={root}>
      <style dangerouslySetInnerHTML={{ __html: V7_CSS }} />

      <header className="v-hd">
        <button type="button" className="railbtn" onClick={onToggleRail}
          aria-expanded={railOpen} aria-label={railOpen ? 'Hide the menu' : 'Show the menu'}
          title={railOpen ? 'Hide the menu' : 'Show the menu'}>
          <span /><span /><span />
        </button>
        <div className="v-logo">Ground <span>Goat</span></div>
        {!ov && <span className="v-mut">numbers unavailable: {why}</span>}
        <div className="v-clock">
          <b>{clock || DASH}</b>
          <div>
            <span className={`v-livedot ${connected ? '' : 'off'}`} />
            {connected ? 'live' : 'reconnecting'}
          </div>
        </div>
      </header>

      <NorthStar ns={ns} onNow={liveD?.on_now} why={why} />

      <section className="v-main">
        <div className="v-card v-mapcard">
          <div className="v-maptools">
            <h3 className="v-maptitle">Where we&apos;re growing</h3>
            <Seg value={mode} on={setMode} items={[['new', 'New users'], ['growth', 'Growth vs last period'], ['now', 'On now'], ['all', 'All customers']]} />
            <div className="v-gap" />
            <Seg value={plan} on={setPlan} items={[['all', 'All plans'], ['basic', 'Basic State'], ['premium', 'Premium State'], ['county', 'County'], ['firm', 'Firm'], ['trial', 'Free trial']]} />
            <Seg value={per} on={setPer} items={[[7, '7 d'], [30, '30 d'], [90, '90 d']]} />
          </div>
          <div className="v-mapbox">
            <CountyMap features={features} nowCounties={liveD?.now_counties || null} cfg={cfg} />

            <div className="v-ovl v-big">
              <b>{head.big}</b>
              <span>{head.label}</span>
              <em>
                {head.delta && <span className={`v-d ${head.delta.v > 0 ? 'v-up' : head.delta.v < 0 ? 'v-dn' : 'v-fl'}`}>
                  {head.delta.v > 0 ? '▲' : head.delta.v < 0 ? '▼' : '='} {head.delta.text}</span>}
                {head.note && <span className="v-mut">{head.note}</span>}
              </em>
            </div>

            <div className="v-ovl v-topc">
              <h4>{top.title}</h4>
              {top.rows.length ? top.rows.map((r, i) => (
                <div className="v-tr" key={r.name + i}>
                  <i>{i + 1}</i><span>{r.name}</span><b>{r.b}</b><em>{r.em}</em>
                </div>
              )) : <div className="v-mut">{DASH} {growth.error && mode !== 'now' ? growth.error : mode === 'now' ? 'nobody placed on the map yet' : 'none in this period'}</div>}
            </div>

            <div className="v-ovl v-wk">
              <h4>New users per week</h4>
              <div className="v-wkc">
                {weekly.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weekly} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                      <XAxis dataKey="w" hide />
                      <YAxis hide domain={[0, 'auto']} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,.05)' }}
                        contentStyle={{ background: '#0b0e13', border: '1px solid #2b3444', fontSize: fs * 0.8 }}
                        labelFormatter={(l) => `Week of ${l}`} />
                      <Bar dataKey="v" name="New users" fill={PINK} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <span className="v-mut">{DASH} {why}</span>}
              </div>
            </div>

            <div className="v-ovl v-lgd">
              <span>{legend.t}</span>
              <div className="v-ramp" style={{ background: legend.bg }} />
              <div className="v-ends"><span>{legend.lo}</span><span>{legend.hi}</span></div>
            </div>
          </div>
        </div>

        <div className="v-col" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
          <div className="v-card">
            <div className="v-ct"><h3><span className="v-livedot" />Happening now</h3><small>every action, live</small></div>
            <div className="v-feed">
              {keyed.length ? keyed.map(({ e, k }) => {
                const [tag, cls] = EV[e.type] || ['•', 'i-map']
                return (
                  <div key={k} className={`v-ev ${flash(k) ? 'new' : ''}`}>
                    <span className={`v-ic ${cls}`}>{tag}</span>
                    <span className="v-m"><b>{e.name || e.email || 'Someone'}</b> {e.text}{e.place ? <em> · {e.place}</em> : null}</span>
                    <time>{timeFull(e.t)}</time>
                  </div>
                )
              }) : <span className="v-mut">{DASH} {live.error || (liveD ? 'nothing has happened yet today' : 'no live reading yet')}</span>}
            </div>
          </div>
        </div>

        <div className="v-col" style={{ gridTemplateRows: 'auto minmax(0,1fr)' }}>
          <div className="v-card">
            <div className="v-ct"><h3>Needs attention</h3><small>what went wrong · who it hit</small></div>
            <div className="v-incs">
              {!ov ? <span className="v-mut">{DASH} {why}</span>
                : att.length ? att.map((a, i) => {
                  const cust = Number(a.customers) || 0
                  const names: string[] = a.names || []
                  return (
                    <div key={i} className={`v-inc ${a.level === 'amber' ? 'w' : ''}`}>
                      <div className="v-t"><i>{String(a.kind || '').toUpperCase()}</i>{a.title}</div>
                      <div className="v-s">
                        {cust > 1 ? <b>{n0(cust)} customers</b>
                          : cust === 1 && names[0] ? <b>{names[0]}</b>
                            : <span>No customer impact</span>}
                        {a.detail ? ` · ${a.detail}` : ''}
                        {a.since ? ` · since ${timeShort(a.since)}` : ''}
                        {cust > 1 && names.length ? ` · ${names.join(', ')}${a.more ? `, +${a.more}` : ''}` : ''}
                      </div>
                    </div>
                  )
                }) : <span className="v-mut">Nothing went wrong in the last 24 hours</span>}
            </div>
          </div>
          <div className="v-card">
            <div className="v-ct"><h3>Growth</h3><small>paying · 12 months</small></div>
            <div className="v-fill">
              {growth12.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={growth12} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#1d2532" />
                    <XAxis dataKey="m" tick={trendTick} tickLine={false} axisLine={{ stroke: '#1d2532' }} interval="preserveStartEnd" minTickGap={fs * 2} />
                    <YAxis tick={trendTick} tickLine={false} axisLine={false} width={fs * 3} tickCount={4} domain={[0, 'auto']} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: '#0b0e13', border: '1px solid #2b3444', fontSize: fs * 0.8 }} />
                    <Area type="monotone" dataKey="paying" name="Paying" stroke={PINK} fill={PINK} fillOpacity={0.13} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="trialing" name="On trial" stroke={BLUE} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : <span className="v-mut">{DASH} {why}</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="v-bot">
        <div className="v-card">
          <div className="v-ct"><h3>Features</h3><small>today · click a row for detail</small></div>
          <div className="v-ft">
            <div className="v-fr v-fh"><span>Feature</span><span>People</span><span>Uses</span><span>14 d</span><span>Worked</span><span>Speed</span><span>vs wk</span></div>
            {feats.length ? feats.map(f => {
              const w = f.worked_pct
              const wc = !isNum(w) ? '' : w >= 99 ? '' : w < 97 ? 'bad' : 'warn'
              const col = f.status === 'red' ? BAD : f.status === 'amber' ? WARN : PINK
              const crashes = isNum(f.crashes_today) && f.crashes_today > 0
              return (
                <div key={f.key} className="v-fr v-frow" onClick={() => setOpenFeature(f)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') setOpenFeature(f) }}>
                  <span><i className={`v-st ${dotClass(f.status)}`} />{f.name}</span>
                  <span>{n0(f.people)}</span>
                  <span>{isNum(f.uses) ? n0(f.uses) : <span className="v-dim">—</span>}</span>
                  <span className="v-fsp"><Spark vals={series(f.series_14d?.map?.((v: any) => (typeof v === 'object' ? v : { v })))} color={col} /></span>
                  <span className={wc}>{isNum(w) ? `${w}%` : DASH}</span>
                  <span>{secs(f.speed_ms)}</span>
                  <span>
                    {crashes ? <span className="bad">{n0(f.crashes_today)} crashes</span>
                      : !isNum(f.vs_week_pct) ? <span className="v-dim">—</span>
                        : f.vs_week_pct === 0 ? <span className="v-dim">=</span>
                          : <span style={{ color: f.vs_week_pct > 0 ? '#80e3ad' : '#ffb0ae' }}>
                            {f.vs_week_pct > 0 ? '▲' : '▼'} {n0(Math.abs(f.vs_week_pct))}%</span>}
                  </span>
                </div>
              )
            }) : <span className="v-mut">{DASH} {why}</span>}
          </div>
        </div>

        <div className="v-card">
          <div className="v-ct"><h3>Paid ads · worth the spend?</h3><small>last 30 days</small></div>
          <div className="v-ads">
            <div className="v-ar v-fh"><span>Platform</span><span>Spend</span><span>Clicks</span><span>Sign-ups</span><span>Paid</span><span>Per paying</span><span>Return</span></div>
            {ads?.platforms?.length ? ads.platforms.map((p: any) => (
              <div key={p.key} className="v-ar">
                <span><i className={`v-st ${dotClass(p.status)}`} />{p.name}</span>
                <span>{usd(p.spend)}</span>
                <span>{n0(p.clicks)}</span>
                <span>{n0(p.signups)}</span>
                <span>{n0(p.paid)}</span>
                <span>{usd(p.per_paying)}</span>
                <span>{isNum(p.return_x)
                  ? <b className={`v-ret ${dotClass(p.status)}`}>{n0(p.return_x, 1)}×</b> : DASH}</span>
              </div>
            )) : <span className="v-mut">{DASH} {why}</span>}
          </div>
          {ads && ads.spend_connected === false && (
            <div className="v-mut v-adnote">Spend and clicks: connect ad accounts</div>
          )}
          {ads?.funnel_week && (
            <div className="v-adfoot">
              <span>This week</span>
              <span>Visitors <b>{n0(ads.funnel_week.visitors)}</b></span>
              <span>→ Sign-ups <b>{n0(ads.funnel_week.signups)}</b></span>
              <span>→ Trials <b>{n0(ads.funnel_week.trials)}</b></span>
              <span>→ Paid <b>{n0(ads.funnel_week.paid)}</b></span>
            </div>
          )}
        </div>

        <div className="v-card">
          <div className="v-ct"><h3>Quality</h3><small>today</small></div>
          <div className="v-ql">
            {!q ? <span className="v-mut">{DASH} {why}</span> : <>
              <div className="v-qh">Goat Search</div>
              <div className="v-qr"><span>Searches · answered</span>
                <b className={!isNum(q.goat?.answered_pct) ? '' : q.goat.answered_pct >= 95 ? 'g' : 'w'}>
                  {n0(q.goat?.searches)} · {isNum(q.goat?.answered_pct) ? `${n0(q.goat.answered_pct)}%` : DASH}</b></div>
              <div className="v-qr"><span>Avg results · avg / slowest</span>
                <b>{n0(q.goat?.avg_results)} · {secsFromS(q.goat?.avg_s)} / {secsFromS(q.goat?.slowest_s)}</b></div>
              <div className="v-qh">Reports</div>
              <div className="v-qr"><span>Comp · tract · parcel</span>
                <b>{n0(q.reports?.comp)} · {n0(q.reports?.tract)} · {n0(q.reports?.parcel)}</b></div>
              <div className="v-qr"><span>Build avg · 95% · longest</span>
                <b>{secsFromS(q.reports?.avg_s)} · {secsFromS(q.reports?.p95_s)} · {secsFromS(q.reports?.max_s)}</b></div>
              <div className="v-qr"><span>Failed</span>
                <b className={!isNum(q.reports?.failed) ? '' : q.reports.failed === 0 ? 'g' : 'w'}>{n0(q.reports?.failed)}</b></div>
              {(q.data || []).length > 0 && <div className="v-qh">Data accuracy</div>}
              {(q.data || []).map((d: any, i: number) => (
                <div className="v-qr" key={i}><span>{d.label}</span>
                  <b className={d.status === 'green' ? 'g' : d.status === 'amber' || d.status === 'red' ? 'w' : ''}>{isNum(d.value) ? n0(d.value) : (d.value ?? DASH)}</b></div>
              ))}
            </>}
          </div>
        </div>

        <div className="v-card">
          <div className="v-ct"><h3>Do they come back?</h3><small>% active</small></div>
          <div className="v-coh">
            {coh.length ? <>
              <div className="v-cr"><span /><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span></div>
              {coh.map((c, i) => (
                <div className="v-cr" key={i}>
                  <span className="l" title={isNum(c.size) ? `${n0(c.size)} sign-ups` : undefined}>{weekLabel(c.week)}</span>
                  {[0, 1, 2, 3, 4].map(j => {
                    const v = c.pct?.[j]
                    return isNum(v)
                      ? <span key={j} style={{ background: COHORT_RAMP[Math.min(5, Math.max(0, Math.round((Number(v) - 50) / 10)))] }}>{n0(v)}</span>
                      : <span key={j} style={{ background: '#151b24' }} />
                  })}
                </div>
              ))}
            </> : <span className="v-mut">{DASH} {ov ? 'no sign-ups in these weeks yet' : why}</span>}
          </div>
        </div>

        <div className="v-card">
          <div className="v-ct"><h3>Systems</h3><small>right now</small></div>
          <div className="v-sys">
            {sys.length ? sys.map((s, i) => (
              <div className="v-su" key={i}>
                <span><i className={`v-st ${dotClass(s.status)}`} />{s.label}</span>
                <b className={s.status === 'amber' ? 'w' : s.status === 'red' ? 'r' : ''}>{s.value ?? DASH}</b>
              </div>
            )) : <span className="v-mut">{DASH} {why}</span>}
          </div>
        </div>
      </section>

      <Drawer f={openFeature} fs={fs} onClose={() => setOpenFeature(null)} />
    </div>
  )
}

/* ── Styles: the mockup's, scoped under .v7 and prefixed v- ───────── */
const V7_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
.v7{
  --bg:#0b0e13;--card:#131922;--card2:#1a2130;--line:#222b39;--grid:#1d2532;
  --ink:#eef1f5;--ink2:#a9b3c1;--ink3:#6b7788;
  --pink:#F58CDE;--blue:#3987e5;--aqua:#199e70;--orange:#d95926;
  --good:#2fbf71;--goodbg:#0f2c1e;--warn:#f2b233;--warnbg:#30250b;--bad:#ef5350;--badbg:#38151a;
  --f:clamp(11px, calc(0.5vw + 0.3vh), 28px);
  height:100%;min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1.9fr) minmax(0,1fr);
  gap:.6em;padding:.75em .95em;background:var(--bg);color:var(--ink);
  font-family:Inter,system-ui,sans-serif;font-size:var(--f);line-height:1.3;overflow:hidden;
}
.v7 *{box-sizing:border-box}
.v7 .v-mut{color:var(--ink3);font-size:.78em;font-weight:400}
.v7 .v-card{background:var(--card);border:1px solid var(--line);border-radius:.75em;padding:.65em .8em;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.v7 .v-ct{display:flex;align-items:baseline;gap:.6em;margin-bottom:.35em;flex:none}
.v7 .v-ct h3{margin:0;font-size:.9em;font-weight:600;color:var(--ink2);white-space:nowrap}
.v7 .v-ct small{font-size:.72em;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v7 .v-livedot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:var(--good);margin-right:.35em;animation:v7pulse 1s infinite}
.v7 .v-livedot.off{background:var(--ink3);animation:none}
@keyframes v7pulse{50%{opacity:.35}}
.v7 .v-seg{display:inline-flex;background:var(--card2);border:1px solid var(--line);border-radius:.5em;padding:.15em}
.v7 .v-seg span{font-size:.76em;color:var(--ink2);padding:.28em .6em;border-radius:.38em;cursor:pointer;white-space:nowrap;user-select:none}
.v7 .v-seg span.on{background:#2a3446;color:var(--ink);font-weight:600}
.v7 .v-seg span:focus-visible{outline:2px solid var(--pink);outline-offset:1px}

.v7 .v-hd{display:flex;align-items:center;gap:1em;min-height:0}
.v7 .v-logo{font-weight:700;font-size:1.3em}.v7 .v-logo span{color:var(--pink)}
.v7 .v-clock{margin-left:auto;text-align:right}
.v7 .v-clock b{font-size:1.25em;font-weight:600;font-variant-numeric:tabular-nums}
.v7 .v-clock div{font-size:.74em;color:var(--ink3)}

.v7 .v-ns{display:grid;grid-template-columns:1.25fr repeat(6,1fr);gap:.6em}
.v7 .v-k .v-lab{font-size:.8em;color:var(--ink2);display:flex;justify-content:space-between;white-space:nowrap;gap:.5em}
.v7 .v-k .v-num{font-size:2em;font-weight:700;letter-spacing:-.02em;line-height:1.05;font-variant-numeric:tabular-nums;margin-top:.12em}
.v7 .v-k .v-cmp{display:flex;gap:.5em;font-size:.74em;margin-top:.22em;white-space:nowrap;min-height:1.5em;align-items:center;overflow:hidden}
.v7 .v-sub{color:var(--ink2);overflow:hidden;text-overflow:ellipsis}
.v7 .v-d{font-weight:600;padding:.05em .4em;border-radius:.35em;white-space:nowrap}
.v7 .v-up{color:#80e3ad;background:rgba(47,191,113,.12)}.v7 .v-dn{color:#ffb0ae;background:rgba(239,83,80,.13)}.v7 .v-fl{color:var(--ink2);background:rgba(255,255,255,.06)}
.v7 .v-k .v-sp{height:2.2em;margin-top:.3em;position:relative}
.v7 .v-k.v-hero .v-num{font-size:2.5em;color:var(--pink)}

.v7 .v-main{display:grid;grid-template-columns:minmax(0,7.2fr) minmax(0,2.9fr) minmax(0,2.9fr);gap:.6em;min-height:0}
.v7 .v-mapcard{padding:.65em .8em .6em}
.v7 .v-maptools{display:flex;gap:.6em;align-items:center;flex-wrap:wrap;margin-bottom:.45em;flex:none}
.v7 .v-maptools .v-gap{flex:1}
.v7 .v-maptitle{margin:0;font-size:1em;font-weight:600}
.v7 .v-mapbox{position:relative;flex:1;min-height:0;border-radius:.55em;overflow:hidden;background:#0e131b}
.v7 .v-mapwrap{position:absolute;inset:0}
.v7 .v-mapgl{position:absolute;inset:0}
.v7 .v-mapgl .maplibregl-canvas{outline:none}
.v7 .v-ovl{position:absolute;background:rgba(14,19,27,.88);border:1px solid var(--line);border-radius:.6em;padding:.55em .7em;backdrop-filter:blur(6px);z-index:2}
.v7 .v-big{left:.7em;top:.7em}
.v7 .v-big b{display:block;font-size:2.4em;font-weight:700;color:var(--pink);line-height:1;font-variant-numeric:tabular-nums}
.v7 .v-big span{font-size:.78em;color:var(--ink2)}
.v7 .v-big em{display:flex;flex-direction:column;align-items:flex-start;gap:.2em;font-style:normal;font-size:.76em;margin-top:.3em}
.v7 .v-topc{right:.7em;top:.7em;width:15.5em}
.v7 .v-topc h4,.v7 .v-wk h4{margin:0 0 .35em;font-size:.74em;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em}
.v7 .v-tr{display:grid;grid-template-columns:1.1em minmax(0,1fr) auto auto;gap:.45em;align-items:center;font-size:.8em;padding:.2em 0}
.v7 .v-tr i{font-style:normal;color:var(--ink3);font-size:.9em}
.v7 .v-tr span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v7 .v-tr b{font-variant-numeric:tabular-nums}
.v7 .v-tr em{font-style:normal;font-size:.85em;color:#80e3ad;font-variant-numeric:tabular-nums;min-width:1.6em;text-align:right}
.v7 .v-wk{right:.7em;bottom:.7em;width:15.5em;height:8.5em;display:flex;flex-direction:column}
.v7 .v-wkc{flex:1;position:relative;min-height:0}
.v7 .v-lgd{left:.7em;bottom:.7em;font-size:.74em;color:var(--ink2)}
.v7 .v-ramp{width:14em;height:.6em;border-radius:.3em;margin:.35em 0 .2em}
.v7 .v-ends{display:flex;justify-content:space-between;color:var(--ink3);font-size:.9em;min-height:1em}
.v7 .v-tip{position:absolute;pointer-events:none;background:#0b0e13;border:1px solid #2f3a4c;border-radius:.5em;padding:.45em .6em;font-size:.78em;display:none;white-space:nowrap;z-index:5}
.v7 .v-tip b{display:block;font-size:1.05em;margin-bottom:.15em}
.v7 .v-tip span{color:var(--ink2)}
.v7 .maplibregl-canvas-container.maplibregl-interactive{cursor:grab}

.v7 .v-col{display:grid;gap:.6em;min-height:0}
.v7 .v-incs{display:flex;flex-direction:column;min-height:0;overflow:hidden}
.v7 .v-inc{display:flex;flex-direction:column;gap:.15em;padding:.45em 0 .45em .65em;margin-bottom:.35em;border-left:.25em solid var(--bad);background:rgba(239,83,80,.06)}
.v7 .v-inc.w{border-left-color:var(--warn);background:rgba(242,178,51,.06)}
.v7 .v-inc .v-t{font-weight:600;font-size:.88em}
.v7 .v-inc .v-t i{font-style:normal;font-size:.72em;font-weight:700;letter-spacing:.05em;margin-right:.45em;color:#ff8f8c}
.v7 .v-inc.w .v-t i{color:var(--warn)}
.v7 .v-inc .v-s{font-size:.76em;color:var(--ink2)}.v7 .v-inc .v-s b{color:var(--ink)}
.v7 .v-feed{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.v7 .v-ev{display:grid;grid-template-columns:2em minmax(0,1fr) auto;gap:.45em;align-items:center;padding:.3em .1em;border-bottom:1px solid var(--grid);font-size:.8em;flex:none}
.v7 .v-ev.new{animation:v7slide .6s ease}
@keyframes v7slide{from{background:rgba(245,140,222,.14)}to{background:transparent}}
.v7 .v-ic{width:2em;height:2em;border-radius:.45em;display:grid;place-items:center;font-size:.8em;font-weight:700}
.v7 .v-m{color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v7 .v-m b{color:var(--ink);font-weight:600}.v7 .v-m em{font-style:normal;color:var(--ink3)}
.v7 .v-ev time{font-size:.85em;color:var(--ink3);font-variant-numeric:tabular-nums;white-space:nowrap}
.v7 .i-sub{background:rgba(47,191,113,.16);color:#80e3ad}.v7 .i-rep{background:rgba(57,135,229,.18);color:#8dbbf2}
.v7 .i-gs{background:rgba(245,140,222,.15);color:var(--pink)}.v7 .i-err{background:var(--badbg);color:#ffb0ae}
.v7 .i-sign{background:rgba(25,158,112,.16);color:#6fd3ac}.v7 .i-map{background:rgba(255,255,255,.07);color:var(--ink2)}
.v7 .v-fill{position:relative;flex:1;min-height:0}
.v7 .recharts-wrapper{font-family:Inter,system-ui,sans-serif}

.v7 .v-bot{display:grid;grid-template-columns:minmax(0,3.6fr) minmax(0,2.9fr) minmax(0,2fr) minmax(0,1.75fr) minmax(0,2fr);gap:.6em;min-height:0}
.v7 .v-ft,.v7 .v-ads{flex:1;min-height:0;display:flex;flex-direction:column;font-size:.78em}
.v7 .v-ads{font-size:.8em}
.v7 .v-fr,.v7 .v-ar{display:grid;align-items:center;font-variant-numeric:tabular-nums;white-space:nowrap}
.v7 .v-fr{grid-template-columns:minmax(0,1.9fr) .7fr .8fr 1.1fr .8fr .7fr 1fr}
.v7 .v-ar{grid-template-columns:minmax(0,1.3fr) .9fr .8fr 1.1fr .7fr 1.2fr .9fr;flex:1;min-height:0}
.v7 .v-fr>span,.v7 .v-ar>span{text-align:right;padding:0 .35em;overflow:hidden;text-overflow:ellipsis;min-width:0}
.v7 .v-fr>span:first-child,.v7 .v-ar>span:first-child{text-align:left;font-weight:600}
.v7 .v-fh{flex:none!important;color:var(--ink3);font-weight:500;font-size:.86em;padding-bottom:.25em}
.v7 .v-fh>span{font-weight:500!important}
.v7 .v-frow{flex:1;min-height:0;border-top:1px solid var(--grid);cursor:pointer}
.v7 .v-ar{border-top:1px solid var(--grid)}
.v7 .v-ar.v-fh{border-top:0}
.v7 .v-frow:hover{background:var(--card2)}
.v7 .v-frow:focus-visible{outline:2px solid var(--pink);outline-offset:-2px}
.v7 .v-fsp{height:1.25em;display:block;width:5em;margin-left:auto}
.v7 .v-fsp svg{display:block}
.v7 .v-st{display:inline-block;width:.7em;height:.7em;border-radius:50%;margin-right:.45em;vertical-align:-.05em}
.v7 .v-st.g{background:var(--good)}.v7 .v-st.w{background:var(--warn)}.v7 .v-st.r{background:var(--bad)}.v7 .v-st.x{background:var(--ink3)}
.v7 .bad{color:#ff9e9c;font-weight:600}.v7 .warn{color:var(--warn);font-weight:600}.v7 .v-dim{color:var(--ink3)}
.v7 .v-ret{font-weight:700;padding:.08em .4em;border-radius:.3em}
.v7 .v-ret.g{background:var(--goodbg);color:#80e3ad}.v7 .v-ret.w{background:var(--warnbg);color:#ffd88a}.v7 .v-ret.r{background:var(--badbg);color:#ffb0ae}.v7 .v-ret.x{background:rgba(255,255,255,.06);color:var(--ink2)}
.v7 .v-adnote{padding:.2em 0;flex:none}
.v7 .v-adfoot{display:flex;gap:.6em;font-size:.7em;color:var(--ink3);padding-top:.3em;border-top:1px solid var(--grid);white-space:nowrap;flex:none;overflow:hidden}.v7 .v-adfoot b{color:var(--ink)}
.v7 .v-ql{display:flex;flex-direction:column;flex:1;min-height:0;justify-content:space-between;overflow:hidden}
.v7 .v-qh{font-size:.68em;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;margin-top:.2em}
.v7 .v-qr{display:flex;justify-content:space-between;gap:.5em;font-size:.76em}
.v7 .v-qr span{color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v7 .v-qr b{font-variant-numeric:tabular-nums;white-space:nowrap}.v7 .v-qr b.g{color:#80e3ad}.v7 .v-qr b.w{color:var(--warn)}
.v7 .v-coh{flex:1;min-height:0;display:flex;flex-direction:column;gap:2px;font-size:.72em}
.v7 .v-cr{display:grid;grid-template-columns:3.6em repeat(5,1fr);gap:2px;flex:1;min-height:0}
.v7 .v-cr:first-child{flex:none}
.v7 .v-cr>span{display:flex;align-items:center;justify-content:center;border-radius:3px;font-variant-numeric:tabular-nums;color:#fff;min-height:0}
.v7 .v-cr:first-child>span{color:var(--ink3);font-weight:500}
.v7 .v-cr>span.l{color:var(--ink2);justify-content:flex-start;white-space:nowrap}
.v7 .v-sys{display:flex;flex-direction:column;flex:1;min-height:0;justify-content:space-between;overflow:hidden}
.v7 .v-su{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.5em;align-items:center;font-size:.76em}
.v7 .v-su span{color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v7 .v-su b{font-variant-numeric:tabular-nums;white-space:nowrap}.v7 .v-su b.w{color:var(--warn)}.v7 .v-su b.r{color:var(--bad)}

.v7 .v-scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;z-index:300}
.v7 .v-scrim.on{display:block}
.v7 .v-drawer{position:fixed;top:0;right:0;height:100vh;width:min(38vw,820px);background:#10151d;border-left:1px solid var(--line);padding:1.2em 1.3em;display:none;flex-direction:column;gap:.8em;z-index:301;overflow:hidden}
.v7 .v-drawer.on{display:flex}
.v7 .v-drawer h2{margin:0;font-size:1.5em;display:flex;align-items:center;gap:.3em}
.v7 .v-hint{margin-left:auto;font-size:.55em;color:var(--ink3);font-weight:400}
.v7 .v-dk{display:grid;grid-template-columns:repeat(4,1fr);gap:.5em}
.v7 .v-dk div{background:var(--card);border:1px solid var(--line);border-radius:.6em;padding:.55em .65em}
.v7 .v-dk span{font-size:.74em;color:var(--ink3)}.v7 .v-dk b{display:block;font-size:1.4em;font-variant-numeric:tabular-nums}
.v7 .v-dchart{height:13em;position:relative;background:var(--card);border:1px solid var(--line);border-radius:.6em;padding:.6em;display:flex;flex-direction:column;flex:none}
.v7 .v-dtitle{font-size:.74em;color:var(--ink3);margin-bottom:.3em}
.v7 .v-dchart .recharts-responsive-container{flex:1;min-height:0}
.v7 .v-dl{background:var(--card);border:1px solid var(--line);border-radius:.6em;padding:.5em .7em;font-size:.84em}
.v7 .v-dl div{display:flex;justify-content:space-between;padding:.3em 0;border-bottom:1px solid var(--grid)}.v7 .v-dl div:last-child{border:0}.v7 .v-dl span{color:var(--ink2)}
`
