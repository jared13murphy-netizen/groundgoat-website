import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="bg-gg-gray-900 border-t border-gg-gray-800">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand Column */}
          <div className="md:col-span-1">
            <h3 className="font-display text-3xl font-bold text-gradient mb-4">
              Ground Goat
            </h3>
            <p className="text-gg-gray-400 text-sm leading-relaxed">
              Comprehensive land auction data and property insights for investors, farmers, and land professionals.
            </p>
          </div>

          {/* Product Column */}
          <div>
            <h4 className="text-white font-semibold mb-4">Product</h4>
            <ul className="space-y-3">
              <li>
                <Link href="/#features" className="text-gg-gray-400 hover:text-gg-pink transition-colors text-sm">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/#pricing" className="text-gg-gray-400 hover:text-gg-pink transition-colors text-sm">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/signup" className="text-gg-gray-400 hover:text-gg-pink transition-colors text-sm">
                  Get Started
                </Link>
              </li>
            </ul>
          </div>

          {/* Company Column */}
          <div>
            <h4 className="text-white font-semibold mb-4">Company</h4>
            <ul className="space-y-3">
              <li>
                <Link href="/contact" className="text-gg-gray-400 hover:text-gg-pink transition-colors text-sm">
                  Contact
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-gg-gray-400 hover:text-gg-pink transition-colors text-sm">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-gg-gray-400 hover:text-gg-pink transition-colors text-sm">
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Download Column */}
          <div>
            <h4 className="text-white font-semibold mb-4">Get the App</h4>
            <p className="text-gg-gray-400 text-sm mb-4">
              Download the Ground Goat mobile app
            </p>
            <div className="flex flex-col gap-3">
              <a 
                href="#" 
                className="inline-flex items-center gap-2 bg-gg-gray-800 hover:bg-gg-gray-700 transition-colors px-4 py-2 rounded-lg border border-gg-gray-700"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 22C7.79 22.05 6.8 20.68 5.96 19.47C4.25 17 2.94 12.45 4.7 9.39C5.57 7.87 7.13 6.91 8.82 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/>
                </svg>
                <span className="text-sm font-medium">App Store</span>
              </a>
              <a 
                href="#" 
                className="inline-flex items-center gap-2 bg-gg-gray-800 hover:bg-gg-gray-700 transition-colors px-4 py-2 rounded-lg border border-gg-gray-700"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/>
                </svg>
                <span className="text-sm font-medium">Google Play</span>
              </a>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-gg-gray-800 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-gg-gray-500 text-sm">
            © {new Date().getFullYear()} Ground Goat. All rights reserved.
          </p>
          <p className="text-gg-gray-500 text-sm">
            Carthage, Illinois
          </p>
        </div>
      </div>
    </footer>
  )
}
