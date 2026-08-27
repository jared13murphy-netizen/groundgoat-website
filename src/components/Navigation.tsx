'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'
import { Menu, X, LogOut, User, List, PenLine, FolderOpen, Users } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { fetchMappingAccess } from '@/lib/configurableMapping'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export default function Navigation() {
  const router = useRouter()
  const pathname = usePathname()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [user, setUser] = useState<any>(null)
  // This nav renders on every page, including /configure-map — the
  // richer portal menu is only on /access, so a firm admin who lands
  // here had no way back to their own tools.
  const [hasMapping, setHasMapping] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Only firm accounts can have the add-on, so this asks at most once
  // per navigation for the people it could apply to.
  useEffect(() => {
    if (!user || !['firm_admin', 'firm_user'].includes(user.account_type)) {
      setHasMapping(false)
      return
    }
    let cancelled = false
    fetchMappingAccess().then(ok => { if (!cancelled) setHasMapping(ok) })
    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    const checkAuth = () => {
      const token = localStorage.getItem('auth_token')
      const cachedUser = localStorage.getItem('user')
      
      if (cachedUser) {
        setUser(JSON.parse(cachedUser))
      } else {
        setUser(null)
      }
      
      if (token) {
        // Verify token is still valid
        fetchUser(token)
      }
    }
    
    // Check on mount
    checkAuth()
    
    // Listen for storage changes (login/logout in other tabs)
    window.addEventListener('storage', checkAuth)
    
    // Re-check every time the component is focused
    window.addEventListener('focus', checkAuth)
    
    return () => {
      window.removeEventListener('storage', checkAuth)
      window.removeEventListener('focus', checkAuth)
    }
  }, [pathname])

  const fetchUser = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      
      if (response.ok) {
        const userData = await response.json()
        setUser(userData)
        localStorage.setItem('user', JSON.stringify(userData))
      } else {
        // Token invalid, clear auth
        handleLogout()
      }
    } catch (err) {
      // Network error, keep cached user
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
    setUser(null)
    setShowUserMenu(false)
    router.push('/')
  }

  const isAdmin = user?.account_type === 'groundgoat_admin' || user?.account_type === 'groundgoat_sales'
  const isFirmAdmin = user?.account_type === 'firm_admin'
  const canViewListings = user?.account_type === 'groundgoat_admin' ||
    user?.account_type === 'groundgoat_sales' ||
    user?.account_type === 'firm_admin' ||
    user?.account_type === 'firm_user'

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      isScrolled ? 'bg-black backdrop-blur-lg border-b border-gg-gray-800' : 'bg-black'
    }`}>
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <Image
              src="/logo.png"
              alt="Ground Goat"
              width={240}
              height={80}
              className="h-16 w-auto"
              priority
            />
          </Link>

          {/* Desktop Navigation - All Right Aligned */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/#features" className="text-gg-gray-300 hover:text-white transition-colors font-medium">
              Features
            </Link>
            <Link href="/#pricing" className="text-gg-gray-300 hover:text-white transition-colors font-medium">
              Pricing
            </Link>
            <Link href="/contact" className="text-gg-gray-300 hover:text-white transition-colors font-medium">
              Contact
            </Link>
            
            {user ? (
              <>
                {canViewListings && (
                  <Link
                    href="/access"
                    className="text-gg-gray-300 hover:text-white transition-colors font-medium"
                  >
                    Map
                  </Link>
                )}
                {isAdmin && (
                  <Link
                    href="/admin/dashboard"
                    className="text-gg-gray-300 hover:text-white transition-colors font-medium"
                  >
                    Dashboard
                  </Link>
                )}
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 text-white font-medium hover:text-gg-pink transition-colors"
                  >
                    <div className="w-8 h-8 bg-gradient-to-br from-gg-pink to-gg-pink-dark rounded-full flex items-center justify-center">
                      <span className="text-sm font-bold text-black">
                        {user.first_name?.[0]}{user.last_name?.[0]}
                      </span>
                    </div>
                    <span>Hi, {user.first_name}</span>
                  </button>
                  
                  {showUserMenu && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-gg-gray-800 border border-gg-gray-700 rounded-lg shadow-xl py-2 z-50">
                      <Link
                        href="/account"
                        className="flex items-center gap-2 px-4 py-2 text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white"
                        onClick={() => setShowUserMenu(false)}
                      >
                        <User size={16} />
                        Account
                      </Link>
                      {hasMapping && (
                        <>
                          <Link
                            href="/configure-map"
                            className="flex items-center gap-2 px-4 py-2 text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <PenLine size={16} />
                            Configure Map
                          </Link>
                          <Link
                            href="/map-portfolio"
                            className="flex items-center gap-2 px-4 py-2 text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <FolderOpen size={16} />
                            Map Portfolio
                          </Link>
                        </>
                      )}
                      {isFirmAdmin && (
                        <Link
                          href="/account/team"
                          className="flex items-center gap-2 px-4 py-2 text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <Users size={16} />
                          Manage Team
                        </Link>
                      )}
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2 text-red-400 hover:bg-gg-gray-700 w-full text-left"
                      >
                        <LogOut size={16} />
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <Link 
                  href="/signin" 
                  className="text-white font-medium hover:text-gg-pink transition-colors"
                >
                  Sign In
                </Link>
                <Link 
                  href="/signup" 
                  className="btn-primary"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button 
            className="md:hidden text-white p-2"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-gg-gray-900 border-b border-gg-gray-800 py-6 px-6">
            <div className="flex flex-col gap-4">
              <Link 
                href="/#features" 
                className="text-gg-gray-300 hover:text-white transition-colors font-medium py-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Features
              </Link>
              <Link 
                href="/#pricing" 
                className="text-gg-gray-300 hover:text-white transition-colors font-medium py-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Pricing
              </Link>
              <Link 
                href="/contact" 
                className="text-gg-gray-300 hover:text-white transition-colors font-medium py-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Contact
              </Link>
              <hr className="border-gg-gray-700 my-2" />
              
              {user ? (
                <>
                  <div className="flex items-center gap-3 py-2">
                    <div className="w-10 h-10 bg-gradient-to-br from-gg-pink to-gg-pink-dark rounded-full flex items-center justify-center">
                      <span className="text-sm font-bold text-black">
                        {user.first_name?.[0]}{user.last_name?.[0]}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-white">{user.first_name} {user.last_name}</p>
                      <p className="text-sm text-gg-gray-400">{user.email}</p>
                    </div>
                  </div>
                  {canViewListings && (
                    <Link
                      href="/listings"
                      className="text-white font-medium py-2 flex items-center gap-2"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <List size={18} />
                      Listings
                    </Link>
                  )}
                  {isAdmin && (
                    <Link
                      href="/admin/dashboard"
                      className="text-white font-medium py-2"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Dashboard
                    </Link>
                  )}
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false)
                      handleLogout()
                    }}
                    className="text-red-400 font-medium py-2 text-left"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <Link 
                    href="/signin" 
                    className="text-white font-medium py-2"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Link 
                    href="/signup" 
                    className="btn-primary text-center"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
