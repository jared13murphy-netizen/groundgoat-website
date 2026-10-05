import type { MetadataRoute } from 'next'

// robots.txt (owner 2026-10-05). The site had none, so every crawler —
// including the AI-company crawlers that collect training data — read
// whatever is public with no instructions at all.
//
// Production: normal search engines (Google, Bing) and link previews
// (facebookexternalhit, Slackbot, iMessage) keep working, so share links and
// search results are untouched. AI TRAINING crawlers are refused everywhere —
// our auction data is something we may license, not give away. AI *search*
// fetchers (ChatGPT search, Claude/Perplexity answering a user's question)
// are deliberately NOT blocked: they send people to us.
//
// Sandbox (NEXT_PUBLIC_IS_SANDBOX=true): a test site, so nothing may index
// it at all; the AI list is kept so the production rules can be checked here.

const IS_SANDBOX = process.env.NEXT_PUBLIC_IS_SANDBOX === 'true'

// Crawlers that gather data to train AI models (each company's documented
// user-agent). facebookexternalhit is NOT here — it draws share previews.
const AI_TRAINING_BOTS = [
  'GPTBot', // OpenAI
  'ClaudeBot', // Anthropic
  'anthropic-ai', // Anthropic (older token)
  'Google-Extended', // Gemini training (Google Search is unaffected)
  'Applebot-Extended', // Apple Intelligence training (Siri/Spotlight unaffected)
  'CCBot', // Common Crawl — the dataset most AI models start from
  'Bytespider', // ByteDance / TikTok
  'meta-externalagent', // Meta AI
  'FacebookBot', // Meta AI training
  'Amazonbot', // Amazon
  'cohere-ai', // Cohere
  'cohere-training-data-crawler', // Cohere
  'Diffbot', // sells crawled data to AI companies
  'AI2Bot', // Allen Institute
  'Timpibot',
  'omgili', // Webz.io — sells crawled data
  'ImagesiftBot',
]

// Signed-in, admin and one-off pages: nothing a search engine should list.
const PRIVATE_PATHS = [
  '/account',
  '/admin',
  '/api/',
  '/auth',
  '/dev',
  '/access',
  '/configure-map',
  '/map-portfolio',
  '/upgrade',
  '/reset-password',
  '/verify',
  '/unsubscribe',
  '/delete-account',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      IS_SANDBOX
        ? { userAgent: '*', disallow: '/' }
        : { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
      { userAgent: AI_TRAINING_BOTS, disallow: '/' },
    ],
  }
}
