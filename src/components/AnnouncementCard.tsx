import React from 'react';
import { SiteSettings, Language } from '../types';
import { translations } from '../translations';

interface AnnouncementCardProps {
  settings: SiteSettings;
  lang: Language;
}

export const AnnouncementCard: React.FC<AnnouncementCardProps> = ({ settings, lang }) => {
  const t = translations[lang];

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
    <div className="relative w-full max-w-[390px] mx-auto select-none shrink-0">
      {/* Outer 1.2px Specular Ice-Blue & Chrome-White Border Frame with exact chamfered corners */}
      <div 
        className="relative p-[1.2px] bg-gradient-to-br from-[#F4F9FF]/85 via-[#00E5FF]/80 to-[#167DFF]/55 hover:from-[#FFFFFF] hover:via-[#00E5FF] hover:to-[#42BFFF]/85 clip-announcement transition-all duration-300 shadow-[0_12px_36px_-8px_rgba(0,229,255,0.38),0_0_18px_rgba(0,229,255,0.18)]"
      >
        {/* Inner Card with High-Gloss Cyber Glassmorphism */}
        <div className="relative cyber-glass-card backdrop-blur-xl p-3.5 sm:p-4 clip-announcement overflow-hidden">
          {/* Top Mirror-White & Cyan Specular Reflection Bar */}
          <span className="absolute top-0 left-5 right-5 h-[1.5px] bg-gradient-to-r from-transparent via-[#F4F9FF]/95 to-transparent shadow-[0_0_12px_#00E5FF] pointer-events-none" />

          {/* Diagonal Glossy Crystal Reflection Overlay */}
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-[#00E5FF]/[0.04] to-white/[0.07] pointer-events-none" />

          {/* Subtle cyan ambient glow flare in top-right corner */}
          <div 
            className="absolute -top-6 -right-6 w-36 h-36 rounded-full pointer-events-none opacity-45 blur-xl"
            style={{ background: 'radial-gradient(circle, rgba(0, 229, 255, 0.58) 0%, rgba(22, 125, 255, 0.22) 45%, transparent 70%)' }}
          />

          {/* Small top kicker */}
          <div className="relative z-10 flex items-center gap-1.5 text-[#6EF2FF] text-[10px] sm:text-[11px] font-bold tracking-[0.24em] uppercase mb-0.5 font-tech drop-shadow-[0_0_8px_rgba(0,229,255,0.45)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] shadow-[0_0_8px_#00E5FF]" />
            <span>{lang === 'HI' ? t.moving : settings.announcementTitle || "WE'RE MOVING"}</span>
          </div>

          {/* Brand transition headline with Metallic Ice-Cyan & Chrome-White Shine */}
          <div className="relative z-10 flex items-center gap-2 text-[22px] sm:text-2xl font-black tracking-tight mb-2 font-tech">
            <span className="bg-gradient-to-b from-[#F4F9FF] via-[#6EF2FF] to-[#00E5FF] bg-clip-text text-transparent uppercase drop-shadow-[0_0_14px_rgba(0,229,255,0.55)]">
              {(!settings.announcementFrom || settings.announcementFrom === 'SILENTX') ? 'ANTIBAN' : settings.announcementFrom}
            </span>
            <span className="text-[#42BFFF] font-bold text-lg sm:text-xl drop-shadow-[0_0_8px_rgba(0,229,255,0.5)]">
              →
            </span>
            <span className="bg-gradient-to-b from-[#FFFFFF] via-[#F4F9FF] to-[#B8DCFF] bg-clip-text text-transparent uppercase tracking-wide drop-shadow-[0_2px_12px_rgba(0,229,255,0.35)]">
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
                    className="flex items-start gap-2 text-[11px] sm:text-xs leading-snug text-[#A5B4C7]"
                  >
                    <span className="text-[#00E5FF] font-tech text-xs mt-[1px] select-none shrink-0 drop-shadow-[0_0_6px_#00E5FF]">▸</span>
                    <span className="flex-1 text-[#F4F9FF]/95 font-medium">{line}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Secondary / Highlighted WhatsApp CTA Button: Glossy Dark Surface with White-Cyan Specular Rim & Glow */}
          <div className="relative z-10 group/btn mt-1.5 w-full">
            {/* Controlled White + Ice-Blue Ambient Halo Behind Button */}
            <div className="absolute -inset-[1.5px] bg-gradient-to-r from-[#00E5FF]/55 via-[#FFFFFF]/70 to-[#00E5FF]/55 rounded-[5px] blur-[7px] opacity-80 group-hover/btn:opacity-100 transition-opacity duration-200 pointer-events-none" />

            {/* Crisp Mirror-White & Electric Cyan Border Rim */}
            <div className="relative p-[1.2px] bg-gradient-to-r from-[#00E5FF] via-[#FFFFFF] to-[#00E5FF] clip-whatsapp-btn shadow-[0_0_20px_rgba(0,229,255,0.45),0_0_28px_rgba(244,249,255,0.22)] transition-transform duration-150 group-hover/btn:scale-[1.01] active:scale-[0.99]">
              <button
                onClick={handleWhatsAppClick}
                type="button"
                className="relative w-full bg-gradient-to-b from-[#0E1A2B] via-[#09121E] to-[#060B12] hover:from-[#132338] hover:to-[#08101B] py-2 sm:py-2.5 px-3 sm:px-3.5 flex items-center justify-between gap-2.5 clip-whatsapp-btn cursor-pointer transition-all duration-150 overflow-hidden shadow-[inset_0_1px_1px_rgba(255,255,255,0.45),inset_0_0_18px_rgba(0,229,255,0.18)]"
              >
                {/* Top Half Glossy Glass Bevel */}
                <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.08] to-transparent pointer-events-none" />

                {/* Animated Luminous Mirror Sheen Sweep */}
                <div className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/25 to-transparent -skew-x-12 animate-sheen pointer-events-none" />

                {/* Top & Bottom Specular Highlights */}
                <span className="absolute top-0 left-2 right-2 h-[1.5px] bg-gradient-to-r from-transparent via-[#FFFFFF] to-transparent opacity-95 shadow-[0_0_10px_#00E5FF] pointer-events-none" />
                <span className="absolute bottom-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-[#00E5FF]/85 to-transparent opacity-90 pointer-events-none" />

                {/* LEFT SIDE: WhatsApp Icon */}
                <div className="relative z-10 flex items-center gap-2 shrink-0">
                  <div className="relative flex items-center justify-center w-6 h-6 sm:w-6.5 sm:h-6.5 rounded-[3px] bg-[#062419] border border-[#10b981]/90 shadow-[0_0_12px_rgba(16,185,129,0.65)] group-hover/btn:scale-105 transition-transform">
                    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10b981] shadow-[0_0_6px_#10b981]" />
                    </span>
                    <svg 
                      className="w-3.5 h-3.5 text-[#25D366] drop-shadow-[0_0_6px_rgba(37,211,102,0.9)]" 
                      viewBox="0 0 24 24" 
                      fill="currentColor"
                    >
                      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.32C9.37 7.32 9.1 7.38 8.87 7.63C8.65 7.88 8.01 8.48 8.01 9.71C8.01 10.94 8.91 12.12 9.03 12.28C9.16 12.45 10.79 14.96 13.27 16.03C13.86 16.29 14.32 16.44 14.68 16.55C15.27 16.74 15.81 16.71 16.24 16.65C16.72 16.58 17.71 16.05 17.92 15.46C18.12 14.88 18.12 14.38 18.06 14.28C18 14.18 17.84 14.12 17.6 14C17.35 13.88 16.14 13.29 15.91 13.21C15.69 13.12 15.52 13.08 15.36 13.33C15.2 13.57 14.73 14.12 14.59 14.28C14.45 14.45 14.31 14.47 14.06 14.34C13.82 14.22 13.04 13.97 12.11 13.14C11.39 12.5 10.9 11.7 10.76 11.46C10.62 11.21 10.74 11.08 10.87 10.95C10.98 10.84 11.12 10.66 11.24 10.51C11.36 10.37 11.4 10.27 11.49 10.1C11.57 9.94 11.53 9.8 11.47 9.67C11.41 9.55 10.92 8.35 10.72 7.86C10.52 7.39 10.32 7.45 10.17 7.44C10.03 7.44 9.86 7.43 9.7 7.43L9.53 7.32Z"/>
                    </svg>
                  </div>
                </div>

                {/* CENTER: Main text "GET KEY INSTANTLY" */}
                <div className="relative z-10 flex-1 text-center">
                  <span className="text-[#FFFFFF] text-[13px] sm:text-[14px] font-black tracking-[0.16em] uppercase font-tech drop-shadow-[0_0_10px_rgba(0,229,255,0.75)] select-none">
                    GET KEY INSTANTLY
                  </span>
                </div>

                {/* RIGHT SIDE: Small Cyber Ice-Blue Badge with Key, 24/7, and Arrow */}
                <div className="relative z-10 flex items-center gap-1.5 bg-[#0F2036]/95 border border-[#00E5FF]/80 px-2 py-0.5 rounded-[3px] text-[#FFFFFF] text-[10px] sm:text-[10.5px] font-extrabold tracking-wider font-tech uppercase shadow-[0_0_12px_rgba(0,229,255,0.38),inset_0_1px_1px_rgba(255,255,255,0.35)] group-hover/btn:border-[#FFFFFF] group-hover/btn:bg-[#152B47] transition-all shrink-0">
                  <span className="text-[#fbbf24] drop-shadow-[0_0_4px_rgba(251,191,36,0.75)] text-[10px]">🔑</span>
                  <span className="font-mono-code font-bold text-[10px] text-[#F4F9FF]">24/7</span>
                  <span className="text-[#00E5FF] transition-transform duration-150 group-hover/btn:translate-x-0.5 font-bold">→</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
