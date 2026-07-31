'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Bell, Mail, Shield, Database, Globe, Loader2, Check } from 'lucide-react'

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
    
    // Pricing
    countyPlanPrice: '7.99',
    statePlanPrice: '29.99',
    firmPlanPrice: '199.99',
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
                <p className="text-sm text-gg-gray-400">Subscription plan pricing (requires Stripe update)</p>
              </div>
            </div>
            
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gg-gray-300 mb-2">County Plan</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-400">$</span>
                  <input
                    type="text"
                    value={settings.countyPlanPrice}
                    onChange={(e) => handleChange('countyPlanPrice', e.target.value)}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg pl-8 pr-4 py-3 text-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gg-gray-400">/mo</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gg-gray-300 mb-2">State Plan</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-400">$</span>
                  <input
                    type="text"
                    value={settings.statePlanPrice}
                    onChange={(e) => handleChange('statePlanPrice', e.target.value)}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg pl-8 pr-4 py-3 text-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gg-gray-400">/mo</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gg-gray-300 mb-2">Firm Plan</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-400">$</span>
                  <input
                    type="text"
                    value={settings.firmPlanPrice}
                    onChange={(e) => handleChange('firmPlanPrice', e.target.value)}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg pl-8 pr-4 py-3 text-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gg-gray-400">/mo</span>
                </div>
              </div>
            </div>
            <p className="text-gg-gray-500 text-sm mt-4">
              Note: Changing prices here is for display only. Actual prices must be updated in Stripe.
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
