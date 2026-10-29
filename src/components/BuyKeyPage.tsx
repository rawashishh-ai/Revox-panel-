import React, { useState } from 'react';
import { SiteSettings, PurchasePlan } from '../types';
import {
  resolveConfiguredKeyPlans,
  isPlanFullyConfigured,
  resolveWhatsAppPurchaseUrl,
  WHATSAPP_PURCHASE_MESSAGE
} from '../config/purchaseConfig';

interface BuyKeyPageProps {
  settings: SiteSettings;
  selectedPlanId: string | null;
  onBack: () => void;
  onSelectPlan: (plan: PurchasePlan) => void;
}

const KeyCardIcon: React.FC<{ isPermanent?: boolean; className?: string }> = ({
  isPermanent,
  className = 'w-4 h-4'
}) => {
  if (isPermanent) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        <path d="M2 6l4.5 5L12 4l5.5 7L22 6l-2 13H4L2 6z" />
        <path d="M4 19h16" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
};

const OnlinePayIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
  </svg>
);

const WhatsAppIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M12.031 2.002c-5.518 0-9.998 4.48-9.998 9.997 0 1.763.459 3.485 1.332 5.003L2 22l5.122-1.343a9.954 9.954 0 0 0 4.908 1.298h.004c5.517 0 9.997-4.48 9.997-9.998a9.963 9.963 0 0 0-2.927-7.071 9.96 9.96 0 0 0-7.073-2.884zm5.847 14.289c-.246.693-1.434 1.326-1.995 1.409-.513.077-1.163.109-1.878-.118-.434-.138-.99-.322-1.703-.629-2.996-1.293-4.953-4.312-5.103-4.512-.149-.199-1.218-1.621-1.218-3.092 0-1.471.771-2.194 1.045-2.493.274-.299.597-.374.796-.374.199 0 .398.002.572.011.183.009.429-.07.672.513.249.598.846 2.069.921 2.218.075.15.124.324.025.524-.099.199-.149.324-.299.498-.149.175-.314.391-.448.524-.149.149-.304.311-.131.61.174.299.773 1.275 1.66 2.066 1.141 1.017 2.103 1.332 2.402 1.482.299.149.473.124.647-.075.174-.199.747-.872.946-1.171.199-.299.398-.249.672-.149.274.1 1.742.822 2.041.972.299.149.498.224.572.349.075.124.075.722-.171 1.415z" />
  </svg>
);

