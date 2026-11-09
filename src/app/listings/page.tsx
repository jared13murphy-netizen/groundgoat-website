import { redirect } from 'next/navigation'

// The Listings page is retired (owner 11/9: it is not supposed to exist).
// Auctions and sales live on the map at /access, which sends anyone without
// the website map (Basic State, no plan) to /account. Server-side redirect so
// old bookmarks never render the old page.
export default function ListingsPageRedirect() {
  redirect('/access')
}
