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

const QR_VALIDITY_DURATION_MS = 5 * 60 * 1000; // 5 minutes in ms
const QR_VALIDITY_SECONDS = 300; // 5 minutes in seconds

export const CheckoutPage: React.FC<CheckoutPageProps> = ({
  settings,
  selectedPlan,
  initialOrderId,
  onBackToPlans,
  onNavigateToKeySuccess
}) => {
  const [activeOrderId, setActiveOrderId] = useState<string>(initialOrderId || '');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [upiIntentUrl, setUpiIntentUrl] = useState<string>('');
  const [reconUrl, setReconUrl] = useState<string>('');
  const [cashfreeMode, setCashfreeMode] = useState<'production' | 'sandbox'>('production');
  const [gatewayConfigured, setGatewayConfigured] = useState<boolean>(true);
  const [missingCredentials, setMissingCredentials] = useState<string[]>([]);
  const [gatewayChecking, setGatewayChecking] = useState<boolean>(true);

  const [qrLoading, setQrLoading] = useState<boolean>(false);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [bannerState, setBannerState] = useState<VerificationBannerState>('IDLE');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [hasAttemptedVerification, setHasAttemptedVerification] = useState<boolean>(false);

  // Strict 5-Minute QR Validity State
  const [qrExpiresAtMs, setQrExpiresAtMs] = useState<number | null>(null);
  const [qrRemainingSeconds, setQrRemainingSeconds] = useState<number>(QR_VALIDITY_SECONDS);
  const [qrExpired, setQrExpired] = useState<boolean>(false);

  const [verifiedOrder, setVerifiedOrder] = useState<PaymentOrder | null>(null);

  // 7-Second Payment Status Animation State
  const [animationMode, setAnimationMode] = useState<PaymentAnimationMode>('NONE');
  const [animationStage, setAnimationStage] = useState<number>(0); // 1: 0-1s, 2: 1-3s, 3: 3-5s, 4: 5-7s
  const [notVerifiedReason, setNotVerifiedReason] = useState<NotVerifiedReason>('PENDING');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);

  const animationTimersRef = useRef<number[]>([]);
  const isAnimatingRef = useRef<boolean>(false);
  const orderInitKeyRef = useRef<string | null>(null);
  const pollBusyRef = useRef<boolean>(false);

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

  // Trigger the 7-Second Payment Not Verified Animation, then return to QR payment page with "CHECK PAYMENT AGAIN"
  const startNotVerifiedAnimationFlow = useCallback(
    (
      reason: NotVerifiedReason,
      finalBannerState: VerificationBannerState,
      finalMessage: string
    ) => {
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

      // Exactly 7.0s: Return customer to QR payment page and display "CHECK PAYMENT AGAIN"
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

  // Create (or reuse active) Cashfree order and retrieve official Cashfree UPI QR code & UPI intent link
  const initializeDirectQrOrder = useCallback(
    async (forceNew = false) => {
      if (
        !selectedPlan ||
        qrLoading ||
        isAnimatingRef.current ||
        animationMode !== 'NONE' ||
        bannerState === 'SUCCESS'
      ) {
        return;
      }

      setQrLoading(true);
      if (forceNew) {
        setQrExpired(false);
        setBannerState('IDLE');
        setStatusMessage('');
      }

      try {
        const response = await fetch('/api/payments/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planId: selectedPlan.id,
            reuseOrderId: forceNew ? undefined : activeOrderId || undefined,
            forceNew
          })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success || !data.order_id || !data.qr_code_data_url) {
          setQrLoading(false);
          if (data.code === 'CASHFREE_NOT_CONFIGURED') {
            setGatewayConfigured(false);
            if (Array.isArray(data.missingCredentials)) {
              setMissingCredentials(data.missingCredentials);
            }
          }
          setBannerState('FAILED');
          setStatusMessage(
            data.message || 'Unable to generate Cashfree UPI QR code. Please try again.'
          );
          return;
        }

        const createdOrderId = String(data.order_id);
        const resolvedMode: 'production' | 'sandbox' =
          data.cashfree_mode === 'sandbox' ? 'sandbox' : 'production';

        // Calculate exact 5-minute expiry timestamp
        const rawExpiry = data.expires_at || data.order?.expiresAt;
        const parsedExpiryMs = rawExpiry ? new Date(rawExpiry).getTime() : NaN;
        const maxAllowedExpiryMs = Date.now() + QR_VALIDITY_DURATION_MS;
        const resolvedExpiryMs =
          Number.isFinite(parsedExpiryMs) && parsedExpiryMs > Date.now()
            ? Math.min(parsedExpiryMs, maxAllowedExpiryMs)
            : maxAllowedExpiryMs;
        const initialSecs = Math.max(
          1,
          Math.min(QR_VALIDITY_SECONDS, Math.ceil((resolvedExpiryMs - Date.now()) / 1000))
        );

        setActiveOrderId(createdOrderId);
        setCashfreeMode(resolvedMode);
        setQrCodeDataUrl(String(data.qr_code_data_url));
        setQrExpiresAtMs(resolvedExpiryMs);
        setQrRemainingSeconds(initialSecs);
        setQrExpired(false);
        setUpiIntentUrl(
          typeof data.upi_intent_url === 'string' ? data.upi_intent_url.trim() : ''
        );
        setReconUrl(typeof data.recon_url === 'string' ? data.recon_url.trim() : '');
        if (data.order) {
          setVerifiedOrder(data.order);
        }
        setBannerState('IDLE');
        setStatusMessage('');
      } catch {
        setBannerState('NETWORK_ERROR');
        setStatusMessage(
          'Unable to connect to Cashfree payment gateway. Please try again.'
        );
      } finally {
        setQrLoading(false);
      }
    },
    [activeOrderId, animationMode, bannerState, qrLoading, selectedPlan]
  );

  // Authoritative backend Cashfree payment verification
  // silent = true is used by automatic background polling so it never interrupts the user while scanning
  const verifyCashfreeOrder = useCallback(
    async (orderIdToVerify: string, silent = false) => {
      const cleanOrderId = (orderIdToVerify || activeOrderId || '').trim();
      if (!cleanOrderId) {
        if (!silent) {
          startNotVerifiedAnimationFlow(
            'FAILED',
            'FAILED',
            'We could not verify your payment. Please try again.'
          );
        }
        return;
      }

      if (verifying || isAnimatingRef.current) return;
      if (silent && pollBusyRef.current) return;

      if (silent) {
        pollBusyRef.current = true;
      } else {
        setVerifying(true);
        setBannerState('PROCESSING');
        setStatusMessage('Checking payment status with Cashfree...');
      }

      try {
        const response = await fetch(
          silent
            ? `/api/payments/order-status/${encodeURIComponent(cleanOrderId)}`
            : '/api/payments/verify-status',
          silent
            ? { method: 'GET', cache: 'no-store' }
            : {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: cleanOrderId })
              }
        );

        const result = await response.json().catch(() => ({}));

        if (result.order) {
          setVerifiedOrder(result.order);
          if (result.order.cashfreeQrCode && !qrCodeDataUrl && !qrExpired) {
            setQrCodeDataUrl(result.order.cashfreeQrCode);
          }
          if (!qrExpiresAtMs && (result.order.expiresAt || result.order.purchasedAt)) {
            const expMs = result.order.expiresAt
              ? new Date(result.order.expiresAt).getTime()
              : new Date(result.order.purchasedAt).getTime() + QR_VALIDITY_DURATION_MS;
            if (Number.isFinite(expMs)) {
              setQrExpiresAtMs(expMs);
              const secsLeft = Math.max(0, Math.ceil((expMs - Date.now()) / 1000));
              setQrRemainingSeconds(secsLeft);
              if (secsLeft <= 0 && result.payment_status !== 'SUCCESS') {
                setQrExpired(true);
              }
            }
          }
          if (result.order.upiIntentUrl && !upiIntentUrl) {
            setUpiIntentUrl(result.order.upiIntentUrl);
          }
          if (result.order.cashfreeReconUrl && !reconUrl) {
            setReconUrl(result.order.cashfreeReconUrl);
          }
          if (result.order.cashfreeMode) {
            setCashfreeMode(result.order.cashfreeMode);
          }
        }

        const category: string = String(result.verification_category || '').toUpperCase();

        // 1. Confirmed Genuine Payment Success -> Trigger 7-Second Success Animation -> /key-success
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
          return;
        }

        // 2. If silent background poll: update UI only on terminal failure; keep waiting quietly if PENDING
        if (silent) {
          if (
            category === 'FAILED' &&
            (result.payment_status === 'FAILED' ||
              result.order_status === 'EXPIRED' ||
              result.order_status === 'TERMINATED')
          ) {
            setBannerState('FAILED');
            setStatusMessage(
              result.message || 'We could not verify your payment. Please try again.'
            );
          }
          return;
        }

        // 3. Explicit manual check -> Trigger 7-Second Payment Not Verified Animation
        if (category === 'NETWORK_ERROR' || response.status >= 500) {
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
            'Your payment is awaiting confirmation. Please wait.'
          );
        } else {
          startNotVerifiedAnimationFlow(
            'FAILED',
            'FAILED',
            result.message || 'We could not verify your payment. Please try again.'
          );
        }
      } catch {
        if (!silent) {
          startNotVerifiedAnimationFlow(
            'NETWORK_ERROR',
            'NETWORK_ERROR',
            'Unable to check your payment status. Please try again.'
          );
        }
      } finally {
        if (silent) {
          pollBusyRef.current = false;
        } else {
          setVerifying(false);
        }
      }
    },
    [
      activeOrderId,
      qrCodeDataUrl,
      reconUrl,
      selectedPlan,
      startNotVerifiedAnimationFlow,
      startSuccessAnimationFlow,
      syncVerifiedKeyToFirestore,
      upiIntentUrl,
      verifying
    ]
  );

  // Automatically initialize the Direct UPI QR code when landing on /checkout
  useEffect(() => {
    if (initialOrderId) {
      if (orderInitKeyRef.current !== `init_${initialOrderId}`) {
        orderInitKeyRef.current = `init_${initialOrderId}`;
        setActiveOrderId(initialOrderId);
        verifyCashfreeOrder(initialOrderId, false);
      }
      return;
    }

    if (
      selectedPlan &&
      selectedPlan.available &&
      isPlanFullyConfigured(selectedPlan)
    ) {
      const planKey = `plan_${selectedPlan.id}_${selectedPlan.priceINR}`;
      if (orderInitKeyRef.current !== planKey) {
        orderInitKeyRef.current = planKey;
        initializeDirectQrOrder(false);
      }
    }
  }, [initialOrderId, initializeDirectQrOrder, selectedPlan, verifyCashfreeOrder]);

  // Strict 5-Minute (300s) QR Validity Countdown Timer
  useEffect(() => {
    if (!qrExpiresAtMs || !qrCodeDataUrl || bannerState === 'SUCCESS') {
      return;
    }

    const updateTimer = () => {
      const diffMs = qrExpiresAtMs - Date.now();
      const secs = Math.max(0, Math.ceil(diffMs / 1000));
      setQrRemainingSeconds(secs);

      if (secs <= 0) {
        setQrExpired(true);
        setQrCodeDataUrl('');
        setUpiIntentUrl('');
        setReconUrl('');
        setBannerState('FAILED');
        setStatusMessage('QR code expired (valid for 5 minutes only). Please generate a new QR code.');
      }
    };

    updateTimer();
    const timerId = window.setInterval(updateTimer, 1000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [qrExpiresAtMs, qrCodeDataUrl, bannerState]);

  // Automatic Background Payment Status Verification every 4 seconds while QR is active
  useEffect(() => {
    if (
      !activeOrderId ||
      !qrCodeDataUrl ||
      qrExpired ||
      animationMode !== 'NONE' ||
      bannerState === 'SUCCESS' ||
      bannerState === 'FAILED'
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!isAnimatingRef.current && !verifying) {
        verifyCashfreeOrder(activeOrderId, true);
      }
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeOrderId, animationMode, bannerState, qrCodeDataUrl, qrExpired, verifyCashfreeOrder, verifying]);

  // Listen for Cashfree recon iframe postMessage events to trigger immediate backend verification
  useEffect(() => {
    if (!activeOrderId) return;
    const handleReconMessage = (event: MessageEvent) => {
      try {
        const raw = event.data;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const txStatus = String(
          parsed?.transaction?.txStatus || parsed?.txStatus || ''
        ).toUpperCase();
        const orderStatus = String(parsed?.order?.status || '').toUpperCase();
        if (txStatus === 'SUCCESS' || orderStatus === 'PAID') {
          verifyCashfreeOrder(activeOrderId, true);
        }
      } catch {
        // Ignore unrelated window messages
      }
    };
    window.addEventListener('message', handleReconMessage);
    return () => {
      window.removeEventListener('message', handleReconMessage);
    };
  }, [activeOrderId, verifyCashfreeOrder]);

  // Open Cashfree-supported UPI Payment Intent / Deep Link
  const handleOpenUpiApp = () => {
    if (!upiIntentUrl || qrExpired || animationMode !== 'NONE') return;
    setBannerState('PENDING');
    setStatusMessage('Your payment is awaiting confirmation. Please wait.');
    window.location.href = upiIntentUrl;
  };

  const getNotVerifiedOverlayMessage = (): string => {
    if (notVerifiedReason === 'PENDING') {
      return 'Your payment is awaiting confirmation. Please wait.';
    }
    if (notVerifiedReason === 'NETWORK_ERROR') {
      return 'Unable to check your payment status. Please try again.';
    }
    return 'We could not verify your payment. Please try again.';
  };

  const formattedQrCountdown = `${String(Math.floor(qrRemainingSeconds / 60)).padStart(
    2,
    '0'
  )}:${String(qrRemainingSeconds % 60).padStart(2, '0')}`;

  const checkPaymentButtonLabel = verifying
    ? 'CHECKING PAYMENT...'
    : hasAttemptedVerification
    ? 'CHECK PAYMENT AGAIN'
    : 'CHECK PAYMENT STATUS';

  return (
    <div className="relative min-h-[100dvh] w-full bg-[#05080D] text-[#F4F7FB] overflow-y-auto overflow-x-hidden select-none">
      {/* Subtle ambient background depth matching REVOX PANEL */}
      <div className="fixed inset-0 vignette-radial pointer-events-none z-0" />

      {/* Hidden 0x0 Cashfree Recon Frame for real-time bank QR push reconciliation */}
      {reconUrl && animationMode === 'NONE' && bannerState !== 'SUCCESS' && (
        <iframe
          src={reconUrl}
          title="Cashfree Recon"
          className="w-0 h-0 border-0 opacity-0 pointer-events-none fixed"
          aria-hidden="true"
        />
      )}

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
                REVOX PANEL // VERIFIED
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

              {/* Purchased Plan Summary */}
              <div
                className="bg-[#05080D]/85 rounded-xl px-4 py-3 space-y-2 text-left"
                style={{ border: '1px solid rgba(0, 217, 245, 0.25)' }}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#A7B5C5] font-mono-code text-[10px] tracking-[0.14em] uppercase">
                    SELECTED PLAN
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
                  OPENING ACCESS KEY PAGE...
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
                REVOX PANEL // STATUS
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
                className="bg-[#05080D]/85 rounded-xl px-4 py-3.5 space-y-1"
                style={{ border: '1px solid rgba(255, 82, 104, 0.35)' }}
              >
                {notVerifiedReason === 'PENDING' && (
                  <div className="text-[11px] font-tech font-bold tracking-[0.14em] uppercase text-[#00D9F5]">
                    PAYMENT PENDING
                  </div>
                )}
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
                  RETURNING TO QR PAYMENT PAGE...
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 flex flex-col min-h-[100dvh]">
        {/* ====================================================================
            HEADER: REVOX PANEL + SECURE UPI PAYMENT + BACK TO PLANS
            ==================================================================== */}
        <header className="sticky top-0 z-30 w-full bg-[#05080D]/95 backdrop-blur-md border-b border-[#1C3041] px-4 py-3">
          <div className="w-full max-w-[430px] mx-auto flex items-center justify-between gap-3">
            {/* Left: REVOX Logo + REVOX PANEL + SECURE UPI PAYMENT */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[#0B1420] border border-[#00D9F5]/30 flex items-center justify-center p-1 shrink-0">
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
                  SECURE UPI PAYMENT
                </div>
              </div>
            </div>

            {/* Right: Back to Plans Link */}
            <button
              type="button"
              onClick={onBackToPlans}
              disabled={animationMode !== 'NONE'}
              className="bg-[#0B1420] hover:bg-[#111E30] active:scale-[0.98] border border-[#1C3041] hover:border-[#00D9F5]/50 text-[#F4F7FB] text-xs font-tech font-semibold tracking-wider px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shrink-0 disabled:opacity-50"
            >
              <span className="text-[#00D9F5]">←</span>
              <span>Back to Plans</span>
            </button>
          </div>
        </header>

        {/* ====================================================================
            MAIN QR PAYMENT CONTAINER
            ==================================================================== */}
        <main className="w-full max-w-[430px] mx-auto px-3.5 sm:px-4 pt-4 pb-10 space-y-4 flex-1">
          {!hasValidPlanOrOrder ? (
            <section className="bg-[#0B1420] border border-[#1C3041] rounded-2xl p-5 text-center space-y-3.5">
              <h1 className="text-base font-bold font-tech text-[#F4F7FB] tracking-wider uppercase">
                NO PLAN SELECTED
              </h1>
              <p className="text-xs text-[#A7B5C5] leading-relaxed">
                Please select an access-key plan before proceeding to payment.
              </p>
              <button
                type="button"
                onClick={onBackToPlans}
                className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-[#00D9F5] to-[#168BFF] text-[#05080D] font-tech font-bold text-xs tracking-wider uppercase cursor-pointer"
              >
                ← BACK TO PLANS
              </button>
            </section>
          ) : (
            <>
              {/* ==============================================================
                  CLEAN & PROFESSIONAL REVOX QR PAYMENT CARD
                  ============================================================== */}
              <section
                className="bg-[#0B1420]/95 backdrop-blur-xl rounded-2xl p-4 sm:p-5 space-y-4"
                style={{
                  border: '1px solid rgba(0, 217, 245, 0.22)',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.55)'
                }}
              >
                {/* Selected Plan / Panel Validity / Payable Amount */}
                <div className="bg-[#05080D]/90 border border-[#1C3041] rounded-xl px-4 py-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[#A7B5C5]">Selected Plan:</span>
                    <span className="font-tech font-bold text-[#F4F7FB] tracking-wider uppercase">
                      {activePlanName}
                    </span>
                  </div>

                  <div className="h-[1px] bg-[#1C3041]" />

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[#A7B5C5]">Panel Validity:</span>
                    <span className="font-tech font-bold text-[#F4F7FB] tracking-wide">
                      {activeValidity}
                    </span>
                  </div>

                  <div className="h-[1px] bg-[#1C3041]" />

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[#A7B5C5]">Payable Amount:</span>
                    <span className="text-lg font-tech font-bold text-[#00D9F5] tracking-wide">
                      ₹{activeAmount}
                    </span>
                  </div>
                </div>

                {/* Gateway Configuration Notice if Credentials Missing */}
                {!gatewayChecking && !gatewayConfigured && (
                  <div className="bg-[#05080D] border border-[#FF5268]/50 rounded-xl p-3.5 space-y-1.5 text-left">
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
                      .
                    </p>
                  </div>
                )}

                {/* ============================================================
                    CLEAN WHITE UPI QR CONTAINER (STRICT 5-MINUTE VALIDITY)
                    ============================================================ */}
                <div className="flex flex-col items-center space-y-2.5 pt-0.5">
                  <div
                    className="relative bg-white rounded-2xl p-3.5 flex items-center justify-center w-[240px] h-[240px] sm:w-[252px] sm:h-[252px]"
                    style={{
                      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45)'
                    }}
                  >
                    {qrLoading ? (
                      <div className="flex flex-col items-center justify-center gap-3 text-center px-4">
                        <span className="w-8 h-8 rounded-full border-3 border-[#00D9F5] border-t-transparent animate-spin" />
                        <span className="text-[11px] font-tech font-bold tracking-wider uppercase text-[#05080D]">
                          GENERATING QR...
                        </span>
                      </div>
                    ) : qrCodeDataUrl && !qrExpired ? (
                      <img
                        src={qrCodeDataUrl}
                        alt={`Scan to pay ₹${activeAmount} via UPI`}
                        className="w-full h-full object-contain select-none"
                        style={{ imageRendering: 'crisp-edges' }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2.5 text-center px-4">
                        <span className="text-xs font-tech font-bold uppercase text-[#05080D]">
                          {qrExpired ? 'QR EXPIRED (5 MIN LIMIT)' : 'QR UNAVAILABLE'}
                        </span>
                        <button
                          type="button"
                          onClick={() => initializeDirectQrOrder(true)}
                          className="px-3.5 py-2 rounded-lg bg-[#05080D] text-[#00D9F5] text-[11px] font-tech font-bold tracking-wider uppercase cursor-pointer"
                        >
                          GENERATE NEW QR CODE
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 5-Minute QR Validity Countdown Indicator */}
                  {qrCodeDataUrl && !qrExpired && bannerState !== 'SUCCESS' && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[#05080D]/90 border border-[#1C3041]">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          qrRemainingSeconds <= 60
                            ? 'bg-[#FF5268] animate-ping'
                            : 'bg-[#20D997] animate-pulse'
                        }`}
                      />
                      <span className="text-[11px] font-mono-code font-semibold tracking-wider uppercase text-[#A7B5C5]">
                        QR Valid For:
                      </span>
                      <span
                        className={`text-xs font-mono-code font-extrabold tracking-widest ${
                          qrRemainingSeconds <= 60 ? 'text-[#FF5268]' : 'text-[#00D9F5]'
                        }`}
                      >
                        {formattedQrCountdown}
                      </span>
                    </div>
                  )}

                  {/* Clean Single-Line Scan Instruction */}
                  <div className="text-xs font-tech font-bold tracking-[0.16em] uppercase text-[#00D9F5] pt-0.5">
                    SCAN &amp; PAY ANY APP
                  </div>
                </div>

                {/* ============================================================
                    OPEN UPI APP BUTTON (Shown only if valid Cashfree UPI intent link is available)
                    ============================================================ */}
                {Boolean(upiIntentUrl) && !qrExpired && (
                  <button
                    type="button"
                    onClick={handleOpenUpiApp}
                    disabled={
                      qrLoading ||
                      verifying ||
                      qrExpired ||
                      animationMode !== 'NONE' ||
                      bannerState === 'SUCCESS'
                    }
                    className="relative overflow-hidden w-full py-3 px-5 rounded-xl bg-gradient-to-r from-[#00D9F5] to-[#168BFF] hover:brightness-105 active:scale-[0.99] text-[#05080D] font-tech font-bold text-xs tracking-[0.14em] uppercase border border-[#7CEEFF]/50 transition-all cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <span className="relative z-10">OPEN UPI APP</span>
                  </button>
                )}

                {(bannerState === 'FAILED' || bannerState === 'NETWORK_ERROR') &&
                  statusMessage &&
                  animationMode === 'NONE' && (
                    <div
                      role="status"
                      className="bg-[#05080D] border border-[#FF5268]/50 rounded-xl px-4 py-3 text-center space-y-2"
                    >
                      <p className="text-xs text-[#FF5268] leading-relaxed">
                        {statusMessage}
                      </p>
                      {bannerState === 'FAILED' && (
                        <button
                          type="button"
                          onClick={() => initializeDirectQrOrder(true)}
                          disabled={qrLoading || verifying}
                          className="px-4 py-2 rounded-lg bg-[#0B1420] border border-[#00D9F5]/40 text-[#00D9F5] text-[11px] font-tech font-bold tracking-[0.14em] uppercase cursor-pointer hover:bg-[#111E30] transition-colors"
                        >
                          RETRY WITH NEW QR
                        </button>
                      )}
                    </div>
                  )}

                {/* ============================================================
                    CHECK PAYMENT STATUS BUTTON (ABOVE) + WAITING TEXT (BELOW)
                    ============================================================ */}
                <div className="space-y-2.5 pt-0.5">
                  {(Boolean(activeOrderId) || hasAttemptedVerification) && (
                    <button
                      type="button"
                      onClick={() => verifyCashfreeOrder(activeOrderId, false)}
                      disabled={
                        verifying ||
                        qrLoading ||
                        animationMode !== 'NONE' ||
                        bannerState === 'SUCCESS'
                      }
                      className="relative w-full py-3 px-5 rounded-xl bg-[#0D1A2B]/90 hover:bg-[#112338] active:scale-[0.99] backdrop-blur-md border border-[#00D9F5]/35 text-[#F4F7FB] font-tech font-bold text-xs tracking-[0.14em] uppercase transition-all cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed flex items-center justify-center gap-2 overflow-hidden shadow-[0_0_10px_rgba(0,217,245,0.1),inset_0_1px_0_rgba(255,255,255,0.14)]"
                    >
                      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
                      {verifying ? (
                        <span className="relative z-10 w-3.5 h-3.5 rounded-full border-2 border-[#00D9F5] border-t-transparent animate-spin shrink-0" />
                      ) : (
                        <span className="relative z-10 w-1.5 h-1.5 rounded-full bg-[#00D9F5] shrink-0" />
                      )}
                      <span className="relative z-10 text-[#F4F7FB]">
                        {checkPaymentButtonLabel}
                      </span>
                    </button>
                  )}

                  {qrCodeDataUrl && !qrExpired && bannerState !== 'FAILED' && bannerState !== 'SUCCESS' && (
                    <p className="text-center text-[11px] font-normal text-[#A7B5C5]/75 tracking-wide">
                      Waiting for payment confirmation...
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
};
