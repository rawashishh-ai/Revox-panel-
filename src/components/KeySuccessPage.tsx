import React, { useState, useEffect, useCallback } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { SiteSettings, AccessKey } from '../types';
import { formatPlanValidity } from '../config/purchaseConfig';

export const VERIFIED_PURCHASE_SESSION_KEY = 'rvx_verified_purchase_session_v1';

export interface VerifiedPurchaseSession {
  orderId: string;
  claimToken: string;
  planName?: string;
  validityLabel?: string;
}

interface KeySuccessPageProps {
  settings: SiteSettings;
  verifiedSession: VerifiedPurchaseSession | null;
  onOpenRevoxPanel: (accessKey?: string) => void;
  onBackToPlans: () => void;
}

interface ClaimedOrderDetails {
  orderId: string;
  planName: string;
  planDurationValue: number;
  planDurationUnit: 'minutes' | 'hours' | 'days' | 'lifetime';
  validityLabel: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  assignedKey: string | null;
}

export const KeySuccessPage: React.FC<KeySuccessPageProps> = ({
  settings,
  verifiedSession,
  onOpenRevoxPanel,
  onBackToPlans
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [unauthorized, setUnauthorized] = useState<boolean>(false);
  const [keyPreparing, setKeyPreparing] = useState<boolean>(false);
  const [orderDetails, setOrderDetails] = useState<ClaimedOrderDetails | null>(null);
  const [accessKey, setAccessKey] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const logoSrc =
    settings.logoUrl && settings.logoUrl.trim() !== ''
      ? settings.logoUrl
      : '/assets/revox-logo.png';

  const syncVerifiedKeyToFirestore = useCallback(
    async (order: ClaimedOrderDetails, keyStr: string) => {
      if (!keyStr) return;
      try {
        const keyDoc: AccessKey = {
          id: keyStr,
          key: keyStr,
          customerName: 'REVOX Customer',
          status: 'active',
          durationDays: Number(order.planDurationValue) || 7,
          durationUnit: order.planDurationUnit || 'days',
          durationValue: Number(order.planDurationValue) || 7,
          createdAt: new Date().toISOString(),
          activatedAt: null,
          expiresAt: null,
          boundDeviceId: null,
          activeSessionToken: null,
          lastVerifiedAt: null,
          renewedAt: null,
          updatedAt: new Date().toISOString(),
          notes: `Cashfree Verified (${order.orderId})`
        };
        await setDoc(doc(db, 'accessKeys', keyDoc.id), keyDoc, { merge: true });
      } catch {
        // Non-blocking if backend already persisted key
      }
    },
    []
  );

  const retrieveVerifiedAccessKey = useCallback(async () => {
    let session = verifiedSession;
    if (!session || !session.orderId || !session.claimToken) {
      try {
        const raw = sessionStorage.getItem(VERIFIED_PURCHASE_SESSION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as VerifiedPurchaseSession;
          if (parsed && parsed.orderId && parsed.claimToken) {
            session = parsed;
          }
        }
      } catch {
        session = null;
      }
    }

    if (!session || !session.orderId || !session.claimToken) {
      setUnauthorized(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setUnauthorized(false);

    try {
      const response = await fetch('/api/payments/claim-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-claim-token': session.claimToken
        },
        body: JSON.stringify({
          orderId: session.orderId,
          claimToken: session.claimToken
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.verified || !data.order) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }

      const claimedOrder: ClaimedOrderDetails = {
        orderId: data.order.orderId,
        planName: data.order.planName || session.planName || 'REVOX ACCESS KEY',
        planDurationValue: Number(data.order.planDurationValue) || 7,
        planDurationUnit: data.order.planDurationUnit || 'days',
        validityLabel:
          data.order.validityLabel ||
          session.validityLabel ||
          formatPlanValidity(
            Number(data.order.planDurationValue) || 7,
            data.order.planDurationUnit || 'days'
          ),
        amount: Number(data.order.amount) || 0,
        currency: data.order.currency || 'INR',
        paymentStatus: 'VERIFIED',
        assignedKey: data.assignedKey || data.order.assignedKey || null
      };

      setOrderDetails(claimedOrder);

      if (claimedOrder.assignedKey) {
        setAccessKey(claimedOrder.assignedKey);
        setKeyPreparing(false);
        await syncVerifiedKeyToFirestore(claimedOrder, claimedOrder.assignedKey);
      } else {
        setKeyPreparing(true);
      }
    } catch {
      if (session?.orderId && session?.claimToken) {
        setOrderDetails({
          orderId: session.orderId,
          planName: session.planName || 'REVOX ACCESS KEY',
          planDurationValue: 7,
          planDurationUnit: 'days',
          validityLabel: session.validityLabel || '7 Days',
          amount: 0,
          currency: 'INR',
          paymentStatus: 'VERIFIED',
          assignedKey: null
        });
        setKeyPreparing(true);
      } else {
        setUnauthorized(true);
      }
    } finally {
      setLoading(false);
    }
  }, [verifiedSession, syncVerifiedKeyToFirestore]);

  useEffect(() => {
    retrieveVerifiedAccessKey();
  }, [retrieveVerifiedAccessKey]);

  const handleCopyAccessKey = () => {
    if (!accessKey) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(accessKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="relative min-h-[100dvh] w-full bg-[#070B12] text-[#F4F7FB] overflow-y-auto overflow-x-hidden select-none">
      {/* Subtle ambient background depth matching REVOX PANEL */}
      <div className="fixed inset-0 vignette-radial pointer-events-none z-0" />

      <div className="relative z-10 flex flex-col min-h-[100dvh]">
        {/* ====================================================================
            HEADER: REVOX PANEL / PURCHASE CONFIRMED
            ==================================================================== */}
        <header className="sticky top-0 z-30 w-full bg-[#070B12]/95 backdrop-blur-sm border-b border-[#1C3041] px-4 py-3">
          <div className="w-full max-w-[440px] mx-auto flex items-center justify-between gap-3">
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
                <div className="text-[10px] font-mono-code font-semibold tracking-[0.16em] text-[#20D997] leading-tight truncate uppercase">
                  PURCHASE CONFIRMED
                </div>
              </div>
            </div>

            <div className="px-2.5 py-1 rounded-md bg-[#0D1622] border border-[#20D997]/40 text-[10px] font-mono-code font-bold tracking-[0.14em] uppercase text-[#20D997] shrink-0">
              VERIFIED
            </div>
          </div>
        </header>

        {/* ====================================================================
            MAIN ACCESS KEY CONTAINER
            ==================================================================== */}
        <main className="w-full max-w-[440px] mx-auto px-3.5 sm:px-4 pt-5 pb-10 space-y-4 flex-1 flex flex-col justify-center">
          {loading ? (
            <section className="bg-[#0D1622] border border-[#1C3041] rounded-xl p-6 text-center space-y-3 shadow-[0_10px_28px_rgba(0,0,0,0.5)]">
              <div className="w-8 h-8 mx-auto rounded-full border-2 border-[#00D9F5] border-t-transparent animate-spin" />
              <div className="text-xs font-tech font-bold tracking-wider uppercase text-[#F4F7FB]">
                RETRIEVING YOUR ACCESS KEY...
              </div>
            </section>
          ) : unauthorized ? (
            <section className="bg-[#0D1622] border border-[#1C3041] rounded-xl p-5 text-center space-y-3.5 shadow-[0_10px_28px_rgba(0,0,0,0.5)]">
              <h1 className="text-base font-bold font-tech text-[#F4F7FB] tracking-wider uppercase">
                VERIFIED PURCHASE REQUIRED
              </h1>
              <p className="text-xs text-[#A7B5C5] leading-relaxed">
                An active verified payment session is required to view an access key. Please select a plan and complete payment verification first.
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
              {/* Title & Subtitle */}
              <div className="text-center space-y-1.5">
                <h1 className="text-lg sm:text-xl font-tech font-bold tracking-[0.12em] uppercase text-[#F4F7FB]">
                  YOUR ACCESS KEY
                </h1>
                <p className="text-xs text-[#A7B5C5] leading-relaxed">
                  Your payment has been verified. Your access key is ready.
                </p>
              </div>

              {/* Main Access Key Card */}
              <section className="bg-[#0D1622] border border-[#1C3041] rounded-xl p-4 sm:p-5 space-y-4 shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
                {/* Plan & Purchase Metadata */}
                <div className="bg-[#090F18] border border-[#1C3041] rounded-lg p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono-code font-bold tracking-[0.15em] uppercase text-[#A7B5C5]">
                      PLAN NAME:
                    </span>
                    <span className="text-xs font-tech font-bold tracking-wider uppercase text-[#F4F7FB] text-right">
                      {orderDetails?.planName || 'REVOX ACCESS KEY'}
                    </span>
                  </div>

                  <div className="h-[1px] bg-[#1C3041]" />

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono-code font-bold tracking-[0.15em] uppercase text-[#A7B5C5]">
                      PANEL VALIDITY:
                    </span>
                    <span className="text-xs font-tech font-bold tracking-wider text-[#00D9F5] text-right">
                      {orderDetails?.validityLabel || '7 Days'}
                    </span>
                  </div>

                  <div className="h-[1px] bg-[#1C3041]" />

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono-code font-bold tracking-[0.15em] uppercase text-[#A7B5C5]">
                      PAYMENT STATUS:
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-mono-code font-bold tracking-[0.14em] uppercase text-[#20D997]">
                      <span>●</span>
                      <span>VERIFIED</span>
                    </span>
                  </div>
                </div>

                {/* Access Key Display Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono-code font-bold tracking-[0.16em] uppercase text-[#00D9F5]">
                      ACCESS KEY:
                    </span>
                    {copied && (
                      <span className="text-[10px] font-mono-code font-bold tracking-[0.14em] uppercase text-[#20D997]">
                        ACCESS KEY COPIED
                      </span>
                    )}
                  </div>

                  {keyPreparing || !accessKey ? (
                    <div className="bg-[#090F18] border border-[#00D9F5]/40 rounded-lg p-3.5 text-center space-y-2.5">
                      <p className="text-xs text-[#F4F7FB] leading-relaxed">
                        Payment verified. Your access key is being prepared. Please check again shortly.
                      </p>
                      <button
                        type="button"
                        onClick={retrieveVerifiedAccessKey}
                        className="px-4 py-2 rounded-lg bg-[#0D1622] border border-[#1C3041] hover:border-[#00D9F5]/50 text-xs font-tech font-bold tracking-wider uppercase text-[#00D9F5] cursor-pointer transition-colors"
                      >
                        CHECK AGAIN
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={handleCopyAccessKey}
                      title="Click to copy access key"
                      className="bg-[#090F18] border border-[#20D997]/45 hover:border-[#00D9F5]/60 rounded-lg py-3.5 px-4 text-center font-mono-code text-base sm:text-lg font-bold tracking-[0.14em] text-[#F4F7FB] select-all break-all shadow-[inset_0_0_18px_rgba(0,217,245,0.06)] transition-colors cursor-pointer"
                    >
                      {accessKey}
                    </div>
                  )}
                </div>

                {/* Primary Actions */}
                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyAccessKey}
                    disabled={!accessKey}
                    className="relative overflow-hidden w-full py-3.5 px-5 rounded-lg bg-gradient-to-r from-[#00D9F5] to-[#168BFF] hover:brightness-105 active:scale-[0.99] text-[#070B12] font-tech font-bold text-sm tracking-[0.14em] uppercase border border-[#7CEEFF]/60 shadow-[0_4px_16px_rgba(0,217,245,0.2),inset_0_1px_0_rgba(255,255,255,0.45)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
                    <span className="relative z-10">
                      {copied ? 'ACCESS KEY COPIED' : 'COPY ACCESS KEY'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenRevoxPanel(accessKey)}
                    className="w-full py-3.5 px-5 rounded-lg bg-[#090F18] hover:bg-[#111C2B] active:scale-[0.99] border border-[#1C3041] hover:border-[#00D9F5]/50 text-[#F4F7FB] font-tech font-bold text-sm tracking-[0.14em] uppercase transition-all cursor-pointer"
                  >
                    OPEN REVOX PANEL
                  </button>
                </div>

                {/* Security Note */}
                <p className="text-[11px] text-[#A7B5C5] text-center leading-relaxed pt-1">
                  Keep your access key private. Do not share it with others.
                </p>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
};
