import type { Metadata } from 'next'
import Image from 'next/image'

// Screenshot gallery linked from our Expo App Awards 2026 submission
// (the entry form only takes text, so screenshots live here).
export const metadata: Metadata = {
  title: 'Ground Goat | Expo App Awards 2026',
  description: 'Screenshots of the Ground Goat app: tillable, timber and water engine, soil ratings, Goat Search, owner search, live auctions and reports.',
}

const APP_STORE_URL = 'https://apps.apple.com/us/app/ground-goat/id6753321116'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.groundgoat.app'

const SHOTS = [
  { file: '2-quick-draw-tillable-timber-water-acres', caption: 'Quick Draw: outline any area and instantly get tillable, timber and water acres plus the soil rating.' },
  { file: '3-tract-sheet-tillable-and-PI', caption: 'Tap a tract: acres, tillable acres and PI, with 3D, comps, auction and report one tap away.' },
  { file: '4-soil-ratings-map', caption: "Soil ratings across the landscape, with every parcel's owner labeled." },
  { file: '5-goat-search-iowa-csr2', caption: 'Goat Search: "Show all farmland in Iowa with CSR2 greater than 80," answered on the map.' },
  { file: '10-show-owned-ground', caption: 'Show Owned Ground: everything one owner holds, lit up across the county in a tap.' },
  { file: '9-comparable-sales-report', caption: 'Comparable sales report: price per acre, per tillable acre and per soil point, ready to email.' },
  { file: '6-3d-soil-view', caption: 'Any tract in 3D, with soil types draped over the terrain.' },
  { file: '7-home-live-auctions', caption: "Home: today's live auctions and the latest sale results." },
  { file: '8-ground-truth-county-data', caption: 'Ground Truth: county yields, cash rents and land values for every tract.' },
]

export default function ImageGalleryPage() {
  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10 text-center">
          <p className="text-gg-pink font-semibold tracking-widest uppercase text-sm mb-3">Expo App Awards 2026</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">Ground Goat</h1>
          <p className="text-gg-gray-300 text-lg max-w-2xl mx-auto">
            Farmland intelligence for everyone who buys, sells, lends on or appraises land. Built with Expo for iOS and Android.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <a href={APP_STORE_URL} className="px-5 py-2.5 rounded-full bg-gg-pink text-black font-semibold">App Store</a>
            <a href={PLAY_STORE_URL} className="px-5 py-2.5 rounded-full border border-gg-pink text-gg-pink font-semibold">Google Play</a>
          </div>
        </div>

        <figure className="mb-14">
          <Image
            src="/image-gallery/1-engine-tillable-timber-polygons.jpg"
            alt="Engine-drawn tillable and timber polygons on a farm"
            width={2000}
            height={1313}
            sizes="(min-width: 1152px) 1104px, 100vw"
            className="w-full h-auto rounded-2xl border border-white/10"
            priority
          />
          <figcaption className="text-gg-gray-300 text-center mt-4 max-w-3xl mx-auto">
            Our land-cover engine traced every tillable (green) and timber (red) acre on this farm, with no hand drawing.
          </figcaption>
        </figure>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
          {SHOTS.map(({ file, caption }) => (
            <figure key={file} className="flex flex-col items-center">
              <Image
                src={`/image-gallery/${file}.jpg`}
                alt={caption}
                width={462}
                height={1000}
                sizes="320px"
                className="w-full max-w-[320px] h-auto rounded-[2rem] border border-white/10"
              />
              <figcaption className="text-gg-gray-300 text-center text-sm mt-4 max-w-[320px]">{caption}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  )
}
