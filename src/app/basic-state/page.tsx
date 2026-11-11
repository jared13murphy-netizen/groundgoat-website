import type { Metadata } from 'next'
import PlanLanding from '@/components/PlanLanding'
import { PLAN_LANDING } from '@/config/planLanding'

const c = PLAN_LANDING.basic_state

// Landing page for this plan (owner 11/11): advertised directly, and
// where the homepage pricing card's button goes before signup.
export const metadata: Metadata = {
  title: c.pageTitle,
  description: c.metaDescription,
  openGraph: { title: c.pageTitle, description: c.metaDescription },
}

export default function Page() {
  return <PlanLanding plan="basic_state" />
}
