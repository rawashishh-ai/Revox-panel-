import React from 'react';
import { SiteSettings, Language } from '../types';
import { translations } from '../translations';

interface AnnouncementCardProps {
  settings: SiteSettings;
  lang: Language;
  onOpenGetKeyChoice?: () => void;
}

export const AnnouncementCard: React.FC<AnnouncementCardProps> = ({
  settings,
  lang,
  onOpenGetKeyChoice
}) => {
  const t = translations[lang];

  const handleGetKeyButtonClick = () => {
    if (onOpenGetKeyChoice) {
      onOpenGetKeyChoice();
      return;
    }
    handleWhatsAppClick();
  };

  const handleWhatsAppClick = () => {
    const prefillMessage =
      "👋 Hello REVOX PANEL!\n\n🔐 I want to buy an Access Key.\n💎 Please share the price and payment details.\n\n⚡ REVOX PANEL — POWER BEYOND LIMITS!";
    const encodedMsg = encodeURIComponent(prefillMessage);

    let raw = (settings.whatsappUrl || 'https://wa.me/919623508876').trim();

    // Check if it's a wa.me link or raw phone number
    const waMeMatch = raw.match(/^(?:https?:\/\/)?(?:www\.)?wa\.me\/([0-9+]+)/i);
    const digitsOnly = raw.replace(/[^0-9]/g, '');

    let finalUrl = '';

    if (waMeMatch || (!raw.startsWith('http://') && !raw.startsWith('https://'))) {
      let phoneDigits = waMeMatch ? waMeMatch[1].replace(/[^0-9]/g, '') : digitsOnly;
      // If a 10-digit Indian mobile number is configured without country code, prefix 91
      if (phoneDigits.length === 10 && /^[6-9]/.test(phoneDigits)) {
        phoneDigits = `91${phoneDigits}`;
      }
      finalUrl = phoneDigits
        ? `https://wa.me/${phoneDigits}?text=${encodedMsg}`
        : `https://wa.me/?text=${encodedMsg}`;
    } else if (raw.includes('whatsapp.com')) {
      const separator = raw.includes('?') ? '&' : '?';
      finalUrl = raw.includes('text=') ? raw : `${raw}${separator}text=${encodedMsg}`;
    } else {
      const separator = raw.includes('?') ? '&' : '?';
      finalUrl = `${raw}${separator}text=${encodedMsg}`;
    }

    window.open(finalUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="relative w-full select-none shrink-0">
      {/* Outer 1px Crisp Border Frame with chamfered corners (glow reduced by ~20%) */}
      <div 
        className="relative p-[1px] bg-gradient-to-br from-[#00CFE8]/60 via-[#1B3345] to-[#168BFF]/45 hover:from-[#00CFE8]/85 hover:via-[#00CFE8]/55 hover:to-[#168BFF]/80 clip-announcement transition-all duration-300 shadow-[0_11px_27px_-10px_rgba(0,0,0,0.72),0_0_16px_rgba(0,207,232,0.11)]"
      >
        {/* Inner Card Surface (#101B28 -> #0D1622) */}
        <div className="relative cyber-glass-card backdrop-blur-xl p-3 min-[360px]:p-3.5 sm:p-4 clip-announcement overflow-hidden">
          {/* Top Specular Highlight Line */}
          <span className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8]/65 to-transparent pointer-events-none" />

          {/* Subtle Diagonal Surface Reflection */}
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-[#00CFE8]/[0.02] to-white/[0.03] pointer-events-none" />

          {/* Controlled Cyan Ambient Corner Accent (reduced by ~20%) */}
          <div 
            className="absolute -top-8 -right-8 w-32 h-32 rounded-full pointer-events-none opacity-28 blur-xl"
            style={{ background: 'radial-gradient(circle, rgba(0, 207, 232, 0.36) 0%, rgba(22, 139, 255, 0.13) 50%, transparent 72%)' }}
          />

          {/* Small top kicker */}
          <div className="relative z-10 flex items-center gap-1.5 text-[#00CFE8] text-[10px] sm:text-[11px] font-bold tracking-[0.2em] sm:tracking-[0.24em] uppercase mb-0.5 font-tech">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00CFE8] shadow-[0_0_6px_rgba(0,207,232,0.8)] shrink-0" />
            <span className="truncate">{lang === 'HI' ? t.moving : settings.announcementTitle || "WE'RE MOVING"}</span>
          </div>

          {/* Brand transition headline */}
          <div className="relative z-10 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[clamp(18px,5.2vw,24px)] leading-tight font-black tracking-tight mb-2 font-tech min-w-0">
            <span className="bg-gradient-to-b from-[#F4F7FB] via-[#00CFE8] to-[#168BFF] bg-clip-text text-transparent uppercase drop-shadow-[0_0_9px_rgba(0,207,232,0.28)]">
              {(!settings.announcementFrom || settings.announcementFrom === 'SILENTX') ? 'ANTIBAN' : settings.announcementFrom}
            </span>
            <span className="text-[#00CFE8] font-bold text-base sm:text-xl shrink-0">
              →
            </span>
            <span className="text-[#F4F7FB] uppercase tracking-wide drop-shadow-[0_2px_8px_rgba(0,207,232,0.18)]">
              {settings.announcementTo || settings.panelName || settings.websiteTitle || 'REVOX PANEL'}
            </span>
          </div>

          {/* Line-by-line detail bullet points controlled from Admin Panel */}
          {(() => {
            const lines: string[] = (settings.announcementLines && settings.announcementLines.length > 0)
              ? settings.announcementLines
              : (t.announcementLines || []);

            if (!lines || lines.length === 0) return null;

            return (
              <div className="relative z-10 space-y-1 mb-2.5 font-sans">
                {lines.map((line, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-start gap-2 text-[11px] sm:text-xs leading-snug text-[#A7B5C5] min-w-0"
                  >
                    <span className="text-[#00CFE8] font-tech text-xs mt-[1px] select-none shrink-0">▸</span>
                    <span className="flex-1 min-w-0 break-words text-[#A7B5C5] font-medium">{line}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ==============================================================
              SHINING "GET KEY INSTANTLY" BUTTON (MULTI-BEAM SHINE, -20% GLOW)
             ============================================================== */}
          <div className="relative z-10 group/btn mt-2 w-full">
            {/* Controlled Cyan + White Halo Aura Behind Button (reduced by ~20%) */}
            <div className="absolute -inset-[1.5px] bg-gradient-to-r from-[#00CFE8]/60 via-[#F4F7FB]/68 to-[#168BFF]/60 rounded-[5px] blur-[6px] opacity-68 group-hover/btn:opacity-85 group-hover/btn:blur-[8px] transition-all duration-200 pointer-events-none" />

            {/* Crisp Mirror-White & Electric Cyan Border Rim with Radiant Pulse */}
            <div className="relative p-[1.5px] bg-gradient-to-r from-[#00CFE8] via-[#F4F7FB] to-[#00CFE8] clip-whatsapp-btn animate-getkey-radiant transition-transform duration-150 group-hover/btn:scale-[1.01] active:scale-[0.985]">
              <button
                onClick={handleGetKeyButtonClick}
                type="button"
                className="relative w-full bg-gradient-to-r from-[#0D1622] via-[#132945] to-[#0D1622] hover:from-[#101E30] hover:via-[#173355] hover:to-[#101E30] py-2 sm:py-2.5 px-2.5 min-[360px]:px-3 sm:px-3.5 flex items-center justify-between gap-1.5 min-[360px]:gap-2 clip-whatsapp-btn cursor-pointer transition-all duration-150 overflow-hidden shadow-[inset_0_1px_1.5px_rgba(244,247,251,0.52),inset_0_-1px_1.5px_rgba(0,207,232,0.36),inset_0_0_17px_rgba(0,207,232,0.22)]"
              >
                {/* Top Half High-Gloss Chrome Bevel */}
                <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.13] via-[#00CFE8]/[0.05] to-transparent pointer-events-none" />

                {/* BEAM 1: Primary Diagonal White-Cyan Mirror Sweep */}
                <span
                  className="
                    absolute top-0 -left-1/4 w-[52%] h-full pointer-events-none z-20
                    bg-gradient-to-r from-transparent via-white/75 to-transparent
                    shadow-[0_0_18px_rgba(244,247,251,0.75),0_0_30px_rgba(0,207,232,0.68)]
                    animate-getkey-super-shine
                  "
                />

                {/* BEAM 2: Secondary High-Velocity Cyan-White Glint Sweep */}
                <span
                  className="
                    absolute top-0 -left-1/3 w-[30%] h-full pointer-events-none z-20
                    bg-gradient-to-r from-transparent via-[#00CFE8]/65 to-transparent
                    animate-getkey-secondary-glint
                  "
                />

                {/* Top & Bottom Specular Light Rails */}
                <span className="absolute top-0 left-1 right-1 h-[1.5px] bg-gradient-to-r from-transparent via-[#F4F7FB] to-transparent opacity-90 shadow-[0_0_10px_#F4F7FB,0_0_16px_#00CFE8] pointer-events-none z-20" />
                <span className="absolute bottom-0 left-2 right-2 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8] to-transparent opacity-85 shadow-[0_0_8px_#00CFE8] pointer-events-none z-20" />

                {/* LEFT SIDE: WhatsApp Icon with Success Green (#27D980) Accent */}
                <div className="relative z-30 flex items-center shrink-0">
                  <div className="relative flex items-center justify-center w-6 h-6 sm:w-6.5 sm:h-6.5 rounded-[3px] bg-[#062419] border border-[#27D980] shadow-[0_0_11px_rgba(39,217,128,0.6)] group-hover/btn:scale-105 transition-transform">
                    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#27D980] opacity-70" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#27D980] shadow-[0_0_6px_#27D980]" />
                    </span>
                    <svg 
                      className="w-3.5 h-3.5 text-[#27D980] drop-shadow-[0_0_6px_rgba(39,217,128,0.75)]" 
                      viewBox="0 0 24 24" 
                      fill="currentColor"
                    >
                      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.32C9.37 7.32 9.1 7.38 8.87 7.63C8.65 7.88 8.01 8.48 8.01 9.71C8.01 10.94 8.91 12.12 9.03 12.28C9.16 12.45 10.79 14.96 13.27 16.03C13.86 16.29 14.32 16.44 14.68 16.55C15.27 16.74 15.81 16.71 16.24 16.65C16.72 16.58 17.71 16.05 17.92 15.46C18.12 14.88 18.12 14.38 18.06 14.28C18 14.18 17.84 14.12 17.6 14C17.35 13.88 16.14 13.29 15.91 13.21C15.69 13.12 15.52 13.08 15.36 13.33C15.2 13.57 14.73 14.12 14.59 14.28C14.45 14.45 14.31 14.47 14.06 14.34C13.82 14.22 13.04 13.97 12.11 13.14C11.39 12.5 10.9 11.7 10.76 11.46C11.62 11.21 10.74 11.08 10.87 10.95C10.98 10.84 11.12 10.66 11.24 10.51C11.36 10.37 11.4 10.27 11.49 10.1C11.57 9.94 11.53 9.8 11.47 9.67C11.41 9.55 10.92 8.35 10.72 7.86C10.52 7.39 10.32 7.45 10.17 7.44C10.03 7.44 9.86 7.43 9.7 7.43L9.53 7.32Z"/>
                    </svg>
                  </div>
                </div>

                {/* CENTER: Main text "GET KEY INSTANTLY" with responsive sizing so it never overflows on 320px-360px */}
                <div className="relative z-30 flex-1 min-w-0 text-center">
                  <span className="block truncate text-[#F4F7FB] text-[clamp(11.5px,3.4vw,14px)] font-black tracking-[0.08em] min-[375px]:tracking-[0.15em] uppercase font-tech drop-shadow-[0_0_8px_rgba(244,247,251,0.72),0_0_14px_rgba(0,207,232,0.76)] select-none">
                    GET KEY INSTANTLY
                  </span>
                </div>

                {/* RIGHT SIDE: Cyber Ice-Blue Badge with Key, 24/7, and Arrow */}
                <div className="relative z-30 flex items-center gap-1 min-[360px]:gap-1.5 bg-[#101B28] border border-[#00CFE8] px-1.5 min-[360px]:px-2 py-0.5 rounded-[3px] text-[#F4F7FB] text-[10px] sm:text-[10.5px] font-extrabold tracking-wider font-tech uppercase shadow-[0_0_11px_rgba(0,207,232,0.4),inset_0_1px_1px_rgba(255,255,255,0.36)] group-hover/btn:border-[#F4F7FB] group-hover/btn:bg-[#162436] transition-all shrink-0">
                  <span className="text-[#fbbf24] drop-shadow-[0_0_3px_rgba(251,191,36,0.68)] text-[10px]">🔑</span>
                  <span className="font-mono-code font-bold text-[10px] text-[#F4F7FB]">24/7</span>
                  <span className="text-[#00CFE8] transition-transform duration-150 group-hover/btn:translate-x-0.5 font-bold">→</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
