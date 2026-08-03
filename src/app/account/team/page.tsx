'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Users, UserPlus, Trash2, Mail, Check, AlertCircle, Crown, Shield } from 'lucide-react'
import { SALES_CONTACT_EMAIL } from '@/config/pricing'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

interface TeamMember {
  id: string
  email: string
  first_name: string
  last_name: string
  account_type: string
  created_at: string
  is_active: boolean
}

export default function TeamPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [memberPendingRemoval, setMemberPendingRemoval] = useState<TeamMember | null>(null)
  const [maxSeats, setMaxSeats] = useState(3)
  const [upgradingSeats, setUpgradingSeats] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  const [inviteForm, setInviteForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
  })

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    
    const cachedUser = localStorage.getItem('user')
    if (cachedUser) {
      const userData = JSON.parse(cachedUser)
      setUser(userData)
      
      // Only firm_admin can access this page
      if (userData.account_type !== 'firm_admin') {
        router.push('/account')
        return
      }
    }
    
    fetchTeamMembers(token)
  }, [router])

  const fetchTeamMembers = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/firms/team`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (response.ok) {
        const data = await response.json()
        setTeamMembers(data.members || data || [])
        if (data.max_seats) setMaxSeats(data.max_seats)
      } else if (response.status === 404) {
        // Endpoint doesn't exist yet - show empty state
        setTeamMembers([])
      }
    } catch (err) {
      console.error('Failed to fetch team:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setError('')
    setSuccess('')

    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }

    try {
      // Create the user account as firm_user
      const response = await fetch(`${API_URL}/api/firms/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          email: inviteForm.email,
          first_name: inviteForm.firstName,
          last_name: inviteForm.lastName,
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to invite team member')
      }

      setSuccess(`Successfully added ${inviteForm.firstName} to your team!`)
      setShowInviteModal(false)
      setInviteForm({ email: '', firstName: '', lastName: '' })
      
      // Refresh team list
      fetchTeamMembers(token)
    } catch (err: any) {
      setError(err.message || 'Failed to invite team member')
    } finally {
      setInviting(false)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }

    setRemovingId(memberId)
    setError('')

    try {
      const response = await fetch(`${API_URL}/api/firms/team/${memberId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to remove team member')
      }

      setSuccess('Team member removed successfully')
      fetchTeamMembers(token)
    } catch (err: any) {
      setError(err.message || 'Failed to remove team member')
    } finally {
      setRemovingId(null)
      setMemberPendingRemoval(null)
    }
  }

  const handleUpgradeSeats = async (seats: number) => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }

    setUpgradingSeats(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`${API_URL}/api/firms/upgrade-seats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ additional_seats: seats })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to add seats')
      }

      const data = await response.json()
      setSuccess(data.message || `Added ${seats} seat(s)!`)
      setMaxSeats(data.max_users || maxSeats + seats)
      fetchTeamMembers(token)
    } catch (err: any) {
      setError(err.message || 'Failed to upgrade seats')
    } finally {
      setUpgradingSeats(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    )
  }

  // Check if user is firm admin
  if (user?.account_type !== 'firm_admin') {
    return (
      <div className="min-h-screen bg-gg-black pt-24 pb-12">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <AlertCircle size={48} className="text-yellow-500 mx-auto mb-4" />
          <h1 className="font-display text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-gg-gray-400 mb-6">Only Management Firm administrators can access team management.</p>
          <Link href="/account" className="btn-primary">Back to Account</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-3xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link 
              href="/account" 
              className="w-10 h-10 bg-gg-gray-800 rounded-lg flex items-center justify-center text-gg-gray-400 hover:text-white hover:bg-gg-gray-700 transition-colors"
            >
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Team Management</h1>
              <p className="text-gg-gray-400">Manage your firm's team members</p>
            </div>
          </div>
          <button
            onClick={() => setShowInviteModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus size={18} />
            Add Member
          </button>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="card bg-green-500/10 border-green-500/30 mb-6 flex items-center gap-3">
            <Check className="text-green-500" size={20} />
            <p className="text-green-400">{success}</p>
          </div>
        )}

        {error && (
          <div className="card bg-red-500/10 border-red-500/30 mb-6 flex items-center gap-3">
            <AlertCircle className="text-red-500" size={20} />
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Plan Info */}
        <div className="card bg-gradient-to-r from-gg-pink/10 to-purple-500/10 border-gg-pink/30 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gg-pink/20 rounded-xl flex items-center justify-center">
                <Crown className="text-gg-pink" size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-white">Management Firm Plan</h3>
                <p className="text-gg-gray-400 text-sm">
                  {teamMembers.length + 1} of {maxSeats} users • {Math.max(0, maxSeats - teamMembers.length - 1)} remaining
                </p>
              </div>
            </div>
            {maxSeats >= 10 ? (
              <a
                href={`mailto:${SALES_CONTACT_EMAIL}`}
                className="text-xs bg-gg-pink/20 text-gg-pink px-3 py-1.5 rounded-full hover:bg-gg-pink/30 transition font-medium"
              >
                Need more than 10 users? Contact us
              </a>
            ) : teamMembers.length + 1 >= maxSeats ? (
              <button
                onClick={() => handleUpgradeSeats(1)}
                disabled={upgradingSeats}
                className="text-xs bg-gg-pink/20 text-gg-pink px-3 py-1.5 rounded-full hover:bg-gg-pink/30 transition font-medium disabled:opacity-50"
              >
                {upgradingSeats ? 'Adding...' : '+ Add User ($9.99/mo)'}
              </button>
            ) : teamMembers.length >= 2 ? (
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full">
                Additional users: $9.99/mo each
              </span>
            ) : null}
          </div>
        </div>

        {/* Team Members List */}
        <div className="space-y-4">
          {/* Admin (current user) */}
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-gg-pink to-gg-pink-dark rounded-full flex items-center justify-center">
                  <span className="text-lg font-bold text-black">
                    {user?.first_name?.[0]}{user?.last_name?.[0]}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-white">
                      {user?.first_name} {user?.last_name}
                    </h3>
                    <span className="text-xs bg-gg-pink/20 text-gg-pink px-2 py-0.5 rounded flex items-center gap-1">
                      <Shield size={10} />
                      Admin
                    </span>
                  </div>
                  <p className="text-sm text-gg-gray-400">{user?.email}</p>
                </div>
              </div>
              <span className="text-xs text-gg-gray-500">You</span>
            </div>
          </div>

          {/* Team Members */}
          {teamMembers.map((member) => (
            <div key={member.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gg-gray-700 rounded-full flex items-center justify-center">
                    <span className="text-lg font-bold text-gg-gray-300">
                      {member.first_name?.[0]}{member.last_name?.[0]}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-white">
                        {member.first_name} {member.last_name}
                      </h3>
                      <span className="text-xs bg-gg-gray-700 text-gg-gray-400 px-2 py-0.5 rounded">
                        Member
                      </span>
                    </div>
                    <p className="text-sm text-gg-gray-400">{member.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => setMemberPendingRemoval(member)}
                  disabled={removingId === member.id}
                  className="text-gg-gray-500 hover:text-red-400 transition-colors p-2"
                >
                  {removingId === member.id ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Trash2 size={18} />
                  )}
                </button>
              </div>
            </div>
          ))}

          {/* Empty State */}
          {teamMembers.length === 0 && (
            <div className="card text-center py-12">
              <Users size={48} className="text-gg-gray-600 mx-auto mb-4" />
              <h3 className="font-display text-xl font-semibold text-white mb-2">No Team Members Yet</h3>
              <p className="text-gg-gray-400 mb-6">Add team members to give them access to your firm's subscription.</p>
              <button
                onClick={() => setShowInviteModal(true)}
                className="btn-primary inline-flex items-center gap-2"
              >
                <UserPlus size={18} />
                Add Your First Member
              </button>
            </div>
          )}
        </div>

        {/* Remove Member Confirmation */}
        {memberPendingRemoval && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gg-gray-900 rounded-xl p-6 max-w-md w-full border border-gg-gray-700">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                  <Trash2 className="text-red-500" size={20} />
                </div>
                <h3 className="text-xl font-semibold text-white">Remove Team Member</h3>
              </div>

              <p className="text-gg-gray-400 mb-6">
                Remove {memberPendingRemoval.first_name} {memberPendingRemoval.last_name} from your firm?
                They will immediately lose access to your firm&apos;s subscription.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setMemberPendingRemoval(null)}
                  disabled={removingId === memberPendingRemoval.id}
                  className="flex-1 btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRemoveMember(memberPendingRemoval.id)}
                  disabled={removingId === memberPendingRemoval.id}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg px-4 py-3 flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {removingId === memberPendingRemoval.id ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Trash2 size={18} />
                  )}
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Invite Modal */}
        {showInviteModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gg-gray-900 rounded-xl border border-gg-gray-700 max-w-md w-full p-6">
              <h2 className="font-display text-xl font-semibold text-white mb-4">Add Team Member</h2>
              <p className="text-gg-gray-400 text-sm mb-6">
                Create an account for a new team member. They'll have access to all your firm's subscribed areas.
              </p>

              <form onSubmit={handleInvite} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">First Name</label>
                    <input
                      type="text"
                      value={inviteForm.firstName}
                      onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })}
                      className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                      placeholder="John"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">Last Name</label>
                    <input
                      type="text"
                      value={inviteForm.lastName}
                      onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })}
                      className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                      placeholder="Doe"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gg-gray-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                    placeholder="john@example.com"
                    required
                  />
                </div>

                <p className="text-xs text-gg-gray-500">
                  We&apos;ll email them an invitation to set up their own password.
                </p>

                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <div className="flex gap-4 mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowInviteModal(false)
                      setError('')
                    }}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    {inviting ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <UserPlus size={18} />
                        Add Member
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
