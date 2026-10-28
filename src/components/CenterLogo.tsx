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

  // Prominently sized logo covering the central area without causing vertical gaps or overflow
  const rawSize = settings.logoSize;
  const configuredSize = typeof rawSize === 'number' && rawSize >= 200 ? rawSize : 260;
  const maxLogoPx = Math.max(200, Math.min(configuredSize, 290));

  if (rawUrl === '') {
    return <div className="my-0.5 h-2 shrink-0" />;
  }

  return (
    <div className="w-full py-1 flex items-center justify-center select-none flex-1 min-h-0">
      <div className="relative group flex items-center justify-center w-full max-w-[270px] sm:max-w-[290px] px-2">
        {/* Controlled Cyber Ice-Blue Ambient Aura */}
        <div
          className="
            absolute w-44 h-44 sm:w-52 sm:h-52 rounded-full blur-2xl opacity-50
            pointer-events-none transition-opacity duration-500 group-hover:opacity-70
          "
          style={{
            background:
              'radial-gradient(circle, rgba(0, 207, 232, 0.45) 0%, rgba(22, 139, 255, 0.22) 50%, transparent 75%)'
          }}
        />

        {/* Inner Cyan Core Backlight */}
        <div
          className="absolute w-32 h-32 sm:w-36 sm:h-36 rounded-full blur-xl opacity-45 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(244, 247, 251, 0.3) 0%, rgba(0, 207, 232, 0.4) 45%, transparent 75%)'
          }}
        />

        <img
          key={logoSrc}
          src={logoSrc}
          alt={settings.websiteTitle || 'REVOX PANEL'}
          onError={() => setLoadFailed(true)}
          className="relative z-10 block w-auto h-auto object-contain animate-revox-logo filter brightness-[1.03] contrast-[1.03] hover:brightness-108 transition-all duration-300"
          style={{
            maxWidth: 'min(78vw, 250px)',
            maxHeight: '230px',
            filter:
              'drop-shadow(0 0 16px rgba(0, 207, 232, 0.42)) drop-shadow(0 10px 24px rgba(22, 139, 255, 0.32))'
          }}
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
};
