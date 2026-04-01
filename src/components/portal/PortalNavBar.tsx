'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Map, Calendar, Building2, BarChart3, LogOut, User, Settings, Filter } from 'lucide-react'

type TabType = 'map' | 'auctions' | 'private_treaty' | 'results'

interface PortalNavBarProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  onFilterToggle: () => void
  filterOpen: boolean
  user: {
    first_name: string
    last_name: string
    account_type: string
  }
}

export default function PortalNavBar({ activeTab, onTabChange, onFilterToggle, filterOpen, user }: PortalNavBarProps) {
  const router = useRouter()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isAdmin = user.account_type === 'groundgoat_admin' || user.account_type === 'groundgoat_sales'
  const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '')

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSignOut = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
    router.push('/signin')
  }

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'map', label: 'Map', icon: <Map size={15} /> },
    { key: 'auctions', label: 'Auctions', icon: <Calendar size={15} /> },
    { key: 'private_treaty', label: 'Private Treaty', icon: <Building2 size={15} /> },
    { key: 'results', label: 'Results', icon: <BarChart3 size={15} /> },
  ]

  return (
    <div className="fixed top-4 left-4 right-4 z-[500] flex items-center justify-between gap-3">
      {/* Logo + Tabs + Filter */}
      <div className="bg-black/50 backdrop-blur-xl rounded-2xl px-3 py-2 flex items-center gap-3 border border-white/10">
        <Link href="/access" className="shrink-0">
          <Image src="/logo.png" alt="Ground Goat" width={52} height={52} className="rounded-lg" />
        </Link>

        <div className="h-6 w-px bg-white/10" />

        <nav className="flex items-center gap-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all flex items-center gap-1.5 ${
                activeTab === tab.key
                  ? 'bg-gg-pink/15 text-gg-pink border-gg-pink/30'
                  : 'border-transparent text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.icon}
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          ))}

          {/* Filter button */}
          <div className="h-5 w-px bg-white/10 mx-1" />
          <button
            onClick={onFilterToggle}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all flex items-center gap-1.5 ${
              filterOpen
                ? 'bg-gg-pink/15 text-gg-pink border-gg-pink/30'
                : 'border-transparent text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Filter size={15} />
            <span className="hidden md:inline">Filters</span>
          </button>
        </nav>
      </div>

      {/* User Menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="bg-black/50 backdrop-blur-xl rounded-2xl p-1.5 border border-white/10 hover:border-gg-pink/30 transition"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-gg-pink to-gg-pink-dark flex items-center justify-center text-xs font-bold text-black">
            {initials}
          </div>
        </button>

        {showUserMenu && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-gg-gray-900/95 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5">
              <div className="text-sm font-medium">{user.first_name} {user.last_name}</div>
              <div className="text-[10px] text-gg-gray-400 uppercase tracking-wider mt-0.5">
                {user.account_type.replace(/_/g, ' ')}
              </div>
            </div>
            <div className="py-1">
              <Link
                href="/account/profile"
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-gg-gray-300 hover:bg-white/5 hover:text-white transition"
                onClick={() => setShowUserMenu(false)}
              >
                <User size={14} />
                Profile
              </Link>
              {isAdmin && (
                <Link
                  href="/admin/dashboard"
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-gg-gray-300 hover:bg-white/5 hover:text-white transition"
                  onClick={() => setShowUserMenu(false)}
                >
                  <Settings size={14} />
                  Admin Dashboard
                </Link>
              )}
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:bg-white/5 w-full text-left transition"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}