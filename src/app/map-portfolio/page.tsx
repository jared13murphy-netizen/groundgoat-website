'use client'

/**
 * Retired: projects and maps now live in the Saved Projects panel on the
 * Explore map. Old links land there; ?project=<id> opens that project.
 */
import { useEffect } from 'react'

export default function RetiredPage() {
  useEffect(() => {
    const project = new URLSearchParams(window.location.search).get('project')
    window.location.replace(project ? `/access?project=${encodeURIComponent(project)}` : '/access')
  }, [])
  return null
}
