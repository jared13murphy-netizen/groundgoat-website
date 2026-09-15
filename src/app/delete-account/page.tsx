import Link from 'next/link'

export const metadata = {
  title: 'Delete Your Ground Goat Account',
  description: 'How to delete your Ground Goat account and the data we remove when you do.',
}

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="mb-12">
          <h1 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">Delete Your Ground Goat Account</h1>
          <p className="text-gg-gray-400">Ground Goat, Inc. · Last Updated: September 9, 2026</p>
        </div>

        <div className="space-y-8 text-gg-gray-300">
          <section>
            <p className="text-lg">
              You can delete your Ground Goat account and the personal data associated with it at any time. Deletion is
              permanent and cannot be undone. This applies to the Ground Goat mobile app (iOS and Android) and the
              Ground Goat website.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Option 1: Delete from the website</h2>
            <ol className="list-decimal list-inside space-y-2">
              <li>Sign in at <Link href="/account" className="text-gg-green hover:underline">www.groundgoat.com/account</Link>.</li>
              <li>Scroll to the bottom of the Account page and click <span className="text-white">Delete Account</span>.</li>
              <li>Confirm the deletion in the dialog. Your account is deleted immediately.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Option 2: Delete from the mobile app</h2>
            <ol className="list-decimal list-inside space-y-2">
              <li>Open the Ground Goat app and go to your <span className="text-white">Profile</span>.</li>
              <li>Tap <span className="text-white">Edit Profile</span>, then tap <span className="text-white">Delete Account</span>.</li>
              <li>Confirm the deletion. Your account is deleted immediately.</li>
            </ol>
            <p className="mt-4">
              If you have an active subscription, cancel it first (through the Ground Goat website, the App Store, or
              Google Play, depending on where you subscribed). The app will guide you to the right place.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">Option 3: Email us</h2>
            <p>
              If you cannot sign in, email <a href="mailto:info@groundgoat.com" className="text-gg-green hover:underline">info@groundgoat.com</a> from
              the email address on your account with the subject line &quot;Delete my account&quot;. We will confirm your
              identity and delete the account within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">What is deleted</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Your name, email address, phone number, and password</li>
              <li>Your saved counties, saved listings, filters, and notification preferences</li>
              <li>Your push-notification device tokens</li>
              <li>Your Goat Search history and app crash reports tied to your account</li>
              <li>Comparable sales reports, map projects, and portfolios you created</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">What is kept, and for how long</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Subscription payment records required for tax and accounting purposes are retained by our payment processor for up to 7 years, as required by law. These records do not include your password or app activity.</li>
              <li>Server logs that may contain your account ID are deleted automatically within 90 days.</li>
              <li>Public land-sale and auction data shown in Ground Goat is not personal data and is not affected by account deletion.</li>
            </ul>
          </section>

          <section>
            <p>
              Questions? Read our <Link href="/privacy" className="text-gg-green hover:underline">Privacy Policy</Link> or
              contact <a href="mailto:info@groundgoat.com" className="text-gg-green hover:underline">info@groundgoat.com</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
