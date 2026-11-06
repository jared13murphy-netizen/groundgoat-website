'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Bell, Mail, Shield, Database, Globe, Loader2, Check } from 'lucide-react'
import { PRICING, MAX_STATES, formatPrice } from '@/config/pricing'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export default function AdminSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  
  const [settings, setSettings] = useState({
    // Notifications
    emailNotificationsEnabled: true,
    pushNotificationsEnabled: true,
    newUserAlerts: true,
    newSubscriptionAlerts: true,
    
    // Platform
    maintenanceMode: false,
    allowNewRegistrations: true,
    requireEmailVerification: true,
    
    // Scraper
    autoScraperEnabled: false,
    scraperFrequency: 'daily',

  })

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    // Simulate loading settings
    setTimeout(() => setLoading(false), 500)
  }, [router])

  const handleToggle = (key: string) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))
    setSaved(false)
  }

  const handleChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
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
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-4xl font-bold text-white">Settings</h1>
              <p className="text-gg-gray-400">Configure system settings</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? (
              <Loader2 size={20} className="animate-spin" />
            ) : saved ? (
              <Check size={20} />
            ) : (
              <Save size={20} />
            )}
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>

        <div className="space-y-8">
          {/* Notifications */}
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gg-pink/10 rounded-lg flex items-center justify-center">
                <Bell className="text-gg-pink" size={20} />
              </div>
              <div>
                <h2 className="font-semibold text-white">Notifications</h2>
                <p className="text-sm text-gg-gray-400">Configure admin alerts</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <ToggleSetting
                label="Email Notifications"
                description="Receive email alerts for important events"
                enabled={settings.emailNotificationsEnabled}
                onToggle={() => handleToggle('emailNotificationsEnabled')}
              />
              <ToggleSetting
                label="Push Notifications"
                description="Receive push notifications in the app"
                enabled={settings.pushNotificationsEnabled}
                onToggle={() => handleToggle('pushNotificationsEnabled')}
              />
              <ToggleSetting
                label="New User Alerts"
                description="Get notified when new users sign up"
                enabled={settings.newUserAlerts}
                onToggle={() => handleToggle('newUserAlerts')}
              />
              <ToggleSetting
                label="New Subscription Alerts"
                description="Get notified for new subscriptions"
                enabled={settings.newSubscriptionAlerts}
                onToggle={() => handleToggle('newSubscriptionAlerts')}
              />
            </div>
          </div>

          {/* Platform */}
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gg-pink/10 rounded-lg flex items-center justify-center">
                <Globe className="text-gg-pink" size={20} />
              </div>
              <div>
                <h2 className="font-semibold text-white">Platform</h2>
                <p className="text-sm text-gg-gray-400">General platform settings</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <ToggleSetting
                label="Maintenance Mode"
                description="Temporarily disable the platform for maintenance"
                enabled={settings.maintenanceMode}
                onToggle={() => handleToggle('maintenanceMode')}
                danger={true}
              />
              <ToggleSetting
                label="Allow New Registrations"
                description="Allow new users to create accounts"
                enabled={settings.allowNewRegistrations}
                onToggle={() => handleToggle('allowNewRegistrations')}
              />
              <ToggleSetting
                label="Require Email Verification"
                description="Users must verify their email before subscribing"
                enabled={settings.requireEmailVerification}
                onToggle={() => handleToggle('requireEmailVerification')}
              />
            </div>
          </div>

          {/* Scraper */}
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gg-pink/10 rounded-lg flex items-center justify-center">
                <Database className="text-gg-pink" size={20} />
              </div>
              <div>
                <h2 className="font-semibold text-white">Scraper</h2>
                <p className="text-sm text-gg-gray-400">Automated data collection settings</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <ToggleSetting
                label="Auto Scraper"
                description="Automatically run the scraper on a schedule"
                enabled={settings.autoScraperEnabled}
                onToggle={() => handleToggle('autoScraperEnabled')}
              />
              
              <div className="flex items-center justify-between py-3 border-b border-gg-gray-700">
                <div>
                  <p className="text-white font-medium">Scraper Frequency</p>
                  <p className="text-sm text-gg-gray-400">How often to run the auto scraper</p>
                </div>
                <select
                  value={settings.scraperFrequency}
                  onChange={(e) => handleChange('scraperFrequency', e.target.value)}
                  disabled={!settings.autoScraperEnabled}
                  className="bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white disabled:opacity-50"
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gg-pink/10 rounded-lg flex items-center justify-center">
                <Shield className="text-gg-pink" size={20} />
              </div>
              <div>
                <h2 className="font-semibold text-white">Pricing</h2>
                <p className="text-sm text-gg-gray-400">Current subscription prices</p>
              </div>
            </div>
            
            {/* Read-only: the live prices (owner 2026-11-06), from the one
                price list in @/config/pricing (mirrors backend plan_pricing.py).
                The old editable County / State / Firm boxes changed nothing. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gg-gray-400 text-left">
                    <th className="py-2 pr-4 font-medium">Plan</th>
                    <th className="py-2 pr-4 font-medium">Monthly</th>
                    <th className="py-2 pr-4 font-medium">Annual</th>
                  </tr>
                </thead>
                <tbody className="text-white">
                  {(['basic_state', 'premium_state'] as const).map(k => (
                    <tr key={k} className="border-t border-gg-gray-800">
                      <td className="py-2 pr-4">{PRICING[k].name}</td>
                      <td className="py-2 pr-4">${formatPrice(PRICING[k].monthly.first)} first state + ${formatPrice(PRICING[k].monthly.additional)} each additional</td>
                      <td className="py-2 pr-4">${formatPrice(PRICING[k].annual.first)} first state + ${formatPrice(PRICING[k].annual.additional)} each additional</td>
                    </tr>
                  ))}
                  <tr className="border-t border-gg-gray-800">
                    <td className="py-2 pr-4">{PRICING.firm.name}</td>
                    <td className="py-2 pr-4 text-gg-gray-500">—</td>
                    <td className="py-2 pr-4">${formatPrice(PRICING.firm.annualBase)} for {PRICING.firm.includedUsers} users + ${formatPrice(PRICING.firm.annualPerAdditionalUser)} per extra user (up to {PRICING.firm.maxUsers})</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-gg-gray-500 text-sm mt-4">
              Up to {MAX_STATES} states on Basic and Premium. 30-day free trial on every plan. Prices are set in Stripe and App Store Connect.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleSetting({ 
  label, 
  description, 
  enabled, 
  onToggle,
  danger = false 
}: { 
  label: string
  description: string
  enabled: boolean
  onToggle: () => void
  danger?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gg-gray-700 last:border-0">
      <div>
        <p className={`font-medium ${danger && enabled ? 'text-red-400' : 'text-white'}`}>{label}</p>
        <p className="text-sm text-gg-gray-400">{description}</p>
      </div>
      <button
        onClick={onToggle}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          enabled 
            ? danger ? 'bg-red-500' : 'bg-gg-pink' 
            : 'bg-gg-gray-700'
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
            enabled ? 'left-7' : 'left-1'
          }`}
        />
      </button>
    </div>
  )
}
