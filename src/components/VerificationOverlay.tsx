import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

export type VerificationState = 'idle' | 'verifying' | 'success' | 'error';

interface VerificationOverlayProps {
  state: VerificationState;
  errorMessage?: string;
  onSuccessComplete: () => void;
  onErrorComplete: () => void;
}

export const VerificationOverlay: React.FC<VerificationOverlayProps> = ({
  state,
  errorMessage,
  onSuccessComplete,
  onErrorComplete,
}) => {
  const [stage, setStage] = useState<'scan' | 'verified' | 'error'>('scan');

  useEffect(() => {
    if (state === 'verifying') {
      setStage('scan');
    } else if (state === 'success') {
      setStage('verified');
      // Success sequence: ~1.5 seconds, then transition to dashboard
      const timer = setTimeout(() => {
        onSuccessComplete();
      }, 1500);
      return () => clearTimeout(timer);
    } else if (state === 'error') {
      setStage('error');
      // Error sequence: ~1.4 seconds, then return to input form
      const timer = setTimeout(() => {
        onErrorComplete();
      }, 1400);
      return () => clearTimeout(timer);
    }
  }, [state, onSuccessComplete, onErrorComplete]);

  if (state === 'idle') return null;

  const overlayContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#070B12] animate-fade-in select-none">
      {/* Solid non-transparent depth base */}
      <div className="absolute inset-0 vignette-radial pointer-events-none" />
      
      {/* Smooth ambient lighting (glow reduced by ~20%, zero scanlines) */}
      <div 
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
          stage === 'verified' 
            ? 'opacity-35 bg-[radial-gradient(circle_at_50%_50%,rgba(0,217,160,0.14)_0%,transparent_62%)]' 
            : stage === 'error'
              ? 'opacity-35 bg-[radial-gradient(circle_at_50%_50%,rgba(229,9,20,0.17)_0%,transparent_62%)]'
              : 'opacity-35 bg-[radial-gradient(circle_at_50%_50%,rgba(0,207,232,0.15)_0%,transparent_62%)]'
        }`}
      />

      {/* Main Verification Card with solid surface, clean border & reduced glow */}
      <div 
        className={`relative w-full max-w-[340px] sm:max-w-[360px] p-[1px] ${
          stage === 'verified' 
            ? 'bg-gradient-to-br from-[#00D9A0]/65 via-[#1B3345] to-[#00D9A0]/40 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.85),0_0_20px_rgba(0,217,160,0.18)]' 
            : stage === 'error'
              ? 'bg-gradient-to-br from-[#FF5263]/80 via-[#1B3345] to-[#E50914]/55 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.85),0_0_20px_rgba(255,82,99,0.22)]'
              : 'bg-gradient-to-br from-[#00CFE8]/65 via-[#1B3345] to-[#168BFF]/45 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.85),0_0_18px_rgba(0,207,232,0.18)]'
        } clip-announcement transition-colors duration-500`}
      >
        <div className="relative bg-gradient-to-b from-[#101B28] to-[#0D1622] clip-announcement p-6 sm:p-7 flex flex-col items-center justify-center text-center overflow-hidden min-h-[220px]">
          
          {/* Top clean highlight edge */}
          <span className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8]/55 to-transparent pointer-events-none" />

          {/* Subtle Scanning Laser Line in Electric Cyan (Active while verifying, glow reduced by ~20%) */}
          {stage === 'scan' && (
            <div className="absolute inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#00CFE8]/85 to-transparent animate-laser shadow-[0_0_11px_rgba(0,207,232,0.75)] pointer-events-none" />
          )}

          {/* PHASE 1: SCANNING / VERIFYING */}
          {stage === 'scan' && (
            <div className="flex flex-col items-center space-y-4 w-full">
              {/* Rotating tech radar glyph in Electric Cyan */}
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-[#168BFF]/55 border-dashed animate-spin" style={{ animationDuration: '6s' }} />
                <div className="absolute inset-2 rounded-full border border-[#1B3345]" />
                <div className="w-8 h-8 rounded-full border-2 border-t-[#00CFE8] border-r-[#168BFF] border-b-transparent border-l-transparent animate-spin" />
              </div>

              {/* Status Header with crisp high-contrast readability */}
              <div className="space-y-1">
                <div className="text-[#F4F7FB] text-xs sm:text-[13px] font-black tracking-[0.24em] uppercase font-tech">
                  VERIFYING ACCESS KEY
                </div>
                <div className="text-[#A7B5C5] text-[10px] font-mono-code tracking-widest uppercase font-semibold">
                  CRYPTOGRAPHIC VALIDATION
                </div>
              </div>

              {/* Thin glowing cyan progress line */}
              <div className="relative w-full h-[2.5px] bg-[#0A111B] border border-[#1B3345] rounded-full overflow-hidden mt-2">
                <div className="absolute inset-y-0 bg-[#00CFE8] rounded-full animate-scanning-progress shadow-[0_0_8px_rgba(0,207,232,0.75)]" />
              </div>
            </div>
          )}

          {/* PHASE 2: SUCCESS ANIMATION SEQUENCE */}
          {stage === 'verified' && (
            <div className="flex flex-col items-center space-y-3.5 w-full animate-glitch">
              {/* Animated SVG Circle with Drawing Checkmark */}
              <div className="relative w-16 h-16 flex items-center justify-center">
                {/* Expanding pulse wave */}
                <div className="absolute inset-0 rounded-full bg-[#00D9A0]/16 animate-pulse-expand" />
                
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 60 60">
                  {/* Outer circle track */}
                  <circle
                    cx="30"
                    cy="30"
                    r="26"
                    fill="none"
                    stroke="#142620"
                    strokeWidth="2.5"
                  />
                  {/* Drawing green outline */}
                  <circle
                    cx="30"
                    cy="30"
                    r="26"
                    fill="none"
                    stroke="#00D9A0"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="animate-draw-circle"
                  />
                </svg>

                {/* Animated Green Checkmark */}
                <svg
                  className="absolute w-8 h-8 text-[#00D9A0] drop-shadow-[0_0_6px_rgba(0,217,160,0.75)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" className="animate-draw-checkmark" />
                </svg>
              </div>

              {/* Success Typography */}
              <div className="space-y-1">
                <div className="text-[#F4F7FB] text-sm sm:text-base font-black tracking-[0.24em] uppercase font-tech drop-shadow-[0_0_8px_rgba(0,217,160,0.32)]">
                  ACCESS VERIFIED
                </div>
                <div className="text-[#00D9A0] text-[10.5px] sm:text-[11px] font-mono-code tracking-[0.18em] uppercase font-bold">
                  LICENSE AUTHENTICATED
                </div>
              </div>
            </div>
          )}

          {/* PHASE 3: INVALID / ERROR ANIMATION */}
          {stage === 'error' && (
            <div className="flex flex-col items-center space-y-3.5 w-full">
              {/* Red outlined error circle */}
              <div className="w-16 h-16 rounded-full border-2 border-[#FF5263] bg-[#22070a] flex items-center justify-center shadow-[0_0_16px_rgba(255,82,99,0.4)]">
                <svg 
                  className="w-7 h-7 text-[#FF5263]" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2.5" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>

              {/* Error Typography */}
              <div className="space-y-1">
                <div className="text-[#FF5263] text-xs sm:text-[13px] font-black tracking-[0.22em] uppercase font-tech">
                  {errorMessage || 'INVALID ACCESS KEY'}
                </div>
                <div className="text-[#A7B5C5] text-[10px] font-mono-code tracking-widest uppercase font-semibold">
                  VERIFICATION REJECTED
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(overlayContent, document.body)
    : overlayContent;
};

