'use client'

/**
 * "I'm open" — tells the backend once a minute that this tab is on screen,
 * so the Command Center's On now counts everyone with Ground Goat open, not
 * only people who happened to click in the last five minutes.
 * Owner 11/27: "if someone has the app or website open on their device,
 * then that should show as a current user."
 *
 * Signed in: the ping carries the token, so the person is counted (staff
 * and the owner included). Signed out: it carries a random id this browser
 * keeps, so a visitor is counted once however many tabs they have open.
 * A hidden tab sends nothing. Never throws, never blocks the page.
 */

import { useEffect } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
export const PRESENCE_PING_MS = 60_000
const DEVICE_KEY = 'gg_device_id'

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = (crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return ''
  }
}

function ping() {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
  let token: string | null = null
  try { token = localStorage.getItem('auth_token') } catch { /* storage blocked */ }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const body = token ? '{}' : JSON.stringify({ device_id: deviceId(), client: 'web' })
  fetch(`${API_URL}/api/presence/ping`, { method: 'POST', headers, body, keepalive: true }).catch(() => {})
}

export default function PresencePing() {
  useEffect(() => {
    ping()
    const t = window.setInterval(ping, PRESENCE_PING_MS)
    const onVis = () => { if (document.visibilityState === 'visible') ping() }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  return null
}
