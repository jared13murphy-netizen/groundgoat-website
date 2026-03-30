'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function Terrain3DContent() {
  const searchParams = useSearchParams();
  const tractId = searchParams.get('tractId') || '';
  const token = searchParams.get('token') || '';
  
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app';
  const iframeSrc = `${apiUrl}/static/3d-viewer.html?tractId=${tractId}&token=${token}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1a1a', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => window.history.back()}
          style={{ color: '#fff', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center' }}
        >
          ← Back
        </button>
      </div>
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
    <Suspense fallback={<div style={{ background: '#1a1a1a', color: '#888', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>}>
      <Terrain3DContent />
    </Suspense>
  );
}
