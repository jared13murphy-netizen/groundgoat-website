'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, User, Loader2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

interface UsageData {
  user_id: string
  last_active_at: string | null
  active_days_30: number
  active_days_7: number
  requests_30: number
  requests_7: number
  top_features: { label: string; count: number }[]
  sparkline: { date: string; requests: number }[]
  summary_updated_at: string | null
}

interface UserInfo {
  id: string
  email: string
  first_name: string
  last_name: string
  subscription_count: number
  account_type?: string
  // Admin access override (2026-08-18). access_override is what was granted;
  // access_override_active is false once an expiry has passed — an expired
  // override behaves exactly like none, so the two must be shown separately
  // or an admin cannot tell "granted" from "granted but lapsed".
  access_override?: string | null
  access_override_active?: boolean
  access_override_firm_id?: string | null
  access_override_reason?: string | null
  access_override_expires_at?: string | null
}

interface FirmOption {
  id: string
  name: string
  subscription_status: string
}

const OVERRIDE_OPTIONS = [
  { value: '', label: 'No override — use their real plan' },
  { value: 'premium_state', label: 'Premium (keeps their own states)' },
  { value: 'firm_user', label: 'Management firm user (all states)' },
  { value: 'firm_admin', label: 'Management firm admin (all states)' },
]

const FIRM_OVERRIDES = ['firm_user', 'firm_admin']

