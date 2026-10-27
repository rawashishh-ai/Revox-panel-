import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { SiteSettings } from '../types';
import { resolveWhatsAppPurchaseUrl, WHATSAPP_PURCHASE_MESSAGE } from '../config/purchaseConfig';

interface GetKeyChoiceModalProps {
  isOpen: boolean;
  settings: SiteSettings;
  onClose: () => void;
  onSelectWebsite: () => void;
}

export const GetKeyChoiceModal: React.FC<GetKeyChoiceModalProps> = ({
  isOpen,
  settings,
  onClose,
  onSelectWebsite
}) => {
  const [whatsappNotice, setWhatsappNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleWhatsAppOption = () => {
    const resolved = resolveWhatsAppPurchaseUrl(settings, WHATSAPP_PURCHASE_MESSAGE);
    if (!resolved.configured) {
      setWhatsappNotice(
        'WhatsApp contact is not configured yet. Please use GET KEY ON WEBSITE.'
      );
      return;
    }
    window.open(resolved.url, '_blank', 'noopener,noreferrer');
    onClose();
  };

  const handleWebsiteOption = () => {
    onClose();
    onSelectWebsite();
  };

  const logoSrc =
    settings.logoUrl && settings.logoUrl.trim() !== ''
      ? settings.logoUrl
      : '/assets/revox-logo.png';

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#070B12] select-none animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="get-key-choice-title"
    >
      {/* 100% Solid Opaque Background with Subtle Depth (No Transparent Bleed-Through) */}
      <div className="absolute inset-0 bg-[#070B12] pointer-events-none" />
      <div className="absolute inset-0 vignette-radial pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(0,207,232,0.12)_0%,rgba(22,139,255,0.05)_45%,transparent_70%)] pointer-events-none" />

      {/* Glowing Glass Outer Rim */}
      <div
        onClick={e => e.stopPropagation()}
        className="relative z-10 w-full max-w-[356px] p-[1px] rounded-2xl bg-gradient-to-br from-[#00CFE8]/75 via-[#1B3345] to-[#168BFF]/60 shadow-[0_16px_38px_-6px_rgba(0,0,0,0.9),0_0_24px_rgba(0,207,232,0.2)]"
      >
        {/* Solid Dark Glass Card Surface (#0D1622) */}
        <div className="relative bg-[#0D1622] rounded-2xl p-5 text-[#F4F7FB] overflow-hidden shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]">
          {/* Top Specular Glass Highlight */}
          <span className="absolute top-0 left-8 right-8 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8]/70 to-transparent pointer-events-none" />

          {/* Top Row: Small REVOX Logo + Branding & Close Button */}
          <div className="relative z-10 flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <img
                src={logoSrc}
                alt="REVOX"
                className="w-7 h-7 object-contain shrink-0 drop-shadow-[0_0_8px_rgba(0,207,232,0.35)]"
                onError={e => {
                  (e.currentTarget as HTMLImageElement).src = '/assets/revox-logo.png';
                }}
              />
              <span className="text-xs font-black tracking-[0.16em] text-[#F4F7FB] font-tech uppercase">
                REVOX
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 rounded-lg bg-[#080D14] hover:bg-[#121F30] border border-[#1B3345] hover:border-[#00CFE8] text-[#A7B5C5] hover:text-[#F4F7FB] flex items-center justify-center text-xs transition-all cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
            >
              ✕
            </button>
          </div>

          {/* Heading & Short Description */}
          <div className="relative z-10 mb-4">
            <h2
              id="get-key-choice-title"
              className="text-base sm:text-lg font-black font-tech tracking-[0.08em] uppercase text-[#F4F7FB] drop-shadow-[0_0_10px_rgba(0,207,232,0.2)]"
            >
              SELECT PURCHASE METHOD
            </h2>
            <p className="text-xs text-[#A7B5C5] mt-1 font-sans leading-relaxed">
              Choose how you want to get your access key.
            </p>
          </div>

          {whatsappNotice && (
            <div className="relative z-10 mb-3.5 p-2.5 rounded-xl bg-[#1A0D12] border border-[#FF5263]/50 text-[#FF5263] text-xs font-sans">
              {whatsappNotice}
            </div>
          )}

          {/* Two Glowing Glass & Shine Buttons */}
          <div className="relative z-10 space-y-3">
            {/* BUTTON 1: GET KEY ON WHATSAPP (Glowing Glass + Sweeping Shine) */}
            <div className="relative group/wa p-[1px] rounded-xl bg-gradient-to-r from-[#00CFE8]/70 via-[#F4F7FB]/55 to-[#27D980]/65 shadow-[0_6px_20px_-4px_rgba(0,207,232,0.22)] transition-transform duration-150 hover:scale-[1.01] active:scale-[0.985]">
              <button
                type="button"
                onClick={handleWhatsAppOption}
                className="relative w-full rounded-xl bg-gradient-to-r from-[#0B1522] via-[#112438] to-[#0B1522] hover:from-[#0E1B2B] hover:via-[#152C44] hover:to-[#0E1B2B] px-3.5 py-3 flex items-center justify-between gap-3 text-left transition-all cursor-pointer overflow-hidden shadow-[inset_0_1px_1.5px_rgba(244,247,251,0.35),inset_0_-1px_1.5px_rgba(0,207,232,0.25),inset_0_0_16px_rgba(0,207,232,0.16)]"
              >
                {/* Top-Half Glossy Glass Reflection */}
                <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.13] via-[#00CFE8]/[0.04] to-transparent pointer-events-none" />

                {/* Diagonal White-Cyan Shine Sweep */}
                <span className="absolute top-0 -left-1/4 w-[48%] h-full pointer-events-none z-20 bg-gradient-to-r from-transparent via-white/55 to-transparent animate-getkey-super-shine" />

                {/* Top Specular Light Rail */}
                <span className="absolute top-0 left-3 right-3 h-[1px] bg-gradient-to-r from-transparent via-[#F4F7FB]/80 to-transparent pointer-events-none z-20" />

                <div className="relative z-30 flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#062019] border border-[#27D980]/80 flex items-center justify-center text-[#27D980] shrink-0 shadow-[0_0_12px_rgba(39,217,128,0.45),inset_0_1px_1px_rgba(255,255,255,0.25)]">
                    <svg
                      className="w-4 h-4 drop-shadow-[0_0_5px_rgba(39,217,128,0.7)]"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.32C9.37 7.32 9.1 7.38 8.87 7.63C8.65 7.88 8.01 8.48 8.01 9.71C8.01 10.94 8.91 12.12 9.03 12.28C9.16 12.45 10.79 14.96 13.27 16.03C13.86 16.29 14.32 16.44 14.68 16.55C15.27 16.74 15.81 16.71 16.24 16.65C16.72 16.58 17.71 16.05 17.92 15.46C18.12 14.88 18.12 14.38 18.06 14.28C18 14.18 17.84 14.12 17.6 14C17.35 13.88 16.14 13.29 15.91 13.21C15.69 13.12 15.52 13.08 15.36 13.33C15.2 13.57 14.73 14.12 14.59 14.28C14.45 14.45 14.31 14.47 14.06 14.34C13.82 14.22 13.04 13.97 12.11 13.14C11.39 12.5 10.9 11.7 10.76 11.46C10.62 11.21 10.74 11.08 10.87 10.95C10.98 10.84 11.12 10.66 11.24 10.51C11.36 10.37 11.4 10.27 11.49 10.1C11.57 9.94 11.53 9.8 11.47 9.67C11.41 9.55 10.92 8.35 10.72 7.86C10.52 7.39 10.32 7.45 10.17 7.44C10.03 7.44 9.86 7.43 9.7 7.43L9.53 7.32Z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black font-tech tracking-[0.08em] text-[#F4F7FB] drop-shadow-[0_0_8px_rgba(0,207,232,0.45)]">
                      GET KEY ON WHATSAPP
                    </div>
                    <div className="text-xs text-[#A7B5C5] font-sans truncate">
                      Direct chat & support
                    </div>
                  </div>
                </div>
                <span className="relative z-30 text-sm font-bold text-[#00CFE8] transition-transform duration-150 group-hover/wa:translate-x-0.5 shrink-0">
                  →
                </span>
              </button>
            </div>

            {/* BUTTON 2: GET KEY ON WEBSITE (Radiant Cyan-Blue Glass + Multi-Beam Shine) */}
            <div className="relative group/web p-[1px] rounded-xl bg-gradient-to-r from-[#00CFE8] via-[#F4F7FB] to-[#168BFF] shadow-[0_6px_22px_-3px_rgba(0,207,232,0.35)] transition-transform duration-150 hover:scale-[1.01] active:scale-[0.985]">
              <button
                type="button"
                onClick={handleWebsiteOption}
                className="relative w-full rounded-xl bg-gradient-to-r from-[#00CFE8] via-[#22B8FF] to-[#168BFF] hover:brightness-108 px-3.5 py-3 flex items-center justify-between gap-3 text-left transition-all cursor-pointer overflow-hidden shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.65),inset_0_-1px_2px_rgba(7,11,18,0.25)]"
              >
                {/* Top-Half Glossy Chrome Bevel */}
                <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />

                {/* Primary Diagonal Mirror Shine Beam */}
                <span className="absolute top-0 -left-1/4 w-[50%] h-full pointer-events-none z-20 bg-gradient-to-r from-transparent via-white/75 to-transparent animate-getkey-super-shine" />

                {/* Secondary Glint Sweep */}
                <span className="absolute top-0 -left-1/3 w-[30%] h-full pointer-events-none z-20 bg-gradient-to-r from-transparent via-white/45 to-transparent animate-getkey-secondary-glint" />

                <div className="relative z-30 flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#070B12] border border-[#00CFE8]/80 flex items-center justify-center text-[#00CFE8] shrink-0 shadow-[0_2px_10px_rgba(7,11,18,0.45),inset_0_1px_1px_rgba(0,207,232,0.35)]">
                    <svg
                      className="w-4 h-4 drop-shadow-[0_0_5px_rgba(0,207,232,0.75)]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <line x1="2" y1="10" x2="22" y2="10" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black font-tech tracking-[0.08em] text-[#070B12] drop-shadow-[0_1px_0_rgba(255,255,255,0.35)]">
                      GET KEY ON WEBSITE
                    </div>
                    <div className="text-xs text-[#070B12]/80 font-sans font-semibold truncate">
                      Plans & online checkout
                    </div>
                  </div>
                </div>
                <span className="relative z-30 text-sm font-black text-[#070B12] transition-transform duration-150 group-hover/web:translate-x-0.5 shrink-0">
                  →
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
};
