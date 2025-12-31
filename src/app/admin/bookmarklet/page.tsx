'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { 
  ArrowLeft, 
  Bookmark,
  CheckCircle,
  Copy,
  Loader2,
  ExternalLink
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

export default function BookmarkletPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [schemaId, setSchemaId] = useState(2)

  // Bookmarklet code - minified JavaScript that runs on the listing page
  const bookmarkletCode = `javascript:(function(){
    var schema=${schemaId};
    var html=document.documentElement.outerHTML;
    var url=window.location.href;
    var API='${API_URL}/api/scraper/bookmarklet';
    var token=prompt('Enter your Ground Goat auth token (from Settings):');
    if(!token){alert('Token required');return;}
    fetch(API,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify({html:html,url:url,schema_id:schema})
    })
    .then(r=>r.json())
    .then(d=>{
      if(d.success){
        alert('✓ Listing created!\\n'+
          'Acres: '+(d.details?.total_acres||'N/A')+'\\n'+
          'County: '+(d.details?.county||'N/A')+'\\n'+
          'State: '+(d.details?.state||'N/A')+'\\n'+
          'Price: $'+(d.details?.asking_price?.toLocaleString()||'N/A'));
      }else{
        alert('Error: '+(d.error||'Failed')+(d.duplicate?'\\n\\nThis listing already exists.':''));
      }
    })
    .catch(e=>alert('Error: '+e.message));
  })();`

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth(token)
  }, [router])

  const checkAuth = async (token: string) => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)
      if (!response.ok) throw new Error('Not authenticated')
      const userData = await response.json()
      if (userData.account_type !== 'groundgoat_admin' && userData.account_type !== 'groundgoat_sales') {
        router.push('/account')
        return
      }
      setUser(userData)
    } catch (err) {
      router.push('/signin')
    } finally {
      setLoading(false)
    }
  }

  const copyToken = () => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-3xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/scraper" className="text-gg-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="font-display text-4xl font-bold text-white">Bookmarklet Scraper</h1>
            <p className="text-gg-gray-400">Scrape listings from sites that block our servers</p>
          </div>
        </div>

        {/* Why use this */}
        <div className="card mb-8 bg-gg-gray-900/50 border-gg-pink/20">
          <h2 className="font-semibold text-white mb-2">Why use the bookmarklet?</h2>
          <p className="text-gg-gray-400 text-sm">
            Some websites (like Whitetail Properties) block requests from cloud servers. 
            The bookmarklet runs in YOUR browser using YOUR internet connection, 
            which bypasses these blocks. It grabs the page content and sends it to Ground Goat for processing.
          </p>
        </div>

        {/* Schema Selection */}
        <div className="card mb-8">
          <h2 className="font-semibold text-white mb-4">1. Select Listing Type</h2>
          <select
            value={schemaId}
            onChange={(e) => setSchemaId(Number(e.target.value))}
            className="bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
          >
            <option value={1}>Land Auction</option>
            <option value={2}>Private Treaty</option>
            <option value={3}>Equipment Auction</option>
          </select>
          <p className="text-gg-gray-500 text-sm mt-2">
            Choose the type before dragging the bookmarklet to your toolbar.
          </p>
        </div>

        {/* Bookmarklet */}
        <div className="card mb-8">
          <h2 className="font-semibold text-white mb-4">2. Drag to Bookmarks Bar</h2>
          <div className="flex items-center gap-4 mb-4">
            
              href={bookmarkletCode}
              onClick={(e) => e.preventDefault()}
              draggable="true"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gg-pink text-white rounded-lg font-semibold hover:bg-gg-pink/80 cursor-grab active:cursor-grabbing"
            >
              <Bookmark size={20} />
              Scrape to Ground Goat
            </a>
            <span className="text-gg-gray-400">← Drag this to your bookmarks bar</span>
          </div>
          <p className="text-gg-gray-500 text-sm">
            If you dont see your bookmarks bar, press <code className="bg-gg-gray-800 px-1 rounded">Cmd+Shift+B</code> (Mac) 
            or <code className="bg-gg-gray-800 px-1 rounded">Ctrl+Shift+B</code> (Windows).
          </p>
        </div>

        {/* Auth Token */}
        <div className="card mb-8">
          <h2 className="font-semibold text-white mb-4">3. Copy Your Auth Token</h2>
          <p className="text-gg-gray-400 text-sm mb-4">
            When you use the bookmarklet, it will ask for your auth token. Click below to copy it:
          </p>
          <button
            onClick={copyToken}
            className="btn-secondary flex items-center gap-2"
          >
            {copied ? <CheckCircle size={20} className="text-green-400" /> : <Copy size={20} />}
            {copied ? 'Copied!' : 'Copy Auth Token'}
          </button>
        </div>

        {/* Instructions */}
        <div className="card bg-gg-gray-900/50">
          <h2 className="font-semibold text-white mb-4">How to Use</h2>
          <ol className="space-y-3 text-sm text-gg-gray-400 list-decimal list-inside">
            <li>Go to a listing page (e.g., Whitetail Properties listing)</li>
            <li>Click the <strong className="text-white">Scrape to Ground Goat</strong> bookmark</li>
            <li>Paste your auth token when prompted</li>
            <li>Wait for the confirmation popup showing the extracted data</li>
            <li>The listing is now in Ground Goat! View it in the <Link href="/admin/listings" className="text-gg-pink hover:underline">Listings page</Link></li>
          </ol>
        </div>

        {/* Supported Sites */}
        <div className="mt-8 card bg-gg-gray-900/50">
          <h3 className="font-semibold text-white mb-2">Supported Sites</h3>
          <ul className="space-y-1 text-sm text-gg-gray-400">
            <li className="flex items-center gap-2">
              <CheckCircle size={16} className="text-green-400" />
              Whitetail Properties (whitetailproperties.com)
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle size={16} className="text-gg-gray-500" />
              Any other listing site that blocks server requests
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
