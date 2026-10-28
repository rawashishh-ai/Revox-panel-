import React, { useState, useEffect, useCallback, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { SiteSettings, PurchasePlan, PaymentOrder, AccessKey } from '../types';
import {
  formatPlanValidity,
  isPlanFullyConfigured
} from '../config/purchaseConfig';
import {
  VERIFIED_PURCHASE_SESSION_KEY,
  VerifiedPurchaseSession
} from './KeySuccessPage';

interface CheckoutPageProps {
  settings: SiteSettings;
  selectedPlan: PurchasePlan | null;
  initialOrderId?: string | null;
  onBackToPlans: () => void;
  onNavigateToKeySuccess: (session: VerifiedPurchaseSession) => void;
}

type VerificationBannerState =
  | 'IDLE'
  | 'PROCESSING'
  | 'PENDING'
  | 'FAILED'
  | 'NETWORK_ERROR'
  | 'SUCCESS';

type PaymentAnimationMode = 'NONE' | 'SUCCESS' | 'NOT_VERIFIED';
type NotVerifiedReason = 'PENDING' | 'FAILED' | 'NETWORK_ERROR';

export const CheckoutPage: React.FC<CheckoutPageProps> = ({
  settings,
  selectedPlan,
  initialOrderId,
  onBackToPlans,
  onNavigateToKeySuccess
}) => {
  const [activeOrderId, setActiveOrderId] = useState<string>(initialOrderId || '');
  const [paymentSessionId, setPaymentSessionId] = useState<string>('');
  const [cashfreeMode, setCashfreeMode] = useState<'production' | 'sandbox'>('production');
  const [gatewayConfigured, setGatewayConfigured] = useState<boolean>(true);
  const [missingCredentials, setMissingCredentials] = useState<string[]>([]);
  const [gatewayChecking, setGatewayChecking] = useState<boolean>(true);

  const [checkoutOpening, setCheckoutOpening] = useState<boolean>(false);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [bannerState, setBannerState] = useState<VerificationBannerState>('IDLE');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [hasAttemptedVerification, setHasAttemptedVerification] = useState<boolean>(false);

  const [verifiedOrder, setVerifiedOrder] = useState<PaymentOrder | null>(null);

  // 7-Second Payment Status Animation State
  const [animationMode, setAnimationMode] = useState<PaymentAnimationMode>('NONE');
  const [animationStage, setAnimationStage] = useState<number>(0); // 1: 0-1s, 2: 1-3s, 3: 3-5s, 4: 5-7s
  const [notVerifiedReason, setNotVerifiedReason] = useState<NotVerifiedReason>('PENDING');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);

  const animationTimersRef = useRef<number[]>([]);
  const isAnimatingRef = useRef<boolean>(false);
  const autoVerifiedInitialOrderRef = useRef<string | null>(null);

  const logoSrc =
    settings.logoUrl && settings.logoUrl.trim() !== ''
      ? settings.logoUrl
      : '/assets/revox-logo.png';

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener?.('change', handler);
      return () => mediaQuery.removeEventListener?.('change', handler);
    }
  }, []);

  const clearAnimationTimers = useCallback(() => {
    for (const id of animationTimersRef.current) {
      window.clearTimeout(id);
    }
    animationTimersRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      clearAnimationTimers();
    };
  }, [clearAnimationTimers]);

  const getValidityLabel = (
    plan: PurchasePlan | null,
    order?: PaymentOrder | null
  ): string => {
    if (order?.planDurationValue) {
      return formatPlanValidity(
        order.planDurationValue,
        order.planDurationUnit || 'days'
      );
    }
    if (!plan) return '7 Days';
    const raw = (plan.validityLabel || '').trim();
    if (raw && !/^\d+$/.test(raw)) return raw;
    return formatPlanValidity(plan.durationValue, plan.durationUnit);
  };

  const activePlanName =
    verifiedOrder?.planName || selectedPlan?.name || 'REVOX ACCESS KEY';
  const activeValidity = getValidityLabel(selectedPlan, verifiedOrder);
  const activeAmount =
    verifiedOrder?.amount !== undefined
      ? verifiedOrder.amount
      : typeof selectedPlan?.priceINR === 'number' && selectedPlan.priceINR > 0
      ? selectedPlan.priceINR
      : 0;

  const hasValidPlanOrOrder =
    Boolean(initialOrderId) ||
    Boolean(
      selectedPlan && selectedPlan.available && isPlanFullyConfigured(selectedPlan)
    );

  // Sync verified key to Firestore accessKeys so client-side verification recognizes it immediately
  const syncVerifiedKeyToFirestore = useCallback(
    async (order?: PaymentOrder | null, keyStr?: string) => {
      const finalKey = keyStr || order?.assignedKey;
      if (!finalKey) return;
      try {
        const keyDoc: AccessKey = {
          id: order?.assignedKeyId || finalKey,
          key: finalKey,
          customerName: order?.customerName || 'REVOX Customer',
          status: 'active',
          durationDays: Number(order?.planDurationValue) || 7,
          durationUnit: order?.planDurationUnit || 'days',
          durationValue: Number(order?.planDurationValue) || 7,
          createdAt: order?.purchasedAt || new Date().toISOString(),
          activatedAt: null,
          expiresAt: null,
          boundDeviceId: null,
          activeSessionToken: null,
          lastVerifiedAt: null,
          renewedAt: null,
          updatedAt: new Date().toISOString(),
          notes: `Cashfree Verified (${order?.orderId || activeOrderId})`
        };
        await setDoc(doc(db, 'accessKeys', keyDoc.id), keyDoc, { merge: true });
      } catch {
        // Non-blocking if backend already saved the key
      }
    },
    [activeOrderId]
  );

  // Trigger the 7-Second Payment Successful Animation, then navigate to /key-success
  const startSuccessAnimationFlow = useCallback(
    (sessionPayload: VerifiedPurchaseSession) => {
      if (isAnimatingRef.current) return;
      isAnimatingRef.current = true;
      clearAnimationTimers();

      try {
        sessionStorage.setItem(
          VERIFIED_PURCHASE_SESSION_KEY,
          JSON.stringify(sessionPayload)
        );
      } catch {
        // Ignore storage quota issues
      }

      // 0-1s: Stage 1 (Fade in dark glass status card with subtle cyan edge glow)
      setAnimationMode('SUCCESS');
      setAnimationStage(1);

      // 1-3s: Stage 2 (Animate circular scanning ring + draw SVG checkmark + subtle blue-green glow)
      const t1 = window.setTimeout(() => {
        setAnimationStage(2);
      }, 1000);

      // 3-5s: Stage 3 (Smooth fade-and-slide "PAYMENT SUCCESSFUL" heading)
      const t2 = window.setTimeout(() => {
        setAnimationStage(3);
      }, 3000);

      // 5-7s: Stage 4 (Display "Payment verified successfully." + actual plan + validity + confirmation indicator)
      const t3 = window.setTimeout(() => {
        setAnimationStage(4);
      }, 5000);

      // Exactly 7.0s: Automatically navigate to the separate Access Key page (/key-success)
      const t4 = window.setTimeout(() => {
        isAnimatingRef.current = false;
        setAnimationMode('NONE');
        setAnimationStage(0);
        onNavigateToKeySuccess(sessionPayload);
      }, 7000);

      animationTimersRef.current = [t1, t2, t3, t4];
    },
    [clearAnimationTimers, onNavigateToKeySuccess]
  );

  // Trigger the 7-Second Payment Not Verified Animation, then return to payment page with "VERIFY PAYMENT AGAIN"
  const startNotVerifiedAnimationFlow = useCallback(
    (reason: NotVerifiedReason, finalBannerState: VerificationBannerState, finalMessage: string) => {
      if (isAnimatingRef.current) return;
      isAnimatingRef.current = true;
      clearAnimationTimers();

      setNotVerifiedReason(reason);
      // 0-1s: Stage 1 (Fade in the dark hacking-style glass card)
      setAnimationMode('NOT_VERIFIED');
      setAnimationStage(1);

      // 1-3s: Stage 2 (Animate circular scanning ring and SVG warning symbol)
      const t1 = window.setTimeout(() => {
        setAnimationStage(2);
      }, 1000);

      // 3-5s: Stage 3 (Display "PAYMENT NOT VERIFIED")
      const t2 = window.setTimeout(() => {
        setAnimationStage(3);
      }, 3000);

      // 5-7s: Stage 4 (Display exact status message according to backend status)
      const t3 = window.setTimeout(() => {
        setAnimationStage(4);
      }, 5000);

      // Exactly 7.0s: Return customer to payment page and display "VERIFY PAYMENT AGAIN"
      const t4 = window.setTimeout(() => {
        isAnimatingRef.current = false;
        setAnimationMode('NONE');
        setAnimationStage(0);
        setHasAttemptedVerification(true);
        setBannerState(finalBannerState);
        setStatusMessage(finalMessage);
      }, 7000);

      animationTimersRef.current = [t1, t2, t3, t4];
    },
    [clearAnimationTimers]
  );

  // Check Cashfree gateway configuration status on mount
  useEffect(() => {
    let mounted = true;
    const checkGateway = async () => {
      setGatewayChecking(true);
      try {
        const res = await fetch('/api/payments/gateway-status', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        if (res.ok && data) {
          setGatewayConfigured(Boolean(data.cashfreeConfigured));
          if (data.mode === 'sandbox' || data.mode === 'production') {
            setCashfreeMode(data.mode);
          }
          if (Array.isArray(data.missingCredentials)) {
            setMissingCredentials(data.missingCredentials);
          }
        }
      } catch {
        // Non-blocking
      } finally {
        if (mounted) setGatewayChecking(false);
      }
    };
    checkGateway();
    return () => {
      mounted = false;
    };
  }, []);

  // Authoritative backend Cashfree payment verification
  const verifyCashfreeOrder = useCallback(
    async (orderIdToVerify: string) => {
      const cleanOrderId = (orderIdToVerify || activeOrderId || '').trim();
      if (!cleanOrderId) {
        startNotVerifiedAnimationFlow(
          'FAILED',
          'FAILED',
          'We could not verify your payment. Please try again.'
        );
        return;
      }

      if (verifying || isAnimatingRef.current) return;

      setVerifying(true);
      setBannerState('PROCESSING');
      setStatusMessage('Verifying your payment with Cashfree...');

      try {
        const response = await fetch('/api/payments/verify-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: cleanOrderId })
        });

        const result = await response.json().catch(() => ({}));

        if (result.order) {
          setVerifiedOrder(result.order);
          if (result.order.paymentSessionId) {
            setPaymentSessionId(result.order.paymentSessionId);
          }
          if (result.order.cashfreeMode) {
            setCashfreeMode(result.order.cashfreeMode);
          }
        }

        const category: string = String(result.verification_category || '').toUpperCase();

        if (
          response.ok &&
          result.verified === true &&
          result.payment_status === 'SUCCESS' &&
          result.claimToken
        ) {
          const deliveredKey = result.assignedKey || result.order?.assignedKey || '';
          await syncVerifiedKeyToFirestore(result.order, deliveredKey);
          setBannerState('SUCCESS');
          setStatusMessage('Payment verified successfully.');

          const resolvedPlanName =
            result.order?.planName || selectedPlan?.name || 'REVOX ACCESS KEY';
          const resolvedValidity = getValidityLabel(selectedPlan, result.order);

          startSuccessAnimationFlow({
            orderId: result.order?.orderId || cleanOrderId,
            claimToken: result.claimToken,
            planName: resolvedPlanName,
            validityLabel: resolvedValidity
          });
        } else if (category === 'NETWORK_ERROR' || response.status >= 500) {
          startNotVerifiedAnimationFlow(
            'NETWORK_ERROR',
            'NETWORK_ERROR',
            'Unable to check your payment status. Please try again.'
          );
        } else if (
          category === 'PENDING' ||
          result.payment_status === 'PENDING' ||
          result.order_status === 'ACTIVE' ||
          result.order_status === 'PENDING'
        ) {
          startNotVerifiedAnimationFlow(
            'PENDING',
            'PENDING',
            'Your payment is awaiting confirmation. Please check again shortly.'
          );
        } else {
          startNotVerifiedAnimationFlow(
            'FAILED',
            'FAILED',
            'We could not verify your payment. Please try again.'
          );
        }
      } catch {
        startNotVerifiedAnimationFlow(
          'NETWORK_ERROR',
          'NETWORK_ERROR',
          'Unable to check your payment status. Please try again.'
        );
      } finally {
        setVerifying(false);
      }
    },
    [
      activeOrderId,
      selectedPlan,
       startNotVerifiedAnimationFlow,
      startSuccessAnimationFlow,
      syncVerifiedKeyToFirestore,
      verifying
    ]
  );

  // If user returned from Cashfree redirect with ?order_id=..., automatically verify once
  useEffect(() => {
    if (
      initialOrderId &&
      autoVerifiedInitialOrderRef.current !== initialOrderId
    ) {
      autoVerifiedInitialOrderRef.current = initialOrderId;
      setActiveOrderId(initialOrderId);
      verifyCashfreeOrder(initialOrderId);
    }
  }, [initialOrderId, verifyCashfreeOrder]);

  // Create (or reuse active) Cashfree order and open official Cashfree JS SDK v3 Checkout
  const handleProceedToCashfreeCheckout = async () => {
    if (
      !selectedPlan ||
      checkoutOpening ||
      verifying ||
      isAnimatingRef.current ||
      animationMode !== 'NONE' ||
      bannerState === 'SUCCESS'
    ) {
      return;
    }

    setCheckoutOpening(true);
    setBannerState('PROCESSING');
    setStatusMessage('Initializing secure Cashfree payment session...');

    try {
      const response = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlan.id,
          reuseOrderId: activeOrderId || undefined
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success || !data.payment_session_id || !data.order_id) {
        setCheckoutOpening(false);
        if (data.code === 'CASHFREE_NOT_CONFIGURED') {
          setGatewayConfigured(false);
          if (Array.isArray(data.missingCredentials)) {
            setMissingCredentials(data.missingCredentials);
          }
          setBannerState('FAILED');
          setStatusMessage(
            data.message ||
              'Cashfree API credentials (CASHFREE_APP_ID / CASHFREE_SECRET_KEY) are not configured on the server.'
          );
          return;
        }

        setBannerState('FAILED');
        setStatusMessage(
          data.message || 'Unable to create Cashfree payment order. Please try again.'
        );
        return;
      }

      const createdOrderId = String(data.order_id);
      const sessionToken = String(data.payment_session_id);
      const resolvedMode: 'production' | 'sandbox' =
        data.cashfree_mode === 'sandbox' ? 'sandbox' : 'production';

      setActiveOrderId(createdOrderId);
      setPaymentSessionId(sessionToken);
      setCashfreeMode(resolvedMode);
      if (data.order) {
        setVerifiedOrder(data.order);
      }

      const cashfreeFactory = (window as any).Cashfree;
      if (typeof cashfreeFactory !== 'function') {
        setCheckoutOpening(false);
        setBannerState('FAILED');
        setStatusMessage(
          'Cashfree Checkout SDK could not be loaded. Please check your internet connection and refresh the page.'
        );
        return;
      }

      const cashfree = cashfreeFactory({ mode: resolvedMode });

      const checkoutResult = await cashfree.checkout({
        paymentSessionId: sessionToken,
        redirectTarget: '_modal'
      });

      setCheckoutOpening(false);

      if (checkoutResult?.error) {
        // User closed modal or an attempt error occurred — verify actual status with backend
        await verifyCashfreeOrder(createdOrderId);
        return;
      }

      // Verify payment status through the authoritative backend after modal completion
      await verifyCashfreeOrder(createdOrderId);
    } catch {
      setCheckoutOpening(false);
      setBannerState('NETWORK_ERROR');
      setStatusMessage('Unable to connect to Cashfree payment gateway. Please try again.');
    }
  };

  const getNotVerifiedOverlayMessage = (): string => {
    if (notVerifiedReason === 'PENDING') {
      return 'Your payment is awaiting confirmation. Please check again shortly.';
    }
    if (notVerifiedReason === 'NETWORK_ERROR') {
      return 'Unable to check your payment status. Please try again.';
    }
    return 'We could not verify your payment. Please try again.';
  };

  const verifyButtonLabel = verifying
    ? 'VERIFYING PAYMENT...'
    : hasAttemptedVerification
    ? 'VERIFY PAYMENT AGAIN'
    : 'VERIFY PAYMENT';

  return (
    <div className="relative min-h-[100dvh] w-full bg-[#070B12] text-[#F4F7FB] overflow-y-auto overflow-x-hidden select-none">
      {/* Subtle ambient background depth matching REVOX PANEL */}
      <div className="fixed inset-0 vignette-radial pointer-events-none z-0" />

      {/* ======================================================================
          1. 7-SECOND PAYMENT SUCCESSFUL ANIMATION OVERLAY
          Hacking-inspired glassmorphic interface (#05080D backdrop, #0B1420 card,
          rgba(0, 217, 245, 0.35) glass border, cyan/blue/green glow).
          Triggered ONLY after backend confirms Cashfree payment is successful.
          ====================================================================== */}
      {animationMode === 'SUCCESS' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Payment Successful"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#05080D]/95 backdrop-blur-xl"
        >
          {/* Controlled ambient blue-green & cyan glow */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                animationStage >= 2
                  ? 'radial-gradient(circle at 50% 45%, rgba(32, 217, 151, 0.14) 0%, rgba(0, 217, 245, 0.11) 34%, rgba(22, 139, 255, 0.06) 55%, transparent 74%)'
                  : 'radial-gradient(circle at 50% 45%, rgba(0, 217, 245, 0.14) 0%, rgba(22, 139, 255, 0.06) 45%, transparent 70%)',
              transition: prefersReducedMotion ? 'none' : 'background 900ms ease-out'
            }}
          />

          {/* 0-1s: Fade in dark glass status card (#0B1420) with subtle cyan edge glow */}
          <div
            className="relative z-10 w-full max-w-[392px] rounded-2xl bg-[#0B1420]/90 backdrop-blur-xl px-6 py-7 text-center overflow-hidden"
            style={{
              border:
                animationStage >= 2
                  ? '1px solid rgba(32, 217, 151, 0.42)'
                  : '1px solid rgba(0, 217, 245, 0.35)',
              boxShadow:
                animationStage >= 2
                  ? '0 0 38px rgba(0, 217, 245, 0.16), 0 0 24px rgba(32, 217, 151, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 20px 50px rgba(0, 0, 0, 0.8)'
                  : '0 0 30px rgba(0, 217, 245, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 20px 50px rgba(0, 0, 0, 0.8)',
              opacity: animationStage >= 1 ? 1 : 0,
              transform:
                prefersReducedMotion || animationStage >= 1
                  ? 'translateY(0) scale(1)'
                  : 'translateY(10px) scale(0.97)',
              transition: prefersReducedMotion
                ? 'opacity 250ms ease'
                : 'all 750ms cubic-bezier(0.22, 1, 0.36, 1)'
            }}
          >
            {/* Top Subtle Hacking Glass Edge Highlight */}
            <div
              className="pointer-events-none absolute inset-x-8 top-0 h-[1px]"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(0, 217, 245, 0.65), rgba(32, 217, 151, 0.65), transparent)'
              }}
            />

            {/* Top Security Status Tag */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#05080D]/80 border border-[#00D9F5]/25 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#20D997]" />
              <span className="text-[10px] font-mono-code font-bold tracking-[0.18em] uppercase text-[#A7B5C5]">
                CASHFREE VERIFIED // REVOX
              </span>
            </div>

            {/* 1-3s: Circular Scanning Ring + Smooth SVG Checkmark + Subtle Blue-Green Glow */}
            <div className="relative w-24 h-24 mx-auto mb-5 flex items-center justify-center">
              <div
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{
                  boxShadow:
                    animationStage >= 2
                      ? '0 0 30px rgba(32, 217, 151, 0.26), 0 0 18px rgba(0, 217, 245, 0.22), inset 0 0 16px rgba(0, 217, 245, 0.16)'
                      : '0 0 16px rgba(0, 217, 245, 0.16)',
                  transition: prefersReducedMotion ? 'none' : 'box-shadow 900ms ease-out'
                }}
              />
              <svg
                viewBox="0 0 96 96"
                className="w-24 h-24 overflow-visible"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="rvxSuccessRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00D9F5" />
                    <stop offset="50%" stopColor="#168BFF" />
                    <stop offset="100%" stopColor="#20D997" />
                  </linearGradient>
                </defs>
                {/* Outer subtle cyber HUD tick ring */}
                <circle
                  cx="48"
                  cy="48"
                  r="44"
                  fill="none"
                  stroke="rgba(0, 217, 245, 0.22)"
                  strokeWidth="1"
                  strokeDasharray="6 6"
                  className={!prefersReducedMotion && animationStage >= 2 ? 'animate-spin' : ''}
                  style={{ animationDuration: '12s' }}
                />
                {/* Inner dark glass core */}
                <circle
                  cx="48"
                  cy="48"
                  r="38"
                  fill="#05080D"
                  stroke="rgba(0, 217, 245, 0.18)"
                  strokeWidth="2"
                />
                {/* Animated circular scanning ring */}
                <circle
                  cx="48"
                  cy="48"
                  r="38"
                  fill="none"
                  stroke="url(#rvxSuccessRingGrad)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  transform="rotate(-90 48 48)"
                  style={{
                    strokeDasharray: 240,
                    strokeDashoffset: animationStage >= 2 ? 0 : 240,
                    transition: prefersReducedMotion
                      ? 'none'
                      : 'stroke-dashoffset 1100ms cubic-bezier(0.33, 1, 0.68, 1)'
                  }}
                />
                {/* Smooth SVG Checkmark inside circle */}
                <path
                  d="M31 49.5 L43 61.5 L66 36.5"
                  fill="none"
                  stroke="#20D997"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: 60,
                    strokeDashoffset: animationStage >= 2 ? 0 : 60,
                    transition: prefersReducedMotion
                      ? 'none'
                      : 'stroke-dashoffset 850ms cubic-bezier(0.33, 1, 0.68, 1) 550ms'
                  }}
                />
              </svg>
            </div>

            {/* 3-5s: Display "PAYMENT SUCCESSFUL" with smooth fade-and-slide */}
            <div
              style={{
                opacity: animationStage >= 3 ? 1 : 0,
                transform:
                  prefersReducedMotion || animationStage >= 3
                    ? 'translateY(0)'
                    : 'translateY(8px)',
                transition: prefersReducedMotion
                  ? 'opacity 200ms ease'
                  : 'opacity 650ms ease-out, transform 650ms ease-out'
              }}
            >
              <h2 className="text-lg sm:text-xl font-tech font-bold tracking-[0.14em] uppercase text-[#20D997]">
                PAYMENT SUCCESSFUL
              </h2>
            </div>

            {/* 5-7s: Display "Payment verified successfully." + Actual plan + validity + confirmation indicator */}
            <div
              className="mt-3 space-y-4"
              style={{
                opacity: animationStage >= 4 ? 1 : 0,
                transform:
                  prefersReducedMotion || animationStage >= 4
                    ? 'translateY(0)'
                    : 'translateY(8px)',
                transition: prefersReducedMotion
                  ? 'opacity 200ms ease'
                  : 'opacity 600ms ease-out, transform 600ms ease-out'
              }}
            >
              <p className="text-xs sm:text-sm text-[#F4F7FB] leading-relaxed">
                Payment verified successfully.
              </p>

              {/* Purchased Plan Summary (Access key is never shown on the animation screen) */}
              <div
                className="bg-[#05080D]/85 rounded-xl px-4 py-3 space-y-2 text-left"
                style={{ border: '1px solid rgba(0, 217, 245, 0.25)' }}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#A7B5C5] font-mono-code text-[10px] tracking-[0.14em] uppercase">
                    PURCHASED PLAN
                  </span>
                  <span className="font-tech font-bold text-[#F4F7FB] tracking-wider uppercase">
                    {activePlanName}
                  </span>
                </div>
                <div className="h-[1px] bg-[#1C3041]" />
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#A7B5C5] font-mono-code text-[10px] tracking-[0.14em] uppercase">
                    PANEL VALIDITY
                  </span>
                  <span className="font-tech font-bold text-[#00D9F5] tracking-wider">
                    {activeValidity}
                  </span>
                </div>
              </div>

              {/* Subtle animated confirmation indicator */}
              <div className="space-y-2 pt-1">
                <div className="w-full h-1.5 rounded-full bg-[#05080D] border border-[#00D9F5]/25 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#00D9F5] via-[#168BFF] to-[#20D997]"
                    style={{
                      width: animationStage >= 4 ? '100%' : '0%',
                      transition: prefersReducedMotion
                        ? 'none'
                        : 'width 1850ms linear'
                    }}
                  />
                </div>
                <div className="text-[10px] font-mono-code tracking-[0.15em] uppercase text-[#A7B5C5]">
                  PREPARING YOUR ACCESS KEY PAGE...
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================================
          2. 7-SECOND PAYMENT NOT VERIFIED ANIMATION OVERLAY
          Hacking-inspired glassmorphic interface (#05080D backdrop, #0B1420 card,
          fine red and cyan illuminated borders, animated scanning ring, SVG warning icon).
          ====================================================================== */}
      {animationMode === 'NOT_VERIFIED' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Payment Not Verified"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#05080D]/95 backdrop-blur-xl"
        >
          {/* Subtle red and cyan lighting */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                animationStage >= 2
                  ? 'radial-gradient(circle at 50% 45%, rgba(255, 82, 104, 0.15) 0%, rgba(0, 217, 245, 0.08) 38%, transparent 72%)'
                  : 'radial-gradient(circle at 50% 45%, rgba(0, 217, 245, 0.11) 0%, transparent 65%)',
              transition: prefersReducedMotion ? 'none' : 'background 900ms ease-out'
            }}
          />

          {/* 0-1s: Fade in the dark glass card */}
          <div
            className="relative z-10 w-full max-w-[392px] rounded-2xl bg-[#0B1420]/90 backdrop-blur-xl px-6 py-7 text-center overflow-hidden"
            style={{
              border:
                animationStage >= 2
                  ? '1px solid rgba(255, 82, 104, 0.45)'
                  : '1px solid rgba(0, 217, 245, 0.35)',
              boxShadow:
                animationStage >= 2
                  ? '0 0 36px rgba(255, 82, 104, 0.16), 0 0 22px rgba(0, 217, 245, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 20px 50px rgba(0, 0, 0, 0.8)'
                  : '0 0 28px rgba(0, 217, 245, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 20px 50px rgba(0, 0, 0, 0.8)',
              opacity: animationStage >= 1 ? 1 : 0,
              transform:
                prefersReducedMotion || animationStage >= 1
                  ? 'translateY(0) scale(1)'
                  : 'translateY(10px) scale(0.97)',
              transition: prefersReducedMotion
                ? 'opacity 250ms ease'
                : 'all 750ms cubic-bezier(0.22, 1, 0.36, 1)'
            }}
          >
            {/* Top Subtle Red & Cyan Glass Edge Highlight */}
            <div
              className="pointer-events-none absolute inset-x-8 top-0 h-[1px]"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(0, 217, 245, 0.55), rgba(255, 82, 104, 0.65), transparent)'
              }}
            />

            {/* Top Security Status Tag */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#05080D]/80 border border-[#FF5268]/30 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF5268]" />
              <span className="text-[10px] font-mono-code font-bold tracking-[0.18em] uppercase text-[#A7B5C5]">
                REVOX VERIFICATION STATUS
              </span>
            </div>

            {/* 1-3s: Animate circular scanning ring and smooth SVG warning symbol */}
            <div className="relative w-24 h-24 mx-auto mb-5 flex items-center justify-center">
              <div
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{
                  boxShadow:
                    animationStage >= 2
                      ? '0 0 28px rgba(255, 82, 104, 0.25), inset 0 0 16px rgba(0, 217, 245, 0.14)'
                      : 'none',
                  transition: prefersReducedMotion ? 'none' : 'box-shadow 900ms ease-out'
                }}
              />
              <svg
                viewBox="0 0 96 96"
                className="w-24 h-24 overflow-visible"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="rvxWarnRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#FF5268" />
                    <stop offset="100%" stopColor="#00D9F5" />
                  </linearGradient>
                </defs>
                {/* Outer subtle cyber HUD tick ring */}
                <circle
                  cx="48"
                  cy="48"
                  r="44"
                  fill="none"
                  stroke="rgba(255, 82, 104, 0.24)"
                  strokeWidth="1"
                  strokeDasharray="6 6"
                  className={!prefersReducedMotion && animationStage >= 2 ? 'animate-spin' : ''}
                  style={{ animationDuration: '12s' }}
                />
                {/* Inner dark glass core */}
                <circle
                  cx="48"
                  cy="48"
                  r="38"
                  fill="#05080D"
                  stroke="rgba(255, 82, 104, 0.2)"
                  strokeWidth="2"
                />
                {/* Animated circular scanning ring */}
                <circle
                  cx="48"
                  cy="48"
                  r="38"
                  fill="none"
                  stroke="url(#rvxWarnRingGrad)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  transform="rotate(-90 48 48)"
                  style={{
                    strokeDasharray: 240,
                    strokeDashoffset: animationStage >= 2 ? 0 : 240,
                    transition: prefersReducedMotion
                      ? 'none'
                      : 'stroke-dashoffset 1100ms cubic-bezier(0.33, 1, 0.68, 1)'
                  }}
                />
                {/* Smooth SVG Warning Symbol (Exclamation Stem + Dot) inside circle */}
                <path
                  d="M48 31 L48 53"
                  fill="none"
                  stroke="#FF5268"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  style={{
                    strokeDasharray: 26,
                    strokeDashoffset: animationStage >= 2 ? 0 : 26,
                    transition: prefersReducedMotion
                      ? 'none'
                      : 'stroke-dashoffset 600ms ease-out 500ms'
                  }}
                />
                <circle
                  cx="48"
                  cy="63"
                  r="2.6"
                  fill="#FF5268"
                  style={{
                    opacity: animationStage >= 2 ? 1 : 0,
                    transition: prefersReducedMotion
                      ? 'none'
                      : 'opacity 400ms ease-out 900ms'
                  }}
                />
              </svg>
            </div>

            {/* 3-5s: Display "PAYMENT NOT VERIFIED" */}
            <div
              style={{
                opacity: animationStage >= 3 ? 1 : 0,
                transform:
                  prefersReducedMotion || animationStage >= 3
                    ? 'translateY(0)'
                    : 'translateY(8px)',
                transition: prefersReducedMotion
                  ? 'opacity 200ms ease'
                  : 'opacity 650ms ease-out, transform 650ms ease-out'
              }}
            >
              <h2 className="text-lg sm:text-xl font-tech font-bold tracking-[0.14em] uppercase text-[#FF5268]">
                PAYMENT NOT VERIFIED
              </h2>
            </div>

            {/* 5-7s: Show the exact message according to actual backend status */}
            <div
              className="mt-3 space-y-4"
              style={{
                opacity: animationStage >= 4 ? 1 : 0,
                transform:
                  prefersReducedMotion || animationStage >= 4
                    ? 'translateY(0)'
                    : 'translateY(8px)',
                transition: prefersReducedMotion
                  ? 'opacity 200ms ease'
                  : 'opacity 600ms ease-out, transform 600ms ease-out'
              }}
            >
              <div
                className="bg-[#05080D]/85 rounded-xl px-4 py-3.5"
                style={{ border: '1px solid rgba(255, 82, 104, 0.35)' }}
              >
                <p className="text-xs sm:text-sm text-[#F4F7FB] leading-relaxed">
                  {getNotVerifiedOverlayMessage()}
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <div className="w-full h-1.5 rounded-full bg-[#05080D] border border-[#FF5268]/30 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#FF5268] to-[#00D9F5]"
                    style={{
                      width: animationStage >= 4 ? '100%' : '0%',
                      transition: prefersReducedMotion
                        ? 'none'
                        : 'width 1850ms linear'
                    }}
                  />
                </div>
                <div className="text-[10px] font-mono-code tracking-[0.15em] uppercase text-[#A7B5C5]">
                  RETURNING TO CHECKOUT...
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 flex flex-col min-h-[100dvh]">
        {/* ====================================================================
            A. HEADER: REVOX LOGO + BRANDING + SECURE CHECKOUT + BACK TO PLANS
            ==================================================================== */}
        <header className="sticky top-0 z-30 w-full bg-[#070B12]/95 backdrop-blur-sm border-b border-[#1C3041] px-4 py-3">
          <div className="w-full max-w-[440px] mx-auto flex items-center justify-between gap-3">
            {/* Left: REVOX Logo + Branding + SECURE CHECKOUT */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[#0D1622] border border-[#1C3041] flex items-center justify-center p-1 shrink-0">
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
                <div className="text-sm font-bold font-tech tracking-wider text-[#F4F7FB] leading-tight truncate uppercase">
                  REVOX PANEL
                </div>
                <div className="text-[10px] font-mono-code font-semibold tracking-[0.16em] text-[#00D9F5] leading-tight truncate uppercase">
                  SECURE CHECKOUT
                </div>
              </div>
            </div>

            {/* Right: Back to Plans Link */}
            <button
              type="button"
              onClick={onBackToPlans}
              disabled={animationMode !== 'NONE'}
              className="bg-[#0D1622] hover:bg-[#121F30] active:scale-[0.98] border border-[#1C3041] hover:border-[#00D9F5]/50 text-[#F4F7FB] text-xs font-tech font-semibold tracking-wider px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shrink-0 disabled:opacity-50"
            >
              <span className="text-[#00D9F5]">←</span>
              <span>Back to Plans</span>
            </button>
          </div>
        </header>

        {/* ====================================================================
            MAIN CHECKOUT CONTAINER
            ==================================================================== */}
        <main className="w-full max-w-[440px] mx-auto px-3.5 sm:px-4 pt-4 pb-10 space-y-4 flex-1">
          {!hasValidPlanOrOrder ? (
            <section className="bg-[#0D1622] border border-[#1C3041] rounded-xl p-5 text-center space-y-3.5">
              <h1 className="text-base font-bold font-tech text-[#F4F7FB] tracking-wider uppercase">
                NO PLAN SELECTED
              </h1>
              <p className="text-xs text-[#A7B5C5] leading-relaxed">
                Please select an access-key plan before proceeding to checkout.
              </p>
              <button
                type="button"
                onClick={onBackToPlans}
                className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-[#00D9F5] to-[#168BFF] text-[#070B12] font-tech font-bold text-xs tracking-wider uppercase cursor-pointer"
              >
                ← BACK TO PLANS
              </button>
            </section>
          ) : (
            <>
              {/* ==============================================================
                  B. ORDER SUMMARY CARD
                  ============================================================== */}
              <section className="bg-[#0D1622] border border-[#1C3041] rounded-xl p-4 space-y-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono-code font-bold tracking-[0.16em] uppercase text-[#00D9F5]">
                    ORDER SUMMARY
                  </span>
                  <span className="text-[11px] font-tech font-bold tracking-wider uppercase text-[#F4F7FB]">
                    {activePlanName}
                  </span>
                </div>

                <div className="bg-[#090F18] border border-[#1C3041] rounded-lg px-3.5 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[#A7B5C5]">Panel Validity:</span>
                    <span className="font-tech font-bold text-[#F4F7FB] tracking-wide">
                      {activeValidity}
                    </span>
                  </div>

                  <div className="h-[1px] bg-[#1C3041]" />

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[#A7B5C5]">Total Amount:</span>
                    <span className="text-base font-tech font-bold text-[#00D9F5] tracking-wide">
                      ₹{activeAmount}
                    </span>
                  </div>
                </div>
              </section>

              {/* ==============================================================
                  C. CASHFREE SECURE CHECKOUT SECTION
                  ============================================================== */}
              <section className="bg-[#0D1622] border border-[#1C3041] rounded-xl p-4 sm:p-5 space-y-4 shadow-[0_10px_28px_rgba(0,0,0,0.5)]">
                {/* Section Heading & Description */}
                <div className="space-y-1 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <h1 className="text-sm sm:text-base font-tech font-bold tracking-[0.1em] uppercase text-[#F4F7FB]">
                      CASHFREE SECURE CHECKOUT
                    </h1>
                    {cashfreeMode === 'sandbox' && (
                      <span className="px-2 py-0.5 rounded bg-[#090F18] border border-[#00D9F5]/40 text-[9px] font-mono-code font-bold tracking-widest uppercase text-[#00D9F5]">
                        TEST MODE
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#A7B5C5] leading-relaxed">
                    Complete your payment securely via Cashfree Payments using UPI, Google Pay, PhonePe, Paytm, Cards, or NetBanking.
                  </p>
                </div>

                {/* Gateway Configuration Notice if Credentials Missing */}
                {!gatewayChecking && !gatewayConfigured && (
                  <div className="bg-[#090F18] border border-[#FF5268]/50 rounded-xl p-3.5 space-y-1.5 text-left">
                    <div className="text-[10px] font-mono-code font-bold tracking-[0.15em] uppercase text-[#FF5268]">
                      CASHFREE CONFIGURATION REQUIRED
                    </div>
                    <p className="text-xs text-[#F4F7FB] leading-relaxed">
                      Missing server environment credentials:{' '}
                      <span className="font-mono-code text-[#00D9F5]">
                        {missingCredentials.length > 0
                          ? missingCredentials.join(', ')
                          : 'CASHFREE_APP_ID, CASHFREE_SECRET_KEY'}
                      </span>
                      . Please configure your Cashfree API credentials on the server to process payments.
                    </p>
                  </div>
                )}

                {/* Cashfree Checkout Info Box */}
                <div className="bg-[#090F18] border border-[#1C3041] rounded-xl p-4 space-y-3.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[#A7B5C5] font-mono-code text-[10px] tracking-[0.14em] uppercase">
                      PAYMENT GATEWAY
                    </span>
                    <span className="font-tech font-bold text-[#00D9F5] tracking-wider uppercase">
                      CASHFREE PAYMENTS
                    </span>
                  </div>

                  {activeOrderId && (
                    <>
                      <div className="h-[1px] bg-[#1C3041]" />
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-[#A7B5C5] font-mono-code text-[10px] tracking-[0.14em] uppercase">
                          ORDER ID
                        </span>
                        <span className="font-mono-code text-[11px] text-[#F4F7FB] truncate max-w-[210px]">
                          {activeOrderId}
                        </span>
                      </div>
                    </>
                  )}

                  {/* Supported Payment Methods */}
                  <div className="pt-2 border-t border-[#1C3041] text-center space-y-2">
                    <div className="text-[10px] font-mono-code font-bold tracking-[0.16em] uppercase text-[#A7B5C5]">
                      SUPPORTED PAYMENT METHODS
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      {[
                        'UPI QR & Intent',
                        'Google Pay',
                        'PhonePe',
                        'Paytm',
                        'Cards & NetBanking'
                      ].map(method => (
                        <span
                          key={method}
                          className="px-2.5 py-1 rounded bg-[#0D1622] border border-[#1C3041] text-[10px] font-tech font-semibold tracking-wider text-[#F4F7FB]"
                        >
                          {method}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ============================================================
                    PRIMARY ACTION: PROCEED TO CASHFREE PAYMENT
                    ============================================================ */}
                <button
                  type="button"
                  onClick={handleProceedToCashfreeCheckout}
                  disabled={
                    checkoutOpening ||
                    verifying ||
                    animationMode !== 'NONE' ||
                    bannerState === 'SUCCESS'
                  }
                  className="relative overflow-hidden w-full py-3.5 px-5 rounded-lg bg-gradient-to-r from-[#00D9F5] to-[#168BFF] hover:brightness-105 active:scale-[0.99] text-[#070B12] font-tech font-bold text-sm tracking-[0.14em] uppercase border border-[#7CEEFF]/60 shadow-[0_4px_16px_rgba(0,217,245,0.2),inset_0_1px_0_rgba(255,255,255,0.45)] transition-all cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
                  {checkoutOpening && (
                    <span className="w-4 h-4 rounded-full border-2 border-[#070B12] border-t-transparent animate-spin shrink-0" />
                  )}
                  <span className="relative z-10">
                    {checkoutOpening
                      ? 'OPENING CASHFREE CHECKOUT...'
                      : activeOrderId && paymentSessionId
                      ? 'OPEN CASHFREE CHECKOUT'
                      : 'PROCEED TO SECURE PAYMENT'}
                  </span>
                </button>

                {/* ============================================================
                    SECONDARY ACTION: VERIFY PAYMENT / VERIFY PAYMENT AGAIN
                    ============================================================ */}
                {(Boolean(activeOrderId) || hasAttemptedVerification) && (
                  <button
                    type="button"
                    onClick={() => verifyCashfreeOrder(activeOrderId)}
                    disabled={
                      verifying ||
                      checkoutOpening ||
                      animationMode !== 'NONE' ||
                      bannerState === 'SUCCESS'
                    }
                    className="w-full py-3 px-4 rounded-lg bg-[#090F18] hover:bg-[#111C2B] active:scale-[0.99] border border-[#1C3041] hover:border-[#00D9F5]/50 text-[#00D9F5] font-tech font-bold text-xs tracking-[0.14em] uppercase transition-all cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {verifying && (
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-[#00D9F5] border-t-transparent animate-spin shrink-0" />
                    )}
                    <span>{verifyButtonLabel}</span>
                  </button>
                )}

                {/* ============================================================
                    STATUS MESSAGES BOX
                    ============================================================ */}
                {bannerState !== 'IDLE' && statusMessage && animationMode === 'NONE' && (
                  <div
                    role="status"
                    className={`rounded-lg px-3.5 py-2.5 border text-xs leading-relaxed flex items-start gap-2.5 ${
                      bannerState === 'SUCCESS'
                        ? 'bg-[#090F18] border-[#20D997]/50 text-[#20D997]'
                        : bannerState === 'PROCESSING' || bannerState === 'PENDING'
                        ? 'bg-[#090F18] border-[#00D9F5]/45 text-[#F4F7FB]'
                        : 'bg-[#090F18] border-[#FF5268]/50 text-[#FF5268]'
                    }`}
                  >
                    {bannerState === 'PROCESSING' && (
                      <span className="w-3.5 h-3.5 mt-0.5 rounded-full border-2 border-[#00D9F5] border-t-transparent animate-spin shrink-0" />
                    )}
                    {bannerState === 'SUCCESS' && (
                      <span className="font-bold text-[#20D997] shrink-0">✓</span>
                    )}
                    {(bannerState === 'FAILED' ||
                      bannerState === 'NETWORK_ERROR' ||
                      bannerState === 'PENDING') && (
                      <span className="font-bold text-[#FF5268] shrink-0">!</span>
                    )}
                    <span className="flex-1">{statusMessage}</span>
                  </div>
                )}
              </section>

              {/* ==============================================================
                  BACK TO PLANS LINK BELOW MAIN PAYMENT SECTION
                  ============================================================== */}
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={onBackToPlans}
                  disabled={animationMode !== 'NONE'}
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-tech font-semibold tracking-[0.14em] uppercase text-[#A7B5C5] hover:text-[#00D9F5] transition-colors cursor-pointer py-1.5 px-3 disabled:opacity-50"
                >
                  <span>← BACK TO PLANS</span>
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};
