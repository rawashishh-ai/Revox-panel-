import React from 'react';
import { SiteSettings, PurchasePlan } from '../types';
import {
  resolveConfiguredKeyPlans,
  isPlanFullyConfigured,
  formatPlanValidity
} from '../config/purchaseConfig';

interface BuyKeyPageProps {
  settings: SiteSettings;
  selectedPlanId: string | null;
  onBack: () => void;
  onSelectPlan: (plan: PurchasePlan) => void;
}

export const BuyKeyPage: React.FC<BuyKeyPageProps> = ({
  settings,
  selectedPlanId,
  onBack,
  onSelectPlan
}) => {
  const allPlans = resolveConfiguredKeyPlans(settings);

  // Display ONLY plans that are properly configured with a valid price (> 0) and marked available
  const availablePlans = allPlans.filter(
    p => p.available && isPlanFullyConfigured(p)
  );

  const logoSrc =
    settings.logoUrl && settings.logoUrl.trim() !== ''
      ? settings.logoUrl
      : '/assets/revox-logo.png';

  const getValidityLabel = (plan: PurchasePlan): string => {
    const raw = (plan.validityLabel || '').trim();
    if (raw && !/^\d+$/.test(raw)) return raw;
    return formatPlanValidity(plan.durationValue, plan.durationUnit);
  };

  return (
    <div className="relative min-h-[100dvh] w-full bg-[#070B12] text-[#F4F7FB] overflow-y-auto overflow-x-hidden">
      {/* Background radial depth layer (100% opaque base) */}
      <div className="fixed inset-0 vignette-radial pointer-events-none z-0" />

      <div className="relative z-10 flex flex-col min-h-[100dvh]">
        {/* ====================================================================
            HEADER: REVOX BRANDING + BACK BUTTON
            ==================================================================== */}
        <header className="sticky top-0 z-30 w-full bg-[#070B12] border-b border-[#1B2938] px-4 py-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.85)]">
          <div className="w-full max-w-[480px] mx-auto flex items-center justify-between gap-3">
            {/* Left: REVOX Logo + OFFICIAL KEY STORE */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[#0D1622] border border-[#00CFE8]/35 flex items-center justify-center p-1 shrink-0 shadow-[0_0_12px_rgba(0,207,232,0.16)]">
                <img
                  src={logoSrc}
                  alt="REVOX"
                  className="w-full h-full object-contain"
                  onError={e => {
                    (e.currentTarget as HTMLImageElement).src = '/assets/revox-logo.png';
                  }}
                />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold font-tech tracking-wider text-[#F4F7FB] leading-tight truncate">
                  REVOX PANEL
                </div>
                <div className="text-[10px] font-sans font-semibold tracking-wider text-[#00CFE8] leading-tight truncate uppercase">
                  OFFICIAL KEY STORE
                </div>
              </div>
            </div>

            {/* Right: Back Button */}
            <button
              type="button"
              onClick={onBack}
              className="relative overflow-hidden bg-gradient-to-b from-[#132235] to-[#0A131F] hover:from-[#182B42] hover:to-[#0E1A2A] active:scale-95 border border-[#1B2938] hover:border-[#00CFE8]/60 text-[#F4F7FB] text-xs font-semibold px-3.5 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.1)]"
            >
              <span className="text-[#00CFE8]">←</span>
              <span>Back</span>
            </button>
          </div>
        </header>

        {/* ====================================================================
            MAIN CONTENT: PLAN SELECTION ONLY
            ==================================================================== */}
        <main className="w-full max-w-[480px] mx-auto px-4 pt-6 pb-16 space-y-5 flex-1">
          {/* Page Heading */}
          <section className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-[10px] font-tech font-bold tracking-[0.18em] text-[#00CFE8] uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00CFE8]" />
              <span>STEP 1 OF 2 • SELECT YOUR PLAN</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-tech tracking-wide text-[#F4F7FB] uppercase">
              AVAILABLE ACCESS KEY PLANS
            </h1>
            <p className="text-xs sm:text-sm text-[#A7B5C5] font-sans">
              Choose an access-key plan below to continue to secure checkout.
            </p>
          </section>

          {/* Plan Cards */}
          {availablePlans.length > 0 ? (
            <section className="space-y-4">
              {availablePlans.map(plan => {
                const isSelected = selectedPlanId === plan.id;
                const validityText = getValidityLabel(plan);

                return (
                  <div
                    key={plan.id}
                    className={`relative overflow-hidden bg-[#0D1622] rounded-2xl p-5 border transition-all ${
                      isSelected
                        ? 'border-[#00CFE8]/70 shadow-[0_10px_28px_rgba(0,0,0,0.85),0_0_18px_rgba(0,207,232,0.15)]'
                        : 'border-[#1B2938] hover:border-[#00CFE8]/45 shadow-[0_8px_22px_rgba(0,0,0,0.75)]'
                    }`}
                  >
                    {/* Top specular accent line */}
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8]/65 to-transparent" />

                    {/* Plan Title */}
                    <div className="flex items-center justify-between gap-2 mb-4">
                      <h2 className="text-base sm:text-lg font-bold font-tech tracking-wider text-[#F4F7FB] uppercase">
                        {plan.name}
                      </h2>
                      <span className="px-2.5 py-1 rounded-md bg-[#070B12] border border-[#1B2938] text-[10px] font-tech font-bold tracking-wider text-[#00CFE8] uppercase">
                        INSTANT DELIVERY
                      </span>
                    </div>

                    {/* Plan Details: Panel Validity & Price */}
                    <div className="bg-[#070B12] border border-[#1B2938] rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2 text-xs sm:text-sm font-sans">
                        <span className="text-[#A7B5C5] font-medium">
                          Panel Validity:
                        </span>
                        <span className="font-tech font-bold text-[#00CFE8] tracking-wide">
                          {validityText}
                        </span>
                      </div>

                      <div className="h-[1px] bg-[#1B2938]" />

                      <div className="flex items-center justify-between gap-2 text-xs sm:text-sm font-sans">
                        <span className="text-[#A7B5C5] font-medium">
                          Price:
                        </span>
                        <span className="text-lg sm:text-xl font-bold font-tech text-[#F4F7FB] tracking-wide">
                          ₹{plan.priceINR}
                        </span>
                      </div>
                    </div>

                    {plan.description && (
                      <p className="text-xs text-[#A7B5C5] font-sans mt-3.5 leading-relaxed">
                        {plan.description}
                      </p>
                    )}

                    {/* Primary Action: SELECT PLAN */}
                    <button
                      type="button"
                      onClick={() => onSelectPlan(plan)}
                      className="relative overflow-hidden mt-4 w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#00CFE8] via-[#4AE8FF] to-[#168BFF] hover:brightness-110 active:scale-[0.99] text-[#050911] border border-[#B8F6FF]/75 text-xs sm:text-sm font-bold font-tech tracking-wider uppercase transition-all cursor-pointer shadow-[0_6px_20px_rgba(0,207,232,0.28),inset_0_1px_1px_rgba(255,255,255,0.65)]"
                    >
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/30 to-transparent" />
                      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                        <div className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[42%] bg-gradient-to-r from-transparent via-white/55 to-transparent" />
                      </div>
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        <span>SELECT PLAN</span>
                        <span>→</span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </section>
          ) : (
            <section className="bg-[#0D1622] border border-[#1B2938] rounded-2xl p-6 text-center space-y-2 shadow-[0_8px_24px_rgba(0,0,0,0.75)]">
              <p className="text-sm font-semibold text-[#F4F7FB] font-sans">
                No access-key plans are currently available.
              </p>
              <p className="text-xs text-[#A7B5C5] font-sans">
                Please check back later or contact support.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
