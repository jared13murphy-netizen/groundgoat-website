'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app';

function Terrain3DContent() {
  const searchParams = useSearchParams();
  const tractId = searchParams.get('tractId') || '';
  const token = searchParams.get('token') || '';
  
  const iframeSrc = `/3d-viewer.html?tractId=${tractId}&token=${token}&apiUrl=${encodeURIComponent(API_URL)}`;

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
