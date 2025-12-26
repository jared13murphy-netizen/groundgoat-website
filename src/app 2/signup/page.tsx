'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Check, ArrowLeft, ArrowRight, Eye, EyeOff, MapPin, ChevronDown, X, Loader2 } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Valid US states to filter against - defined outside component to avoid reference issues
const VALID_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming'
]

const PLANS = {
  county: {
    name: 'County',
    basePrice: 7.99,
    additionalPrice: 3.99,
    description: 'Perfect for focused investors',
    features: ['1 county included', 'Upcoming auction alerts', 'Sale results access', 'Mobile app access'],
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

function SignUpContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialPlan = searchParams.get('plan') as keyof typeof PLANS || 'state'
  const initialStep = searchParams.get('step') ? parseInt(searchParams.get('step')!) : 1
  const cancelled = searchParams.get('cancelled') === 'true'
  
  const [step, setStep] = useState(initialStep)
  const [selectedPlan, setSelectedPlan] = useState(initialPlan)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(cancelled ? 'Payment was cancelled. Please try again.' : '')
  const [isReturningUser, setIsReturningUser] = useState(false)
  
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
  
  // Check if user is already logged in (returning user without subscription)
  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    const user = localStorage.getItem('user')
    if (token && user && initialStep >= 2) {
      setIsReturningUser(true)
      // Pre-fill form data from stored user
      const userData = JSON.parse(user)
      setFormData(prev => ({
        ...prev,
        firstName: userData.first_name || '',
        lastName: userData.last_name || '',
        email: userData.email || '',
      }))
    }
  }, [initialStep])
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  })

  // Fetch available states on component mount
  useEffect(() => {
    fetchAvailableStates()
  }, [])

  // Fetch counties when state is selected
  useEffect(() => {
    if (selectedState && selectedPlan === 'county') {
      fetchAvailableCounties(selectedState)
    }
  }, [selectedState, selectedPlan])

  const fetchAvailableStates = async () => {
    setLoadingStates(true)
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/available-states`)
      if (response.ok) {
        const data = await response.json()
        // Handle array of {state, listing_count} objects and filter to valid states only
        let states: string[] = []
        if (Array.isArray(data)) {
          states = data
            .map((item: any) => typeof item === 'string' ? item : item.state)
            .filter((s: string) => VALID_STATES.includes(s))
            .sort()
        }
        setAvailableStates(states.length > 0 ? states : VALID_STATES.slice(0, 10))
      }
    } catch (err) {
      console.error('Failed to fetch states:', err)
      // Fallback to common states
      setAvailableStates(['Illinois', 'Iowa', 'Missouri', 'Indiana', 'Wisconsin'])
    } finally {
      setLoadingStates(false)
    }
  }

  const fetchAvailableCounties = async (state: string) => {
    setLoadingCounties(true)
    setAvailableCounties([])
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/available-counties/${encodeURIComponent(state)}`)
      if (response.ok) {
        const data = await response.json()
        // Handle array of {county, listing_count} objects and filter out townships/bad data
        let counties: string[] = []
        if (Array.isArray(data)) {
          counties = data
            .map((item: any) => typeof item === 'string' ? item : item.county)
            .filter((c: string) => c && !c.includes('Township') && !c.includes('Precinct') && !c.match(/^\d/))
            .sort()
        }
        setAvailableCounties(counties)
      }
    } catch (err) {
      console.error('Failed to fetch counties:', err)
    } finally {
      setLoadingCounties(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError('')
  }

  const validateStep1 = () => {
    if (!formData.firstName.trim()) return 'First name is required'
    if (!formData.lastName.trim()) return 'Last name is required'
    if (!formData.email.trim()) return 'Email is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Invalid email address'
    if (formData.password.length < 8) return 'Password must be at least 8 characters'
    if (formData.password !== formData.confirmPassword) return 'Passwords do not match'
    return null
  }

  const validateStep3 = () => {
    if (selectedPlan === 'firm') return null // Firm gets unlimited access
    if (selectedAreas.length === 0) return 'Please select at least one area'
    return null
  }

  const addArea = () => {
    if (selectedPlan === 'county') {
      if (!selectedState || !selectedCounty) {
        setError('Please select both a state and county')
        return
      }
      // Check for duplicates
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
      // Check for duplicates
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

  const calculatePrice = () => {
    const plan = PLANS[selectedPlan]
    let total = plan.basePrice
    
    // Add price for additional areas
    if (selectedAreas.length > 1) {
      total += (selectedAreas.length - 1) * plan.additionalPrice
    }
    
    if (billingCycle === 'annual') {
      total = total * 12 * 0.9 // 10% discount
    }
    
    return total.toFixed(2)
  }

  const handleContinue = async () => {
    if (step === 1) {
      const validationError = validateStep1()
      if (validationError) {
        setError(validationError)
        return
      }
      setStep(2)
    } else if (step === 2) {
      if (selectedPlan === 'firm') {
        // Firm plan skips territory selection
        setStep(4)
        await handleRegistration()
      } else {
        setStep(3)
      }
    } else if (step === 3) {
      const validationError = validateStep3()
      if (validationError) {
        setError(validationError)
        return
      }
      setStep(4)
      await handleRegistration()
    }
  }

  const handleRegistration = async () => {
    setLoading(true)
    setError('')
    
    try {
      let authData;
      let token = localStorage.getItem('auth_token')
      
      // If returning user with existing token, skip registration
      if (isReturningUser && token) {
        authData = { access_token: token }
      } else {
        // Step 1: Register the user
        const registerResponse = await fetch(`${API_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: formData.firstName,
            last_name: formData.lastName,
            email: formData.email,
            password: formData.password,
            account_type: selectedPlan === 'firm' ? 'firm_admin' : 'individual',
          }),
        })

        if (!registerResponse.ok) {
          const data = await registerResponse.json().catch(() => ({}))
          // If user already exists, try to log them in instead
          if (data.detail?.includes('already') || data.detail?.includes('exists')) {
            const loginResponse = await fetch(`${API_URL}/api/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: formData.email,
                password: formData.password,
              }),
            })
            
            if (!loginResponse.ok) {
              throw new Error('Account already exists. Please sign in instead.')
            }
            
            authData = await loginResponse.json()
          } else {
            throw new Error(data.detail || 'Registration failed. Please try again.')
          }
        } else {
          authData = await registerResponse.json()
        }
        
        // Store tokens
        localStorage.setItem('auth_token', authData.access_token)
        if (authData.refresh_token) {
          localStorage.setItem('refresh_token', authData.refresh_token)
        }
        
        // Fetch user data
        const userResponse = await fetch(`${API_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${authData.access_token}` }
        })
        
        if (userResponse.ok) {
          const userData = await userResponse.json()
          localStorage.setItem('user', JSON.stringify(userData))
        }
      }

      // Step 2: Create subscription checkout for each area
      if (selectedPlan !== 'firm' && selectedAreas.length > 0) {
        const primaryArea = selectedAreas[0]
        const checkoutResponse = await fetch(`${API_URL}/api/subscriptions/checkout`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authData.access_token}`
          },
          body: JSON.stringify({
            subscription_type: selectedPlan,
            state: primaryArea.state,
            county: primaryArea.county || null,
            billing_cycle: billingCycle,
          }),
        })

        if (checkoutResponse.ok) {
          const checkoutData = await checkoutResponse.json()
          // Redirect to Stripe checkout
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

      // If no checkout URL or firm plan, redirect to account
      router.push('/account?welcome=true')
      
    } catch (err: any) {
      console.error('Registration error:', err)
      setError(err.message || 'Something went wrong. Please try again.')
      setStep(3) // Go back to territory selection on error
    } finally {
      setLoading(false)
    }
  }

  const plan = PLANS[selectedPlan]

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-12">
          <Link href="/" className="inline-block mb-8">
            <Image src="/logo.png" alt="Ground Goat" width={150} height={50} className="h-12 w-auto" />
          </Link>
          <h1 className="font-display text-4xl font-bold text-white mb-4">
            Create Your Account
          </h1>
          <p className="text-gg-gray-400">
            {step === 1 && 'Enter your information to get started'}
            {step === 2 && 'Choose your subscription plan'}
            {step === 3 && 'Select your coverage areas'}
            {step === 4 && 'Setting up your account...'}
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-4 mb-12">
          <div className={`flex items-center gap-2 ${step >= 1 ? 'text-gg-pink' : 'text-gg-gray-500'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= 1 ? 'bg-gg-pink text-black' : 'bg-gg-gray-700'}`}>1</div>
            <span className="hidden sm:inline">Account</span>
          </div>
          <div className="w-12 h-px bg-gg-gray-700" />
          <div className={`flex items-center gap-2 ${step >= 2 ? 'text-gg-pink' : 'text-gg-gray-500'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= 2 ? 'bg-gg-pink text-black' : 'bg-gg-gray-700'}`}>2</div>
            <span className="hidden sm:inline">Plan</span>
          </div>
          <div className="w-12 h-px bg-gg-gray-700" />
          <div className={`flex items-center gap-2 ${step >= 3 ? 'text-gg-pink' : 'text-gg-gray-500'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= 3 ? 'bg-gg-pink text-black' : 'bg-gg-gray-700'}`}>3</div>
            <span className="hidden sm:inline">Areas</span>
          </div>
          <div className="w-12 h-px bg-gg-gray-700" />
          <div className={`flex items-center gap-2 ${step >= 4 ? 'text-gg-pink' : 'text-gg-gray-500'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= 4 ? 'bg-gg-pink text-black' : 'bg-gg-gray-700'}`}>4</div>
            <span className="hidden sm:inline">Payment</span>
          </div>
        </div>

        {/* Step Content */}
        <div className="max-w-xl mx-auto">
          {/* Step 1: Account Info */}
          {step === 1 && (
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

                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <button
                  onClick={handleContinue}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  Continue
                  <ArrowRight size={20} />
                </button>

                <p className="text-center text-gg-gray-500 text-sm">
                  Already have an account?{' '}
                  <Link href="/signin" className="text-gg-pink hover:underline">Sign in</Link>
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Plan Selection */}
          {step === 2 && (
            <div className="space-y-6">
              {/* Billing Toggle */}
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

              {/* Plan Selection */}
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
                  onClick={() => setStep(1)}
                  className="btn-secondary flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={20} />
                  Back
                </button>
                <button
                  onClick={handleContinue}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {selectedPlan === 'firm' ? 'Continue to Payment' : 'Select Areas'}
                  <ArrowRight size={20} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Territory Selection */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="card">
                <h3 className="font-display text-xl font-semibold text-white mb-2">
                  Select Your {selectedPlan === 'county' ? 'Counties' : 'States'}
                </h3>
                <p className="text-gg-gray-400 text-sm mb-6">
                  {selectedPlan === 'county' 
                    ? 'Choose the counties you want to monitor for land auctions and sales.'
                    : 'Choose the states you want full access to. All counties in selected states will be included.'
                  }
                </p>

                {/* State Selection */}
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

                {/* County Selection (only for county plan) */}
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

                {/* Add Area Button */}
                <button
                  onClick={addArea}
                  className="btn-secondary w-full flex items-center justify-center gap-2"
                >
                  <MapPin size={18} />
                  Add {selectedPlan === 'county' ? 'County' : 'State'}
                </button>
              </div>

              {/* Selected Areas */}
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
                  
                  {/* Price Summary */}
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

          {/* Step 4: Processing */}
          {step === 4 && (
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
                    onClick={() => setStep(3)}
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
