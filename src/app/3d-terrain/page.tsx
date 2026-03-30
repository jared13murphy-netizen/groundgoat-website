'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

function Terrain3DRedirect() {
  const searchParams = useSearchParams();
  const tractId = searchParams.get('tractId') || '';
  const token = searchParams.get('token') || '';
  
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app';

  useEffect(() => {
    // Redirect directly to the 3D viewer - no iframe, no header
    window.location.replace(`${apiUrl}/static/3d-viewer.html?tractId=${tractId}&token=${token}`);
  }, [tractId, token, apiUrl]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1a1a', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 99999 }}>
      <p style={{ color: '#888' }}>Loading 3D terrain...</p>
    </div>
  );
}

export default function Terrain3DPage() {
  return (
    <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#1a1a1a', zIndex: 99999 }} />}>
      <Terrain3DRedirect />
    </Suspense>
  );
}
