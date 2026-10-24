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

  const width = Math.max(50, Math.min(settings.logoSize || 145, 360));
  const posY = settings.logoPositionY || 0;

  if (rawUrl === '') {
    return <div className="my-2 sm:my-3 h-10 shrink-0" />;
  }

  return (
    <div 
      className="w-full flex items-center justify-center my-2 sm:my-3 select-none transition-all duration-300 shrink-0"
      style={{
        transform: `translateY(${posY}px)`,
      }}
    >
      <div className="relative group flex items-center justify-center">
        {/* Subtle violet ambient glow behind logo */}
        <div 
          className="absolute inset-0 rounded-full blur-xl opacity-25 pointer-events-none transition-opacity duration-500 group-hover:opacity-45"
          style={{
            background: 'radial-gradient(circle, rgba(168, 85, 247, 0.65) 0%, transparent 70%)',
            transform: 'scale(1.2)'
          }}
        />

        <img
          key={logoSrc}
          src={logoSrc}
          alt={settings.websiteTitle || 'Portal Emblem'}
          onError={() => setLoadFailed(true)}
          className="relative z-10 object-contain drop-shadow-[0_8px_24px_rgba(168,85,247,0.35)] filter hover:brightness-110 transition-all duration-300"
          style={{
            width: `${width}px`,
            maxHeight: '155px',
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
