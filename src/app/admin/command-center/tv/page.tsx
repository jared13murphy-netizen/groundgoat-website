'use client'

/* /admin/command-center/tv — the TV wall (owner 11/24). The wall lives
   inside the Command Center page so it shares its live data stream and map;
   this short address just opens it. */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CommandCenterTv() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/command-center?view=tv') }, [router])
  return null
}
