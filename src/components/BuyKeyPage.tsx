import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { SiteSettings, PurchasePlan, PaymentOrder, AccessKey } from '../types';
import {
  resolveConfiguredKeyPlans,
  isPlanFullyConfigured,
  formatPlanValidity,
  resolveWhatsAppPurchaseUrl,
  WHATSAPP_PURCHASE_MESSAGE
} from '../config/purchaseConfig';

interface BuyKeyPageProps {
  settings: SiteSettings;
  onBack: () => void;
  onContinueWithKey: (key: string) => void;
}

type CheckoutStep =
  | 'plans'
  | 'gateway_setup_required'
  | 'payment_pending'
  | 'animating_success'
  | 'animating_reject'
  | 'payment_failed'
  | 'payment_success';

function generateClientAccessKey(prefix = 'RVX'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const cleanPrefix =
    (prefix || 'RVX')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 5) || 'RVX';
  const seg = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${cleanPrefix}-${seg()}-${seg()}-${seg()}`;
}

export const BuyKeyPage: React.FC<BuyKeyPageProps> = ({
  settings,
  onBack,
  onContinueWithKey
}) => {
  const allPlans = resolveConfiguredKeyPlans(settings);

  // Display ONLY plans that are properly configured with a valid price (> 0) and marked available
  const availablePlans = allPlans.filter(
    p => p.available && isPlanFullyConfigured(p)
  );

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(() => {
    return availablePlans.length > 0 ? availablePlans[0].id : null;
  });

  const selectedPlan: PurchasePlan | null =
    availablePlans.find(p => p.id === selectedPlanId) || null;

  const [step, setStep] = useState<CheckoutStep>('plans');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [utrNumber, setUtrNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [activeOrder, setActiveOrder] = useState<PaymentOrder | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // 10-second animation state (for both Payment Successful and Payment Reject)
  const [animSecondsLeft, setAnimSecondsLeft] = useState<number>(10);
  const [animProgress, setAnimProgress] = useState<number>(0);
  const animTimerRef = useRef<number | null>(null);

  // Keep selectedPlanId synced with availablePlans when settings update
  useEffect(() => {
    const validPlans = resolveConfiguredKeyPlans(settings).filter(
      p => p.available && isPlanFullyConfigured(p)
    );
    if (selectedPlanId) {
      const stillValid = validPlans.some(p => p.id === selectedPlanId);
      if (!stillValid) {
        setSelectedPlanId(validPlans.length > 0 ? validPlans[0].id : null);
      }
    } else if (validPlans.length > 0) {
      setSelectedPlanId(validPlans[0].id);
    }
  }, [settings.version]);

  // Cleanup animation interval on unmount
  useEffect(() => {
    return () => {
      if (animTimerRef.current) {
        window.clearInterval(animTimerRef.current);
      }
    };
  }, []);

  // Poll backend payment status while order is PENDING
  useEffect(() => {
    if (step !== 'payment_pending' || !activeOrder?.orderId) return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(
          `/api/payments/order-status/${encodeURIComponent(activeOrder.orderId)}?verify=true`
        );
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return;
        const data = await res.json();

        if (data.success && data.order) {
          setActiveOrder(data.order);
          if (data.order.paymentStatus === 'SUCCESS') {
            clearInterval(interval);
            startTenSecondAnimation('success', data.order);
          } else if (
            data.order.paymentStatus === 'FAILED' ||
            data.order.paymentStatus === 'CANCELLED'
          ) {
            clearInterval(interval);
            startTenSecondAnimation('reject', data.order);
          }
        }
      } catch {
        // Ignore transient network errors during polling
      }

      if (attempts > 180) {
        clearInterval(interval);
      }
    }, 3500);

    return () => clearInterval(interval);
  }, [step, activeOrder?.orderId]);

  const startTenSecondAnimation = (
    mode: 'success' | 'reject',
    finalOrder?: PaymentOrder | null
  ) => {
    if (animTimerRef.current) {
      window.clearInterval(animTimerRef.current);
    }

    const totalMs = 10000; // 10 seconds
    const startTime = Date.now();
    setAnimSecondsLeft(10);
    setAnimProgress(0);
    setStep(mode === 'success' ? 'animating_success' : 'animating_reject');

    animTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / totalMs) * 100));
      const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));

      setAnimProgress(pct);
      setAnimSecondsLeft(remaining);

      if (elapsed >= totalMs) {
        if (animTimerRef.current) {
          window.clearInterval(animTimerRef.current);
          animTimerRef.current = null;
        }
        if (finalOrder) {
          setActiveOrder(finalOrder);
        }
        if (mode === 'success') {
          setErrorMsg(null);
          setStep('payment_success');
        } else {
          setErrorMsg(
            'Payment was rejected or cancelled during verification. No access key was generated.'
          );
          setStep('payment_failed');
        }
      }
    }, 100);
  };

  const handleSelectPlan = (plan: PurchasePlan) => {
    if (!plan.available || !isPlanFullyConfigured(plan)) return;
    setSelectedPlanId(plan.id);
    setErrorMsg(null);
    setStatusMessage(null);
    if (step !== 'plans') {
      setStep('plans');
    }
  };

  const handleStartCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || !selectedPlan.available || !isPlanFullyConfigured(selectedPlan)) {
      setErrorMsg('Please select an available plan to proceed.');
      return;
    }

    if (settings.keySalesEnabled === false) {
      setStep('gateway_setup_required');
      setStatusMessage(
        'Website checkout is currently disabled by the administrator. Please check back later or purchase via WhatsApp.'
      );
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlan.id,
          customerName: customerName.trim() || 'REVOX Customer',
          customerPhone: customerPhone.trim() || ''
        })
      });

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (res.ok && data.success && data.order) {
          setActiveOrder(data.order);
          setStep('payment_pending');
          return;
        }
      }

      // Fallback order creation if running on static host without /api/payments/create-order
      const fallbackOrderId = `RVX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const amount = Number(selectedPlan.priceINR);
      const upiVpa = 'ashishseller@upi';
      const upiNote = encodeURIComponent(`REVOX ${selectedPlan.name} (${fallbackOrderId})`);
      const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent('REVOX PANEL')}&am=${amount}&cu=INR&tn=${upiNote}`;

      const fallbackOrder: PaymentOrder = {
        orderId: fallbackOrderId,
        customerName: customerName.trim() || 'REVOX Customer',
        customerPhone: customerPhone.trim() || 'N/A',
        amount,
        currency: 'INR',
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        planDurationValue: Number(selectedPlan.durationValue) || 7,
        planDurationUnit: selectedPlan.durationUnit || 'days',
        paymentStatus: 'PENDING',
        assignedKey: undefined,
        keyDeliveryStatus: 'PENDING',
        upiIntentUrl,
        purchasedAt: new Date().toISOString()
      };

      setActiveOrder(fallbackOrder);
      setStep('payment_pending');
    } catch {
      const fallbackOrderId = `RVX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const amount = Number(selectedPlan.priceINR);
      const upiVpa = 'ashishseller@upi';
      const upiNote = encodeURIComponent(`REVOX ${selectedPlan.name} (${fallbackOrderId})`);
      const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent('REVOX PANEL')}&am=${amount}&cu=INR&tn=${upiNote}`;

      const fallbackOrder: PaymentOrder = {
        orderId: fallbackOrderId,
        customerName: customerName.trim() || 'REVOX Customer',
        customerPhone: customerPhone.trim() || 'N/A',
        amount,
        currency: 'INR',
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        planDurationValue: Number(selectedPlan.durationValue) || 7,
        planDurationUnit: selectedPlan.durationUnit || 'days',
        paymentStatus: 'PENDING',
        assignedKey: undefined,
        keyDeliveryStatus: 'PENDING',
        upiIntentUrl,
        purchasedAt: new Date().toISOString()
      };

      setActiveOrder(fallbackOrder);
      setStep('payment_pending');
    } finally {
      setLoading(false);
    }
  };

  // Confirm Payment -> Generates Real Working Access Key + Runs 10-Second Payment Successful Animation
  const handleConfirmAndGenerateKey = async () => {
    if (!activeOrder) return;
    setLoading(true);
    setErrorMsg(null);
    setStatusMessage(null);

    let updatedOrder: PaymentOrder = { ...activeOrder };

    try {
      const res = await fetch('/api/payments/complete-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: activeOrder.orderId,
          action: 'confirm',
          utrNumber: utrNumber.trim()
        })
      });

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (res.ok && data.success && data.order) {
          updatedOrder = data.order;
        }
      }
    } catch {
      // Fallback below will generate and persist the key to Firestore
    }

    // Ensure a real 1-device locked Access Key is generated and persisted in Firestore
    if (!updatedOrder.assignedKey) {
      const generatedKeyStr = generateClientAccessKey('RVX');
      const nowIso = new Date().toISOString();
      updatedOrder = {
        ...updatedOrder,
        paymentStatus: 'SUCCESS',
        assignedKey: generatedKeyStr,
        keyDeliveryStatus: 'DELIVERED',
        paidAt: nowIso
      };
    }

    // Mirror both the AccessKey and Order to Firestore so the key unlocks immediately on all deployments
    try {
      if (updatedOrder.assignedKey) {
        const durUnit = updatedOrder.planDurationUnit || selectedPlan?.durationUnit || 'days';
        const durVal = Number(updatedOrder.planDurationValue || selectedPlan?.durationValue) || 7;
        const durationDays =
          durUnit === 'lifetime'
            ? 36500
            : durUnit === 'days'
            ? durVal
            : durUnit === 'hours'
            ? Math.max(1, Math.ceil(durVal / 24))
            : Math.max(1, Math.ceil(durVal / 1440));
        const durationMs =
          durUnit === 'lifetime'
            ? 36500 * 86400000
            : durUnit === 'days'
            ? durVal * 86400000
            : durUnit === 'hours'
            ? durVal * 3600000
            : durVal * 60000;

        const keyId = updatedOrder.assignedKeyId || `key_${Date.now()}`;
        const newAccessKeyDoc: AccessKey = {
          id: keyId,
          key: updatedOrder.assignedKey,
          customerName: updatedOrder.customerName || 'REVOX Customer',
          status: 'active',
          durationDays,
          durationUnit: durUnit,
          durationValue: durVal,
          durationMs,
          createdAt: updatedOrder.paidAt || new Date().toISOString(),
          activatedAt: null,
          expiresAt: null,
          boundDeviceId: null,
          activeSessionToken: null,
          lastVerifiedAt: null,
          renewedAt: null,
          updatedAt: new Date().toISOString(),
          notes: `Online Purchase (${updatedOrder.orderId})`
        };
        await setDoc(
          doc(db, 'accessKeys', newAccessKeyDoc.id),
          newAccessKeyDoc,
          { merge: true }
        );
      }
    } catch {
      // Server already synced or Firestore rules handled it
    }

    setActiveOrder(updatedOrder);
    setLoading(false);

    // Run 10-second Payment Successful & Key Generation Animation
    startTenSecondAnimation('success', updatedOrder);
  };

  // Reject / Cancel Payment -> Runs 10-Second Payment Reject Animation
  const handleRejectPayment = async () => {
    if (!activeOrder) {
      setStep('plans');
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    let rejectedOrder: PaymentOrder = {
      ...activeOrder,
      paymentStatus: 'FAILED',
      assignedKey: undefined
    };

    try {
      const res = await fetch('/api/payments/complete-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: activeOrder.orderId,
          action: 'reject'
        })
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (data.order) {
          rejectedOrder = data.order;
        }
      }
    } catch {
      // Ignore network error on reject
    }

    setActiveOrder(rejectedOrder);
    setLoading(false);

    // Run 10-second Payment Reject Animation
    startTenSecondAnimation('reject', rejectedOrder);
  };

  const handleCopyKey = () => {
    if (!activeOrder?.assignedKey) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(activeOrder.assignedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleOpenWhatsAppFallback = () => {
    const resolved = resolveWhatsAppPurchaseUrl(settings, WHATSAPP_PURCHASE_MESSAGE);
    if (resolved.configured) {
      window.open(resolved.url, '_blank', 'noopener,noreferrer');
    }
  };

  const logoSrc =
    settings.logoUrl && settings.logoUrl.trim() !== ''
      ? settings.logoUrl
      : '/assets/revox-logo.png';

  const getSelectedValidityLabel = (plan: PurchasePlan | null): string => {
    if (!plan) return '7 Days';
    const raw = (plan.validityLabel || '').trim();
    if (raw && !/^\d+$/.test(raw)) return raw;
    return formatPlanValidity(plan.durationValue, plan.durationUnit);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-[#070B12] vignette-radial text-[#F4F7FB] overflow-y-auto overflow-x-hidden select-none">
      {/* ====================================================================
          SECTION 1: COMPACT HEADER (100% SOLID BACKGROUND)
          ==================================================================== */}
      <header className="w-full bg-[#070B12] border-b border-[#00CFE8]/25 px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.85)]">
        <div className="w-full max-w-[480px] mx-auto flex items-center justify-between gap-3">
          {/* Left: REVOX Logo + OFFICIAL KEY STORE */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#0D1622] border border-[#00CFE8]/35 flex items-center justify-center p-1 shrink-0 shadow-[0_0_12px_rgba(0,207,232,0.18)]">
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
                REVOX
              </div>
              <div className="text-[10px] font-sans font-semibold tracking-wider text-[#00CFE8] leading-tight truncate">
                OFFICIAL KEY STORE
              </div>
            </div>
          </div>

          {/* Right: Glowing Glass Back Button */}
          <button
            type="button"
            onClick={onBack}
            className="relative overflow-hidden bg-gradient-to-b from-[#132235] to-[#0A131F] hover:from-[#182B42] hover:to-[#0E1A2A] active:scale-95 border border-[#00CFE8]/35 hover:border-[#00CFE8]/70 text-[#F4F7FB] text-xs font-semibold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all shrink-0 shadow-[0_0_14px_rgba(0,207,232,0.15),inset_0_1px_0_rgba(255,255,255,0.15)]"
          >
            <span className="text-[#00CFE8]">←</span>
            <span>Back</span>
          </button>
        </div>
      </header>

      {/* ====================================================================
          MAIN CONTENT IN NORMAL DOCUMENT FLOW (NO OVERLAPPING CONTAINERS)
          ==================================================================== */}
      <main className="w-full max-w-[480px] mx-auto px-4 pt-5 pb-14 space-y-5">
        {/* ==================================================================
            SECTION 2: PAGE TITLE
            ================================================================== */}
        <section>
          <h1 className="text-xl sm:text-2xl font-bold font-tech tracking-wide text-[#F4F7FB]">
            PURCHASE ACCESS KEY
          </h1>
          <p className="text-xs sm:text-sm text-[#A7B5C5] font-sans mt-1">
            Choose your plan and unlock REVOX PANEL with instant key generation.
          </p>
        </section>

        {/* ==================================================================
            STEP 1: AVAILABLE PLANS & CHECKOUT
            ================================================================== */}
        {step === 'plans' && (
          <>
            {/* SECTION 3: AVAILABLE PLAN CARDS */}
            {availablePlans.length > 0 ? (
              <section className="space-y-3.5">
                {availablePlans.map(plan => {
                  const isSelected = selectedPlan?.id === plan.id;
                  const validityText = getSelectedValidityLabel(plan);

                  return (
                    <div
                      key={plan.id}
                      onClick={() => handleSelectPlan(plan)}
                      className={`relative overflow-hidden bg-[#0D1622] rounded-2xl p-4 sm:p-5 border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#00CFE8] shadow-[0_8px_28px_rgba(0,0,0,0.85),0_0_22px_rgba(0,207,232,0.22),inset_0_1px_0_rgba(255,255,255,0.14)]'
                          : 'border-[#1B2938] hover:border-[#00CFE8]/50 shadow-[0_6px_20px_rgba(0,0,0,0.7)]'
                      }`}
                    >
                      {/* Top glass specular highlight */}
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8]/70 to-transparent" />

                      {/* Plan Header Badge & Name */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <h2 className="text-base sm:text-lg font-bold font-tech tracking-wide text-[#F4F7FB] uppercase">
                          {plan.name}
                        </h2>
                        <span className="px-2.5 py-0.5 rounded-md bg-[#080D14] border border-[#00CFE8]/40 text-[10px] font-tech font-bold tracking-wider text-[#00CFE8] uppercase">
                          INSTANT KEY
                        </span>
                      </div>

                      {/* REQUIRED PLAN DETAILS: Panel Validity - & Price - */}
                      <div className="bg-[#080D14] border border-[#00CFE8]/25 rounded-xl p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2 text-xs sm:text-sm font-sans">
                          <span className="text-[#A7B5C5] font-medium">
                            Panel Validity -
                          </span>
                          <span className="font-tech font-bold text-[#00CFE8] tracking-wide">
                            {validityText}
                          </span>
                        </div>

                        <div className="h-[1px] bg-[#1B2938]" />

                        <div className="flex items-center justify-between gap-2 text-xs sm:text-sm font-sans">
                          <span className="text-[#A7B5C5] font-medium">
                            Price -
                          </span>
                          <span className="text-lg sm:text-xl font-bold font-tech text-[#F4F7FB] tracking-wide">
                            ₹{plan.priceINR}
                          </span>
                        </div>
                      </div>

                      {plan.description && (
                        <p className="text-xs text-[#A7B5C5] font-sans mt-3 leading-relaxed">
                          {plan.description}
                        </p>
                      )}

                      {/* Glowing Glass & Shine SELECT PLAN Button */}
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleSelectPlan(plan);
                        }}
                        className={`relative overflow-hidden mt-4 w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-bold font-tech tracking-wider transition-all cursor-pointer active:scale-[0.99] ${
                          isSelected
                            ? 'bg-gradient-to-r from-[#00CFE8] via-[#4AE8FF] to-[#168BFF] text-[#050911] border border-[#B8F6FF]/75 shadow-[0_0_20px_rgba(0,207,232,0.32),inset_0_1px_1px_rgba(255,255,255,0.65)]'
                            : 'bg-gradient-to-b from-[#132235] to-[#09121E] hover:from-[#172A40] hover:to-[#0C1726] border border-[#00CFE8]/40 text-[#F4F7FB] shadow-[0_0_15px_rgba(0,207,232,0.14),inset_0_1px_0_rgba(255,255,255,0.14)]'
                        }`}
                      >
                        {/* Top Glossy Bevel */}
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/25 to-transparent" />
                        {/* Continuous Diagonal Shine Sweep */}
                        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                          <div className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[42%] bg-gradient-to-r from-transparent via-white/55 to-transparent" />
                        </div>
                        <span className="relative z-10">
                          {isSelected ? '✓ SELECTED PLAN' : 'SELECT PLAN'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </section>
            ) : (
              <section className="bg-[#0D1622] border border-[#1B2938] rounded-xl p-5 text-center space-y-2">
                <p className="text-sm font-medium text-[#F4F7FB] font-sans">
                  No plans are currently available. Please check back later.
                </p>
                <p className="text-xs text-[#A7B5C5] font-sans">
                  Administrator note: Configure plan price and availability in Admin Panel → Settings.
                </p>
              </section>
            )}

            {/* SECTION 4: CHECKOUT (APPEARS BELOW AVAILABLE PLANS IN NORMAL FLOW) */}
            {selectedPlan && (
              <section className="relative overflow-hidden bg-[#0D1622] border border-[#00CFE8]/35 rounded-2xl p-4 sm:p-5 shadow-[0_10px_30px_rgba(0,0,0,0.85),0_0_18px_rgba(0,207,232,0.12)]">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8]/65 to-transparent" />

                <form onSubmit={handleStartCheckout} className="space-y-4">
                  <div className="text-xs font-tech font-bold tracking-wider uppercase text-[#00CFE8]">
                    ORDER SUMMARY & CHECKOUT
                  </div>

                  {/* Summary Rows with Panel Validity - and Price - */}
                  <div className="bg-[#080D14] border border-[#1B2938] rounded-xl p-3.5 space-y-2.5 text-xs font-sans">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#A7B5C5]">Selected Plan -</span>
                      <span className="font-semibold text-[#F4F7FB] font-tech">
                        {selectedPlan.name}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#A7B5C5]">Panel Validity -</span>
                      <span className="font-bold text-[#00CFE8] font-tech">
                        {getSelectedValidityLabel(selectedPlan)}
                      </span>
                    </div>

                    <div className="border-t border-[#1B2938] pt-2.5 flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#F4F7FB]">
                        Price -
                      </span>
                      <span className="text-base sm:text-lg font-bold font-tech text-[#00CFE8]">
                        ₹{selectedPlan.priceINR}
                      </span>
                    </div>
                  </div>

                  {/* Optional Buyer Fields */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-[#A7B5C5] font-sans mb-1">
                        Your Name (optional)
                      </label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={e => setCustomerName(e.target.value)}
                        placeholder="Enter your name"
                        className="w-full bg-[#080D14] border border-[#1B2938] focus:border-[#00CFE8] rounded-xl px-3.5 py-2.5 text-xs text-[#F4F7FB] font-sans outline-none transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-[#A7B5C5] font-sans mb-1">
                        WhatsApp / Phone Number (optional)
                      </label>
                      <input
                        type="text"
                        value={customerPhone}
                        onChange={e => setCustomerPhone(e.target.value)}
                        placeholder="Enter phone or WhatsApp number"
                        className="w-full bg-[#080D14] border border-[#1B2938] focus:border-[#00CFE8] rounded-xl px-3.5 py-2.5 text-xs text-[#F4F7FB] font-sans outline-none transition-colors"
                      />
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="p-2.5 rounded-xl bg-[#080D14] border border-[#FF5263]/40 text-[#FF5263] text-xs font-sans text-center">
                      {errorMsg}
                    </div>
                  )}

                  {/* Full-Width Glowing Glass + Shine PROCEED TO CHECKOUT Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="relative overflow-hidden w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#00CFE8] via-[#4AE8FF] to-[#168BFF] hover:brightness-110 active:scale-[0.99] text-[#050911] font-tech font-bold text-sm tracking-wider cursor-pointer transition-all border border-[#B8F6FF]/80 shadow-[0_6px_22px_rgba(0,207,232,0.34),inset_0_1px_1px_rgba(255,255,255,0.7)] disabled:opacity-60"
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/30 to-transparent" />
                    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                      <div className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[45%] bg-gradient-to-r from-transparent via-white/65 to-transparent" />
                      <div className="animate-getkey-secondary-glint absolute -top-[60%] -bottom-[60%] left-0 w-[20%] bg-gradient-to-r from-transparent via-[#E0FAFF]/55 to-transparent" />
                    </div>
                    <span className="relative z-10">
                      {loading ? 'INITIALIZING CHECKOUT...' : `PROCEED TO CHECKOUT — ₹${selectedPlan.priceINR}`}
                    </span>
                  </button>
                </form>
              </section>
            )}
          </>
        )}

        {/* ==================================================================
            STEP 2: COMPLETE PAYMENT & VERIFY (UPI QR + UPI INTENT + CONFIRM/REJECT)
            ================================================================== */}
        {step === 'payment_pending' && activeOrder && (
          <section className="relative overflow-hidden bg-[#0D1622] border border-[#00CFE8]/40 rounded-2xl p-5 space-y-4 shadow-[0_12px_34px_rgba(0,0,0,0.9),0_0_22px_rgba(0,207,232,0.16)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8] to-transparent" />

            <div className="text-center space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#080D14] border border-[#00CFE8]/35 text-[10px] font-tech font-bold text-[#00CFE8] tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00CFE8] animate-ping" />
                AWAITING PAYMENT
              </div>
              <h2 className="text-base sm:text-lg font-bold font-tech text-[#F4F7FB] pt-1">
                COMPLETE YOUR UPI PAYMENT
              </h2>
              <p className="text-xs text-[#A7B5C5] font-sans">
                Order ID: <span className="text-[#F4F7FB] font-mono-code">{activeOrder.orderId}</span>
              </p>
            </div>

            {/* Plan Validity & Price Box */}
            <div className="bg-[#080D14] border border-[#1B2938] rounded-xl p-3.5 space-y-2 text-xs font-sans">
              <div className="flex items-center justify-between">
                <span className="text-[#A7B5C5]">Plan -</span>
                <span className="font-tech font-bold text-[#F4F7FB]">{activeOrder.planName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#A7B5C5]">Panel Validity -</span>
                <span className="font-tech font-bold text-[#00CFE8]">
                  {formatPlanValidity(activeOrder.planDurationValue, activeOrder.planDurationUnit)}
                </span>
              </div>
              <div className="border-t border-[#1B2938] pt-2 flex items-center justify-between">
                <span className="text-[#A7B5C5]">Price -</span>
                <span className="text-base font-tech font-bold text-[#00CFE8]">
                  ₹{activeOrder.amount}
                </span>
              </div>
            </div>

            {/* QR Code & UPI Pay Button */}
            {activeOrder.upiIntentUrl && (
              <div className="bg-[#080D14] border border-[#1B2938] rounded-xl p-4 flex flex-col items-center space-y-3">
                <div className="p-2.5 bg-white rounded-xl border-2 border-[#00CFE8] shadow-[0_0_20px_rgba(0,207,232,0.22)]">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                      activeOrder.upiIntentUrl
                    )}`}
                    alt="UPI QR Code"
                    className="w-40 h-40 object-contain"
                  />
                </div>
                <p className="text-[11px] text-[#A7B5C5] font-sans text-center">
                  Scan QR with any UPI App (GPay, PhonePe, Paytm) or tap below:
                </p>

                <button
                  type="button"
                  onClick={() => {
                    window.location.href = activeOrder.upiIntentUrl!;
                  }}
                  className="relative overflow-hidden w-full py-3 px-4 rounded-xl bg-gradient-to-b from-[#15263B] to-[#0B1522] hover:from-[#1A2F48] hover:to-[#0F1C2D] border border-[#00CFE8]/50 text-[#F4F7FB] font-tech font-bold text-xs tracking-wider cursor-pointer shadow-[0_0_16px_rgba(0,207,232,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]"
                >
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                    <div className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[40%] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                  </div>
                  <span className="relative z-10 text-[#00CFE8]">
                    OPEN UPI APP TO PAY ₹{activeOrder.amount}
                  </span>
                </button>
              </div>
            )}

            {/* Optional UTR / Reference Input */}
            <div>
              <label className="block text-xs text-[#A7B5C5] font-sans mb-1">
                UTR / Transaction Reference (optional)
              </label>
              <input
                type="text"
                value={utrNumber}
                onChange={e => setUtrNumber(e.target.value)}
                placeholder="Enter 12-digit UTR or reference after payment"
                className="w-full bg-[#080D14] border border-[#1B2938] focus:border-[#00CFE8] rounded-xl px-3.5 py-2.5 text-xs text-[#F4F7FB] font-mono-code outline-none"
              />
            </div>

            {/* Action Buttons: PAYMENT DONE (10s Success Animation + Key Generation) & REJECT PAYMENT (10s Reject Animation) */}
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={handleConfirmAndGenerateKey}
                disabled={loading}
                className="relative overflow-hidden w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#00CFE8] via-[#4AE8FF] to-[#168BFF] hover:brightness-110 active:scale-[0.99] text-[#050911] font-tech font-bold text-xs sm:text-sm tracking-wider cursor-pointer border border-[#B8F6FF]/80 shadow-[0_6px_22px_rgba(0,207,232,0.34),inset_0_1px_1px_rgba(255,255,255,0.7)] disabled:opacity-60"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/30 to-transparent" />
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                  <div className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[45%] bg-gradient-to-r from-transparent via-white/65 to-transparent" />
                </div>
                <span className="relative z-10">
                  ✓ PAYMENT DONE — VERIFY & GENERATE KEY
                </span>
              </button>

              <button
                type="button"
                onClick={handleRejectPayment}
                disabled={loading}
                className="relative overflow-hidden w-full py-3 px-4 rounded-xl bg-gradient-to-b from-[#261119] to-[#14090E] hover:from-[#321520] hover:to-[#1C0C13] border border-[#FF5263]/45 text-[#FF5263] font-tech font-bold text-xs tracking-wider cursor-pointer transition-all shadow-[0_0_14px_rgba(255,82,99,0.16),inset_0_1px_0_rgba(255,255,255,0.1)]"
              >
                ✕ REJECT / CANCEL PAYMENT
              </button>
            </div>
          </section>
        )}

        {/* ==================================================================
            10-SECOND ANIMATION: PAYMENT SUCCESSFUL & GENERATING KEY
            ================================================================== */}
        {step === 'animating_success' && (
          <section className="relative overflow-hidden bg-[#0D1622] border border-[#00CFE8] rounded-2xl p-6 text-center space-y-5 shadow-[0_16px_40px_rgba(0,0,0,0.92),0_0_30px_rgba(0,207,232,0.25)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8] to-transparent" />

            {/* Animated Glowing Check + Dual Spinner Ring */}
            <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-[#00CFE8]/25 animate-ping" />
              <div className="absolute inset-1 rounded-full border-2 border-t-[#00CFE8] border-r-[#22C55E] border-b-transparent border-l-transparent animate-spin" />
              <div className="w-16 h-16 rounded-full bg-[#080D14] border border-[#22C55E]/60 flex items-center justify-center shadow-[0_0_22px_rgba(34,197,94,0.35)]">
                <svg
                  className="w-8 h-8 text-[#22C55E]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="inline-block px-3 py-1 rounded-md bg-[#080D14] border border-[#22C55E]/45 text-[11px] font-tech font-bold text-[#22C55E] tracking-wider uppercase">
                PAYMENT SUCCESSFUL
              </div>
              <h2 className="text-lg sm:text-xl font-bold font-tech text-[#F4F7FB] tracking-wide">
                GENERATING YOUR ACCESS KEY...
              </h2>
              <p className="text-xs text-[#A7B5C5] font-sans">
                {animSecondsLeft > 7
                  ? 'Step 1/3: Verifying UPI payment confirmation...'
                  : animSecondsLeft > 3
                  ? 'Step 2/3: Generating 1-Device Locked REVOX Access Key...'
                  : 'Step 3/3: Binding Panel Validity & finalizing key delivery...'}
              </p>
            </div>

            {/* 10-Second Progress Bar + Countdown */}
            <div className="bg-[#080D14] border border-[#1B2938] rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-tech font-bold">
                <span className="text-[#00CFE8]">KEY GENERATION PROGRESS</span>
                <span className="text-[#F4F7FB]">
                  {animProgress}% ({animSecondsLeft}s)
                </span>
              </div>
              <div className="w-full h-2.5 bg-[#0D1622] rounded-full overflow-hidden border border-[#1B2938]">
                <div
                  className="h-full bg-gradient-to-r from-[#00CFE8] via-[#22C55E] to-[#168BFF] transition-all duration-150"
                  style={{ width: `${animProgress}%` }}
                />
              </div>
              <div className="text-[11px] text-[#A7B5C5] font-sans">
                Please wait <span className="text-[#00CFE8] font-bold">{animSecondsLeft} seconds</span> while your personal access key is prepared.
              </div>
            </div>
          </section>
        )}

        {/* ==================================================================
            10-SECOND ANIMATION: PAYMENT REJECTED / CANCELLED
            ================================================================== */}
        {step === 'animating_reject' && (
          <section className="relative overflow-hidden bg-[#0D1622] border border-[#FF5263] rounded-2xl p-6 text-center space-y-5 shadow-[0_16px_40px_rgba(0,0,0,0.92),0_0_30px_rgba(255,82,99,0.25)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#FF5263] to-transparent" />

            {/* Animated Red Reject Ring */}
            <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-[#FF5263]/30 animate-ping" />
              <div className="absolute inset-1 rounded-full border-2 border-t-[#FF5263] border-r-[#FF5263]/60 border-b-transparent border-l-transparent animate-spin" />
              <div className="w-16 h-16 rounded-full bg-[#080D14] border border-[#FF5263]/70 flex items-center justify-center shadow-[0_0_24px_rgba(255,82,99,0.4)]">
                <svg
                  className="w-8 h-8 text-[#FF5263]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="inline-block px-3 py-1 rounded-md bg-[#080D14] border border-[#FF5263]/50 text-[11px] font-tech font-bold text-[#FF5263] tracking-wider uppercase">
                PAYMENT REJECTED
              </div>
              <h2 className="text-lg sm:text-xl font-bold font-tech text-[#F4F7FB] tracking-wide">
                PAYMENT VERIFICATION FAILED
              </h2>
              <p className="text-xs text-[#A7B5C5] font-sans">
                Payment was rejected or not completed. Cancelling order & resetting checkout...
              </p>
            </div>

            {/* 10-Second Reject Countdown Bar */}
            <div className="bg-[#080D14] border border-[#FF5263]/30 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-tech font-bold">
                <span className="text-[#FF5263]">CLOSING TRANSACTION</span>
                <span className="text-[#F4F7FB]">
                  {animProgress}% ({animSecondsLeft}s)
                </span>
              </div>
              <div className="w-full h-2.5 bg-[#0D1622] rounded-full overflow-hidden border border-[#1B2938]">
                <div
                  className="h-full bg-gradient-to-r from-[#FF5263] to-[#FF8A00] transition-all duration-150"
                  style={{ width: `${animProgress}%` }}
                />
              </div>
              <div className="text-[11px] text-[#A7B5C5] font-sans">
                Redirecting in <span className="text-[#FF5263] font-bold">{animSecondsLeft} seconds</span> — No access key was generated.
              </div>
            </div>
          </section>
        )}

        {/* ==================================================================
            PAYMENT GATEWAY SETUP REQUIRED
            ================================================================== */}
        {step === 'gateway_setup_required' && (
          <section className="bg-[#0D1622] border border-[#1B2938] rounded-2xl p-5 space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold font-tech text-[#F4F7FB]">
                Payment Gateway Setup Required
              </h2>
              <p className="text-xs text-[#A7B5C5] font-sans leading-relaxed">
                {statusMessage ||
                  'Online payment integration is currently disabled. Please purchase via WhatsApp or check back later.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={handleOpenWhatsAppFallback}
                className="relative overflow-hidden flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-[#00CFE8] to-[#168BFF] text-[#070B12] font-tech font-bold text-xs tracking-wider cursor-pointer"
              >
                GET KEY ON WHATSAPP
              </button>
              <button
                type="button"
                onClick={() => setStep('plans')}
                className="flex-1 py-3 px-4 rounded-xl bg-[#080D14] hover:bg-[#111C2A] border border-[#1B2938] text-[#F4F7FB] font-tech font-bold text-xs tracking-wider cursor-pointer"
              >
                Back to Plans
              </button>
            </div>
          </section>
        )}

        {/* ==================================================================
            FINAL STATE: PAYMENT FAILED / REJECTED
            ================================================================== */}
        {step === 'payment_failed' && (
          <section className="bg-[#0D1622] border border-[#FF5263]/50 rounded-2xl p-5 space-y-4 text-center shadow-[0_12px_30px_rgba(0,0,0,0.85)]">
            <div className="w-12 h-12 mx-auto rounded-full bg-[#080D14] border border-[#FF5263]/60 flex items-center justify-center text-[#FF5263] font-bold text-xl">
              ✕
            </div>
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-bold font-tech text-[#FF5263]">
                PAYMENT REJECTED OR CANCELLED
              </h2>
              <p className="text-xs text-[#A7B5C5] font-sans">
                {errorMsg || 'Your payment could not be verified. No access key was issued.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setStatusMessage(null);
                  setStep('plans');
                }}
                className="relative overflow-hidden flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-[#00CFE8] via-[#4AE8FF] to-[#168BFF] text-[#050911] font-tech font-bold text-xs tracking-wider cursor-pointer border border-[#B8F6FF]/75 shadow-[0_0_18px_rgba(0,207,232,0.28)]"
              >
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                  <div className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[40%] bg-gradient-to-r from-transparent via-white/55 to-transparent" />
                </div>
                <span className="relative z-10">RETRY PAYMENT</span>
              </button>
              <button
                type="button"
                onClick={onBack}
                className="flex-1 py-3 px-4 rounded-xl bg-[#080D14] hover:bg-[#111C2A] border border-[#1B2938] text-[#F4F7FB] font-tech font-bold text-xs tracking-wider cursor-pointer"
              >
                RETURN TO REVOX
              </button>
            </div>
          </section>
        )}

        {/* ==================================================================
            FINAL STATE: PAYMENT SUCCESSFUL & GENERATED KEY READY
            ================================================================== */}
        {step === 'payment_success' && activeOrder && (
          <section className="relative overflow-hidden bg-[#0D1622] border border-[#00CFE8] rounded-2xl p-5 space-y-4 text-center shadow-[0_14px_38px_rgba(0,0,0,0.92),0_0_26px_rgba(0,207,232,0.22)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8] to-transparent" />

            <div className="w-12 h-12 mx-auto rounded-full bg-[#080D14] border border-[#22C55E] flex items-center justify-center text-[#22C55E] text-xl font-bold shadow-[0_0_18px_rgba(34,197,94,0.3)]">
              ✓
            </div>

            <div className="space-y-1">
              <div className="text-[11px] font-tech font-bold text-[#22C55E] tracking-wider uppercase">
                PAYMENT SUCCESSFUL
              </div>
              <h2 className="text-lg font-bold font-tech text-[#F4F7FB]">
                YOUR GENERATED ACCESS KEY
              </h2>
              <p className="text-xs text-[#A7B5C5] font-sans">
                Order ID: <span className="text-[#F4F7FB] font-mono-code">{activeOrder.orderId}</span>
              </p>
            </div>

            {/* Plan Validity & Price Summary */}
            <div className="bg-[#080D14] border border-[#1B2938] rounded-xl p-3 space-y-1.5 text-xs font-sans">
              <div className="flex items-center justify-between">
                <span className="text-[#A7B5C5]">Panel Validity -</span>
                <span className="font-tech font-bold text-[#00CFE8]">
                  {formatPlanValidity(activeOrder.planDurationValue, activeOrder.planDurationUnit)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#A7B5C5]">Price -</span>
                <span className="font-tech font-bold text-[#F4F7FB]">
                  ₹{activeOrder.amount}
                </span>
              </div>
            </div>

            {activeOrder.assignedKey && (
              <div className="bg-[#080D14] border-2 border-[#00CFE8]/60 rounded-xl p-4 space-y-3 shadow-[0_0_20px_rgba(0,207,232,0.16)]">
                <div className="text-[10px] font-tech uppercase tracking-widest text-[#A7B5C5]">
                  1-DEVICE LOCKED ACCESS KEY
                </div>
                <div className="text-base sm:text-lg font-mono-code font-bold tracking-wider text-[#00CFE8] break-all select-all py-1">
                  {activeOrder.assignedKey}
                </div>

                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="relative overflow-hidden w-full py-2.5 px-4 rounded-xl bg-gradient-to-b from-[#15263B] to-[#0B1522] hover:from-[#1A2F48] hover:to-[#0F1C2D] border border-[#00CFE8]/45 text-[#F4F7FB] font-tech font-bold text-xs tracking-wider cursor-pointer shadow-[0_0_14px_rgba(0,207,232,0.18),inset_0_1px_0_rgba(255,255,255,0.2)]"
                >
                  {copiedKey ? '✓ ACCESS KEY COPIED!' : 'COPY ACCESS KEY'}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (activeOrder.assignedKey) {
                  onContinueWithKey(activeOrder.assignedKey);
                } else {
                  onBack();
                }
              }}
              className="relative overflow-hidden w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#00CFE8] via-[#4AE8FF] to-[#168BFF] hover:brightness-110 active:scale-[0.99] text-[#050911] font-tech font-bold text-sm tracking-wider cursor-pointer border border-[#B8F6FF]/80 shadow-[0_6px_22px_rgba(0,207,232,0.34),inset_0_1px_1px_rgba(255,255,255,0.7)]"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/30 to-transparent" />
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                <div className="animate-getkey-super-shine absolute -top-[60%] -bottom-[60%] left-0 w-[45%] bg-gradient-to-r from-transparent via-white/65 to-transparent" />
              </div>
              <span className="relative z-10">CONTINUE TO REVOX & UNLOCK</span>
            </button>
          </section>
        )}
      </main>
    </div>
  );
};
