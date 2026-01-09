'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, ArrowLeft, ArrowRight, Eye, EyeOff, MapPin, ChevronDown, X, Loader2, Building2, Users, Plus, Mail } from 'lucide-react'
import { US_STATES, getCountiesForState, getStateAbbreviation } from '@/data/counties'

const API_URL = 'https://practical-serenity-production.up.railway.app'


// VALID_STATES now imported from @/data/counties as US_STATES

const PLANS = {
  county: {
    name: 'County',
    basePrice: 7.99,
    additionalPrice: 3.99,
    description: 'Perfect for focused investors',
    features: ['1 county included', 'Upcoming land sale alerts', 'Sale results access', 'Mobile app access'],
  },
  state: {
    name: 'State',
    basePrice: 39.99,
    additionalPrice: 12.99,
    description: 'Best for active land investors',
    features: ['1 state included (all counties)', 'Everything in County plan', 'Priority notifications', 'Historical data access'],
  },
  firm: {
    name: 'Management Firm',
    basePrice: 189.99,
    additionalPrice: 39.99,
    description: 'For teams and professionals',
    features: ['Unlimited states & counties', 'Up to 3 team members', 'Comparable sales lookup', 'Priority support'],
  },
}

interface SelectedArea {
  state: string
  county?: string
}

interface TeamMember {
  email: string
  firstName: string
  lastName: string
  password: string
}

interface ReferrerInfo {
  first_name: string
  account_type: string
}

function SignUpContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialPlan = searchParams.get('plan') as keyof typeof PLANS || 'state'
  const initialStep = searchParams.get('step') ? parseInt(searchParams.get('step')!) : 1
  const cancelled = searchParams.get('cancelled') === 'true'
  const referralCode = searchParams.get('ref') || null  // Capture referral code from URL
  
  const [step, setStep] = useState(initialStep)
  const [selectedPlan, setSelectedPlan] = useState(initialPlan)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(cancelled ? 'Payment was cancelled. Please try again.' : '')
  const [verificationToken, setVerificationToken] = useState<string | null>(null)
  
  // Referral state
  const [referrerInfo, setReferrerInfo] = useState<ReferrerInfo | null>(null)
  
  // Verification code state
  const [verificationCode, setVerificationCode] = useState(['', '', '', '', '', ''])
  const [codeSent, setCodeSent] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([])
  
  // Territory selection state
  const [availableStates, setAvailableStates] = useState<string[]>([])
  const [availableCounties, setAvailableCounties] = useState<string[]>([])
  const [loadingStates, setLoadingStates] = useState(false)
  const [loadingCounties, setLoadingCounties] = useState(false)
  const [selectedState, setSelectedState] = useState('')
  const [selectedCounty, setSelectedCounty] = useState('')
  const [selectedAreas, setSelectedAreas] = useState<SelectedArea[]>([])
  const [showStateDropdown, setShowStateDropdown] = useState(false)
  const [showCountyDropdown, setShowCountyDropdown] = useState(false)
  
  // Firm-specific state
  const [firmData, setFirmData] = useState({
    firmName: '',
    firmWebsite: '',
    firmPhone: '',
  })
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [newMember, setNewMember] = useState<TeamMember>({
    email: '',
    firstName: '',
    lastName: '',
    password: '',
  })
  const [additionalSeats, setAdditionalSeats] = useState(0)
  const [showAddMember, setShowAddMember] = useState(false)
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    homeState: '',
    homeCounty: '',
  })

  // Home location dropdowns
  const [homeCounties, setHomeCounties] = useState<string[]>([])
  const [showHomeStateDropdown, setShowHomeStateDropdown] = useState(false)
  const [showHomeCountyDropdown, setShowHomeCountyDropdown] = useState(false)

  // Validate referral code on mount
  useEffect(() => {
    if (referralCode) {
      validateReferralCode(referralCode)
    }
  }, [referralCode])

  const validateReferralCode = async (code: string) => {
    try {
      const response = await fetch(`${API_URL}/api/referral/validate/${code}`)
      if (response.ok) {
        const data = await response.json()
        if (data.valid && data.referrer) {
          setReferrerInfo(data.referrer)
        }
      }
    } catch (err) {
      console.error('Failed to validate referral code:', err)
    }
  }

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCountdown])

  useEffect(() => {
    fetchAvailableStates()
  }, [])

  useEffect(() => {
    if (selectedState && selectedPlan === 'county') {
      fetchAvailableCounties(selectedState)
    }
  }, [selectedState, selectedPlan])

  // Load counties for home location when home state changes
  useEffect(() => {
    if (formData.homeState) {
      setHomeCounties(getCountiesForState(formData.homeState))
      setFormData(prev => ({ ...prev, homeCounty: '' }))
    } else {
      setHomeCounties([])
    }
  }, [formData.homeState])

  const fetchAvailableStates = () => {
    setLoadingStates(true)
    // Use local county data for consistency with listings
    setAvailableStates(US_STATES)
    setLoadingStates(false)
  }

  const fetchAvailableCounties = (state: string) => {
    setLoadingCounties(true)
    setAvailableCounties([])
    // Use local county data for consistency with listings
    setAvailableCounties(getCountiesForState(state))
    setLoadingCounties(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError('')
  }

  const handleFirmInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFirmData({ ...firmData, [e.target.name]: e.target.value })
    setError('')
  }

  const handleNewMemberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMember({ ...newMember, [e.target.name]: e.target.value })
    setError('')
  }

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/\D/g, '').slice(0, 6).split('')
      const newCode = [...verificationCode]
      digits.forEach((digit, i) => {
        if (index + i < 6) {
          newCode[index + i] = digit
        }
      })
      setVerificationCode(newCode)
      const nextIndex = Math.min(index + digits.length, 5)
      codeInputRefs.current[nextIndex]?.focus()
    } else {
      const newCode = [...verificationCode]
      newCode[index] = value.replace(/\D/g, '')
      setVerificationCode(newCode)
      if (value && index < 5) {
        codeInputRefs.current[index + 1]?.focus()
      }
    }
    setError('')
  }

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !verificationCode[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus()
    }
  }

  const validateStep1 = () => {
    if (!formData.firstName.trim()) return 'First name is required'
    if (!formData.lastName.trim()) return 'Last name is required'
    if (!formData.email.trim()) return 'Email is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Invalid email address'
    if (formData.password.length < 8) return 'Password must be at least 8 characters'
    if (formData.password !== formData.confirmPassword) return 'Passwords do not match'
    if (!formData.homeState) return 'Please select your home state'
    if (!formData.homeCounty) return 'Please select your home county'
    return null
  }

  const validateFirmProfile = () => {
    if (!firmData.firmName.trim()) return 'Company name is required'
    return null
  }

  const validateStep3 = () => {
    if (selectedPlan === 'firm') return null
    if (selectedAreas.length === 0) return 'Please select at least one area'
    return null
  }

  const addArea = () => {
    if (selectedPlan === 'county') {
      if (!selectedState || !selectedCounty) {
        setError('Please select both a state and county')
        return
      }
      const exists = selectedAreas.some(a => a.state === selectedState && a.county === selectedCounty)
      if (exists) {
        setError('This county is already selected')
        return
      }
      setSelectedAreas([...selectedAreas, { state: selectedState, county: selectedCounty }])
      setSelectedCounty('')
    } else {
      if (!selectedState) {
        setError('Please select a state')
        return
      }
      const exists = selectedAreas.some(a => a.state === selectedState && !a.county)
      if (exists) {
        setError('This state is already selected')
        return
      }
      setSelectedAreas([...selectedAreas, { state: selectedState }])
    }
    setError('')
  }

  const removeArea = (index: number) => {
    setSelectedAreas(selectedAreas.filter((_, i) => i !== index))
  }

  const addTeamMember = async () => {
    if (!newMember.email.trim()) {
      setError('Email is required')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newMember.email)) {
      setError('Invalid email address')
      return
    }
    if (!newMember.firstName.trim()) {
      setError('First name is required')
      return
    }
    if (!newMember.lastName.trim()) {
      setError('Last name is required')
      return
    }
    if (newMember.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    
    try {
      const checkResponse = await fetch(`${API_URL}/api/auth/check-email?email=${encodeURIComponent(newMember.email)}`)
      if (checkResponse.ok) {
        const data = await checkResponse.json()
        if (data.exists) {
          setError('This email is already registered')
          return
        }
      }
    } catch (err) {
      console.error('Email check failed:', err)
    }
    
    if (teamMembers.some(m => m.email.toLowerCase() === newMember.email.toLowerCase())) {
      setError('This team member is already added')
      return
    }
    
    const baseSeats = 3
    const maxMembers = baseSeats - 1 + additionalSeats
    if (teamMembers.length >= maxMembers) {
      setError(`You've reached your seat limit. Add more seats to invite more members.`)
      return
    }
    
    setTeamMembers([...teamMembers, newMember])
    setNewMember({ email: '', firstName: '', lastName: '', password: '' })
    setShowAddMember(false)
    setError('')
  }

  const removeTeamMember = (index: number) => {
    setTeamMembers(teamMembers.filter((_, i) => i !== index))
  }

  const calculatePrice = () => {
    const plan = PLANS[selectedPlan]
    let total = plan.basePrice
    
    if (selectedPlan === 'firm') {
      total += additionalSeats * plan.additionalPrice
    } else if (selectedAreas.length > 1) {
      total += (selectedAreas.length - 1) * plan.additionalPrice
    }
    
    if (billingCycle === 'annual') {
      total = total * 12 * 0.9
    }
    
    return total.toFixed(2)
  }

  const getTotalSteps = () => {
    if (selectedPlan === 'firm') {
      return 5
    }
    return 4
  }

  const getStepLabel = (stepNum: number) => {
    if (selectedPlan === 'firm') {
      switch (stepNum) {
        case 1: return 'Account'
        case 2: return 'Plan'
        case 3: return 'Company'
        case 4: return 'Team'
        case 5: return 'Payment'
      }
    }
    switch (stepNum) {
      case 1: return 'Account'
      case 2: return 'Plan'
      case 3: return 'Areas'
      case 4: return 'Payment'
    }
    return ''
  }

  const sendVerificationCode = async () => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(`${API_URL}/api/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          first_name: formData.firstName,
          last_name: formData.lastName,
          password: formData.password,
          referral_code: referralCode,  // Pass referral code
        }),
      })

      if (response.ok) {
        setCodeSent(true)
        setResendCountdown(60)
        setVerificationCode(['', '', '', '', '', ''])
      } else {
        const data = await response.json()
        throw new Error(data.detail || 'Failed to send verification code')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    const code = verificationCode.join('')
    if (code.length !== 6) {
      setError('Please enter the complete 6-digit code')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_URL}/api/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          code: code,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setVerificationToken(data.verification_token)
        
        // Check if Ground Goat employee - register immediately and skip subscription
        if (formData.email.toLowerCase().endsWith('@groundgoat.com')) {
          // Register the user directly
          const registerResponse = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              first_name: formData.firstName,
              last_name: formData.lastName,
              email: formData.email,
              password: formData.password,
              home_state: getStateAbbreviation(formData.homeState),
              home_county: formData.homeCounty,
              referral_code: referralCode,  // Pass referral code
              verification_token: data.verification_token,  // Pass verification token
            }),
          })

          if (!registerResponse.ok) {
            const regData = await registerResponse.json().catch(() => ({}))
            throw new Error(regData.detail || 'Registration failed')
          }

          const authData = await registerResponse.json()
          localStorage.setItem('auth_token', authData.access_token)
          if (authData.refresh_token) {
            localStorage.setItem('refresh_token', authData.refresh_token)
          }

          // Get user data
          const userResponse = await fetch(`${API_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${authData.access_token}` }
          })
          if (userResponse.ok) {
            const userData = await userResponse.json()
            localStorage.setItem('user', JSON.stringify(userData))
          }

          router.push('/account?welcome=true')
          return
        }
        
        setStep(2)
      } else {
        const data = await response.json()
        throw new Error(data.detail || 'Invalid verification code')
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handleContinue = async () => {
    if (step === 1) {
      if (!codeSent) {
        const validationError = validateStep1()
        if (validationError) {
          setError(validationError)
          return
        }
        await sendVerificationCode()
      } else {
        await verifyCode()
      }
    } else if (step === 2) {
      if (selectedPlan === 'firm') {
        setStep(3)
      } else {
        setStep(3)
      }
    } else if (step === 3) {
      if (selectedPlan === 'firm') {
        const validationError = validateFirmProfile()
        if (validationError) {
          setError(validationError)
          return
        }
        setStep(4)
      } else {
        const validationError = validateStep3()
        if (validationError) {
          setError(validationError)
          return
        }
        setStep(4)
        await handleRegistration()
      }
    } else if (step === 4) {
      if (selectedPlan === 'firm') {
        setStep(5)
        await handleFirmRegistration()
      }
    }
  }

  const handleFirmRegistration = async () => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch(`${API_URL}/api/auth/firm-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_email: formData.email,
          admin_password: formData.password,
          admin_first_name: formData.firstName,
          admin_last_name: formData.lastName,
          firm_name: firmData.firmName,
          firm_website: firmData.firmWebsite || null,
          firm_phone: firmData.firmPhone || null,
          team_members: teamMembers.map(m => ({
            email: m.email,
            first_name: m.firstName,
            last_name: m.lastName,
            password: m.password,
          })),
          billing_cycle: billingCycle,
          additional_seats: additionalSeats,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.checkout_url) {
          window.location.href = data.checkout_url
          return
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || 'Failed to create checkout session')
      }
    } catch (err: any) {
      console.error('Firm registration error:', err)
      setError(err.message || 'Something went wrong. Please try again.')
      setStep(4)
    } finally {
      setLoading(false)
    }
  }

  const handleRegistration = async () => {
    setLoading(true)
    setError('')
    
    try {
      // Register the user with referral code and verification token
      const registerResponse = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: formData.firstName,
          last_name: formData.lastName,
          email: formData.email,
          password: formData.password,
          home_state: getStateAbbreviation(formData.homeState),
          home_county: formData.homeCounty,
          referral_code: referralCode,  // Pass referral code
          verification_token: verificationToken,  // Pass verification token to mark user as verified
        }),
      })

      if (!registerResponse.ok) {
        const data = await registerResponse.json().catch(() => ({}))
        throw new Error(data.detail || 'Registration failed. Please try again.')
      }
      
      const authData = await registerResponse.json()
      
      localStorage.setItem('auth_token', authData.access_token)
      if (authData.refresh_token) {
        localStorage.setItem('refresh_token', authData.refresh_token)
      }
      
      const userResponse = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${authData.access_token}` }
      })
      
      if (userResponse.ok) {
        const userData = await userResponse.json()
        localStorage.setItem('user', JSON.stringify(userData))
        
        // Skip subscription for Ground Goat employees
        if (userData.account_type === 'groundgoat_sales' || userData.account_type === 'groundgoat_admin') {
          router.push('/account?welcome=true')
          return
        }
      }

      if (selectedAreas.length > 0) {
        const primaryArea = selectedAreas[0]
        const checkoutResponse = await fetch(`${API_URL}/api/subscriptions/checkout`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authData.access_token}`
          },
          body: JSON.stringify({
            subscription_type: selectedPlan,
            state: getStateAbbreviation(primaryArea.state),
            county: primaryArea.county || null,
            billing_cycle: billingCycle,
            additional_areas: selectedAreas.slice(1).map(area => ({
              state: getStateAbbreviation(area.state),
              county: area.county || null,
            })),
          }),
        })

        if (checkoutResponse.ok) {
          const checkoutData = await checkoutResponse.json()
          if (checkoutData.checkout_url) {
            window.location.href = checkoutData.checkout_url
            return
          } else {
            throw new Error('Could not create checkout session. Please try again.')
          }
        } else {
          const errorData = await checkoutResponse.json().catch(() => ({}))
          throw new Error(errorData.detail || 'Payment setup failed. Please try again.')
        }
      }

      router.push('/account?welcome=true')
      
    } catch (err: any) {
      console.error('Registration error:', err)
      setError(err.message || 'Something went wrong. Please try again.')
      setStep(3)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Referral Banner */}
        {referrerInfo && (
          <div className="bg-gg-pink/10 border border-gg-pink/30 rounded-xl p-4 mb-8 text-center">
            <p className="text-gg-pink">
              🎉 You were referred by <span className="font-semibold">{referrerInfo.first_name}</span>!
            </p>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl font-bold text-white mb-4">
            Create Your Account
          </h1>
          <p className="text-gg-gray-400">
            {step === 1 && !codeSent && 'Enter your information to get started'}
            {step === 1 && codeSent && 'Enter the verification code sent to your email'}
            {step === 2 && 'Choose your subscription plan'}
            {step === 3 && selectedPlan === 'firm' && 'Tell us about your company'}
            {step === 3 && selectedPlan !== 'firm' && 'Select your coverage areas'}
            {step === 4 && selectedPlan === 'firm' && 'Add your team members'}
            {step === 4 && selectedPlan !== 'firm' && 'Setting up your account...'}
            {step === 5 && 'Setting up your account...'}
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-4 mb-12">
          {Array.from({ length: getTotalSteps() }, (_, i) => i + 1).map((stepNum) => (
            <div key={stepNum} className="flex items-center">
              <div className={`flex items-center gap-2 ${step >= stepNum ? 'text-gg-pink' : 'text-gg-gray-500'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= stepNum ? 'bg-gg-pink text-black' : 'bg-gg-gray-700'}`}>
                  {stepNum}
                </div>
                <span className="hidden sm:inline">{getStepLabel(stepNum)}</span>
              </div>
              {stepNum < getTotalSteps() && <div className="w-12 h-px bg-gg-gray-700 mx-2" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="max-w-xl mx-auto">
          {/* Step 1: Account Info */}
          {step === 1 && !codeSent && (
            <div className="card">
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">First Name</label>
                    <input
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                      placeholder="John"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">Last Name</label>
                    <input
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                      placeholder="Doe"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gg-gray-300 mb-2">Email</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                    placeholder="john@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gg-gray-300 mb-2">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleInputChange}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 pr-12 focus:border-gg-pink focus:outline-none"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gg-gray-500 hover:text-gg-gray-300"
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gg-gray-300 mb-2">Confirm Password</label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                    placeholder="••••••••"
                  />
                </div>

                {/* Home Location */}
                <div className="pt-4 border-t border-gg-gray-700">
                  <p className="text-sm text-gg-gray-400 mb-4">
                    <MapPin size={14} className="inline mr-1" />
                    Your home location helps us send you relevant notifications
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gg-gray-300 mb-2">Home State</label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowHomeStateDropdown(!showHomeStateDropdown)
                            setShowHomeCountyDropdown(false)
                          }}
                          className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-left text-black flex items-center justify-between focus:border-gg-pink focus:outline-none"
                        >
                          <span className={formData.homeState ? 'text-black' : 'text-gray-500'}>
                            {formData.homeState || 'Select...'}
                          </span>
                          <ChevronDown size={16} className={`text-gray-500 transition-transform ${showHomeStateDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showHomeStateDropdown && (
                          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                            {US_STATES.map(state => (
                              <button
                                key={state}
                                type="button"
                                onClick={() => {
                                  setFormData(prev => ({ ...prev, homeState: state, homeCounty: '' }))
                                  setShowHomeStateDropdown(false)
                                }}
                                className="w-full px-4 py-2 text-left text-sm text-black hover:bg-gray-100 transition-colors"
                              >
                                {state}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gg-gray-300 mb-2">Home County</label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            if (formData.homeState) {
                              setShowHomeCountyDropdown(!showHomeCountyDropdown)
                              setShowHomeStateDropdown(false)
                            }
                          }}
                          disabled={!formData.homeState}
                          className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-left text-black flex items-center justify-between focus:border-gg-pink focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className={formData.homeCounty ? 'text-black' : 'text-gray-500'}>
                            {formData.homeCounty || (formData.homeState ? 'Select...' : 'Select state first')}
                          </span>
                          <ChevronDown size={16} className={`text-gray-500 transition-transform ${showHomeCountyDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showHomeCountyDropdown && homeCounties.length > 0 && (
                          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                            {homeCounties.map(county => (
                              <button
                                key={county}
                                type="button"
                                onClick={() => {
                                  setFormData(prev => ({ ...prev, homeCounty: county }))
                                  setShowHomeCountyDropdown(false)
                                }}
                                className="w-full px-4 py-2 text-left text-sm text-black hover:bg-gray-100 transition-colors"
                              >
                                {county}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <button
                  onClick={handleContinue}
                  disabled={loading}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={20} className="animate-spin" /> : <>Send Verification Code <ArrowRight size={20} /></>}
                </button>

                <p className="text-center text-gg-gray-500 text-sm">
                  Already have an account?{' '}
                  <Link href="/signin" className="text-gg-pink hover:underline">Sign in</Link>
                </p>
              </div>
            </div>
          )}

          {/* Step 1b: Verification Code Entry */}
          {step === 1 && codeSent && (
            <div className="card">
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-gg-pink/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail className="text-gg-pink" size={32} />
                </div>
                <h2 className="font-display text-2xl font-bold text-white mb-2">Check Your Email</h2>
                <p className="text-gg-gray-400">
                  We sent a 6-digit code to <span className="text-white">{formData.email}</span>
                </p>
              </div>

              <div className="flex justify-center gap-3 mb-8">
                {verificationCode.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { codeInputRefs.current[index] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleCodeChange(index, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(index, e)}
                    className="w-12 h-14 bg-gg-gray-900 border border-gg-gray-700 rounded-lg text-center text-2xl font-bold text-white focus:border-gg-pink focus:outline-none"
                  />
                ))}
              </div>

              {error && (
                <p className="text-red-400 text-sm text-center mb-4">{error}</p>
              )}

              <button
                onClick={handleContinue}
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2 mb-4"
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : <>Verify Code <ArrowRight size={20} /></>}
              </button>

              <div className="text-center">
                <p className="text-gg-gray-500 text-sm mb-2">Didn't receive the code?</p>
                {resendCountdown > 0 ? (
                  <p className="text-gg-gray-400 text-sm">Resend in {resendCountdown}s</p>
                ) : (
                  <button
                    onClick={sendVerificationCode}
                    disabled={loading}
                    className="text-gg-pink hover:underline text-sm"
                  >
                    Resend Code
                  </button>
                )}
              </div>

              <button
                onClick={() => {
                  setCodeSent(false)
                  setVerificationCode(['', '', '', '', '', ''])
                  setError('')
                }}
                className="w-full mt-6 text-center text-gg-gray-400 hover:text-white text-sm"
              >
                ← Change email address
              </button>
            </div>
          )}

          {/* Step 2: Plan Selection */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex justify-center mb-8">
                <div className="bg-gg-gray-800 rounded-full p-1 flex">
                  <button
                    onClick={() => setBillingCycle('monthly')}
                    className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${billingCycle === 'monthly' ? 'bg-gg-pink text-black' : 'text-gg-gray-300'}`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingCycle('annual')}
                    className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${billingCycle === 'annual' ? 'bg-gg-pink text-black' : 'text-gg-gray-300'}`}
                  >
                    Annual (Save 10%)
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {Object.entries(PLANS).map(([key, p]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedPlan(key as keyof typeof PLANS)}
                    className={`w-full text-left bg-gg-gray-800 rounded-2xl p-6 transition-all duration-200 ${
                      selectedPlan === key 
                        ? 'border-2 border-white shadow-[0_0_25px_rgba(245,140,222,0.5)]' 
                        : 'border border-gg-gray-700 hover:border-gg-gray-500'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-display text-xl font-semibold text-white">{p.name}</h3>
                        <p className="text-gg-gray-400 text-sm">{p.description}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-bold text-white">
                          ${billingCycle === 'annual' ? (p.basePrice * 12 * 0.9).toFixed(2) : p.basePrice.toFixed(2)}
                        </span>
                        <span className="text-gg-gray-400 text-sm">
                          /{billingCycle === 'annual' ? 'year' : 'mo'}
                        </span>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-2">
                      {p.features.slice(0, 2).map((feature, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-gg-gray-300">
                          <Check className="text-gg-pink" size={16} />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    setStep(1)
                    setCodeSent(false)
                  }}
                  className="btn-secondary flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={20} />
                  Back
                </button>
                <button
                  onClick={handleContinue}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {selectedPlan === 'firm' ? 'Company Info' : 'Select Areas'}
                  <ArrowRight size={20} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Firm Profile */}
          {step === 3 && selectedPlan === 'firm' && (
            <div className="space-y-6">
              <div className="card">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-full bg-gg-pink/20 flex items-center justify-center">
                    <Building2 className="text-gg-pink" size={24} />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-semibold text-white">Company Information</h3>
                    <p className="text-gg-gray-400 text-sm">Tell us about your management firm</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">Company Name *</label>
                    <input
                      type="text"
                      name="firmName"
                      value={firmData.firmName}
                      onChange={handleFirmInputChange}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                      placeholder="Acme Land Management"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">Website (optional)</label>
                    <input
                      type="text"
                      name="firmWebsite"
                      value={firmData.firmWebsite}
                      onChange={handleFirmInputChange}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                      placeholder="https://example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">Phone (optional)</label>
                    <input
                      type="tel"
                      name="firmPhone"
                      value={firmData.firmPhone}
                      onChange={handleFirmInputChange}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setStep(2)}
                  className="btn-secondary flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={20} />
                  Back
                </button>
                <button
                  onClick={handleContinue}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  Add Team Members
                  <ArrowRight size={20} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Territory Selection (for non-firm plans) */}
          {step === 3 && selectedPlan !== 'firm' && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="font-display text-xl font-semibold text-white mb-2">
                  Select Your {selectedPlan === 'county' ? 'Counties' : 'States'}
                </h3>
                <p className="text-gg-gray-400 text-sm mb-6">
                  {selectedPlan === 'county' 
                    ? 'Choose the counties you want to monitor for land sales.'
                    : 'Choose the states you want full access to. All counties in selected states will be included.'
                  }
                </p>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gg-gray-300 mb-2">
                    {selectedPlan === 'county' ? 'State' : 'Select State'}
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setShowStateDropdown(!showStateDropdown)}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-left text-white flex items-center justify-between focus:border-gg-pink focus:outline-none"
                    >
                      <span className={selectedState ? 'text-white' : 'text-gg-gray-500'}>
                        {selectedState || 'Select a state...'}
                      </span>
                      <ChevronDown size={20} className={`text-gg-gray-500 transition-transform ${showStateDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {showStateDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-gg-gray-800 border border-gg-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {loadingStates ? (
                          <div className="px-4 py-3 text-gg-gray-400 flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin" />
                            Loading states...
                          </div>
                        ) : availableStates.length === 0 ? (
                          <div className="px-4 py-3 text-gg-gray-400">No states available</div>
                        ) : (
                          availableStates.map(state => (
                            <button
                              key={state}
                              onClick={() => {
                                setSelectedState(state)
                                setSelectedCounty('')
                                setShowStateDropdown(false)
                              }}
                              className="w-full px-4 py-3 text-left text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white transition-colors"
                            >
                              {state}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {selectedPlan === 'county' && selectedState && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">County</label>
                    <div className="relative">
                      <button
                        onClick={() => setShowCountyDropdown(!showCountyDropdown)}
                        className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-left text-white flex items-center justify-between focus:border-gg-pink focus:outline-none"
                      >
                        <span className={selectedCounty ? 'text-white' : 'text-gg-gray-500'}>
                          {selectedCounty || 'Select a county...'}
                        </span>
                        <ChevronDown size={20} className={`text-gg-gray-500 transition-transform ${showCountyDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      
                      {showCountyDropdown && (
                        <div className="absolute z-10 w-full mt-1 bg-gg-gray-800 border border-gg-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                          {loadingCounties ? (
                            <div className="px-4 py-3 text-gg-gray-400 flex items-center gap-2">
                              <Loader2 size={16} className="animate-spin" />
                              Loading counties...
                            </div>
                          ) : availableCounties.length === 0 ? (
                            <div className="px-4 py-3 text-gg-gray-400">No counties available for {selectedState}</div>
                          ) : (
                            availableCounties.map(county => (
                              <button
                                key={county}
                                onClick={() => {
                                  setSelectedCounty(county)
                                  setShowCountyDropdown(false)
                                }}
                                className="w-full px-4 py-3 text-left text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white transition-colors"
                              >
                                {county}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <button
                  onClick={addArea}
                  className="btn-secondary w-full flex items-center justify-center gap-2"
                >
                  <MapPin size={18} />
                  Add {selectedPlan === 'county' ? 'County' : 'State'}
                </button>
              </div>

              {selectedAreas.length > 0 && (
                <div className="card">
                  <h4 className="font-medium text-white mb-4">Selected Areas</h4>
                  <div className="space-y-2">
                    {selectedAreas.map((area, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between bg-gg-gray-900 rounded-lg px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <MapPin size={18} className="text-gg-pink" />
                          <span className="text-white">
                            {area.county ? `${area.county}, ${area.state}` : area.state}
                          </span>
                          {index === 0 && (
                            <span className="text-xs bg-gg-pink/20 text-gg-pink px-2 py-0.5 rounded">Primary</span>
                          )}
                        </div>
                        <button
                          onClick={() => removeArea(index)}
                          className="text-gg-gray-500 hover:text-red-400 transition-colors"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-gg-gray-700">
                    <div className="flex justify-between items-center">
                      <span className="text-gg-gray-400">
                        {selectedAreas.length} {selectedPlan === 'county' ? 'counties' : 'states'} selected
                      </span>
                      <div className="text-right">
                        <span className="text-2xl font-bold text-white">${calculatePrice()}</span>
                        <span className="text-gg-gray-400 text-sm">/{billingCycle === 'annual' ? 'year' : 'mo'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setStep(2)}
                  className="btn-secondary flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={20} />
                  Back
                </button>
                <button
                  onClick={handleContinue}
                  disabled={selectedAreas.length === 0}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue to Payment
                  <ArrowRight size={20} />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Team Setup (for firm plans) */}
          {step === 4 && selectedPlan === 'firm' && (
            <div className="space-y-6">
              <div className="card">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-full bg-gg-pink/20 flex items-center justify-center">
                    <Users className="text-gg-pink" size={24} />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-semibold text-white">Add Team Members</h3>
                    <p className="text-gg-gray-400 text-sm">
                      Your plan includes 3 seats (1 admin + 2 team members)
                    </p>
                  </div>
                </div>

                <div className="bg-gg-gray-900 rounded-lg p-4 mb-6">
                  <div className="flex justify-between items-center">
                    <span className="text-gg-gray-300">Seats Used</span>
                    <span className="text-white font-semibold">
                      {1 + teamMembers.length} / {3 + additionalSeats}
                    </span>
                  </div>
                  <div className="mt-2 h-2 bg-gg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gg-pink transition-all"
                      style={{ width: `${((1 + teamMembers.length) / (3 + additionalSeats)) * 100}%` }}
                    />
                  </div>
                </div>

                {teamMembers.length > 0 && (
                  <div className="space-y-2 mb-6">
                    {teamMembers.map((member, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between bg-gg-gray-900 rounded-lg px-4 py-3"
                      >
                        <div>
                          <p className="text-white">{member.firstName} {member.lastName}</p>
                          <p className="text-gg-gray-400 text-sm">{member.email}</p>
                        </div>
                        <button
                          onClick={() => removeTeamMember(index)}
                          className="text-gg-gray-500 hover:text-red-400 transition-colors"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {showAddMember ? (
                  <div className="border border-gg-gray-700 rounded-lg p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gg-gray-300 mb-2">First Name</label>
                        <input
                          type="text"
                          name="firstName"
                          value={newMember.firstName}
                          onChange={handleNewMemberChange}
                          className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                          placeholder="Jane"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gg-gray-300 mb-2">Last Name</label>
                        <input
                          type="text"
                          name="lastName"
                          value={newMember.lastName}
                          onChange={handleNewMemberChange}
                          className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                          placeholder="Smith"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gg-gray-300 mb-2">Email</label>
                      <input
                        type="email"
                        name="email"
                        value={newMember.email}
                        onChange={handleNewMemberChange}
                        className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                        placeholder="jane@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gg-gray-300 mb-2">Temporary Password</label>
                      <input
                        type="password"
                        name="password"
                        value={newMember.password}
                        onChange={handleNewMemberChange}
                        className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                        placeholder="••••••••"
                      />
                      <p className="text-gg-gray-500 text-xs mt-1">They can change this after signing in</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowAddMember(false)
                          setNewMember({ email: '', firstName: '', lastName: '', password: '' })
                          setError('')
                        }}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={addTeamMember}
                        className="btn-primary flex-1"
                      >
                        Add Member
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddMember(true)}
                    disabled={teamMembers.length >= 2 + additionalSeats}
                    className="btn-secondary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus size={18} />
                    Add Team Member
                  </button>
                )}

                <div className="mt-6 pt-6 border-t border-gg-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">Need more seats?</p>
                      <p className="text-gg-gray-400 text-sm">${PLANS.firm.additionalPrice}/seat/month</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setAdditionalSeats(Math.max(0, additionalSeats - 1))}
                        disabled={additionalSeats === 0}
                        className="w-8 h-8 rounded-full bg-gg-gray-700 text-white flex items-center justify-center disabled:opacity-50"
                      >
                        -
                      </button>
                      <span className="text-white font-semibold w-8 text-center">{additionalSeats}</span>
                      <button
                        onClick={() => setAdditionalSeats(additionalSeats + 1)}
                        className="w-8 h-8 rounded-full bg-gg-gray-700 text-white flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <h4 className="font-medium text-white mb-4">Order Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gg-gray-400">Management Firm Base Plan</span>
                    <span className="text-white">${PLANS.firm.basePrice}/mo</span>
                  </div>
                  {additionalSeats > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gg-gray-400">{additionalSeats} Additional Seat(s)</span>
                      <span className="text-white">${(additionalSeats * PLANS.firm.additionalPrice).toFixed(2)}/mo</span>
                    </div>
                  )}
                  {billingCycle === 'annual' && (
                    <div className="flex justify-between text-green-400">
                      <span>Annual Discount (10%)</span>
                      <span>-${((PLANS.firm.basePrice + additionalSeats * PLANS.firm.additionalPrice) * 12 * 0.1).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-gg-gray-700 flex justify-between">
                    <span className="text-white font-semibold">Total</span>
                    <div className="text-right">
                      <span className="text-2xl font-bold text-white">${calculatePrice()}</span>
                      <span className="text-gg-gray-400 text-sm">/{billingCycle === 'annual' ? 'year' : 'mo'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setStep(3)}
                  className="btn-secondary flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={20} />
                  Back
                </button>
                <button
                  onClick={handleContinue}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  Continue to Payment
                  <ArrowRight size={20} />
                </button>
              </div>

              <p className="text-center text-gg-gray-500 text-sm">
                You can add more team members later from your account settings
              </p>
            </div>
          )}

          {/* Step 4/5: Processing */}
          {((step === 4 && selectedPlan !== 'firm') || step === 5) && (
            <div className="card text-center py-12">
              <Loader2 size={48} className="animate-spin text-gg-pink mx-auto mb-6" />
              <h3 className="font-display text-xl font-semibold text-white mb-2">
                Setting Up Your Account
              </h3>
              <p className="text-gg-gray-400">
                {loading ? 'Please wait while we create your account...' : 'Redirecting to payment...'}
              </p>
              {error && (
                <div className="mt-6">
                  <p className="text-red-400 text-sm mb-4">{error}</p>
                  <button
                    onClick={() => setStep(selectedPlan === 'firm' ? 4 : 3)}
                    className="btn-secondary"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Terms */}
        <p className="text-center text-gg-gray-500 text-sm mt-8">
          By creating an account, you agree to our{' '}
          <Link href="/terms" className="text-gg-pink hover:underline">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="text-gg-pink hover:underline">Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <SignUpContent />
    </Suspense>
  )
}