export default function UserDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)

  // ---- Access override ----------------------------------------------------
  const [firms, setFirms] = useState<FirmOption[]>([])
  const [ovValue, setOvValue] = useState('')
  const [ovFirmId, setOvFirmId] = useState('')
  const [ovReason, setOvReason] = useState('')
  const [ovExpires, setOvExpires] = useState('')
  const [ovSaving, setOvSaving] = useState(false)
  const [ovMsg, setOvMsg] = useState<string | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }

    fetchWithAuth(`${API_URL}/api/auth/me`)
      .then(res => {
        if (!res.ok) {
          router.push('/signin')
          return null
        }
        return res.json()
      })
      .then(me => {
        if (!me) return
        if (me.account_type !== 'groundgoat_admin') {
          router.push('/account')
          return
        }

        Promise.all([
          // No limit: this page finds one user client-side, so a capped list
          // silently 404s anyone outside the cap (users come back newest-first).
          fetchWithAuth(`${API_URL}/api/admin/users`).then(r => r.json()),
          fetchWithAuth(`${API_URL}/api/admin/users/${id}/usage`).then(r => r.json()),
        ])
          .then(([usersData, usageData]) => {
            const users: UserInfo[] = usersData.users || usersData || []
            const found = users.find((u: UserInfo) => u.id === id) || null
            setUserInfo(found)
            // Seed the override form from what is already set, so an admin
            // edits the existing grant rather than silently replacing it.
            if (found) {
              setOvValue(found.access_override || '')
              setOvFirmId(found.access_override_firm_id || '')
              setOvReason(found.access_override_reason || '')
              setOvExpires(
                found.access_override_expires_at
                  ? String(found.access_override_expires_at).slice(0, 10)
                  : ''
              )
            }
            fetchWithAuth(`${API_URL}/api/admin/management-firms`)
              .then(r => (r.ok ? r.json() : { firms: [] }))
              .then(d => setFirms(d.firms || []))
              .catch(() => setFirms([]))
            setUsage(usageData)
            setLoading(false)
          })
          .catch(err => {
            setError(err.message || 'Failed to load data')
            setLoading(false)
          })
      })
      .catch(() => {
        router.push('/signin')
      })
  }, [id, router])

  const saveOverride = async () => {
    setOvMsg(null)
    if (FIRM_OVERRIDES.includes(ovValue) && !ovFirmId) {
      setOvMsg('Pick a management firm for a firm override.')
      return
    }
    if (ovValue && !ovReason.trim()) {
      setOvMsg('A reason is required — it is the only record of why this grant exists.')
      return
    }
    setOvSaving(true)
    try {
      // Empty selection means "remove the override", which is a DELETE.
      const res = ovValue
        ? await fetchWithAuth(`${API_URL}/api/admin/users/${id}/access-override`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              override: ovValue,
              firm_id: FIRM_OVERRIDES.includes(ovValue) ? ovFirmId : undefined,
              reason: ovReason.trim(),
              // date input gives YYYY-MM-DD; send end-of-day UTC so the grant
              // covers the whole day the admin picked.
              expires_at: ovExpires ? `${ovExpires}T23:59:59Z` : undefined,
            }),
          })
        : await fetchWithAuth(`${API_URL}/api/admin/users/${id}/access-override`, {
            method: 'DELETE',
          })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setUserInfo(prev => prev ? {
        ...prev,
        access_override: data.access_override ?? null,
        access_override_active: Boolean(data.access_override),
        access_override_firm_id: data.access_override_firm_id ?? null,
        access_override_reason: data.access_override_reason ?? null,
        access_override_expires_at: data.access_override_expires_at ?? null,
      } : prev)
      setOvMsg(ovValue
        ? 'Saved. Their billing is unchanged — they still pay for their real plan.'
        : 'Override removed. They fall back to the plan they pay for.')
    } catch (e: any) {
      setOvMsg(`Failed: ${e.message || e}`)
    } finally {
      setOvSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  if (error || !usage) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-gg-gray-400 mb-4">{error || 'User not found'}</p>
          <Link href="/admin/users" className="text-gg-pink hover:underline text-sm">
            Back to Users
          </Link>
        </div>
      </div>
    )
  }

  const hasSparkline = usage.sparkline.length > 0 && usage.sparkline.some(d => d.requests > 0)

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-6">
          <Link href="/admin/users" className="text-gg-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </Link>
        </div>

        <div className="flex items-center gap-4 mb-8">
          <User size={24} className="text-gg-pink" />
          <div>
            <h1 className="font-display text-4xl font-bold text-white">User Detail</h1>
            {userInfo && (
              <p className="text-gg-gray-400 mt-1">{userInfo.email}</p>
            )}
          </div>
        </div>

        {/* Access override (2026-08-18). Grants access ABOVE what the user
            pays for. Never touches billing: no Stripe or Apple call is made
            and user_subscriptions is not written, so they keep paying
            exactly what they paid before. */}
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-white mb-1">Access Override</h2>
          <p className="text-xs text-gg-gray-400 mb-4">
            Give this user more access than their plan includes. Their billing
            does not change — they keep paying for their current plan.
          </p>

          {userInfo?.access_override && (
            <div className="mb-4 text-sm">
              <span className="text-gg-gray-400">Currently granted: </span>
              <span className="text-white font-medium">
                {OVERRIDE_OPTIONS.find(o => o.value === userInfo.access_override)?.label
                  || userInfo.access_override}
              </span>
              {userInfo.access_override_active === false && (
                <span className="ml-2 text-yellow-500">(expired — no longer applied)</span>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Override</label>
              <select
                value={ovValue}
                onChange={e => setOvValue(e.target.value)}
                className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded px-3 py-2 text-white text-sm"
              >
                {OVERRIDE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {FIRM_OVERRIDES.includes(ovValue) && (
              <div>
                <label className="block text-xs text-gg-gray-400 mb-1">Management firm</label>
                <select
                  value={ovFirmId}
                  onChange={e => setOvFirmId(e.target.value)}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded px-3 py-2 text-white text-sm"
                >
                  <option value="">Select a firm…</option>
                  {firms.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.subscription_status !== 'active' && f.subscription_status !== 'trialing'
                        ? ` (firm ${f.subscription_status})`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {ovValue && (
              <>
                <div className="md:col-span-2">
                  <label className="block text-xs text-gg-gray-400 mb-1">
                    Reason (required)
                  </label>
                  <input
                    type="text"
                    value={ovReason}
                    onChange={e => setOvReason(e.target.value)}
                    placeholder="e.g. comped premium while evaluating the firm plan"
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded px-3 py-2 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gg-gray-400 mb-1">
                    Expires (optional — blank = no expiry)
                  </label>
                  <input
                    type="date"
                    value={ovExpires}
                    onChange={e => setOvExpires(e.target.value)}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded px-3 py-2 text-white text-sm"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={saveOverride}
              disabled={ovSaving}
              className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
            >
              {ovSaving ? 'Saving…' : ovValue ? 'Save override' : 'Remove override'}
            </button>
            {ovMsg && <span className="text-sm text-gg-gray-300">{ovMsg}</span>}
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Usage</h2>

          <div className="flex flex-wrap gap-6 mb-6">
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Last Active</p>
              <p className="text-2xl font-bold text-white">{timeAgo(usage.last_active_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Active Days (30d)</p>
              <p className="text-2xl font-bold text-white">{usage.active_days_30}</p>
            </div>
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Active Days (7d)</p>
              <p className="text-2xl font-bold text-white">{usage.active_days_7}</p>
            </div>
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Requests (30d)</p>
              <p className="text-2xl font-bold text-white">{usage.requests_30}</p>
            </div>
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Requests (7d)</p>
              <p className="text-2xl font-bold text-white">{usage.requests_7}</p>
            </div>
            {userInfo && typeof userInfo.subscription_count === 'number' && (
              <div>
                <p className="text-xs text-gg-gray-400 mb-1">Subscriptions</p>
                <p className="text-2xl font-bold text-white">{userInfo.subscription_count}</p>
              </div>
            )}
          </div>

          <div className="border-t border-gg-gray-700 my-6" />

          <p className="text-sm font-medium text-gg-gray-400 mb-3">Top Features</p>
          {usage.top_features.length === 0 ? (
            <p className="text-sm text-gg-gray-500">No activity yet.</p>
          ) : (
            <div>
              {usage.top_features.slice(0, 5).map((feature, i) => (
                <div key={feature.label}>
                  {i > 0 && <div className="border-t border-gg-gray-800" />}
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-white">{feature.label}</span>
                    <span className="text-sm text-gg-gray-400">{feature.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-gg-gray-700 my-6" />

          <p className="text-sm font-medium text-gg-gray-400 mb-3">Activity (30 days)</p>
          {!hasSparkline ? (
            <p className="text-sm text-gg-gray-500">No activity yet.</p>
          ) : (
            <Sparkline data={usage.sparkline} />
          )}

          {usage.summary_updated_at && (
            <p className="text-xs text-gg-gray-500 mt-4">
              Data as of {new Date(usage.summary_updated_at).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/** The dates arrive as plain 'YYYY-MM-DD' calendar days (UTC), so they are
    split by hand. `new Date('2026-08-30')` parses as UTC midnight and then
    prints in the viewer's zone, which in the US is the PREVIOUS day — the
    axis would have been off by one for every reader west of Greenwich. */
function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[(m || 1) - 1]} ${d}`
}

/** A y-axis top that lands on a round number, so the ticks read 0 / 25 / 50
    rather than 0 / 23 / 46. */
function niceCeil(v: number): number {
  if (v <= 5) return 5
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * mag
    if (candidate >= v) return candidate
  }
  return 10 * mag
}

/** Daily requests over the last 30 days.
 *
 * This was a bare sparkline: no axes, no labels, no units — a shape with
 * nothing to read it against (owner, 2026-08-30: "I need an X and Y axis so
 * I understand what I'm looking at"). It also drew with
 * preserveAspectRatio="none", which stretches the marks horizontally to
 * whatever width the card happens to be, so a single day's bar rendered as a
 * wide slab and the rounded corners came out as ovals.
 *
 * Now: a labelled y-axis in requests, a labelled x-axis in dates, hairline
 * gridlines one step off the card surface, and a hover readout per day. Laid
 * out in HTML rather than a stretched SVG so the bars keep their proportions
 * and every day has a full-height hover target — including the empty ones,
 * which is how you tell "nothing happened" from "no data".
 */
function Sparkline({ data }: { data: { date: string; requests: number }[] }) {
  const max = Math.max(...data.map(d => d.requests), 1)
  const top = niceCeil(max)
  const ticks = [top, top / 2, 0]
  const last = data.length - 1
  const mid = Math.floor(last / 2)

  return (
    <div>
      <p className="text-[11px] text-gg-gray-500 mb-1 ml-10">Requests per day</p>
      <div className="pl-10">
        <div className="relative h-32">
          {/* Gridlines: solid hairlines one step off the card surface, and
              recessive. The 0 line doubles as the x-axis rule. */}
          {ticks.map(t => (
            <div key={t} className="absolute left-0 right-0 h-px bg-gg-gray-700"
              style={{ bottom: `${(t / top) * 100}%` }}>
              <span className="absolute right-full mr-2 -translate-y-1/2 text-[11px] text-gg-gray-500 tabular-nums whitespace-nowrap">
                {t.toLocaleString()}
              </span>
            </div>
          ))}
          {/* The y-axis rule. */}
          <div className="absolute left-0 top-0 bottom-0 w-px bg-gg-gray-700" />

          {/* One full-height column per day. The column is the hover target;
              the bar inside it is capped at 24px so a wide card gets air
              rather than slabs, and the 2px gap between columns is the card
              surface showing through — no borders on the marks. */}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => (
              <div key={d.date} className="group relative flex-1 h-full flex items-end justify-center">
                {d.requests > 0 && (
                  <div
                    className="w-full max-w-[24px] rounded-t bg-[#e91e8c]"
                    style={{ height: `${Math.max((d.requests / top) * 100, 1.5)}%` }}
                  />
                )}
                {/* Hover readout. A number on all 30 days would be unreadable,
                    so the values live here and on the axis. */}
                {/* Anchored to the plot edge for the first and last few days.
                    Centred on the column, the readout for 30 August hangs off
                    the right of the card — and off the screen entirely on a
                    phone. */}
                <div className={`pointer-events-none absolute bottom-full mb-1 hidden group-hover:block z-10
                                whitespace-nowrap rounded-md border border-gg-gray-600 bg-gg-gray-900 px-2 py-1
                                text-[11px] text-white shadow-lg ${
                                  i <= 2 ? 'left-0'
                                  : i >= data.length - 3 ? 'right-0'
                                  : 'left-1/2 -translate-x-1/2'}`}>
                  <span className="text-gg-gray-400">{dayLabel(d.date)}</span>
                  {' · '}
                  <span className="tabular-nums">{d.requests.toLocaleString()}</span>
                  {d.requests === 1 ? ' request' : ' requests'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Three x labels, not thirty. The ends anchor the window and the
            middle one shows which way time runs. */}
        <div className="relative mt-2 h-4 text-[11px] text-gg-gray-500">
          <span className="absolute left-0">{dayLabel(data[0].date)}</span>
          <span className="absolute left-1/2 -translate-x-1/2">{dayLabel(data[mid].date)}</span>
          <span className="absolute right-0">{dayLabel(data[last].date)}</span>
        </div>
      </div>
    </div>
  )
}
