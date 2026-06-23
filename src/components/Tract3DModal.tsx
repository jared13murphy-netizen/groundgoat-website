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
    <div className="fixed inset-0 z-[9999] flex flex-col" style={{ background: '#0a0a0a' }}>
      <div className="flex justify-between items-center px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.15)', background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 40%, rgba(0,0,0,0.3) 100%), rgba(0,0,0,0.4)', backdropFilter: 'blur(40px)' }}>
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
