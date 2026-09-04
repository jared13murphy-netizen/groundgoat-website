'use client'

import { useRef, useState } from 'react'
import { Play } from 'lucide-react'

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

  const start = () => {
    setPlaying(true)
    // Wait for the video element to mount before asking it to play. Move
    // focus onto it so keyboard users land on the native controls instead
    // of losing their place when the play button unmounts; if play() is
    // refused, fall back to the poster so there's still a way in.
    requestAnimationFrame(() => {
      const video = videoRef.current
      if (!video) return
      video.focus()
      video.play().catch(() => setPlaying(false))
    })
  }

  return (
    <section className="py-24 bg-gg-black relative overflow-hidden">
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
              onClick={start}
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
