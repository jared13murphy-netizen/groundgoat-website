'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, Upload, Trash2, Image as ImageIcon, AlertCircle } from 'lucide-react'
import { fetchFirmLogoUrl, getFirmBranding, readLogoFile, setFirmBranding } from '@/lib/firmBranding'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

/** Firm portal → Company Branding: the name and logo that print at the
 *  top of every report PDF the firm builds. Firm admins only. */
export default function FirmBrandingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [hasLogo, setHasLogo] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState<'name' | 'logo' | 'remove' | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const b = await getFirmBranding()
      setName(b.name || '')
      setHasLogo(b.has_logo)
      setLocalPreview(null)
      const next = b.has_logo ? await fetchFirmLogoUrl(Date.now()) : null
      setLogoUrl((prev) => {
        if (prev && prev !== next) { try { URL.revokeObjectURL(prev) } catch { /* already gone */ } }
        return next
      })
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not load your branding.' })
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }
    fetchWithAuth(`${API_URL}/api/auth/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (me) => {
        if (!me || !['firm_admin', 'groundgoat_admin'].includes(me.account_type)) {
          router.push('/account')
          return
        }
        await load()
        setLoading(false)
      })
      .catch(() => router.push('/account'))
  }, [router, load])

  const saveName = async () => {
    setSaving('name'); setMsg(null)
    try {
      await setFirmBranding({ name: name.trim() })
      setMsg({ kind: 'ok', text: 'Company name saved.' })
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not save that name.' })
    } finally { setSaving(null) }
  }

  const upload = async (file: File) => {
    setMsg(null)
    let dataUrl: string
    try { dataUrl = await readLogoFile(file) } catch (e: any) {
      setMsg({ kind: 'err', text: e.message }); return
    }
    setLocalPreview(dataUrl)
    setSaving('logo')
    try {
      await setFirmBranding({ logo_base64: dataUrl })
      setMsg({ kind: 'ok', text: 'Logo saved. It will print on your next report.' })
      await load()
    } catch (e: any) {
      setLocalPreview(null)
      setMsg({ kind: 'err', text: e?.message || 'Could not save that logo.' })
    } finally {
      setSaving(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async () => {
    if (!window.confirm('Remove your company logo from report PDFs?')) return
    setSaving('remove'); setMsg(null)
    try {
      await setFirmBranding({ logo_base64: '' })
      setMsg({ kind: 'ok', text: 'Logo removed.' })
      await load()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not remove that logo.' })
    } finally { setSaving(null) }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    )
  }

  const preview = localPreview || logoUrl

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-2xl mx-auto px-6">
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/account"
            className="w-10 h-10 bg-gg-gray-800 rounded-lg flex items-center justify-center text-gg-gray-400 hover:text-white hover:bg-gg-gray-700 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Company Branding</h1>
            <p className="text-gg-gray-400">Your name and logo print at the top of every report PDF</p>
          </div>
        </div>

        <div className="card mb-6">
          <label className="block text-sm font-medium text-gg-gray-300 mb-2">Company name on reports</label>
          <div className="flex gap-3">
            <input
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 min-w-0 bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
              placeholder="Acme Land Management"
            />
            <button
              onClick={() => void saveName()}
              disabled={saving === 'name'}
              className="btn-primary flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
            >
              {saving === 'name' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Save
            </button>
          </div>
        </div>

        <div className="card">
          <label className="block text-sm font-medium text-gg-gray-300 mb-3">Company logo</label>
          <div className="flex items-center gap-5">
            <div className="w-28 h-20 rounded-lg bg-white/5 border border-gg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Company logo" className="w-full h-full object-contain p-2"
                     onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <ImageIcon size={22} className="text-gg-gray-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gg-gray-400 mb-3">
                {hasLogo || localPreview ? 'This is the logo on your reports.' : 'No logo yet. PNG or JPEG, under 2 MB.'}
              </p>
              <div className="flex flex-wrap gap-3">
                <label className={`btn-primary flex items-center gap-2 cursor-pointer ${saving ? 'opacity-50 pointer-events-none' : ''}`}>
                  {saving === 'logo' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {hasLogo ? 'Replace logo' : 'Upload logo'}
                  <input ref={inputRef} type="file" accept="image/png,image/jpeg" className="hidden"
                         disabled={!!saving}
                         onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
                </label>
                {(hasLogo || localPreview) && (
                  <button
                    onClick={() => void remove()}
                    disabled={!!saving}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gg-gray-700 text-gg-gray-300 hover:text-white hover:border-gg-gray-500 disabled:opacity-50"
                  >
                    {saving === 'remove' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {msg && (
          <div className={`mt-6 flex items-center gap-2 text-sm ${msg.kind === 'err' ? 'text-red-400' : 'text-green-400'}`}>
            {msg.kind === 'err' ? <AlertCircle size={16} /> : <Check size={16} />}
            {msg.text}
          </div>
        )}
      </div>
    </div>
  )
}
