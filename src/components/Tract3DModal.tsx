'use client';

interface Tract3DModalProps {
  tractId: string;
  tractName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function Tract3DModal({ tractId, tractName, isOpen, onClose }: Tract3DModalProps) {
  if (!isOpen) return null;

  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : '';
  const url = `/3d-terrain?tractId=${tractId}&token=${token}`;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col" style={{ background: 'linear-gradient(145deg, #0a0a14 0%, #12121f 30%, #0d0d1a 60%, #0a0a12 100%)' }}>
      <div className="flex justify-between items-center px-6 py-4" style={{ borderBottom: '1px solid rgba(233,30,140,0.12)', background: 'rgba(14,14,24,0.85)', backdropFilter: 'blur(20px)' }}>
        <h2 className="text-white text-lg font-semibold">{tractName || '3D Terrain Viewer'}</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-2xl font-light transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-800"
        >
          ✕
        </button>
      </div>
      <iframe
        src={url}
        className="flex-1 w-full border-0"
        allow="fullscreen"
        title="3D Terrain Viewer"
      />
    </div>
  );
}
