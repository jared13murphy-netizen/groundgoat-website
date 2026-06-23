import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="mb-12">
          <h1 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">Privacy Policy</h1>
          <p className="text-gg-gray-400">Last Updated: June 10, 2026</p>
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

            <p className="mt-4">We do not collect biometric identifiers or biometric information as defined under the Illinois Biometric Information Privacy Act (740 ILCS 14), including fingerprints, retinal scans, face geometry, or voiceprints.</p>

            <h3 className="font-semibold text-white mt-4 mb-2">Location Information</h3>
            <p>With your permission, we may collect your device's location to surface farmland listings and auction events near you. We collect approximate location (county or region level) rather than continuous precise GPS tracking. Location data is used only to filter and rank content within the Service; it is not sold or shared with third parties for advertising purposes. Location data is retained only for the duration of your session unless you have enabled location-based notifications, in which case we retain your most recently permitted location until you disable that feature or delete your account. You may disable location access at any time through your device settings, which will not affect your ability to use the core features of the Service.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Cookies and Analytics</h2>
            <p>We may use cookies, web beacons, and similar tracking technologies on our website to understand how users interact with our content and to maintain session state. We may use third-party analytics services to collect aggregated, anonymized usage statistics. These services may set their own cookies subject to their own privacy policies. You can control cookie preferences through your browser settings; disabling cookies may affect website functionality.</p>
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
            <p className="mt-4">We do not use your personal information, your usage activity, or any content derived from your use of Ground Goat to train, fine-tune, evaluate, or otherwise improve any artificial intelligence, machine learning, or generative model, whether operated by Ground Goat or any third party. Ground Goat data, listings, maps, soil data, and sale information are also subject to the automated-collection and AI-training prohibitions in our Terms of Service.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Information Sharing</h2>
            <p>We do not sell your personal information. We may share your information with:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Service providers who assist in our operations</li>
              <li>Payment processors for subscription billing</li>
              <li>Law enforcement when required by law</li>
            </ul>
            <p className="mt-4">Our payment processor is Stripe, Inc., which collects billing information (credit card number, billing address) directly from you under Stripe's own privacy policy, available at stripe.com/privacy. We do not store your full payment card details on our servers. For users who subscribe through Apple's App Store, Apple processes your payment directly under Apple's privacy policy. We receive from Apple only confirmation of your subscription status.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Data Security</h2>
            <p>We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the Internet is 100% secure.</p>
            <p className="mt-4"><strong className="text-white">Breach Notification.</strong> In the event of a data breach affecting your personal information, Ground Goat will notify affected users and relevant authorities as required by applicable law, including the Illinois Personal Information Protection Act (815 ILCS 530). We will provide notice within a reasonable time after discovering the breach and will include information about what data was affected and what steps you can take to protect yourself. Notifications will be sent to the email address associated with your account.</p>
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
            <p className="mt-4"><strong className="text-white">California Residents (CCPA/CPRA).</strong> We do not sell or share your personal information with third parties for cross-context behavioral advertising. California residents have the right to: (1) know what personal information we collect and how it is used; (2) request deletion of personal information; (3) correct inaccurate personal information; and (4) not be discriminated against for exercising these rights. To exercise any of these rights, contact us at info@groundgoat.com. We will respond within 45 days as required by law.</p>
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
            <h2 className="font-display text-2xl font-bold text-white mb-4">Data Accuracy and Financial Decisions</h2>
            <p>Information available through Ground Goat — including acreage, soil ratings, estimated values, and sale data — is compiled from third-party and public sources and may be incomplete or inaccurate. It is provided for informational purposes only and must not be used as the sole basis for any financial, investment, or real estate decision. See our Terms of Service for full accuracy disclaimers.</p>
          </section>

          <section>
            <p>This Privacy Policy is governed by and construed in accordance with the laws of the State of Illinois. Any dispute arising from this Privacy Policy is subject to the exclusive jurisdiction of the state and federal courts located in Illinois.</p>
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
