'use client'

import { useEffect, useRef, useState } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Upload, Trash2, CheckCircle, AlertCircle } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

type FirmProfile = {
  id: string
  name: string
  logo_url: string | null
  logo_updated_at: string | null
  can_edit: boolean
}

export default function FirmLogoPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<FirmProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<string>('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/firm/profile`)
        if (res.status === 401) { router.push('/signin'); return }
        if (!res.ok) { setMessage({ kind: 'err', text: 'Only firm accounts have a logo.' }); return }
        setProfile(await res.json())
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setMessage(null)
    if (!file) return
    if (!file.type.startsWith('image/')) { setMessage({ kind: 'err', text: 'Please choose a picture file (PNG or JPG).' }); return }
    if (file.size > 5 * 1024 * 1024) { setMessage({ kind: 'err', text: 'Logo must be under 5 MB.' }); return }
    const reader = new FileReader()
    reader.onload = () => setPreview(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!preview) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/firm/logo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_base64: preview }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMessage({ kind: 'err', text: data?.detail || 'Could not save the logo.' }); return }
      setProfile(data)
      setPreview('')
      if (fileRef.current) fileRef.current.value = ''
      setMessage({ kind: 'ok', text: 'Logo saved.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm('Remove your firm logo?')) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/firm/logo`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMessage({ kind: 'err', text: data?.detail || 'Could not remove the logo.' }); return }
      setProfile(data)
      setMessage({ kind: 'ok', text: 'Logo removed.' })
    } finally {
      setSaving(false)
    }
  }

  const current = profile?.logo_url ? `${API_URL}${profile.logo_url}` : ''

  return (
    <div className="min-h-screen bg-gg-black">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/account" className="text-gg-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Firm Logo</h1>
            <p className="text-gg-gray-400">{profile?.name || 'Your firm'}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gg-pink" size={32} /></div>
        ) : (
          <div className="card space-y-6">
            <div className="flex items-center gap-6">
              <div className="h-28 w-28 rounded-xl bg-white p-2 flex items-center justify-center overflow-hidden">
                {preview || current ? (
                  <img src={preview || current} alt="Firm logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-gg-gray-500 text-xs text-center">No logo yet</span>
                )}
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">{preview ? 'New logo (not saved yet)' : current ? 'Current logo' : 'Add your logo'}</p>
                <p className="text-sm text-gg-gray-400 mt-1">PNG or JPG, under 5 MB. It is shown on your team's reports and in the Ground Goat app.</p>
              </div>
            </div>

            {profile?.can_edit ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={pick}
                  className="block w-full text-sm text-gg-gray-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-gg-gray-700 file:text-white hover:file:bg-gg-gray-600"
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={save}
                    disabled={!preview || saving}
                    className="flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                    Save logo
                  </button>
                  {current && (
                    <button
                      onClick={remove}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 disabled:opacity-40 transition-colors"
                    >
                      <Trash2 size={16} />
                      Remove
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-gg-gray-400">Only your firm admin can change the logo.</p>
            )}

            {message && (
              <div className={`flex items-center gap-2 text-sm ${message.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                {message.kind === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {message.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
