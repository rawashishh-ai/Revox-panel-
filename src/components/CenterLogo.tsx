import React, { useState, useEffect } from 'react';
import { SiteSettings } from '../types';

interface CenterLogoProps {
  settings: SiteSettings;
}

export const CenterLogo: React.FC<CenterLogoProps> = ({ settings }) => {
  const [loadFailed, setLoadFailed] = useState(false);

  // Reset loadFailed whenever logoUrl changes so a newly uploaded logo always renders
  useEffect(() => {
    setLoadFailed(false);
  }, [settings.logoUrl]);

  const rawUrl = settings.logoUrl;
  const isDefaultLogo = !rawUrl || rawUrl === '/assets/default-logo.png';
  const logoSrc = loadFailed ? '/assets/default-logo.png' : (rawUrl || '/assets/default-logo.png');

  // Prominently sized logo covering the central area (290px default, responsive up to 340px)
  const rawSize = settings.logoSize;
  const configuredSize = typeof rawSize === 'number' && rawSize >= 240 ? rawSize : 290;
  const width = Math.max(220, Math.min(configuredSize, 420));
  const posY = settings.logoPositionY || 0;

  if (rawUrl === '') {
    return <div className="my-2 sm:my-3 h-10 shrink-0" />;
  }

  return (
    <div 
      className="w-full flex items-center justify-center my-1 sm:my-2 select-none transition-all duration-300 shrink-0"
      style={{
        transform: `translateY(${posY}px)`,
      }}
    >
      <div className="relative group flex items-center justify-center w-full max-w-[340px] sm:max-w-[370px] px-2">
        {/* Glowing violet ambient back-glow aura */}
        <div 
          className="absolute inset-0 rounded-full blur-2xl opacity-50 pointer-events-none transition-opacity duration-500 group-hover:opacity-75"
          style={{
            background: 'radial-gradient(circle, rgba(168, 85, 247, 0.85) 0%, rgba(139, 92, 246, 0.35) 45%, transparent 75%)',
            transform: 'scale(1.2)'
          }}
        />

        <img
          key={logoSrc}
          src={logoSrc}
          alt={settings.websiteTitle || 'Portal Emblem'}
          onError={() => setLoadFailed(true)}
          className="relative z-10 object-contain drop-shadow-[0_12px_40px_rgba(168,85,247,0.55)] filter hover:brightness-110 transition-all duration-300"
          style={{
            width: `${width}px`,
            maxWidth: '92vw',
            maxHeight: 'min(240px, 32vh)',
            filter: (isDefaultLogo || loadFailed)
              ? 'hue-rotate(275deg) brightness(1.12) saturate(1.28)'
              : 'none',
          }}
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
};