export const BuyKeyPage: React.FC<BuyKeyPageProps> = ({
  settings,
  onBack,
  onSelectPlan
}) => {
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  const allPlans = resolveConfiguredKeyPlans(settings);

  // Display ONLY plans that are properly configured with a valid price (> 0) and marked available
  const availablePlans = allPlans.filter(
    p => p.available && isPlanFullyConfigured(p)
  );

  const logoSrc =
    settings.logoUrl && settings.logoUrl.trim() !== ''
      ? settings.logoUrl
      : '/assets/revox-logo.png';

  const getShortPlanTag = (plan: PurchasePlan): string => {
    if (plan.durationUnit === 'lifetime') return 'PERMANENT';
    const val = plan.durationValue || 7;
    if (plan.durationUnit === 'minutes') return `${val} MIN${val === 1 ? '' : 'S'}`;
    if (plan.durationUnit === 'hours') return `${val} HOUR${val === 1 ? '' : 'S'}`;
    return `${val} DAY${val === 1 ? '' : 'S'}`;
  };

  const handleBuyPlanOnWhatsApp = (_plan: PurchasePlan) => {
    const resolved = resolveWhatsAppPurchaseUrl(settings, WHATSAPP_PURCHASE_MESSAGE);
    window.open(resolved.url, '_blank', 'noopener,noreferrer');
  };

  const handleTogglePlan = (planId: string) => {
    setExpandedPlanId(prev => (prev === planId ? null : planId));
  };

  return (
    <div className="relative min-h-[100svh] w-full max-w-full box-border bg-[#05070B] text-[#F4F7FF] overflow-y-auto overflow-x-hidden selection:bg-[#00D9FF]/25 selection:text-[#F4F7FF]">
      {/* Subtle Navy & Cyan Ambient Lighting Layers */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(circle at 50% 0%, rgba(22, 139, 255, 0.14) 0%, rgba(13, 21, 34, 0.48) 38%, rgba(5, 7, 11, 1) 82%)'
        }}
      />
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-[680px] h-[240px] pointer-events-none z-0 opacity-60"
        style={{
          background:
            'radial-gradient(ellipse at top, rgba(0, 217, 255, 0.12) 0%, transparent 70%)'
        }}
      />

      <div className="relative z-10 flex flex-col min-h-[100svh] w-full max-w-full box-border">
        {/* ====================================================================
            1. COMPACT PREMIUM HEADER: REVOX LOGO + BRAND + BACK BUTTON
            ==================================================================== */}
        <header className="sticky top-0 z-30 w-full max-w-full box-border bg-[#05070B]/90 backdrop-blur-md border-b border-[#00D9FF]/15 px-[clamp(0.875rem,3.5vw,1.5rem)] py-3 shadow-[0_6px_24px_rgba(0,0,0,0.75)]">
          <div className="w-full max-w-[540px] mx-auto flex items-center justify-between gap-2.5 min-w-0">
            {/* Left: REVOX Logo + Brand Title & Subtitle */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#0D1522] border border-[#00D9FF]/35 flex items-center justify-center p-1.5 shrink-0 shadow-[0_0_14px_rgba(0,217,255,0.14),inset_0_1px_0_rgba(255,255,255,0.08)]">
                <img
                  src={logoSrc}
                  alt="REVOX PANEL"
                  className="w-full h-full object-contain"
                  onError={e => {
                    (e.currentTarget as HTMLImageElement).src = '/assets/revox-logo.png';
                  }}
                />
              </div>
              <div className="min-w-0">
                <div className="text-[clamp(0.875rem,2.6vw,1.05rem)] font-bold font-tech tracking-[0.08em] text-[#F4F7FF] leading-tight truncate">
                  REVOX PANEL
                </div>
                <div className="text-[clamp(0.625rem,1.8vw,0.7rem)] font-sans font-semibold tracking-[0.14em] text-[#00D9FF] leading-tight truncate uppercase">
                  OFFICIAL KEY STORE
                </div>
              </div>
            </div>

            {/* Right: Premium Back Button */}
            <button
              type="button"
              onClick={onBack}
              className="relative overflow-hidden bg-[#0D1522] hover:bg-[#132033] active:scale-[0.97] border border-[#00D9FF]/30 hover:border-[#00D9FF]/65 text-[#F4F7FF] text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all duration-200 shrink-0 shadow-[0_4px_14px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]"
            >
              <span className="text-[#00D9FF] text-sm leading-none">←</span>
              <span className="tracking-wide">Back</span>
            </button>
          </div>
        </header>

        {/* ====================================================================
            MAIN CONTENT CONTAINER
            ==================================================================== */}
        <main className="w-full max-w-[540px] mx-auto px-[clamp(0.875rem,3.5vw,1.5rem)] pt-[clamp(1.1rem,3vw,1.6rem)] pb-14 space-y-[clamp(1.1rem,3vw,1.5rem)] flex-1 box-border">
          {/* ====================================================================
              2. PAGE INTRODUCTION
              ==================================================================== */}
          <section className="space-y-1.5 min-w-0">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#0D1522] border border-[#00D9FF]/25 text-[clamp(0.625rem,1.8vw,0.72rem)] font-tech font-bold tracking-[0.16em] text-[#00D9FF] uppercase max-w-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00D9FF] shadow-[0_0_8px_#00D9FF] shrink-0" />
              <span className="truncate">STEP 1 OF 2 • SELECT YOUR PLAN</span>
            </div>

            <h1 className="text-[clamp(1.25rem,4vw,1.65rem)] font-extrabold font-tech tracking-[0.06em] text-[#F4F7FF] uppercase leading-tight pt-0.5">
              💎 KEY PRICES
            </h1>

            <p className="text-[clamp(0.775rem,2.2vw,0.9rem)] text-[#A6B2C4] font-sans leading-relaxed">
              Tap any key plan below to choose <span className="text-[#00D9FF] font-semibold">Buy Online</span> or <span className="text-[#20D9A0] font-semibold">WhatsApp</span>.
            </p>
          </section>

          {/* ====================================================================
              3. OFFICIAL KEY PRICE LIST — GLASS EFFECT BUTTONS WITH 2 OPTIONS ON CLICK
              ==================================================================== */}
          {availablePlans.length > 0 ? (
            <section className="relative overflow-hidden bg-[#0D1522]/90 backdrop-blur-xl border border-[#00D9FF]/35 rounded-2xl p-[clamp(0.95rem,3vw,1.3rem)] shadow-[0_14px_36px_rgba(0,0,0,0.8),0_0_24px_rgba(0,217,255,0.08),inset_0_1px_1px_rgba(255,255,255,0.1)] box-border">
              {/* Top luminous specular edge */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#00D9FF]/80 to-transparent" />

              {/* Card Header + 1-DEVICE LOCK Badge */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5 pb-2.5 border-b border-[#1A2940]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-[#00D9FF] shadow-[0_0_8px_#00D9FF] shrink-0" />
                  <span className="text-[clamp(0.7rem,2vw,0.8rem)] font-bold font-tech tracking-[0.13em] text-[#00D9FF] uppercase truncate">
                    OFFICIAL KEY PRICE LIST
                  </span>
                </div>

                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-[#111D2E] border border-[#20D9A0]/35 text-[10px] font-mono-code font-bold tracking-wider text-[#20D9A0] uppercase shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#20D9A0]" />
                  <span>1-DEVICE LOCK</span>
                </span>
              </div>

              {/* Glass-Effect Price Buttons */}
              <div className="space-y-2.5">
                {availablePlans.map(plan => {
                  const tag = getShortPlanTag(plan);
                  const isPerm = plan.durationUnit === 'lifetime';
                  const isExpanded = expandedPlanId === plan.id;

                  return (
                    <div
                      key={plan.id}
                      className={`relative rounded-xl p-[1px] transition-all duration-200 ${
                        isExpanded
                          ? 'bg-gradient-to-r from-[#00D9FF] via-[#F4F7FF]/70 to-[#20D9A0] shadow-[0_8px_26px_rgba(0,217,255,0.22)]'
                          : isPerm
                          ? 'bg-gradient-to-r from-[#00D9FF]/60 via-[#168BFF]/40 to-[#00D9FF]/60 hover:from-[#00D9FF]/85 hover:to-[#20D9A0]/75 shadow-[0_4px_16px_rgba(0,217,255,0.12)]'
                          : 'bg-gradient-to-r from-[#00D9FF]/35 via-[#1E334E] to-[#168BFF]/35 hover:from-[#00D9FF]/70 hover:to-[#168BFF]/65 shadow-[0_4px_14px_rgba(0,0,0,0.45)]'
                      }`}
                    >
                      <div className="relative rounded-[11px] bg-gradient-to-r from-[#0B1422]/95 via-[#112036]/95 to-[#0B1422]/95 backdrop-blur-md overflow-hidden">
                        {/* Primary Glass-Effect Price Button */}
                        <button
                          type="button"
                          onClick={() => handleTogglePlan(plan.id)}
                          aria-expanded={isExpanded}
                          className="group relative w-full min-w-0 flex items-center justify-between gap-2.5 px-3.5 py-3 text-left cursor-pointer transition-all duration-150 active:scale-[0.99] overflow-hidden shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.22),inset_0_-1px_1px_rgba(0,217,255,0.12)]"
                        >
                          {/* Top-Half Glossy Glass Reflection */}
                          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.11] via-[#00D9FF]/[0.03] to-transparent" />

                          {/* Top Specular Light Rail */}
                          <span className="pointer-events-none absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/60 to-transparent" />

                          {/* Sweeping Glass Shine Effect */}
                          <span className="pointer-events-none absolute inset-0 overflow-hidden">
                            <span className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[36%] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                          </span>

                          {/* Left: Icon + Plan Duration */}
                          <div className="relative z-10 flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border transition-all ${
                                isPerm || isExpanded
                                  ? 'bg-[#00D9FF]/15 border-[#00D9FF]/60 text-[#00D9FF] shadow-[0_0_10px_rgba(0,217,255,0.28),inset_0_1px_1px_rgba(255,255,255,0.2)]'
                                  : 'bg-[#08101B]/90 border-[#00D9FF]/30 text-[#00D9FF] group-hover:border-[#00D9FF]/65 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]'
                              }`}
                            >
                              <KeyCardIcon isPermanent={isPerm} className="w-3.5 h-3.5" />
                            </span>
                            <span
                              className={`text-[clamp(0.8rem,2.3vw,0.92rem)] font-extrabold font-tech tracking-[0.08em] uppercase truncate ${
                                isPerm || isExpanded
                                  ? 'text-[#00D9FF] drop-shadow-[0_0_8px_rgba(0,217,255,0.3)]'
                                  : 'text-[#F4F7FF]'
                              }`}
                            >
                              {tag}
                            </span>
                          </div>

                          {/* Right: Price + Glass Indicator */}
                          <div className="relative z-10 flex items-center gap-2 shrink-0">
                            <span className="text-xs text-[#A6B2C4] group-hover:text-[#00D9FF] transition-colors">
                              —
                            </span>
                            <span className="text-[clamp(0.92rem,2.6vw,1.05rem)] font-extrabold font-mono-code text-[#20D9A0] tracking-tight drop-shadow-[0_0_8px_rgba(32,217,160,0.25)]">
                              ₹{plan.priceINR}
                            </span>
                            <span
                              className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] border transition-all duration-200 ${
                                isExpanded
                                  ? 'bg-[#00D9FF]/20 border-[#00D9FF]/60 text-[#00D9FF] rotate-180'
                                  : 'bg-[#08101B]/80 border-[#1E324C] text-[#A6B2C4] group-hover:border-[#00D9FF]/45 group-hover:text-[#00D9FF]'
                              }`}
                            >
                              ▼
                            </span>
                          </div>
                        </button>

                        {/* Two Glass-Effect Options Shown on Click: BUY ONLINE & WHATSAPP */}
                        {isExpanded && (
                          <div className="px-3 pb-3 pt-2 border-t border-[#00D9FF]/25 bg-[#070D17]/90 space-y-2 animate-fade-in">
                            <div className="flex items-center justify-between text-[10px] font-tech font-bold tracking-[0.12em] text-[#A6B2C4] uppercase px-0.5">
                              <span>SELECT PURCHASE OPTION</span>
                              <span className="text-[#00D9FF]">
                                {tag} • ₹{plan.priceINR}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {/* OPTION 1: BUY ONLINE (Glass Cyan-Blue Button) */}
                              <div className="relative group/online p-[1px] rounded-xl bg-gradient-to-r from-[#00D9FF] via-[#F4F7FF]/80 to-[#168BFF] shadow-[0_5px_18px_rgba(0,217,255,0.28)] transition-transform duration-150 hover:scale-[1.01] active:scale-[0.985]">
                                <button
                                  type="button"
                                  onClick={() => onSelectPlan(plan)}
                                  className="relative w-full rounded-[11px] bg-gradient-to-r from-[#00D9FF] via-[#22B8FF] to-[#168BFF] hover:brightness-110 px-3 py-2.5 flex items-center justify-between gap-2 text-left cursor-pointer overflow-hidden shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.65),inset_0_-1px_2px_rgba(5,7,11,0.3)]"
                                >
                                  {/* Top-Half Glossy Glass Reflection */}
                                  <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />

                                  {/* Sweeping Shine Beam */}
                                  <span className="pointer-events-none absolute inset-0 overflow-hidden">
                                    <span className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[45%] bg-gradient-to-r from-transparent via-white/70 to-transparent" />
                                  </span>

                                  <div className="relative z-10 flex items-center gap-2 min-w-0">
                                    <span className="w-7 h-7 rounded-lg bg-[#05070B] border border-[#00D9FF]/80 flex items-center justify-center text-[#00D9FF] shrink-0 shadow-[0_2px_8px_rgba(5,7,11,0.45)]">
                                      <OnlinePayIcon className="w-3.5 h-3.5" />
                                    </span>
                                    <div className="min-w-0">
                                      <div className="text-xs font-black font-tech tracking-[0.08em] text-[#05070B] uppercase leading-tight truncate">
                                        BUY ONLINE
                                      </div>
                                      <div className="text-[10px] font-sans font-bold text-[#05070B]/80 leading-tight truncate">
                                        Instant UPI QR • ₹{plan.priceINR}
                                      </div>
                                    </div>
                                  </div>

                                  <span className="relative z-10 text-xs font-black text-[#05070B] transition-transform duration-150 group-hover/online:translate-x-0.5 shrink-0">
                                    →
                                  </span>
                                </button>
                              </div>

                              {/* OPTION 2: BUY ON WHATSAPP (Glass Emerald Button) */}
                              <div className="relative group/wa p-[1px] rounded-xl bg-gradient-to-r from-[#20D9A0]/80 via-[#F4F7FF]/60 to-[#00D9FF]/70 shadow-[0_5px_18px_rgba(32,217,160,0.2)] transition-transform duration-150 hover:scale-[1.01] active:scale-[0.985]">
                                <button
                                  type="button"
                                  onClick={() => handleBuyPlanOnWhatsApp(plan)}
                                  className="relative w-full rounded-[11px] bg-gradient-to-r from-[#091926] via-[#0F2938] to-[#091926] hover:from-[#0D2233] hover:via-[#143346] hover:to-[#0D2233] px-3 py-2.5 flex items-center justify-between gap-2 text-left cursor-pointer overflow-hidden shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.32),inset_0_-1px_1.5px_rgba(32,217,160,0.25),inset_0_0_14px_rgba(32,217,160,0.14)]"
                                >
                                  {/* Top-Half Glossy Glass Reflection */}
                                  <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.14] via-[#20D9A0]/[0.05] to-transparent" />

                                  {/* Sweeping Shine Beam */}
                                  <span className="pointer-events-none absolute inset-0 overflow-hidden">
                                    <span className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[45%] bg-gradient-to-r from-transparent via-white/45 to-transparent" />
                                  </span>

                                  <div className="relative z-10 flex items-center gap-2 min-w-0">
                                    <span className="w-7 h-7 rounded-lg bg-[#062019] border border-[#20D9A0]/80 flex items-center justify-center text-[#20D9A0] shrink-0 shadow-[0_0_10px_rgba(32,217,160,0.4)]">
                                      <WhatsAppIcon className="w-3.5 h-3.5" />
                                    </span>
                                    <div className="min-w-0">
                                      <div className="text-xs font-black font-tech tracking-[0.08em] text-[#F4F7FF] uppercase leading-tight truncate drop-shadow-[0_0_6px_rgba(32,217,160,0.35)]">
                                        WHATSAPP
                                      </div>
                                      <div className="text-[10px] font-sans font-semibold text-[#20D9A0] leading-tight truncate">
                                        Direct Chat • ₹{plan.priceINR}
                                      </div>
                                    </div>
                                  </div>

                                  <span className="relative z-10 text-xs font-black text-[#20D9A0] transition-transform duration-150 group-hover/wa:translate-x-0.5 shrink-0">
                                    →
                                  </span>
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="bg-[#0D1522] border border-[#1B2B42] rounded-2xl p-6 text-center space-y-2 shadow-[0_10px_26px_rgba(0,0,0,0.72)]">
              <p className="text-sm font-semibold text-[#F4F7FF] font-sans">
                No access-key plans are currently available.
              </p>
              <p className="text-xs text-[#A6B2C4] font-sans">
                Please check back later or contact support.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

