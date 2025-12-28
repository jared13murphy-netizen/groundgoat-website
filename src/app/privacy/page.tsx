import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="mb-12">
          <h1 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">Privacy Policy</h1>
          <p className="text-gg-gray-400">Last Updated: December 28, 2025</p>
        </div>

        <div className="space-y-8 text-gg-gray-300">
          <section>
            <p className="text-lg">Ground Goat ("we," "us," or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application and website.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Information We Collect</h2>
            <h3 className="font-semibold text-white mt-4 mb-2">Personal Information</h3>
            <p>When you create an account, we collect:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Name (first and last)</li>
              <li>Email address</li>
              <li>Phone number (optional)</li>
              <li>Billing information for subscriptions</li>
            </ul>

            <h3 className="font-semibold text-white mt-4 mb-2">Usage Information</h3>
            <p>We automatically collect certain information when you use the App:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Device information (type, operating system)</li>
              <li>App usage patterns and preferences</li>
              <li>Listings viewed and saved</li>
              <li>Search queries and filters used</li>
            </ul>

            <h3 className="font-semibold text-white mt-4 mb-2">Location Information</h3>
            <p>With your permission, we may collect your location to provide relevant local auction listings. You can disable location services at any time through your device settings.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Provide and maintain our services</li>
              <li>Process your subscription and payments</li>
              <li>Send you notifications about auctions in your areas</li>
              <li>Improve and personalize your experience</li>
              <li>Respond to your inquiries and support requests</li>
              <li>Send important updates about the service</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Information Sharing</h2>
            <p>We do not sell your personal information. We may share your information with:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Service providers who assist in our operations</li>
              <li>Payment processors for subscription billing</li>
              <li>Law enforcement when required by law</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Data Security</h2>
            <p>We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the Internet is 100% secure.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Data Retention</h2>
            <p>We retain your personal information for as long as your account is active or as needed to provide you services. You may request deletion of your account and associated data at any time by contacting us.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Access your personal information</li>
              <li>Correct inaccurate information</li>
              <li>Request deletion of your information</li>
              <li>Opt out of marketing communications</li>
              <li>Export your data in a portable format</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Third-Party Services</h2>
            <p>Our App may contain links to third-party websites or services. We are not responsible for the privacy practices of these third parties. We encourage you to review their privacy policies before providing any personal information.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Children's Privacy</h2>
            <p>Our service is not intended for users under the age of 18. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last Updated" date.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Contact Us</h2>
            <p>If you have any questions about this Privacy Policy, please contact us at: <a href="mailto:info@groundgoat.com" className="text-gg-pink hover:underline">info@groundgoat.com</a></p>
            <div className="mt-4">
              <p className="font-semibold text-white">Ground Goat</p>
              <p>Carthage, Illinois</p>
            </div>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gg-gray-800">
          <Link href="/" className="text-gg-pink hover:underline">← Back to Home</Link>
        </div>
      </div>
    </div>
  )
}
