'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { 
  MapPin, 
  TrendingUp, 
  Bell, 
  Search, 
  BarChart3, 
  Clock,
  Check,
  ArrowRight,
  Smartphone,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Calendar,
  Maximize
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Listing {
  id: string
  county: string
  state: string
  auction_datetime: string
  total_acres: number
  listing_type: string
  primary_image_url: string
  company_name: string
  land_types: string[]
}

// Fallback listings with aerial drone farmland images (fields only, no humans or livestock)
const FALLBACK_LISTINGS: Listing[] = [
  {
    id: '1',
    county: 'Adams',
    state: 'Illinois',
    auction_datetime: '2025-01-15T16:00:00Z',
    total_acres: 320,
    listing_type: 'auction',
    primary_image_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1920&q=80',
    company_name: 'Midwest Land Auctions',
    land_types: ['Farm', 'Tillable']
  },
  {
    id: '2',
    county: 'Hancock',
    state: 'Illinois',
    auction_datetime: '2025-01-18T19:00:00Z',
    total_acres: 156,
    listing_type: 'auction',
    primary_image_url: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=1920&q=80',
    company_name: 'Sullivan Auctioneers',
    land_types: ['Farm', 'Recreational']
  },
  {
    id: '3',
    county: 'Pike',
    state: 'Illinois',
    auction_datetime: '2025-01-22T16:30:00Z',
    total_acres: 240,
    listing_type: 'auction',
    primary_image_url: 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=1920&q=80',
    company_name: 'Agri Affiliates',
    land_types: ['Pasture', 'Timber']
  },
  {
    id: '4',
    county: 'Schuyler',
    state: 'Illinois',
    auction_datetime: '2025-01-25T17:00:00Z',
    total_acres: 80,
    listing_type: 'auction',
    primary_image_url: 'https://images.unsplash.com/photo-1595841696677-6489ff3f8cd1?w=1920&q=80',
    company_name: 'Farmers National',
    land_types: ['Farm']
  },
]

