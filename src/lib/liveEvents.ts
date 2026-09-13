// Live event feed from the API (same socket the phone app uses).
//
// Owner 9/13, fix-list item 13: when a watch count changes, every device in
// the world updates. The portal had no live connection at all — it only
// refetched on tab changes — so a bookmark tapped on the phone never showed
// on the computer. This is a small reconnecting client: sign-in token from
// localStorage, pong on the server's ping, exponential backoff, listeners
// keyed by the event's `type`.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws/listings'
const INITIAL_DELAY = 1000
const MAX_DELAY = 30000
const PING_TIMEOUT = 45000 // server pings every 30 s + grace

type Listener = (data: any) => void

class LiveEvents {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<Listener>>()
  private delay = INITIAL_DELAY
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setTimeout> | null = null
  private closedOnPurpose = false
  /** id of the signed-in user, echoed by the server on connect */
  userId: string | null = null

  connect() {
    if (typeof window === 'undefined') return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    const token = (() => { try { return localStorage.getItem('auth_token') } catch { return null } })()
    if (!token) return
    this.closedOnPurpose = false
    try {
      const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`)
      this.ws = ws
      ws.onopen = () => { this.delay = INITIAL_DELAY; this.resetPingTimer(); this.emit('connection_status', { connected: true }) }
      ws.onmessage = (ev) => {
        let data: any
        try { data = JSON.parse(ev.data) } catch { return }
        if (data.type === 'ping') { this.send({ type: 'pong' }); this.resetPingTimer(); return }
        if (data.type === 'connected') { this.userId = data.user_id ? String(data.user_id) : null; this.resetPingTimer(); return }
        if (data.type === 'auth_error') { ws.close(); return } // fetchWithAuth refreshes the token; next reconnect picks it up
        this.emit(data.type, data)
      }
      ws.onclose = () => {
        this.clearPingTimer()
        this.emit('connection_status', { connected: false })
        if (!this.closedOnPurpose) this.scheduleReconnect()
      }
      ws.onerror = () => { /* onclose follows */ }
    } catch {
      this.scheduleReconnect()
    }
  }

  disconnect() {
    this.closedOnPurpose = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.clearPingTimer()
    this.ws?.close()
    this.ws = null
  }

  on(type: string, cb: Listener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(cb)
    return () => { this.listeners.get(type)?.delete(cb) }
  }

  get isConnected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN }

  private send(msg: any) { if (this.isConnected) this.ws!.send(JSON.stringify(msg)) }

  private emit(type: string, data: any) {
    this.listeners.get(type)?.forEach(cb => { try { cb(data) } catch (e) { console.error('[liveEvents] listener error', e) } })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.connect(), this.delay)
    this.delay = Math.min(this.delay * 2, MAX_DELAY)
  }

  private resetPingTimer() {
    this.clearPingTimer()
    this.pingTimer = setTimeout(() => { this.ws?.close() }, PING_TIMEOUT) // silent server → reconnect
  }

  private clearPingTimer() { if (this.pingTimer) { clearTimeout(this.pingTimer); this.pingTimer = null } }
}

const liveEvents = new LiveEvents()
export default liveEvents
