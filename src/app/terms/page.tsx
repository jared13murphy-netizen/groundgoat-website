import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="mb-12">
          <h1 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">Terms of Service</h1>
          <p className="text-gg-gray-400">Last Updated: December 2024</p>
        </div>

        <div className="space-y-8 text-gg-gray-300">
          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">1. Acceptance of Terms</h2>
            <p>By accessing or using the Ground Goat mobile application and related services, you agree to be bound by these Terms of Service. If you do not agree to these Terms, please do not use our services.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">2. Description of Service</h2>
            <p>Ground Goat provides land auction and property listing information services, including auction listings, sale results, and comparable property data. Our service aggregates publicly available information from various auction companies and listing services.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">3. User Accounts</h2>
            <p>To access certain features, you must create an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">4. Subscription and Billing</h2>
            <p>Some features require a paid subscription. By subscribing, you agree to pay all fees associated with your subscription plan. Subscriptions automatically renew unless cancelled before the renewal date.</p>
            <ul className="list-disc list-inside mt-4 space-y-2">
              <li>County subscriptions start at $7.99/month</li>
              <li>State subscriptions start at $29.99/month</li>
              <li>Management Firm subscriptions are $189.99/month</li>
              <li>Annual billing provides a 10% discount</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">5. Acceptable Use</h2>
            <p>You agree not to use the service for any unlawful purpose, attempt unauthorized access, reproduce or resell any part of the service, use automated systems without permission, or interfere with the service.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">6. Information Accuracy</h2>
            <p>While we strive to provide accurate information, we do not warrant the accuracy, completeness, or reliability of any information provided. Users should verify all information independently before making decisions.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">7. Intellectual Property</h2>
            <p>The App and its original content, features, and functionality are owned by Ground Goat and are protected by international copyright, trademark, and other intellectual property laws.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">8. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, Ground Goat shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the service.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">9. Termination</h2>
            <p>We may terminate or suspend your account immediately, without prior notice, for any reason, including breach of these Terms.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">10. Governing Law</h2>
            <p>These Terms shall be governed by and construed in accordance with the laws of the State of Illinois.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">11. Contact Us</h2>
            <p>If you have questions about these Terms, contact us at: <a href="mailto:no-reply@groundgoat.com" className="text-gg-pink hover:underline">no-reply@groundgoat.com</a></p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gg-gray-800">
          <Link href="/" className="text-gg-pink hover:underline">← Back to Home</Link>
        </div>
      </div>
    </div>
  )
}
