import React, { useState, useRef, useEffect } from 'react';
import { Language } from '../types';

interface LanguageSelectorProps {
  currentLang: Language;
  onLanguageChange: (lang: Language) => void;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ currentLang, onLanguageChange }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block select-none" ref={containerRef}>
      {/* Top left language button with glossy specular cyan border */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative overflow-hidden bg-gradient-to-b from-[#122033] via-[#0B1420] to-[#070C14] hover:from-[#162840] hover:to-[#0A1320] active:scale-95 border border-[#00E5FF]/65 hover:border-[#FFFFFF] text-[#FFFFFF] text-xs font-bold tracking-wider px-3.5 py-1.5 rounded-[4px] flex items-center gap-1.5 cursor-pointer transition-all shadow-[0_0_14px_rgba(0,229,255,0.28),inset_0_1px_1px_rgba(255,255,255,0.4)] hover:shadow-[0_0_20px_rgba(0,229,255,0.5)] font-tech"
      >
        <span className="absolute top-0 left-2 right-2 h-[1px] bg-gradient-to-r from-transparent via-white/80 to-transparent pointer-events-none" />
        {/* Globe icon */}
        <svg 
          className="w-3.5 h-3.5 text-[#00E5FF] drop-shadow-[0_0_6px_rgba(0,229,255,0.75)]" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="font-mono-code font-bold uppercase drop-shadow-[0_0_6px_rgba(0,229,255,0.4)]">{currentLang}</span>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute left-0 mt-1.5 w-32 bg-[#0D1520]/95 backdrop-blur-md border border-[#00E5FF]/35 rounded-[4px] shadow-[0_12px_28px_rgba(0,0,0,0.75)] py-1 z-50">
          <button
            type="button"
            onClick={() => {
              onLanguageChange('EN');
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs font-tech flex items-center justify-between transition-colors ${
              currentLang === 'EN' 
                ? 'bg-[#167DFF]/25 text-[#F4F9FF] font-bold' 
                : 'text-[#A5B4C7] hover:text-[#F4F9FF] hover:bg-[#0A1018]'
            }`}
          >
            <span>English</span>
            <span className="text-[10px] font-mono-code text-[#00E5FF] opacity-80">EN</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onLanguageChange('HI');
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs font-tech flex items-center justify-between transition-colors ${
              currentLang === 'HI' 
                ? 'bg-[#167DFF]/25 text-[#F4F9FF] font-bold' 
                : 'text-[#A5B4C7] hover:text-[#F4F9FF] hover:bg-[#0A1018]'
            }`}
          >
            <span>हिन्दी (Hindi)</span>
            <span className="text-[10px] font-mono-code text-[#00E5FF] opacity-80">HI</span>
          </button>
        </div>
      )}
    </div>
  );
};
