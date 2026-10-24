import React, { useState, useEffect } from 'react';
import { SiteSettings, Language, VerificationResult } from '../types';

interface AuthorizedDashboardProps {
  keyData: NonNullable<VerificationResult['data']>;
  settings?: SiteSettings;
  lang?: Language;
  onDisconnect?: () => void;
}

export const AuthorizedDashboard: React.FC<AuthorizedDashboardProps> = ({ keyData, settings, onDisconnect }) => {
  const storageKey = `rvx_connected_key_${keyData.key}`;
  const legacyStorageKey = `sltx_connected_key_${keyData.key}`;

  const [connecting, setConnecting] = useState(false);
  const [connectStage, setConnectStage] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [connectProgress, setConnectProgress] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  // Persistent connected state: stays true until key expires
  const [connected, setConnected] = useState<boolean>(() => {
    try {
      return (
        localStorage.getItem(storageKey) === 'true' ||
        localStorage.getItem(legacyStorageKey) === 'true'
      );
    } catch {}
    return false;
  });

  const handleOpenExternalUrl = (rawUrl?: string, fallback = 'https://t.me/silentx_phantom_official') => {
    let url = (rawUrl || fallback).trim();
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('intent://')) {
      url = `https://${url}`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Real backend expiry countdown & license validity progress
  const isLifetime = keyData.durationDays === 0 || !keyData.expiresAt;
  const [isExpired, setIsExpired] = useState(false);
  const [timeLeft, setTimeLeft] = useState<{ d: string; h: string; m: string; s: string } | null>(null);
  const [validityPercent, setValidityPercent] = useState<number>(100);

  useEffect(() => {
    if (isLifetime || !keyData.expiresAt) {
      setValidityPercent(100);
      return;
    }

    const target = new Date(keyData.expiresAt).getTime();
    const activatedMs = keyData.activatedAt ? new Date(keyData.activatedAt).getTime() : NaN;
    const durationDaysMs = (keyData.durationDays && keyData.durationDays > 0 ? keyData.durationDays : 1) * 86400 * 1000;
    const totalSpanMs = !Number.isNaN(activatedMs) && target > activatedMs ? target - activatedMs : durationDaysMs;

    const updateTimer = () => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setIsExpired(true);
        setConnected(false);
        setValidityPercent(0);
        try {
          localStorage.removeItem(storageKey);
        } catch {}
        setTimeLeft({ d: '00D', h: '00H', m: '00M', s: '00S' });
        return;
      }

      const pct = Math.min(100, Math.max(2, (diff / totalSpanMs) * 100));
      setValidityPercent(pct);

      const totalSec = Math.floor(diff / 1000);
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;

      setTimeLeft({
        d: `${String(d).padStart(2, '0')}D`,
        h: `${String(h).padStart(2, '0')}H`,
        m: `${String(m).padStart(2, '0')}M`,
        s: `${String(s).padStart(2, '0')}S`
      });
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [keyData.expiresAt, keyData.activatedAt, keyData.durationDays, isLifetime, storageKey]);

  // If key expires, clear connection status
  useEffect(() => {
    if (isExpired) {
      setConnected(false);
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    }
  }, [isExpired, storageKey]);

  // 12-Second 60fps Connection Animation Timeline
  useEffect(() => {
    if (!connecting) return;

    const TOTAL_DURATION_MS = 12000; // Exact 12 seconds total duration
    const startTime = performance.now();
    let rafId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;

      // Determine exact stage according to specification:
      // 0-2s: Stage 1 (REVOX SYSTEM)
      // 2-5s: Stage 2 (INITIALIZING CONNECTION...)
      // 5-8s: Stage 3 (PREPARING SESSION...)
      // 8-11s: Stage 4 (FINALIZING...)
      // 11-12s: Stage 5 (ANIMATION COMPLETE)
      if (elapsed < 2000) {
        setConnectStage(1);
      } else if (elapsed < 5000) {
        setConnectStage(2);
      } else if (elapsed < 8000) {
        setConnectStage(3);
      } else if (elapsed < 11000) {
        setConnectStage(4);
      } else {
        setConnectStage(5);
      }

      // Smooth realistic progress from 0% to 100% reaching 100% at 11.0s
      let pct = 0;
      if (elapsed <= 2000) {
        pct = (elapsed / 2000) * 18;
      } else if (elapsed <= 5000) {
        pct = 18 + ((elapsed - 2000) / 3000) * 28;
      } else if (elapsed <= 8000) {
        pct = 46 + ((elapsed - 5000) / 3000) * 30;
      } else if (elapsed <= 11000) {
        pct = 76 + ((elapsed - 8000) / 3000) * 24;
      } else {
        pct = 100;
      }
      setConnectProgress(Math.min(100, Math.max(0, pct)));

      if (elapsed < TOTAL_DURATION_MS) {
        rafId = requestAnimationFrame(tick);
      } else {
        setConnectProgress(100);
        setConnected(true);
        try {
          localStorage.setItem(storageKey, 'true');
        } catch {}
        setConnecting(false);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [connecting, storageKey]);

  const handleCopyKey = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(keyData.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleConnectHack = () => {
    if (isExpired || connecting) return;

    setConnectStage(1);
    setConnectProgress(0);
    setConnecting(true);
  };

  const activeLogoUrl =
    settings?.logoUrl && settings.logoUrl.trim() !== ''
      ? settings.logoUrl
      : '/assets/revox-logo.png';

  const stageTitle =
    connectStage === 1
      ? 'REVOX SYSTEM'
      : connectStage === 2
      ? 'INITIALIZING CONNECTION...'
      : connectStage === 3
      ? 'PREPARING SESSION...'
      : connectStage === 4
      ? 'FINALIZING...'
      : 'ANIMATION COMPLETE';

  const roundedProgress = Math.round(connectProgress);
  const circleRadius = 46;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const circleDashOffset =
    circleCircumference - (connectProgress / 100) * circleCircumference;

  return (
    <div className="w-full max-w-[390px] mx-auto select-none flex flex-col gap-3 text-[#FFFFFF] animate-page-fade">
      
      {/* ========================================================
          FULL-SCREEN 12-SECOND FUTURISTIC CONNECTION ANIMATION
          ======================================================== */}
      {connecting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-5 bg-[#050308]/96 backdrop-blur-xl animate-fade-in select-none overflow-hidden">
          {/* Scanlines & Deep Neon Purple Radial Atmosphere */}
          <div className="absolute inset-0 scanlines-overlay opacity-55 pointer-events-none" />
          <div
            className={`absolute inset-0 transition-opacity duration-700 pointer-events-none ${
              connectStage === 5
                ? 'bg-[radial-gradient(circle_at_50%_46%,rgba(0,229,164,0.18)_0%,rgba(160,32,240,0.10)_42%,transparent_75%)]'
                : 'bg-[radial-gradient(circle_at_50%_46%,rgba(160,32,240,0.24)_0%,rgba(196,92,255,0.08)_45%,transparent_75%)]'
            }`}
          />

          {/* Smooth Animated Cyber Particles */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {[
              { left: '14%', top: '74%', delay: '0s', size: 'w-1.5 h-1.5' },
              { left: '26%', top: '62%', delay: '0.6s', size: 'w-1 h-1' },
              { left: '38%', top: '80%', delay: '1.2s', size: 'w-1.5 h-1.5' },
              { left: '52%', top: '68%', delay: '0.3s', size: 'w-2 h-2' },
              { left: '66%', top: '76%', delay: '0.9s', size: 'w-1 h-1' },
              { left: '78%', top: '64%', delay: '1.5s', size: 'w-1.5 h-1.5' },
              { left: '86%', top: '72%', delay: '0.4s', size: 'w-1 h-1' },
              { left: '22%', top: '36%', delay: '1.1s', size: 'w-1 h-1' },
              { left: '74%', top: '34%', delay: '0.7s', size: 'w-1.5 h-1.5' }
            ].map((p, idx) => (
              <span
                key={idx}
                style={{ left: p.left, top: p.top, animationDelay: p.delay }}
                className={`absolute rounded-full animate-cyber-particle ${p.size} ${
                  connectStage === 5
                    ? 'bg-[#00E5A4] shadow-[0_0_10px_#00E5A4]'
                    : 'bg-[#C45CFF] shadow-[0_0_10px_#A020F0]'
                }`}
              />
            ))}
          </div>

          {/* Main Futuristic Cyber Frame */}
          <div
            className={`relative w-full max-w-[356px] p-[1px] clip-card-br transition-all duration-500 ${
              connectStage === 5
                ? 'bg-gradient-to-b from-[#00E5A4] via-[#A020F0]/60 to-[#00E5A4]/40 shadow-[0_0_50px_rgba(0,229,164,0.28)]'
                : 'bg-gradient-to-b from-[#C45CFF] via-[#A020F0] to-[#3b0f66] shadow-[0_0_50px_rgba(160,32,240,0.38)]'
            }`}
          >
            <div className="relative bg-[#0A0712]/95 clip-card-br px-6 py-7 flex flex-col items-center justify-between min-h-[340px] overflow-hidden">
              {/* Top Cyber Corner Accents */}
              <div className="w-full flex items-center justify-between text-[9.5px] font-mono-code font-bold tracking-[0.22em] text-[#9993A5] uppercase">
                <span className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      connectStage === 5
                        ? 'bg-[#00E5A4] shadow-[0_0_8px_#00E5A4]'
                        : 'bg-[#C45CFF] shadow-[0_0_8px_#C45CFF] animate-pulse'
                    }`}
                  />
                  <span>STAGE 0{connectStage} / 05</span>
                </span>
                <span className="text-[#C45CFF]">{roundedProgress}%</span>
              </div>

              {/* Laser Sweep Line */}
              <div
                className={`absolute inset-x-0 h-[1.5px] animate-laser pointer-events-none ${
                  connectStage === 5
                    ? 'bg-gradient-to-r from-transparent via-[#00E5A4] to-transparent shadow-[0_0_12px_#00E5A4]'
                    : 'bg-gradient-to-r from-transparent via-[#C45CFF] to-transparent shadow-[0_0_12px_#A020F0]'
                }`}
              />

              {/* ====================================================
                  STAGE-BY-STAGE VISUAL CENTERPIECE (0s - 12s)
                  ==================================================== */}
              <div className="my-4 flex items-center justify-center w-full h-[148px] relative">
                {/* 0–2 SECONDS: REVOX LOGO WITH CINEMATIC PURPLE GLOW & SMOOTH ZOOM */}
                {connectStage === 1 && (
                  <div key="stage-1" className="relative flex flex-col items-center justify-center animate-stage-in">
                    <div className="absolute w-32 h-32 rounded-full bg-[#A020F0]/25 blur-xl animate-pulse pointer-events-none" />
                    <div className="absolute w-28 h-28 rounded-full border border-[#C45CFF]/35 animate-ping pointer-events-none" style={{ animationDuration: '2s' }} />
                    <img
                      src={activeLogoUrl}
                      alt="REVOX SYSTEM"
                      className="w-28 h-28 object-contain animate-revox-logo-zoom relative z-10"
                      onError={e => {
                        (e.currentTarget as HTMLImageElement).src = '/assets/revox-logo.png';
                      }}
                    />
                  </div>
                )}

                {/* 2–5 SECONDS: ROTATING FUTURISTIC CIRCULAR SCANNER */}
                {connectStage === 2 && (
                  <div key="stage-2" className="relative w-32 h-32 flex items-center justify-center animate-stage-in">
                    <div className="absolute inset-0 rounded-full bg-[#A020F0]/15 blur-lg pointer-events-none" />
                    {/* Outer Dashed Ring */}
                    <div className="absolute inset-0 rounded-full border-2 border-dashed border-[#C45CFF]/55 animate-radar-spin" />
                    {/* Counter-RotatingSegmented Ring */}
                    <div className="absolute inset-2.5 rounded-full border-2 border-t-[#A020F0] border-r-transparent border-b-[#C45CFF] border-l-transparent animate-radar-reverse shadow-[0_0_18px_rgba(160,32,240,0.45)]" />
                    {/* Radar Sweep Cone */}
                    <div
                      className="absolute inset-3 rounded-full animate-radar-spin opacity-65"
                      style={{
                        background:
                          'conic-gradient(from 0deg, rgba(196,92,255,0.55) 0deg, rgba(160,32,240,0.12) 90deg, transparent 180deg, transparent 360deg)'
                      }}
                    />
                    {/* Inner Target Core */}
                    <div className="relative z-10 w-11 h-11 rounded-full bg-[#120B1E] border border-[#C45CFF]/70 flex items-center justify-center shadow-[0_0_16px_rgba(196,92,255,0.6)]">
                      <div className="w-3 h-3 rounded-full bg-[#C45CFF] shadow-[0_0_10px_#C45CFF] animate-ping" />
                    </div>
                  </div>
                )}

                {/* 5–8 SECONDS: ANIMATED PURPLE ENERGY WAVES & CONDUITS */}
                {connectStage === 3 && (
                  <div key="stage-3" className="w-full flex flex-col items-center justify-center gap-3.5 animate-stage-in">
                    {/* Equalizer Energy Wave Bars */}
                    <div className="flex items-center justify-center gap-1.5 h-20 px-4">
                      {[0.1, 0.25, 0.4, 0.15, 0.55, 0.3, 0.05, 0.45, 0.2, 0.6, 0.35, 0.12, 0.5, 0.28, 0.18].map(
                        (delay, idx) => (
                          <div
                            key={idx}
                            style={{ animationDelay: `${delay}s` }}
                            className="w-2 h-16 rounded-full bg-gradient-to-t from-[#6b21a8] via-[#A020F0] to-[#C45CFF] animate-energy-bar shadow-[0_0_12px_rgba(196,92,255,0.65)]"
                          />
                        )
                      )}
                    </div>

                    {/* Flowing Horizontal Purple Energy Lines */}
                    <div className="w-full space-y-2 px-2">
                      <div className="relative w-full h-[2px] bg-[#1D1230] overflow-hidden rounded-full">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#C45CFF] to-transparent animate-energy-wave" />
                      </div>
                      <div className="relative w-4/5 mx-auto h-[2px] bg-[#1D1230] overflow-hidden rounded-full">
                        <div
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-[#A020F0] to-transparent animate-energy-wave"
                          style={{ animationDelay: '0.45s' }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 8–11 SECONDS: FUTURISTIC CIRCULAR LOADING ANIMATION */}
                {connectStage === 4 && (
                  <div key="stage-4" className="relative w-32 h-32 flex items-center justify-center animate-stage-in">
                    <div className="absolute inset-0 rounded-full bg-[#A020F0]/20 blur-xl pointer-events-none" />
                    <div className="absolute inset-0 rounded-full border border-[#C45CFF]/30 animate-radar-reverse" />
                    <svg className="w-28 h-28 -rotate-90 transform" viewBox="0 0 112 112">
                      <circle
                        cx="56"
                        cy="56"
                        r={circleRadius}
                        stroke="rgba(160, 32, 240, 0.2)"
                        strokeWidth="6"
                        fill="transparent"
                      />
                      <circle
                        cx="56"
                        cy="56"
                        r={circleRadius}
                        stroke="url(#revoxPurpleGrad)"
                        strokeWidth="6"
                        strokeDasharray={circleCircumference}
                        strokeDashoffset={circleDashOffset}
                        strokeLinecap="round"
                        fill="transparent"
                      />
                      <defs>
                        <linearGradient id="revoxPurpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#C45CFF" />
                          <stop offset="100%" stopColor="#00E5A4" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[20px] font-mono-code font-black text-white tracking-wider drop-shadow-[0_0_10px_rgba(196,92,255,0.6)]">
                        {roundedProgress}%
                      </span>
                    </div>
                  </div>
                )}

                {/* 11–12 SECONDS: GREEN CHECKMARK ANIMATION */}
                {connectStage === 5 && (
                  <div key="stage-5" className="relative w-32 h-32 flex items-center justify-center animate-stage-in">
                    <div className="absolute inset-2 rounded-full border-2 border-[#00E5A4]/60 animate-pulse-expand pointer-events-none" />
                    <div className="absolute inset-0 rounded-full bg-[#00E5A4]/20 blur-xl pointer-events-none" />
                    <svg className="w-24 h-24" viewBox="0 0 80 80" fill="none">
                      <circle
                        cx="40"
                        cy="40"
                        r="34"
                        stroke="#00E5A4"
                        strokeWidth="4"
                        className="animate-draw-circle"
                        style={{ filter: 'drop-shadow(0 0 12px rgba(0, 229, 164, 0.65))' }}
                      />
                      <path
                        d="M25 41.5L35.5 52L56 29.5"
                        stroke="#00E5A4"
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="animate-draw-checkmark"
                        style={{ filter: 'drop-shadow(0 0 10px rgba(0, 229, 164, 0.85))' }}
                      />
                    </svg>
                  </div>
                )}
              </div>

              {/* ====================================================
                  STAGE HEADING & SMOOTH 0%-100% PROGRESS BAR
                  ==================================================== */}
              <div className="w-full space-y-3 text-center">
                <div
                  key={stageTitle}
                  className={`font-tech font-black text-[15px] sm:text-[16px] tracking-[0.2em] uppercase animate-stage-in ${
                    connectStage === 5
                      ? 'text-[#00E5A4] drop-shadow-[0_0_12px_rgba(0,229,164,0.5)]'
                      : 'text-[#FFFFFF] drop-shadow-[0_0_12px_rgba(196,92,255,0.45)]'
                  }`}
                >
                  {stageTitle}
                </div>

                {/* Smooth 0% to 100% Progress Bar */}
                <div className="w-full space-y-1.5">
                  <div className="relative w-full h-2 bg-[#160F24] border border-[#A020F0]/35 overflow-hidden rounded-full">
                    <div
                      className={`h-full rounded-full transition-none relative ${
                        connectStage === 5
                          ? 'bg-gradient-to-r from-[#A020F0] via-[#00E5A4] to-[#00E5A4] shadow-[0_0_14px_#00E5A4]'
                          : 'bg-gradient-to-r from-[#7e22ce] via-[#A020F0] to-[#C45CFF] shadow-[0_0_14px_#A020F0]'
                      }`}
                      style={{ width: `${connectProgress}%` }}
                    >
                      <span className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-sheen" />
                    </div>
                  </div>

                  {/* Progress Footer Readout */}
                  <div className="flex items-center justify-between text-[10px] font-mono-code font-bold tracking-[0.18em] text-[#9993A5] uppercase">
                    <span>{ (settings?.panelName || settings?.websiteTitle || 'REVOX PANEL').trim() }</span>
                    <span className={connectStage === 5 ? 'text-[#00E5A4]' : 'text-[#C45CFF]'}>
                      {roundedProgress}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          1. PREMIUM ACTIVATION CARD (Stagger 1: Fades in)
          ======================================================== */}
      <div className="animate-dash-1 relative p-[1px] bg-gradient-to-br from-[#C45CFF]/70 via-[#A020F0]/45 to-[#A020F0]/15 clip-card-br shadow-[0_10px_28px_-10px_rgba(160,32,240,0.35)]">
        <div className="bg-[#100C18]/95 backdrop-blur-md p-3.5 clip-card-br relative overflow-hidden shadow-[inset_0_1px_18px_rgba(160,32,240,0.14)]">
          
          {/* Subtle ambient glow in top-right */}
          <div className="absolute -top-6 -right-6 w-28 h-28 bg-[radial-gradient(circle,rgba(196,92,255,0.18)_0%,transparent_70%)] pointer-events-none" />

          {/* Top Row: Animated green status dot + ACCESS ACTIVATED + ACTIVE badge on right */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    isExpired ? 'bg-red-500' : 'bg-[#00E5A4]'
                  }`}
                />
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    isExpired
                      ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                      : 'bg-[#00E5A4] shadow-[0_0_8px_#00E5A4]'
                  }`}
                />
              </span>
              <span className="text-[#FFFFFF] text-[12px] sm:text-[13px] font-black tracking-[0.16em] uppercase font-tech truncate">
                ACCESS ACTIVATED
              </span>
            </div>

            <div
              className={`shrink-0 flex items-center px-2 py-0.5 border text-[10px] font-mono-code font-bold uppercase tracking-[0.14em] ${
                isExpired
                  ? 'bg-red-500/10 border-red-500/40 text-red-400'
                  : 'bg-[#00E5A4]/10 border-[#00E5A4]/35 text-[#00E5A4]'
              }`}
            >
              {isExpired ? 'EXPIRED' : 'ACTIVE'}
            </div>
          </div>

          {/* Thin subtle separator */}
          <div className="w-full h-[1px] bg-gradient-to-r from-[#A020F0]/35 via-[#C45CFF]/20 to-transparent my-2.5" />

          {/* Below: LICENSE KEY label + Dynamic Panel Name + Actual Activated Key + Premium Copy Icon */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-mono-code font-bold tracking-[0.18em] uppercase mb-1.5">
              <span className="text-[#a69bb8]">
                {(settings?.panelName || settings?.websiteTitle || 'REVOX PANEL').trim()} · LICENSE KEY
              </span>
              {copied && (
                <span className="text-[#00E5A4] tracking-[0.14em] font-extrabold animate-fade-in">
                  KEY COPIED
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleCopyKey}
              title="Copy license key"
              className="w-full flex items-center justify-between gap-2 bg-[#07050B]/90 hover:bg-[#07050B] border border-[#A020F0]/45 hover:border-[#C45CFF] px-3 py-2 transition-all duration-200 cursor-pointer group active:scale-[0.99]"
            >
              <span className="text-[#FFFFFF] text-[13px] min-[375px]:text-[14px] sm:text-[15px] font-mono-code font-bold tracking-[0.08em] truncate">
                {keyData.key}
              </span>

              <span className="shrink-0 flex items-center justify-center w-6 h-6 bg-[#100C18] border border-[#A020F0]/40 group-hover:border-[#C45CFF] text-[#C45CFF] group-hover:text-[#FFFFFF] transition-colors">
                {copied ? (
                  <svg className="w-3.5 h-3.5 text-[#00E5A4]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================
          2. PREMIUM COUNTDOWN TIMER CARD (Stagger 2: Slides upward)
          ======================================================== */}
      <div className="animate-dash-2 relative p-[1px] bg-gradient-to-br from-[#C45CFF]/60 via-[#A020F0]/40 to-[#A020F0]/15 clip-card-br shadow-[0_10px_28px_-10px_rgba(160,32,240,0.28)]">
        <div className="bg-[#100C18]/95 backdrop-blur-md px-3.5 pt-3 pb-3 clip-card-br relative overflow-hidden shadow-[inset_0_1px_16px_rgba(160,32,240,0.12)]">
          
          <div className="text-[#a69bb8] text-[10px] font-mono-code font-bold tracking-[0.22em] uppercase text-center mb-1.5">
            TIME REMAINING
          </div>

          {/* Single-row digital countdown readout */}
          {isExpired ? (
            <div className="text-[19px] sm:text-[21px] font-black font-mono-code text-red-400 tracking-[0.16em] text-center py-0.5">
              00D : 00H : 00M : 00S
            </div>
          ) : isLifetime ? (
            <div className="text-[17px] sm:text-[19px] font-black font-mono-code tracking-[0.14em] text-center py-0.5 flex items-center justify-center gap-2 whitespace-nowrap">
              <span className="text-[#FFFFFF]">LIFETIME ACCESS</span>
              <span className="text-[#C45CFF]">∞</span>
            </div>
          ) : timeLeft ? (
            <div className="font-mono-code tabular-nums font-bold text-[18px] min-[360px]:text-[20px] sm:text-[22px] tracking-[0.06em] sm:tracking-[0.09em] py-0.5 flex items-center justify-center whitespace-nowrap">
              <span className="text-[#FFFFFF]">{timeLeft.d}</span>
              <span className="text-[#6e5d85] mx-1.5">:</span>
              <span className="text-[#FFFFFF]">{timeLeft.h}</span>
              <span className="text-[#6e5d85] mx-1.5">:</span>
              <span className="text-[#FFFFFF]">{timeLeft.m}</span>
              <span className="text-[#6e5d85] mx-1.5">:</span>
              <span className="text-[#C45CFF] drop-shadow-[0_0_8px_rgba(196,92,255,0.45)]">{timeLeft.s}</span>
            </div>
          ) : (
            <div className="text-xs font-mono-code text-[#a69bb8] text-center py-1">
              SYNCING...
            </div>
          )}

          {/* Thin animated progress line showing remaining license validity */}
          <div className="relative w-full h-[3px] bg-[#07050B] overflow-hidden mt-2.5 border border-[#A020F0]/25">
            <div
              className="h-full bg-gradient-to-r from-[#A020F0] via-[#C45CFF] to-[#00E5A4] transition-all duration-700 ease-out relative"
              style={{ width: `${isExpired ? 0 : validityPercent}%` }}
            >
              <span className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-sheen" />
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          3. CONNECT BUTTON (Stagger 3: Appears)
          ======================================================== */}
      <div className="animate-dash-3">
        <button
          id="startButton"
          type="button"
          onClick={handleConnectHack}
          disabled={isExpired || connecting}
          className={`relative w-full py-3.5 px-5 clip-btn-angular font-tech font-black text-[18px] sm:text-[20px] tracking-[0.14em] uppercase transition-all duration-200 cursor-pointer flex items-center justify-center gap-2.5 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group ${
            connected
              ? 'bg-gradient-to-r from-[#00b884] via-[#00E5A4] to-[#009e70] text-[#07050B] shadow-[0_6px_24px_-4px_rgba(0,229,164,0.45)] border-t border-white/30'
              : 'bg-gradient-to-r from-[#A020F0] via-[#b43df7] to-[#C45CFF] text-[#FFFFFF] shadow-[0_6px_26px_-4px_rgba(160,32,240,0.55)] border-t border-white/25 hover:brightness-110'
          }`}
        >
          {/* Subtle animated shine */}
          <span className="absolute inset-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none animate-sheen" />

          {/* Premium icon */}
          {connected ? (
            <svg className="w-5 h-5 shrink-0 text-[#07050B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5 shrink-0 text-[#FFFFFF] transition-transform duration-200 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          )}

          <span className="relative z-10 whitespace-nowrap">
            {connected ? 'CONNECT SUCCESSFUL' : 'CONNECT HACK'}
          </span>
        </button>
      </div>

      {/* ========================================================
          4. DOWNLOAD AND SETUP BUTTONS (Stagger 4: Reveal)
          ======================================================== */}
      <div className="animate-dash-4 grid grid-cols-2 gap-2.5">
        {/* DOWNLOAD PANEL */}
        <div className="p-[1px] bg-gradient-to-b from-[#C45CFF]/65 to-[#A020F0]/30 hover:from-[#C45CFF] hover:to-[#A020F0] clip-btn-angular transition-all duration-200">
          <button
            type="button"
            onClick={() => handleOpenExternalUrl(settings?.downloadHackUrl, 'https://t.me/silentx_phantom_official')}
            className="relative w-full h-full bg-[#100C18] hover:bg-[#171124] active:scale-[0.98] py-3 px-2 sm:px-2.5 clip-btn-angular flex items-center justify-center gap-1.5 cursor-pointer transition-all group overflow-hidden"
          >
            <svg
              className="w-3.5 h-3.5 min-[360px]:w-4 min-[360px]:h-4 text-[#C45CFF] group-hover:text-[#FFFFFF] shrink-0 transition-colors"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="text-[#FFFFFF] text-[10.5px] min-[360px]:text-[11.5px] min-[390px]:text-[12px] sm:text-[12.5px] font-black tracking-[0.05em] min-[390px]:tracking-[0.07em] uppercase font-tech whitespace-nowrap">
              DOWNLOAD PANEL
            </span>
          </button>
        </div>

        {/* SETUP VIDEO */}
        <div className="p-[1px] bg-gradient-to-b from-[#C45CFF]/65 to-[#A020F0]/30 hover:from-[#C45CFF] hover:to-[#A020F0] clip-btn-angular transition-all duration-200">
          <button
            type="button"
            onClick={() => handleOpenExternalUrl(settings?.setupVideoUrl, 'https://www.youtube.com/')}
            className="relative w-full h-full bg-[#100C18] hover:bg-[#171124] active:scale-[0.98] py-3 px-2 sm:px-2.5 clip-btn-angular flex items-center justify-center gap-1.5 cursor-pointer transition-all group overflow-hidden"
          >
            <svg
              className="w-3.5 h-3.5 min-[360px]:w-4 min-[360px]:h-4 text-[#C45CFF] group-hover:text-[#FFFFFF] shrink-0 transition-colors"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span className="text-[#FFFFFF] text-[10.5px] min-[360px]:text-[11.5px] min-[390px]:text-[12px] sm:text-[12.5px] font-black tracking-[0.05em] min-[390px]:tracking-[0.07em] uppercase font-tech whitespace-nowrap">
              SETUP VIDEO
            </span>
          </button>
        </div>
      </div>

      {/* ========================================================
          5. TEXT-ONLY LOGOUT (No Button Box)
          ======================================================== */}
      {onDisconnect && (
        <div className="animate-dash-5 pt-2 flex justify-center">
          <span
            role="button"
            tabIndex={0}
            onClick={onDisconnect}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onDisconnect();
              }
            }}
            className="text-[11px] font-mono-code font-bold tracking-[0.22em] uppercase text-[#a69bb8] hover:text-[#C45CFF] underline underline-offset-4 decoration-[#A020F0]/50 hover:decoration-[#C45CFF] transition-colors duration-200 cursor-pointer select-none"
          >
            LOGOUT
          </span>
        </div>
      )}

    </div>
  );
};
