import { redirect } from 'next/navigation'

// Old address for the gallery; kept so earlier links still work.
export default function ExpoAwardsRedirect() {
  redirect('/image-gallery')
}
