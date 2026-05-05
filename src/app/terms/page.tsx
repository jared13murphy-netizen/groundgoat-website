import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="mb-12">
          <h1 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">Terms of Service</h1>
          <p className="text-gg-gray-400">Last Updated: May 4, 2026</p>
        </div>

        <div className="space-y-8 text-gg-gray-300">
          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">1. Acceptance of Terms</h2>
            <p>By creating an account, accessing, or otherwise using Ground Goat — including the website at groundgoat.com, our mobile application, and any related APIs, exports, embeds, downloads, or printed reports (together, the &quot;Service&quot;) — you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">2. Description of Service</h2>
            <p>Ground Goat aggregates, normalizes, and enriches information about farmland sales — auction listings, private treaty offerings, sale results, comparable transactions, parcel boundaries, soil and topography data, and related insights. The data presented through the Service is compiled and enriched at significant cost from public records, partner feeds, our own data-collection systems, and proprietary processing.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">3. License Grant</h2>
            <p>Subject to your compliance with these Terms and timely payment of any applicable fees, Ground Goat grants you a personal, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Service for your own internal evaluation of farmland transactions and investment decisions. No other rights or licenses are granted, expressly or by implication.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">4. Account Use Is Personal</h2>
            <p>Each Ground Goat account is intended for use by a single individual. You may not share your login credentials, access tokens, biometric or session data with any other person. If your subscription is purchased by an employer or organization, the named user remains the only person permitted to use the credentials. Allowing a person who has not paid for their own Ground Goat access to view, search, or otherwise interact with the Service through your account — including by screen-share, screen-recording, remote-desktop session, or any indirect means — is a material breach of these Terms.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">5. Prohibited Uses of Ground Goat Data</h2>
            <p>You will not, and will not permit or assist any third party to:</p>
            <ul className="list-disc pl-6 mt-4 space-y-3">
              <li><strong className="text-white">Scrape, crawl, or harvest data from the Service</strong> through any automated means. This includes bots, headless browsers, scripts, scraping frameworks, autonomous AI agents, training pipelines, or any tool designed to retrieve content faster or more comprehensively than a human user reasonably would. Scripted use of the human interface to bypass this restriction is treated as scraping.</li>
              <li><strong className="text-white">Use the Service or data obtained from it to train, fine-tune, evaluate, retrieve-augment, embed, or otherwise improve any artificial-intelligence, machine-learning, or generative model</strong>, whether for your own use or for the benefit of any third party.</li>
              <li><strong className="text-white">Republish, redistribute, syndicate, sell, license, sublicense, or otherwise make available our data</strong> — in whole or in any meaningful part — in printed, digital, embedded, or feed form, or in any way that lets a person who has not paid for their own Ground Goat subscription view, search, or analyze the data.</li>
              <li><strong className="text-white">Use the Service on behalf of, or to deliver insights to, a client, employer, prospect, customer, lender, broker, or other third party</strong>, or as part of a paid consulting, brokerage, or expert-witness engagement, unless every individual who will receive Ground Goat-derived information independently maintains their own paid Ground Goat subscription that covers such use.</li>
              <li><strong className="text-white">Build, market, or operate any product or service that competes with Ground Goat</strong> using data, structure, methodology, or insights derived from the Service.</li>
              <li><strong className="text-white">Reverse engineer, decompile, disassemble, or attempt to derive</strong> the source code, model weights, data schemas, or underlying algorithms of the Service, or attempt to circumvent any technical, contractual, or rate-limiting control.</li>
              <li><strong className="text-white">Bulk-export, cache, archive, or warehouse data from the Service</strong> beyond what is reasonably necessary for your immediate, on-screen review of an active listing or comparable. Storing extracts of our data on your own servers, databases, file shares, or any system intended for later retrieval is prohibited.</li>
              <li><strong className="text-white">Display Ground Goat data on any map, dashboard, embed, report, or other interface visible to people who have not paid for their own access</strong> in a way that lets those viewers see, copy, search, or reconstruct any non-trivial portion of our parcel boundaries, ownership records, sale data, or comparables. Sharing a single screenshot or printout of one specific listing for your own review is permitted; anything broader is not.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">6. Data Ownership</h2>
            <p>All content delivered through the Service — including the underlying data, the database structure, normalization layer, comparables algorithms, polygon data, satellite renderings, soil overlays, NASS-derived metrics, owner-name data, parcel-overlay tiles, and our compilations of public records — is owned by Ground Goat or licensed to Ground Goat by third parties. The selection, arrangement, and enrichment of public-record data is itself protected as a database compilation under applicable law. No rights are transferred to you under these Terms.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">7. Acceptable Use of the Network</h2>
            <p>You will not interfere with or disrupt the Service, attempt to access any account other than your own, probe for vulnerabilities, or send traffic intended to overload our servers. You will not use the Service for any unlawful purpose or in violation of any applicable export, sanction, or trade-control law.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">8. Subscription and Billing</h2>
            <p>Some features require a paid subscription. By subscribing, you authorize Ground Goat to charge your payment method at the start of each billing period. Subscriptions automatically renew at the then-current rate unless cancelled before the renewal date. Annual subscriptions receive a 10% discount versus the equivalent monthly rate. Refunds are at Ground Goat&apos;s discretion and are not customary except where required by law.</p>
            <ul className="list-disc list-inside mt-4 space-y-2">
              <li>County subscriptions starting at $7.99/month</li>
              <li>State subscriptions starting at $19.99/month</li>
              <li>Management Firm subscriptions at $199.99/month</li>
              <li>Annual billing provides a 10% discount</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">9. Information Accuracy</h2>
            <p>Ground Goat compiles data from many sources and applies significant enrichment. Despite our best efforts, the data may contain errors, omissions, lag, or interpretive judgments. You should independently verify any information before making a financial or transactional decision. Ground Goat makes no warranty of accuracy, completeness, fitness for a particular purpose, or fitness for any specific transaction. You assume all risk for decisions made on the basis of information provided through the Service.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">10. Images and Property Content</h2>
            <p>Property images displayed on the Service may not always be representative of the actual parcel. Where no image is available from the original source, a stock or rendered placeholder may be used. Always refer to the original listing source for definitive property images and details before relying on any image for a decision.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">11. Termination and Consequences of Breach</h2>
            <p>Ground Goat may suspend or terminate your account immediately, without prior notice, refund, or liability, if we determine in our sole discretion that you have violated these Terms — particularly Sections 4 and 5. Upon any termination for breach related to data use, you must:</p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              <li>immediately stop accessing the Service;</li>
              <li>delete all data, exports, screenshots, derivative datasets, and any models trained or fine-tuned on Ground Goat data that remain in your possession or under your control; and</li>
              <li>certify the deletion to us in writing on request.</li>
            </ul>
            <p className="mt-4">In addition to termination, Ground Goat reserves all legal and equitable remedies, including monetary damages, injunctive relief, and recovery of reasonable attorneys&apos; fees. The parties acknowledge that misuse of Ground Goat data causes irreparable harm and that injunctive relief is an appropriate remedy.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">12. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, Ground Goat, its officers, directors, employees, contractors, and affiliates will not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for any loss of profits, revenue, data, or business opportunity, arising out of or related to your use of the Service. Ground Goat&apos;s total cumulative liability for direct claims arising from these Terms or the Service will not exceed the fees you actually paid Ground Goat in the twelve months preceding the claim.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">13. Indemnification</h2>
            <p>You agree to indemnify, defend, and hold harmless Ground Goat and its officers, directors, employees, contractors, and affiliates from any claim, loss, liability, damage, or expense (including reasonable attorneys&apos; fees) arising out of or related to (a) your use or misuse of the Service, (b) your violation of these Terms, (c) your violation of any law or third-party right, or (d) any data, content, or material you supply to the Service.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">14. Modifications</h2>
            <p>We may update these Terms from time to time. The &quot;Last Updated&quot; date at the top of this page reflects the most recent revision. Material changes will be communicated via the Service or by email. Continued use of the Service after a change constitutes your acceptance of the updated Terms.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">15. Governing Law and Dispute Resolution</h2>
            <p>These Terms are governed by the laws of the State of Illinois, without regard to its conflict-of-law principles. The state and federal courts located in Illinois have exclusive jurisdiction over any dispute arising from or related to these Terms, and you consent to personal jurisdiction in those courts.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-white mb-4">16. Contact</h2>
            <p>If you have questions about these Terms, contact us at: <a href="mailto:info@groundgoat.com" className="text-gg-pink hover:underline">info@groundgoat.com</a></p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gg-gray-800">
          <Link href="/" className="text-gg-pink hover:underline">← Back to Home</Link>
        </div>
      </div>
    </div>
  )
}
