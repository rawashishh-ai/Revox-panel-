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
  const resolvedDefaultLogo = '/assets/revox-logo.png?v=120';
  const normalizedUrl =
    !rawUrl ||
    rawUrl === '/assets/revox-logo.png' ||
    rawUrl === '/assets/default-logo.png' ||
    rawUrl.startsWith('/assets/revox-logo.png?')
      ? resolvedDefaultLogo
      : rawUrl;
  const logoSrc = loadFailed ? resolvedDefaultLogo : normalizedUrl;

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
      className="w-full flex items-center justify-center my-0.5 sm:my-1.5 select-none transition-all duration-300 shrink-0"
      style={{
        transform: `translateY(${posY}px)`,
      }}
    >
      <div className="relative group flex items-center justify-center w-full max-w-[340px] sm:max-w-[370px] px-2">
        {/* Controlled Cyber Ice-Blue Ambient Aura (reduced by ~20%) */}
        <div 
          className="absolute inset-0 rounded-full blur-2xl opacity-44 pointer-events-none transition-opacity duration-500 group-hover:opacity-60"
          style={{
            background: 'radial-gradient(circle, rgba(0, 207, 232, 0.38) 0%, rgba(22, 139, 255, 0.19) 45%, transparent 78%)',
            transform: 'scale(1.15)'
          }}
        />

        {/* Inner Cyan Core Backlight (reduced by ~20%) */}
        <div 
          className="absolute w-36 h-36 sm:w-40 sm:h-40 rounded-full blur-xl opacity-36 pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(244, 247, 251, 0.25) 0%, rgba(0, 207, 232, 0.34) 45%, transparent 75%)',
          }}
        />

        <img
          key={logoSrc}
          src={logoSrc}
          alt={settings.websiteTitle || 'REVOX PANEL'}
          onError={() => setLoadFailed(true)}
          className="relative z-10 object-contain animate-revox-logo filter brightness-[1.02] contrast-[1.02] hover:brightness-106 transition-all duration-300"
          style={{
            width: `${width}px`,
            maxWidth: '92vw',
            maxHeight: 'min(248px, 33vh)',
            filter: 'drop-shadow(0 0 13px rgba(0, 207, 232, 0.38)) drop-shadow(0 10px 21px rgba(22, 139, 255, 0.26))',
          }}
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
};
