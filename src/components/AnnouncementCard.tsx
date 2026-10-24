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
    const prefillMessage = "Hello 👋 \nPlease send me the access key. 🔐";
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
      {/* Outer 1px purple border frame with exact chamfered corners */}
      <div 
        className="relative p-[1px] bg-[#581c87]/75 hover:bg-[#7e22ce] clip-announcement transition-colors duration-300 shadow-[0_0_35px_-10px_rgba(168,85,247,0.35)]"
      >
        {/* Inner Card */}
        <div className="relative bg-[#0c0c0e] p-3.5 sm:p-4 clip-announcement overflow-hidden">
          {/* Subtle purple ambient glow flare in top-right corner */}
          <div 
            className="absolute -top-6 -right-6 w-32 h-32 rounded-full pointer-events-none opacity-40 blur-xl"
            style={{ background: 'radial-gradient(circle, rgba(168, 85, 247, 0.6) 0%, transparent 65%)' }}
          />

          {/* Small top kicker */}
          <div className="text-[#c084fc] text-[10px] sm:text-[11px] font-bold tracking-[0.24em] uppercase mb-0.5 font-tech">
            {lang === 'HI' ? t.moving : settings.announcementTitle || "WE'RE MOVING"}
          </div>

          {/* Brand transition headline */}
          <div className="flex items-center gap-2 text-[22px] sm:text-2xl font-black tracking-tight mb-2 font-tech">
            <span className="text-[#a855f7] uppercase drop-shadow-[0_0_12px_rgba(168,85,247,0.5)]">
              {(!settings.announcementFrom || settings.announcementFrom === 'SILENTX') ? 'ANTIBAN' : settings.announcementFrom}
            </span>
            <span className="text-[#888892] font-normal text-lg sm:text-xl">
              →
            </span>
            <span className="text-white uppercase tracking-wide">
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
              <div className="space-y-1 mb-2.5 font-sans">
                {lines.map((line, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-start gap-2 text-[11px] sm:text-xs leading-snug text-[#b4b4be]"
                  >
                    <span className="text-[#a855f7] font-tech text-xs mt-[1px] select-none shrink-0">▸</span>
                    <span className="flex-1">{line}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Ultra-Premium Cyberpunk Gaming WhatsApp CTA Button (Glowing Neon Purple with Green WhatsApp Emblem) */}
          <div className="relative group/btn mt-1 w-full">
            {/* Rich Neon Purple Ambient Glow Behind Button */}
            <div className="absolute -inset-[1.5px] bg-gradient-to-r from-[#9333ea]/50 via-[#c084fc]/60 to-[#a855f7]/50 rounded-[4px] blur-[8px] opacity-75 group-hover/btn:opacity-100 transition-opacity duration-200 pointer-events-none" />

            {/* Glowing Neon Purple Border - Solid & Crisp (No vanishing/pulse) */}
            <div className="relative p-[1.5px] bg-gradient-to-r from-[#9333ea] via-[#c084fc] to-[#7e22ce] clip-whatsapp-btn shadow-[0_0_20px_rgba(168,85,247,0.55),0_0_35px_rgba(147,51,234,0.35)] transition-transform duration-150 group-hover/btn:scale-[1.01] active:scale-[0.99]">
              <button
                onClick={handleWhatsAppClick}
                type="button"
                className="relative w-full bg-[#09090c] hover:bg-[#120e1c] active:bg-[#07050d] py-2 sm:py-2.5 px-3 sm:px-3.5 flex items-center justify-between gap-2.5 clip-whatsapp-btn cursor-pointer transition-colors duration-150"
              >
                {/* Top subtle inner border highlight in light violet */}
                <span className="absolute top-0 left-3 right-3 h-[1px] bg-gradient-to-r from-transparent via-[#c084fc]/60 to-transparent pointer-events-none" />

                {/* LEFT SIDE: ONLY WhatsApp Icon is Green (+ Solid Glowing Green Indicator) */}
                <div className="relative z-10 flex items-center gap-2 shrink-0">
                  <div className="relative flex items-center justify-center w-6 h-6 sm:w-6.5 sm:h-6.5 rounded-[3px] bg-[#052e16] border border-[#10b981]/70 shadow-[0_0_10px_rgba(16,185,129,0.6)] group-hover/btn:scale-105 transition-transform">
                    {/* Constant Glowing Green Online Indicator */}
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

                {/* CENTER: Main text "GET KEY INSTANTLY" - High-contrast, Bold White Futuristic Font with Neon Purple Glow */}
                <div className="relative z-10 flex-1 text-center">
                  <span className="text-white text-[13px] sm:text-[14px] font-black tracking-[0.16em] uppercase font-tech drop-shadow-[0_0_12px_rgba(192,132,252,0.6)] select-none">
                    GET KEY INSTANTLY
                  </span>
                </div>

                {/* RIGHT SIDE: Small Premium Cyberpunk Purple Badge with Golden Key, 24/7, and Arrow */}
                <div className="relative z-10 flex items-center gap-1.5 bg-[#3b1261]/60 border border-[#a855f7]/70 px-2 py-0.5 rounded-[3px] text-[#e9d5ff] text-[10px] sm:text-[10.5px] font-extrabold tracking-wider font-tech uppercase shadow-[0_0_10px_rgba(168,85,247,0.45)] group-hover/btn:border-[#c084fc] group-hover/btn:bg-[#4c167d]/80 transition-all shrink-0">
                  <span className="text-[#fbbf24] drop-shadow-[0_0_4px_rgba(251,191,36,0.6)] text-[10px]">🔑</span>
                  <span className="font-mono-code font-bold text-[10px] text-white">24/7</span>
                  <span className="text-[#c084fc] transition-transform duration-150 group-hover/btn:translate-x-0.5 font-bold">→</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
