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
      {/* Top left language button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative overflow-hidden bg-[#101B28] hover:bg-[#152334] active:scale-95 border border-[#1B3345] hover:border-[#00CFE8] text-[#F4F7FB] text-xs font-bold tracking-wider px-3.5 py-1.5 rounded-[4px] flex items-center gap-1.5 cursor-pointer transition-all shadow-[0_3px_11px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(244,247,251,0.1)] hover:shadow-[0_0_13px_rgba(0,207,232,0.22)] font-tech"
      >
        <span className="absolute top-0 left-2 right-2 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8]/48 to-transparent pointer-events-none" />
        {/* Globe icon */}
        <svg 
          className="w-3.5 h-3.5 text-[#00CFE8]" 
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
        <span className="font-mono-code font-bold uppercase text-[#F4F7FB]">{currentLang}</span>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute left-0 mt-1.5 w-32 bg-[#0D1622] border border-[#1B3345] rounded-[4px] shadow-[0_10px_24px_rgba(0,0,0,0.85)] py-1 z-50">
          <button
            type="button"
            onClick={() => {
              onLanguageChange('EN');
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs font-tech flex items-center justify-between transition-colors ${
              currentLang === 'EN' 
                ? 'bg-[#168BFF]/20 text-[#F4F7FB] font-bold' 
                : 'text-[#A7B5C5] hover:text-[#F4F7FB] hover:bg-[#101B28]'
            }`}
          >
            <span>English</span>
            <span className="text-[10px] font-mono-code text-[#00CFE8] opacity-85">EN</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onLanguageChange('HI');
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs font-tech flex items-center justify-between transition-colors ${
              currentLang === 'HI' 
                ? 'bg-[#168BFF]/20 text-[#F4F7FB] font-bold' 
                : 'text-[#A7B5C5] hover:text-[#F4F7FB] hover:bg-[#101B28]'
            }`}
          >
            <span>हिन्दी (Hindi)</span>
            <span className="text-[10px] font-mono-code text-[#00CFE8] opacity-85">HI</span>
          </button>
        </div>
      )}
    </div>
  );
};
