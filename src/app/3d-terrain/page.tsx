'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function Terrain3DContent() {
  const searchParams = useSearchParams();
  const tractId = searchParams.get('tractId') || '';
  const token = searchParams.get('token') || '';
  
  // Serve through authenticated API route
  const iframeSrc = `/api/3d-viewer?tractId=${tractId}&token=${token}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1a1a', zIndex: 99999, display: 'flex', flexDirection: 'column' }}>
      <iframe
        src={iframeSrc}
        style={{ flex: 1, width: '100%', border: 'none' }}
        allow="fullscreen"
        title="3D Terrain Viewer"
      />
    </div>
  );
}

export default function Terrain3DPage() {
  return (
    <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#1a1a1a', zIndex: 99999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}><p style={{ color: '#888' }}>Loading...</p></div>}>
      <Terrain3DContent />
    </Suspense>
  );
}
