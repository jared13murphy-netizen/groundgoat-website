'use client'

// /nav?ll=<lat>,<lng> — where the Applicator Report's QR code points (owner
// 11/12): Apple Maps directions on an iPhone or iPad, Google Maps everywhere
// else. Sends the phone straight on; the links stay for anything that blocks
// the automatic hand-off.
import { useEffect, useState } from 'react'

function parse(ll: string | null): { lat: number; lng: number } | null {
  const [a, b] = (ll || '').split(',').map((x) => Number(x.trim()))
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lng: b } : null
}

export default function NavPage() {
  const [pt, setPt] = useState<{ lat: number; lng: number } | null | undefined>(undefined)
  useEffect(() => {
    const p = parse(new URLSearchParams(window.location.search).get('ll'))
    setPt(p)
    if (!p) return
    const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document
    window.location.replace(apple
      ? `https://maps.apple.com/?daddr=${p.lat},${p.lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`)
  }, [])
  const link = { display: 'block', padding: '14px 16px', borderRadius: 12, background: '#F58CDE', color: '#000', fontWeight: 700, textDecoration: 'none', textAlign: 'center' as const }
  return (
    <main style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0B0B0B', color: '#fff' }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' }}>
        {pt === null ? <p>That location link is not valid.</p> : <>
          <p style={{ margin: 0 }}>Opening directions…</p>
          {pt && <>
            <a style={link} href={`https://maps.apple.com/?daddr=${pt.lat},${pt.lng}`}>Apple Maps</a>
            <a style={link} href={`https://www.google.com/maps/dir/?api=1&destination=${pt.lat},${pt.lng}`}>Google Maps</a>
            <p style={{ margin: 0, fontSize: 13, color: '#A1A1AA' }}>{pt.lat.toFixed(5)}, {pt.lng.toFixed(5)}</p>
          </>}
        </>}
      </div>
    </main>
  )
}
