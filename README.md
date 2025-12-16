# Ground Goat Website

A Next.js website for Ground Goat - Land Auction Intelligence.

## Pages

- **/** - Home (marketing page with features, pricing)
- **/signup** - New user registration with plan selection
- **/signin** - User login
- **/contact** - Contact form
- **/terms** - Terms of Service
- **/privacy** - Privacy Policy
- **/account** - User account management (authenticated)
- **/admin/dashboard** - Admin dashboard (admin only)
- **/admin/scraper** - Scraper interface (admin only)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local`:
```env
NEXT_PUBLIC_API_URL=https://practical-serenity-production.up.railway.app
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
```

3. Run development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## Deployment to Vercel

1. Push this folder to a GitHub repository

2. Go to [vercel.com](https://vercel.com) and import the repository

3. Add environment variables in Vercel dashboard

4. Deploy!

5. In GoDaddy, update DNS to point groundgoat.com to Vercel:
   - Add a CNAME record: `www` → `cname.vercel-dns.com`
   - Add an A record: `@` → `76.76.21.21`

## Brand Colors

- Primary Pink: #f58cde
- Light Pink: #f8daf1
- Dark Pink: #c563ad
- Background: #0a0a0a
- Card Background: #1a1a1a

## Fonts

- Display: Playfair Display
- Body: DM Sans
