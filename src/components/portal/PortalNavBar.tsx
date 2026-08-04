'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Map, Calendar, Building2, BarChart3, LogOut, User, Users, Settings, Filter, Bookmark, UserCircle } from 'lucide-react'
import { SHOW_PRIVATE_TREATY } from '@/lib/featureFlags'

type TabType = 'map' | 'auctions' | 'private_treaty' | 'results'

interface PortalNavBarProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  onFilterToggle: () => void
  filterOpen: boolean
  onAnalyticsToggle?: () => void
  analyticsOpen?: boolean
  onWatchlistToggle?: () => void
  watchlistOpen?: boolean
  watchlistCount?: number
  user: {
    first_name: string
    last_name: string
    account_type: string
  }
}

export default function PortalNavBar({ activeTab, onTabChange, onFilterToggle, filterOpen, onAnalyticsToggle, analyticsOpen, onWatchlistToggle, watchlistOpen, watchlistCount = 0, user }: PortalNavBarProps) {
  const router = useRouter()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isAdmin = user.account_type === 'groundgoat_admin' || user.account_type === 'groundgoat_sales'
  const isFirmAdmin = user.account_type === 'firm_admin'
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
    // PT hidden 2026-07-20, reversible
    ...(SHOW_PRIVATE_TREATY ? [{ key: 'private_treaty' as TabType, label: 'Private Treaty', icon: <Building2 size={15} /> }] : []),
    { key: 'results', label: 'Results', icon: <BarChart3 size={15} /> },
  ]

  return (
    // pointer-events-none on the full-width container so clicks pass
    // through to slide-out panels behind it (e.g. the close-X on the
    // comp report panel sits at y~32-60, exactly where this fixed bar
    // was intercepting). Children below re-enable pointer events on
    // their own pill / menu surfaces so the nav stays clickable.
    <div className="fixed top-4 left-0 right-0 z-[500] flex items-center justify-center pointer-events-none">
      {/* Centered Nav Bar */}
      <div className="bg-black/80 backdrop-blur-xl rounded-2xl px-3 py-2 flex items-center gap-1 border border-white/25 shadow-[0_8px_32px_rgba(0,0,0,0.6)] pointer-events-auto">
        <nav className="flex items-center gap-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all flex items-center gap-1.5 ${
                activeTab === tab.key
                  ? 'bg-gg-pink/15 text-white border-gg-pink/30'
                  : 'border-transparent text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.icon}
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          ))}

          <div className="h-5 w-px bg-white/10 mx-1" />

          {/* Filter button — subtle glow, bright white */}
          <button
            onClick={onFilterToggle}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 ${
              filterOpen
                ? 'bg-gg-pink/15 text-gg-pink border-gg-pink/30 shadow-[0_0_12px_rgba(233,30,140,0.4)]'
                : 'border-transparent text-white font-bold hover:bg-white/5 shadow-[0_0_8px_rgba(233,30,140,0.25)]'
            }`}
          >
            <Filter size={14} className="text-gg-pink" />
            <span className="hidden md:inline">Filters</span>
          </button>

          {/* Watchlist button */}
          {onWatchlistToggle && (
            <button
              onClick={onWatchlistToggle}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all flex items-center gap-1.5 relative ${
                watchlistOpen
                  ? 'bg-gg-pink/15 text-gg-pink border-gg-pink/30'
                  : 'border-transparent text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Bookmark size={14} />
              <span className="hidden md:inline">Watchlist</span>
              {watchlistCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gg-pink text-[9px] font-bold text-white flex items-center justify-center">
                  {watchlistCount > 9 ? '9+' : watchlistCount}
                </span>
              )}
            </button>
          )}

          {/* Analytics button REMOVED 2026-08-04 (owner): analytics reports
              are delivered through Goat Search now, so the separate panel is
              no longer offered. The onAnalyticsToggle/analyticsOpen props and
              the panel itself are left in place deliberately — nothing else
              renders them, and keeping them costs nothing while making this
              trivially reversible if the standalone view is ever wanted back. */}

        </nav>
      </div>

      {/* User Menu — absolute right */}
      <div className="absolute right-14 pointer-events-auto" ref={menuRef}>
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="flex items-center gap-2 bg-black/50 backdrop-blur-xl rounded-full pl-1.5 pr-3 py-1.5 border border-white/10 hover:border-gg-pink/30 transition"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gg-pink to-gg-pink-dark flex items-center justify-center text-xs font-bold text-black">
            {initials}
          </div>
          <span className="text-xs text-white/70">Hi, {user.first_name}</span>
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
                href="/account"
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-gg-gray-300 hover:bg-white/5 hover:text-white transition"
                onClick={() => setShowUserMenu(false)}
              >
                <UserCircle size={14} />
                Account
              </Link>
              <Link
                href="/account/profile"
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-gg-gray-300 hover:bg-white/5 hover:text-white transition"
                onClick={() => setShowUserMenu(false)}
              >
                <User size={14} />
                Profile
              </Link>
              {isFirmAdmin && (
                <Link
                  href="/account/team"
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-gg-gray-300 hover:bg-white/5 hover:text-white transition"
                  onClick={() => setShowUserMenu(false)}
                >
                  <Users size={14} />
                  Manage Team
                </Link>
              )}
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