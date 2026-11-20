/**
 * Google Tag Manager container GTM-M6FXC226 (TEDDYco Media, 11/19).
 *
 * These are Google's OFFICIAL install snippets, unchanged except for JSX
 * syntax: the <script> goes as high in <head> as possible, the <noscript>
 * iframe immediately after the opening <body>. (The snippet in the agency
 * email loaded gtm.js and then set up gtag('js') — a mix of two install
 * methods; Ads/GA4 tags belong inside the container instead.)
 *
 * Server-rendered, and not rendered at all on the sandbox build. Staff
 * browsers skip it (the check wraps the snippet; noscript visitors can't be
 * identified and have no JS for conversions anyway).
 * See src/lib/googleTags.ts for the events the container listens for.
 */

import { GTM_ID, GOOGLE_TAGS_ENABLED } from '@/lib/googleTags'
import { INTERNAL_CHECK_JS } from '@/lib/internalVisitor'

// Google's official snippet, unchanged, run only when this browser is not
// Ground Goat staff (owner 2026-11-20; rule in src/lib/internalVisitor.ts).
const GTM_HEAD_SNIPPET = `(function(){${INTERNAL_CHECK_JS}if(gi)return;
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');
})();`

export function GoogleTagManagerHead() {
  if (!GOOGLE_TAGS_ENABLED) return null
  return <script id="gtm-head" dangerouslySetInnerHTML={{ __html: GTM_HEAD_SNIPPET }} />
}

export function GoogleTagManagerNoScript() {
  if (!GOOGLE_TAGS_ENABLED) return null
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
        height="0"
        width="0"
        style={{ display: 'none', visibility: 'hidden' }}
      />
    </noscript>
  )
}
