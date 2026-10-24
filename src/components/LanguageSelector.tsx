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
      {/* Top right language button matching reference screenshot */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="bg-[#121215] hover:bg-[#1a1a20] active:bg-[#0f0f12] border border-[#26262e] text-[#d4d4dc] text-xs font-bold tracking-wider px-3.5 py-1.5 rounded-[4px] flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm font-tech"
      >
        {/* Globe icon */}
        <svg 
          className="w-3.5 h-3.5 text-[#a1a1aa]" 
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
        <span className="font-mono-code font-bold uppercase">{currentLang}</span>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute left-0 mt-1.5 w-32 bg-[#0e0e12] border border-[#2b2b36] rounded-[4px] shadow-2xl py-1 z-50">
          <button
            type="button"
            onClick={() => {
              onLanguageChange('EN');
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs font-tech flex items-center justify-between transition-colors ${
              currentLang === 'EN' 
                ? 'bg-[#1e1e26] text-white font-bold' 
                : 'text-[#9ca3af] hover:text-white hover:bg-[#15151c]'
            }`}
          >
            <span>English</span>
            <span className="text-[10px] font-mono-code opacity-60">EN</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onLanguageChange('HI');
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs font-tech flex items-center justify-between transition-colors ${
              currentLang === 'HI' 
                ? 'bg-[#1e1e26] text-white font-bold' 
                : 'text-[#9ca3af] hover:text-white hover:bg-[#15151c]'
            }`}
          >
            <span>हिन्दी (Hindi)</span>
            <span className="text-[10px] font-mono-code opacity-60">HI</span>
          </button>
        </div>
      )}
    </div>
  );
};