export default function Home() {
  const [listings, setListings] = useState<Listing[]>(FALLBACK_LISTINGS)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [userLocation, setUserLocation] = useState<string | null>(null)

  // Get user's location via IP geolocation
  useEffect(() => {
    const getLocation = async () => {
      try {
        const response = await fetch('https://ipapi.co/json/')
        if (response.ok) {
          const data = await response.json()
          setUserLocation(data.region)
        }
      } catch (err) {
        console.log('Could not get location')
      }
    }
    getLocation()
  }, [])

  // Fetch real listings from public API endpoint
  // Gets next 12 upcoming auctions (after current time) in random order
  useEffect(() => {
    const fetchListings = async () => {
      try {
        const response = await fetch(`${API_URL}/api/public/featured-auctions?limit=12`)
        if (response.ok) {
          const data = await response.json()

          if (data && data.length > 0) {
            // Take up to 8 listings for the carousel
            setListings(data.slice(0, 8))
          }
        }
      } catch (err) {
        // Keep fallback listings
        console.log('Using fallback listings')
      }
    }

    fetchListings()
  }, [])

  // Auto-advance carousel
  useEffect(() => {
    if (listings.length <= 1) return
    
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % listings.length)
    }, 5000)
    
    return () => clearInterval(interval)
  }, [listings.length])

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev + 1) % listings.length)
  }, [listings.length])

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev - 1 + listings.length) % listings.length)
  }, [listings.length])

  const formatDateTime = (dateString: string) => {
    if (!dateString) return { date: '', time: '' }
    const date = new Date(dateString)
    const dateFormatted = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
    const timeFormatted = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).toLowerCase()
    return { date: dateFormatted, time: timeFormatted }
  }

  const currentListing = listings[currentSlide]

  return (
    <>
      {/* Hero Section with Full-Screen Carousel */}
      <section className="relative min-h-[calc(100vh-80px)] mt-20 flex items-center overflow-hidden">
        {/* Background Image Carousel */}
        <div className="absolute inset-0">
          {listings.map((listing, index) => (
            <div
              key={listing.id}
              className={`absolute inset-0 transition-opacity duration-1000 ${
                index === currentSlide ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <Image
                src={listing.primary_image_url}
                alt={`${listing.county} County auction`}
                fill
                className="object-cover"
                priority={index === 0}
                sizes="100vw"
              />
            </div>
          ))}
          
          {/* Gradient overlays for text readability */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
        </div>

        {/* Content Overlay */}
        <div className="relative z-10 max-w-7xl mx-auto px-6 w-full">
          <div className="max-w-2xl">
            {/* Main Headline */}
            <h1 className="font-display text-7xl md:text-9xl font-bold text-white mb-6 animate-slide-up">
              <span className="text-gradient">Ground Goat</span>
            </h1>

            {/* Subheadline */}
            <p className="text-xl md:text-2xl text-gray-200 mb-8 animate-slide-up delay-100">
              Access comprehensive auction data, sale results, and property insights. 
              Stay ahead with real-time notifications for the areas you care about.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 animate-slide-up delay-200">
              <Link href="/signup" className="btn-primary inline-flex items-center justify-center gap-2 text-lg">
                Get Started
                <ArrowRight size={20} />
              </Link>
              <Link href="/#features" className="btn-secondary inline-flex items-center justify-center gap-2 text-lg">
                See Features
              </Link>
            </div>

            {/* Current Listing Info Card */}
            {currentListing && (
              <div className="mt-12 bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10 p-6 animate-fade-in delay-300">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  {currentListing.auction_datetime && (
                    <>
                      <div className="bg-gg-pink text-black text-sm font-bold px-3 py-1 rounded-full flex items-center gap-1">
                        <Calendar size={14} />
                        {formatDateTime(currentListing.auction_datetime).date}
                      </div>
                      <div className="bg-white/10 text-white text-sm px-3 py-1 rounded-full flex items-center gap-1">
                        <Clock size={14} />
                        {formatDateTime(currentListing.auction_datetime).time}
                      </div>
                    </>
                  )}
                  <div className="bg-white/10 text-white text-sm px-3 py-1 rounded-full capitalize">
                    {currentListing.listing_type?.replace('_', ' ')}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-white mb-2">
                  <MapPin size={20} className="text-gg-pink flex-shrink-0" />
                  <span className="text-2xl font-semibold">
                    {currentListing.county} County, {currentListing.state}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-gray-300">
                  <div className="flex items-center gap-1">
                    <Maximize size={16} />
                    <span>{currentListing.total_acres?.toLocaleString()} acres</span>
                  </div>
                  {currentListing.company_name && (
                    <>
                      <span className="text-gray-500">•</span>
                      <span className="text-gray-400">{currentListing.company_name}</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Carousel Indicators */}
        {listings.length > 1 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-2">
            {listings.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentSlide(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentSlide 
                    ? 'bg-gg-pink w-8' 
                    : 'bg-white/40 hover:bg-white/60 w-2'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        )}
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-gg-gray-900 relative">
        <div className="max-w-7xl mx-auto px-6">
          {/* Section Header */}
          <div className="text-center mb-16">
            <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">
              Everything You Need
            </h2>
            <p className="text-xl text-gg-gray-400 max-w-2xl mx-auto">
              Powerful tools to help you find, track, and analyze land auctions across the country.
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<Search />}
              title="Smart Search"
              description="Filter by state and county to find exactly what you're looking for."
            />
            <FeatureCard 
              icon={<Bell />}
              title="Instant Alerts"
              description="Get notified when new listings appear in your subscribed areas. Never miss an opportunity."
            />
            <FeatureCard 
              icon={<TrendingUp />}
              title="Sale Results"
              description="Access historical sale data including prices and price per acre."
            />
            <FeatureCard 
              icon={<MapPin />}
              title="Area Coverage"
              description="Subscribe to specific counties or entire states. Pay only for the areas you need."
            />
            <FeatureCard 
              icon={<BarChart3 />}
              title="Comparable Sales"
              description="Find similar sold properties to help you evaluate and make informed decisions."
            />
            <FeatureCard 
              icon={<Clock />}
              title="Auction Reminders"
              description="Set reminders for upcoming auctions so you're always prepared and on time."
            />
          </div>
        </div>
      </section>

      {/* App Preview Section */}
      <section className="py-24 bg-gg-black relative overflow-hidden">
        {/* Background accent */}
        <div className="absolute top-1/2 left-0 w-1/2 h-96 bg-gg-pink/5 rounded-full blur-[150px] -translate-y-1/2" />
        
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Content */}
            <div>
              <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-6">
                Take Ground Goat
                <span className="block text-gradient">With You</span>
              </h2>
              <p className="text-xl text-gg-gray-400 mb-8">
                Download our mobile app to browse auctions, get push notifications, 
                and access your watchlist from anywhere.
              </p>
              <ul className="space-y-4 mb-8">
                <li className="flex items-center gap-3 text-gg-gray-300">
                  <Check className="text-gg-pink" size={20} />
                  Browse upcoming auctions on the go
                </li>
                <li className="flex items-center gap-3 text-gg-gray-300">
                  <Check className="text-gg-pink" size={20} />
                  Get push notifications for new listings
                </li>
                <li className="flex items-center gap-3 text-gg-gray-300">
                  <Check className="text-gg-pink" size={20} />
                  Save properties to your watchlist
                </li>
                <li className="flex items-center gap-3 text-gg-gray-300">
                  <Check className="text-gg-pink" size={20} />
                  View detailed tract information
                </li>
              </ul>
              <div className="flex gap-4">
                <a 
                  href="#" 
                  className="inline-flex items-center gap-2 bg-white text-black font-semibold px-6 py-3 rounded-lg hover:bg-gg-gray-200 transition-colors"
                >
                  <Smartphone size={20} />
                  Download App
                </a>
              </div>
            </div>

            {/* Phone Mockup */}
            <div className="relative flex justify-center">
              <div className="relative w-72 h-[580px] bg-gg-gray-800 rounded-[3rem] border-4 border-gg-gray-700 shadow-2xl overflow-hidden">
                {/* Phone notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gg-gray-700 rounded-b-2xl" />
                {/* Screen content */}
                <div className="absolute inset-2 top-8 bg-gg-gray-900 rounded-[2.5rem] overflow-hidden">
                  <div className="p-4 pt-8">
                    <div className="text-center mb-6">
                      <Image
                        src="/logo.png"
                        alt="Ground Goat"
                        width={120}
                        height={40}
                        className="h-8 w-auto mx-auto"
                      />
                    </div>
                    {/* Mock auction cards */}
                    <div className="space-y-3">
                      <MockListingCard acres="320" county="Adams" state="IL" date="Jan 15" />
                      <MockListingCard acres="156" county="Hancock" state="IL" date="Jan 18" />
                      <MockListingCard acres="80" county="Pike" state="IL" date="Jan 22" />
                    </div>
                  </div>
                </div>
              </div>
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gg-pink/20 rounded-full blur-[100px] -z-10" />
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 bg-gg-gray-900">
        <div className="max-w-7xl mx-auto px-6">
          {/* Section Header */}
          <div className="text-center mb-16">
            <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-xl text-gg-gray-400 max-w-2xl mx-auto">
              Choose the plan that fits your needs. All plans include access to our mobile app.
            </p>
          </div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* County Plan */}
            <div className="card relative">
              <h3 className="font-display text-2xl font-bold text-white mb-2">County</h3>
              <p className="text-gg-gray-400 mb-6">Perfect for focused investors</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-white">$7.99</span>
                <span className="text-gg-gray-400">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  1 county included
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  +$3.99/mo per additional county
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Upcoming auction alerts
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Sale results access
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Mobile app access
                </li>
              </ul>
              <Link href="/signup?plan=county" className="btn-secondary w-full text-center block">
                Get Started
              </Link>
              <p className="text-center text-gg-gray-500 text-sm mt-4">
                Save 10% with annual billing
              </p>
            </div>

            {/* State Plan - Featured */}
            <div className="card relative border-gg-pink glow-pink-sm">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gg-pink text-black text-sm font-semibold px-4 py-1 rounded-full">
                Most Popular
              </div>
              <h3 className="font-display text-2xl font-bold text-white mb-2">State</h3>
              <p className="text-gg-gray-400 mb-6">Best for active land investors</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-white">$19.99</span>
                <span className="text-gg-gray-400">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  1 state included (all counties)
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  +$19.99/mo per additional state
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Everything in County plan
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Priority notifications
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Historical data access
                </li>
              </ul>
              <Link href="/signup?plan=state" className="btn-primary w-full text-center block">
                Get Started
              </Link>
              <p className="text-center text-gg-gray-500 text-sm mt-4">
                Save 10% with annual billing
              </p>
            </div>

            {/* Management Firm Plan */}
            <div className="card relative">
              <h3 className="font-display text-2xl font-bold text-white mb-2">Management Firm</h3>
              <p className="text-gg-gray-400 mb-6">For teams and professionals</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-white">$189.99</span>
                <span className="text-gg-gray-400">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Unlimited states & counties
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Up to 3 team members
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  +$39.99/mo per additional user
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Comparable sales lookup
                </li>
                <li className="flex items-center gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink" size={18} />
                  Priority support
                </li>
              </ul>
              <Link href="/signup?plan=firm" className="btn-secondary w-full text-center block">
                Get Started
              </Link>
              <p className="text-center text-gg-gray-500 text-sm mt-4">
                Save 10% with annual billing
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gg-black relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-gg-gray-900 to-gg-black" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gg-pink/20 rounded-full blur-[150px]" />
        
        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
          <h2 className="font-display text-4xl md:text-6xl font-bold text-white mb-6">
            Ready to Get Started?
          </h2>
          <p className="text-xl text-gg-gray-400 mb-10">
            Join thousands of land investors and professionals who use Ground Goat 
            to stay ahead of the market.
          </p>
          <Link href="/signup" className="btn-primary inline-flex items-center gap-2 text-lg">
            Get Started Now
            <ArrowRight size={20} />
          </Link>
        </div>
      </section>
    </>
  )
}

// Feature Card Component
function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="card group hover:border-gg-pink/50">
      <div className="w-12 h-12 bg-gg-pink/10 rounded-xl flex items-center justify-center text-gg-pink mb-4 group-hover:bg-gg-pink/20 transition-colors">
        {icon}
      </div>
      <h3 className="font-display text-xl font-semibold text-white mb-2">{title}</h3>
      <p className="text-gg-gray-400">{description}</p>
    </div>
  )
}

// Mock Listing Card for Phone
function MockListingCard({ acres, county, state, date }: { acres: string, county: string, state: string, date: string }) {
  return (
    <div className="bg-gg-gray-800 rounded-xl p-3 border border-gg-gray-700">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="text-white font-semibold text-sm">{acres} Acres</p>
          <p className="text-gg-gray-400 text-xs">{county} County, {state}</p>
        </div>
        <span className="text-gg-pink text-xs font-medium">{date}</span>
      </div>
      <div className="flex gap-2">
        <span className="bg-gg-gray-700 text-gg-gray-300 text-xs px-2 py-0.5 rounded">Farm</span>
        <span className="bg-gg-gray-700 text-gg-gray-300 text-xs px-2 py-0.5 rounded">Auction</span>
      </div>
    </div>
  )
}
