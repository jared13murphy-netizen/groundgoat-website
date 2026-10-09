'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, X } from 'lucide-react'

// Served from CloudFront (S3: groundgoat-marketing-images/marketing/site/promo).
// Deliberately NOT in public/ — the website container on gg-app-1 also serves
// signed-in subscriber traffic and shouldn't stream a 17MB file per visitor.
const CDN = 'https://d2bkrll2m6lapl.cloudfront.net/marketing/site/promo'
const VIDEO_SRC = `${CDN}/gg-promo-1080.mp4`
const POSTER_SRC = `${CDN}/gg-promo-poster.jpg`

/**
 * Promo video band that sits directly under the hero, above the feature
 * grid. Nothing but the poster loads until the visitor presses play.
 */
export function PromoVideoSection() {
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const sectionRef = useRef<HTMLElement>(null)

  // True when playback was started by the #watch deep link rather than a
  // click. Browsers refuse an unmuted play() that no gesture asked for, so
  // the automatic path mutes first — the native controls hand the sound back.
  const autoStarted = useRef(false)

  const start = (auto = false) => {
    autoStarted.current = auto
    setPlaying(true)
  }

  // Play once the <video> is actually in the DOM. Doing this in an effect
  // rather than a rAF callback is what makes the deep link reliable: on a
  // cold load the ref is still empty a frame after setPlaying.
  useEffect(() => {
    if (!playing) return
    const video = videoRef.current
    if (!video) return
    video.muted = autoStarted.current
    // Don't steal focus on the automatic path — the visitor is still reading.
    if (!autoStarted.current) video.focus()
    video.play().catch(() => setPlaying(false))
  }, [playing])

  // Arriving on groundgoat.com/#watch (the link in our outreach email) scrolls
  // the band into view and starts it muted.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash !== '#watch') return
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    start(true)
  }, [])

  return (
    <section
      ref={sectionRef}
      id="watch"
      className="py-24 bg-gg-black relative overflow-hidden scroll-mt-20"
    >
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-gg-pink/10 rounded-full blur-[150px]" />

      <div className="relative z-10 max-w-5xl mx-auto px-6">
        <div className="text-center mb-10">
          <span className="inline-block text-gg-pink text-sm font-semibold tracking-wide uppercase mb-3">
            Watch — 39 seconds
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">
            Land Auctions
            <span className="block text-gradient">Shouldn&apos;t Be Hard</span>
          </h2>
          <p className="text-xl text-gg-gray-400 max-w-2xl mx-auto">
            See what Ground Goat puts in front of you — every auction, every sale, every acre.
          </p>
        </div>

        <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black group">
          {playing ? (
            <video
              ref={videoRef}
              src={VIDEO_SRC}
              poster={POSTER_SRC}
              controls
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <button
              onClick={() => start()}
              aria-label="Play the Ground Goat video"
              className="absolute inset-0 w-full h-full"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={POSTER_SRC}
                alt="Aerial view of Midwest farmland"
                className="w-full h-full object-cover"
              />
              <span className="absolute inset-0 bg-black/25 group-hover:bg-black/10 transition-colors" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-20 h-20 rounded-full bg-gg-pink text-black flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                  <Play size={32} className="ml-1" fill="currentColor" />
                </span>
              </span>
            </button>
          )}
        </div>
      </div>
    </section>
  )
}


/**
 * "What is Ground Goat?" — a plain pink button that opens the same promo
 * video in a pop-up (owner 9/29, for the signup page). The native controls
 * give pause/scrub; the X, the backdrop and Esc close it. Nothing is fetched
 * until the button is pressed. Closing unmounts the <video>, which stops
 * playback and drops the download.
 */
export function WhatIsGroundGoatButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    // Autoplay with sound is only allowed because it follows the click.
    requestAnimationFrame(() => { videoRef.current?.play().catch(() => {}) })
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gg-pink/40 bg-gg-pink/10 text-gg-pink text-sm font-semibold hover:bg-gg-pink/20 transition ${className}`}
      >
        <Play size={14} fill="currentColor" />
        What is Ground Goat?
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="What is Ground Goat video"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black"
          >
            <video
              ref={videoRef}
              src={VIDEO_SRC}
              poster={POSTER_SRC}
              controls
              playsInline
              className="w-full h-full object-contain"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close video"
              className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
