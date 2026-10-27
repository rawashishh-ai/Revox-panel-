import React, { useState, useEffect } from 'react';

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#05070B]/92 backdrop-blur-md animate-fade-in select-none">
      
      {/* Background ambient lighting */}
      <div 
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
          stage === 'verified' 
            ? 'opacity-40 bg-[radial-gradient(circle_at_50%_50%,rgba(0,217,160,0.18)_0%,transparent_65%)]' 
            : stage === 'error'
              ? 'opacity-40 bg-[radial-gradient(circle_at_50%_50%,rgba(229,9,20,0.22)_0%,transparent_65%)]'
              : 'opacity-40 bg-[radial-gradient(circle_at_50%_50%,rgba(0,229,255,0.20)_0%,transparent_65%)]'
        }`}
      />

      {/* Cyber Grid Texture Overlay */}
      <div className="absolute inset-0 scanlines-overlay opacity-60 pointer-events-none" />

      {/* Main Verification Card */}
      <div 
        className={`relative w-full max-w-[340px] sm:max-w-[360px] p-[1px] ${
          stage === 'verified' 
            ? 'bg-[#00D9A0]/60' 
            : stage === 'error'
              ? 'bg-[#E50914]'
              : 'bg-[#00E5FF]/50'
        } clip-announcement shadow-[0_0_50px_-10px_rgba(0,0,0,0.9)] transition-colors duration-500`}
      >
        <div className="relative bg-[#0D1520] clip-announcement p-6 sm:p-7 flex flex-col items-center justify-center text-center overflow-hidden min-h-[220px]">
          
          {/* Subtle Scanning Laser Line in Electric Cyan (Active while verifying) */}
          {stage === 'scan' && (
            <div className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#00E5FF] to-transparent animate-laser shadow-[0_0_14px_#00E5FF] pointer-events-none" />
          )}

          {/* PHASE 1: SCANNING / VERIFYING */}
          {stage === 'scan' && (
            <div className="flex flex-col items-center space-y-4 w-full">
              {/* Rotating tech radar glyph in Electric Cyan */}
              <div className="relative w-16 h-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-[#167DFF]/60 border-dashed animate-spin" style={{ animationDuration: '6s' }} />
                <div className="absolute inset-2 rounded-full border border-[#00E5FF]/40" />
                <div className="w-8 h-8 rounded-full border-2 border-t-[#00E5FF] border-r-[#42BFFF] border-b-transparent border-l-transparent animate-spin" />
              </div>

              {/* Status Header */}
              <div className="space-y-1">
                <div className="text-[#F4F9FF] text-xs sm:text-[13px] font-black tracking-[0.24em] uppercase font-tech animate-pulse">
                  VERIFYING ACCESS KEY
                </div>
                <div className="text-[#A5B4C7] text-[10px] font-mono-code tracking-widest uppercase">
                  CRYPTOGRAPHIC VALIDATION
                </div>
              </div>

              {/* Thin glowing cyan progress line */}
              <div className="relative w-full h-[2px] bg-[#080D14] rounded-full overflow-hidden mt-2">
                <div className="absolute inset-y-0 bg-[#00E5FF] rounded-full animate-scanning-progress shadow-[0_0_10px_#00E5FF]" />
              </div>
            </div>
          )}

          {/* PHASE 2: SUCCESS ANIMATION SEQUENCE */}
          {stage === 'verified' && (
            <div className="flex flex-col items-center space-y-3.5 w-full animate-glitch">
              {/* Animated SVG Circle with Drawing Checkmark */}
              <div className="relative w-16 h-16 flex items-center justify-center">
                {/* Expanding pulse wave */}
                <div className="absolute inset-0 rounded-full bg-[#00D9A0]/20 animate-pulse-expand" />
                
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
                  className="absolute w-8 h-8 text-[#00D9A0] drop-shadow-[0_0_8px_#00D9A0]"
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
                <div className="text-[#F4F9FF] text-sm sm:text-base font-black tracking-[0.24em] uppercase font-tech drop-shadow-[0_0_10px_rgba(0,217,160,0.4)]">
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
              <div className="w-16 h-16 rounded-full border-2 border-[#E50914] bg-[#22070a] flex items-center justify-center shadow-[0_0_20px_rgba(229,9,20,0.5)]">
                <svg 
                  className="w-7 h-7 text-[#E50914]" 
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
                <div className="text-[#E50914] text-xs sm:text-[13px] font-black tracking-[0.22em] uppercase font-tech">
                  {errorMessage || 'INVALID ACCESS KEY'}
                </div>
                <div className="text-[#A5B4C7] text-[10px] font-mono-code tracking-widest uppercase">
                  VERIFICATION REJECTED
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
