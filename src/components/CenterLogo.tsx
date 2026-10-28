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
    return <div className="my-1 h-6 shrink-0" />;
  }

  return (
    <div className="w-full flex items-center justify-center py-0.5 select-none shrink-0 overflow-hidden">
      <div className="relative group flex items-center justify-center w-full max-w-[320px] sm:max-w-[350px] px-2">
        {/* Controlled Cyber Ice-Blue Ambient Aura (contained so it never causes horizontal overflow) */}
        <div
          className="
            absolute w-44 h-44 sm:w-48 sm:h-48 rounded-full blur-2xl opacity-44
            pointer-events-none transition-opacity duration-500 group-hover:opacity-60
          "
          style={{
            background:
              'radial-gradient(circle, rgba(0, 207, 232, 0.38) 0%, rgba(22, 139, 255, 0.19) 45%, transparent 78%)'
          }}
        />

        {/* Inner Cyan Core Backlight */}
        <div
          className="absolute w-32 h-32 sm:w-36 sm:h-36 rounded-full blur-xl opacity-36 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, rgba(244, 247, 251, 0.25) 0%, rgba(0, 207, 232, 0.34) 45%, transparent 75%)'
          }}
        />

        <img
          key={logoSrc}
          src={logoSrc}
          alt={settings.websiteTitle || 'REVOX PANEL'}
          onError={() => setLoadFailed(true)}
          className="relative z-10 block w-auto h-auto object-contain animate-revox-logo filter brightness-[1.02] contrast-[1.02] hover:brightness-106 transition-all duration-300"
          style={{
            width: `clamp(190px, 60vw, ${maxLogoPx}px)`,
            maxHeight: 'clamp(170px, 27svh, 235px)',
            filter:
              'drop-shadow(0 0 13px rgba(0, 207, 232, 0.38)) drop-shadow(0 10px 21px rgba(22, 139, 255, 0.26))'
          }}
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
};
