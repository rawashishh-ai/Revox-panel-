import React, { useState, useEffect } from 'react';
import { SiteSettings, PaymentOrder } from '../types';

interface GetKeyModalProps {
  settings: SiteSettings;
  onClose: () => void;
  onKeyPurchasedAndSelected?: (key: string) => void;
}

export const GetKeyModal: React.FC<GetKeyModalProps> = ({
  settings,
  onClose,
  onKeyPurchasedAndSelected
}) => {
  const price = settings.keyPriceINR || 199;

  // View steps: 'checkout' | 'payment_pending' | 'revealing' | 'unlocked' | 'retrieve'
  const [step, setStep] = useState<'checkout' | 'payment_pending' | 'revealing' | 'unlocked' | 'retrieve'>('checkout');

  // Customer Inputs
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active Order & Revealed Key
  const [activeOrder, setActiveOrder] = useState<PaymentOrder | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Retrieval input
  const [retrieveOrderId, setRetrieveOrderId] = useState('');

  // Reveal Animation Stages
  const [revealStage, setRevealStage] = useState<1 | 2 | 3 | 4>(1);

  // Poll order status when step is 'payment_pending'
  useEffect(() => {
    if (step !== 'payment_pending' || !activeOrder?.orderId) return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/payments/order-status/${activeOrder.orderId}`);
        const data = await res.json();

        if (data.success && data.order) {
          if (data.order.paymentStatus === 'SUCCESS' && data.order.assignedKey) {
            clearInterval(interval);
            setRevealedKey(data.order.assignedKey);
            triggerRevealAnimation(data.order.assignedKey);
          } else if (data.order.paymentStatus === 'FAILED' || data.order.paymentStatus === 'CANCELLED') {
            clearInterval(interval);
            setErrorMsg('Payment failed or was cancelled. Please try again.');
            setStep('checkout');
          }
        }
      } catch (err) {
        console.warn('Polling status error:', err);
      }

      if (attempts > 180) { // 6 minutes max polling
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [step, activeOrder?.orderId]);

  // Trigger cinematic key reveal sequence
  const triggerRevealAnimation = (key: string) => {
    setStep('revealing');
    setRevealStage(1); // 1. Payment Verified

    setTimeout(() => {
      setRevealStage(2); // 2. Lock Opening
    }, 700);

    setTimeout(() => {
      setRevealStage(3); // 3. Glowing Circle & Blur Removal
    }, 1500);

    setTimeout(() => {
      setRevealStage(4); // 4. Key Unlocked & Copy Button
      setStep('unlocked');
    }, 2400);
  };

  // Create Order & Launch TranzUPI
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim() || 'VIP Customer',
          customerPhone: customerPhone.trim() || ''
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success || !data.order) {
        throw new Error(data.message || 'Failed to create payment order');
      }

      setActiveOrder(data.order);
      setStep('payment_pending');

      // If TranzUPI payment URL is returned, open it in new tab or popup
      if (data.paymentUrl) {
        window.open(data.paymentUrl, '_blank', 'noopener,noreferrer');
      } else if (data.upiIntentUrl) {
        window.location.href = data.upiIntentUrl;
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Server error creating order');
    } finally {
      setLoading(false);
    }
  };

  // Manual Check Payment Status button
  const handleVerifyNow = async () => {
    if (!activeOrder?.orderId) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/payments/order-status/${activeOrder.orderId}?verify=true`);
      const data = await res.json();

      if (data.success && data.order?.paymentStatus === 'SUCCESS' && data.order.assignedKey) {
        setRevealedKey(data.order.assignedKey);
        triggerRevealAnimation(data.order.assignedKey);
      } else {
        setErrorMsg('Payment verification pending. Complete payment on TranzUPI and click verify again.');
      }
    } catch (err: any) {
      setErrorMsg('Error checking payment status');
    } finally {
      setLoading(false);
    }
  };

  // Retrieve previously purchased key
  const handleRetrieveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retrieveOrderId.trim()) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/payments/order-status/${retrieveOrderId.trim().toUpperCase()}`);
      const data = await res.json();

      if (data.success && data.order?.paymentStatus === 'SUCCESS' && data.order.assignedKey) {
        setRevealedKey(data.order.assignedKey);
        setActiveOrder(data.order);
        setStep('unlocked');
      } else if (data.order?.paymentStatus === 'PENDING') {
        setActiveOrder(data.order);
        setStep('payment_pending');
      } else {
        setErrorMsg('Order not found or payment incomplete.');
      }
    } catch {
      setErrorMsg('Error retrieving order details.');
    } finally {
      setLoading(false);
    }
  };

  // Copy Key to Clipboard
  const handleCopy = () => {
    if (revealedKey && navigator.clipboard) {
      navigator.clipboard.writeText(revealedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  // Use Key now
  const handleUseKey = () => {
    if (revealedKey && onKeyPurchasedAndSelected) {
      onKeyPurchasedAndSelected(revealedKey);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#05070B]/92 backdrop-blur-md animate-fade-in select-none">
      
      {/* Outer Glow Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(0,229,255,0.18)_0%,transparent_75%)] pointer-events-none" />
      <div className="absolute inset-0 scanlines-overlay opacity-60 pointer-events-none" />

      {/* Main Container */}
      <div className="relative w-full max-w-[390px] p-[1px] bg-gradient-to-b from-[#00E5FF] via-[#42BFFF] to-[#167DFF]/60 clip-announcement shadow-[0_0_45px_rgba(0,229,255,0.38)]">
        <div className="relative bg-[#0D1520] clip-announcement p-4 sm:p-5 text-[#F4F9FF] flex flex-col justify-between overflow-hidden">
          
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 text-[#A5B4C7] hover:text-[#F4F9FF] bg-[#0A1018] hover:bg-[#111D2C] border border-[#00E5FF]/35 w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-colors cursor-pointer z-20"
          >
            ✕
          </button>

          {/* PAGE HEADER */}
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#0A1828] border border-[#00E5FF]/50 text-[#00E5FF] text-[9.5px] font-mono-code font-bold uppercase tracking-widest mb-1.5 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] animate-pulse" />
              ONE-TIME ACCESS KEY
            </div>
            <h2 className="text-xl sm:text-2xl font-black font-tech tracking-wider uppercase text-[#F4F9FF] drop-shadow-[0_2px_8px_rgba(0,229,255,0.35)]">
              GET YOUR ACCESS KEY
            </h2>
          </div>

          {/* STEP 1: CHECKOUT & LOCKED PREVIEW */}
          {step === 'checkout' && (
            <div className="space-y-4">
              
              {/* Blurred Key Preview Card */}
              <div className="relative p-[1px] bg-gradient-to-b from-[#00E5FF]/55 to-[#167DFF]/30 clip-announcement shadow-lg">
                <div className="bg-[#0A1018] clip-announcement p-3.5 text-center relative overflow-hidden">
                  
                  <div className="text-[#A5B4C7] text-[9.5px] font-bold tracking-[0.2em] uppercase font-mono-code mb-1">
                    ACCESS KEY
                  </div>

                  {/* Blurred placeholder text */}
                  <div className="relative py-2 px-3 bg-[#080D14] border border-[#00E5FF]/35 rounded overflow-hidden flex items-center justify-center">
                    <span className="text-lg font-mono-code font-bold tracking-widest text-[#42BFFF] blur-[5px] select-none pointer-events-none opacity-60">
                      RVX-VIP9-4920-PHAN
                    </span>

                    {/* Lock Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-[#05070B]/60 backdrop-blur-[2px]">
                      <span className="text-xs font-mono-code font-bold text-[#F4F9FF] bg-[#0D1A2B]/90 border border-[#00E5FF]/70 px-2.5 py-1 rounded shadow-md flex items-center gap-1.5 tracking-wider">
                        <span>🔒</span>
                        <span>LOCKED KEY</span>
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-[#A5B4C7] font-sans mt-2">
                    Instant online key delivery for <strong className="text-[#F4F9FF]">₹{price}</strong>.
                  </p>
                  <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#0A1828]/75 border border-[#00E5FF]/40 text-[#42BFFF] text-[9.5px] font-mono-code font-bold">
                    <span>🔒</span>
                    <span>STRICT 1-DEVICE LOCK (Single device license)</span>
                  </div>
                </div>
              </div>

              {/* Price & Customer Form */}
              <form onSubmit={handleCreateOrder} className="space-y-3">
                <div className="bg-[#0A1018] border border-[#00E5FF]/25 p-3 rounded space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono-code border-b border-[#00E5FF]/15 pb-1.5">
                    <span className="text-[#A5B4C7] uppercase tracking-wider">AMOUNT DUE:</span>
                    <span className="text-lg font-bold font-tech text-[#00D9A0] drop-shadow-[0_0_8px_rgba(0,217,160,0.5)]">
                      ₹{price} INR
                    </span>
                  </div>

                  <div>
                    <label className="text-[10px] text-[#A5B4C7] font-mono-code uppercase block mb-1">
                      Your Name / Contact (Optional)
                    </label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="e.g. Rahul / Telegram ID"
                      className="w-full bg-[#080D14] border border-[#00E5FF]/30 focus:border-[#00E5FF] px-3 py-1.5 rounded text-xs text-[#F4F9FF] outline-none font-mono-code"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="bg-[#240a0e] border border-[#f87171] text-[#f87171] p-2 rounded text-[11px] font-mono-code text-center">
                    {errorMsg}
                  </div>
                )}

                {/* UNLOCK KEY — ₹199 BUTTON */}
                <button
                  type="submit"
                  disabled={loading}
                  className="relative w-full bg-gradient-to-r from-[#00E5FF] via-[#42BFFF] to-[#167DFF] hover:brightness-110 active:scale-[0.985] text-[#05070B] py-3 px-4 clip-unlock-btn font-tech font-black text-base sm:text-lg tracking-[0.12em] uppercase transition-all cursor-pointer violet-btn-glow flex items-center justify-center gap-2 border-t border-white/35 disabled:opacity-50"
                >
                  <span className="absolute inset-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none animate-sheen" />
                  <span>🔓 UNLOCK KEY — ₹{price}</span>
                </button>
              </form>

              {/* Already paid retrieve link */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setStep('retrieve')}
                  className="text-[10.5px] text-[#A5B4C7] hover:text-[#00E5FF] font-mono-code underline cursor-pointer transition-colors"
                >
                  Already paid? Retrieve key with Order ID →
                </button>
              </div>

            </div>
          )}

          {/* STEP 2: PAYMENT PENDING & TRANZUPI CHECKOUT */}
          {step === 'payment_pending' && activeOrder && (
            <div className="space-y-4 text-center">
              
              <div className="p-4 bg-[#0A1018] border border-[#00E5FF]/45 rounded space-y-3">
                <div className="w-12 h-12 mx-auto rounded-full bg-[#0A1828] border border-[#00E5FF] flex items-center justify-center text-xl animate-pulse shadow-[0_0_15px_#00E5FF]">
                  💳
                </div>

                <div>
                  <div className="text-xs font-tech font-bold uppercase tracking-wider text-[#F4F9FF]">
                    TranzUPI Checkout Launched
                  </div>
                  <div className="text-[11px] text-[#00E5FF] font-mono-code font-bold mt-0.5">
                    Order ID: {activeOrder.orderId}
                  </div>
                </div>

                <p className="text-[11px] text-[#A5B4C7] leading-relaxed">
                  Complete the ₹{price} payment via UPI. Your 1-device locked access key will generate automatically!
                </p>

                {activeOrder.upiIntentUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = activeOrder.upiIntentUrl!;
                    }}
                    className="w-full bg-gradient-to-r from-[#00E5FF] to-[#167DFF] hover:brightness-110 active:scale-[0.985] text-[#05070B] py-2.5 px-3 rounded font-tech font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(0,229,255,0.35)]"
                  >
                    <span>📱</span>
                    <span>Pay with UPI (GPay / PhonePe / Paytm)</span>
                  </button>
                )}

                {activeOrder.paymentUrl && (
                  <button
                    type="button"
                    onClick={() => window.open(activeOrder.paymentUrl, '_blank')}
                    className="w-full bg-[#0D1A2B] hover:bg-[#12263F] border border-[#00E5FF]/60 text-[#42BFFF] hover:text-[#F4F9FF] py-2 px-3 rounded font-tech font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>↗ Open Payment Gateway</span>
                  </button>
                )}

                {activeOrder.upiIntentUrl && (
                  <div className="flex flex-col items-center justify-center pt-1">
                    <div className="p-1.5 bg-white rounded shadow-md inline-block">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(activeOrder.upiIntentUrl)}`}
                        alt="Scan UPI QR"
                        className="w-24 h-24"
                        loading="lazy"
                      />
                    </div>
                    <span className="text-[9.5px] text-[#A5B4C7] font-mono-code mt-1 font-semibold">
                      Scan QR code with any UPI app
                    </span>
                  </div>
                )}

                <div className="pt-2 border-t border-[#00E5FF]/15 flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#00D9A0] animate-ping" />
                  <span className="text-[10.5px] font-mono-code text-[#00D9A0] font-bold">
                    Awaiting server verification...
                  </span>
                </div>
              </div>

              {errorMsg && (
                <div className="bg-[#240a0e] border border-[#f87171] text-[#f87171] p-2 rounded text-[11px] font-mono-code">
                  {errorMsg}
                </div>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleVerifyNow}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#00E5FF] to-[#167DFF] hover:brightness-110 text-[#05070B] py-2.5 px-4 rounded font-tech font-black text-xs uppercase tracking-wider cursor-pointer shadow-md transition-all"
                >
                  {loading ? 'Checking Gateway...' : '🔄 Verify Payment Status Now'}
                </button>

                <button
                  type="button"
                  onClick={() => setStep('checkout')}
                  className="text-[10.5px] text-[#A5B4C7] hover:text-[#F4F9FF] font-mono-code block mx-auto underline cursor-pointer"
                >
                  ← Change details / cancel
                </button>
              </div>

            </div>
          )}

          {/* STEP 3: CINEMATIC REVEAL ANIMATION */}
          {step === 'revealing' && (
            <div className="py-6 text-center space-y-4">
              
              {/* Glowing Cyan Circle */}
              <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-[#00E5FF]/30 animate-pulse-expand" />
                <div className="w-16 h-16 rounded-full bg-[#0A1828] border-2 border-[#00E5FF] flex items-center justify-center text-2xl shadow-[0_0_25px_#00E5FF]">
                  {revealStage === 1 ? '✓' : revealStage === 2 ? '🔓' : '✨'}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-black font-tech uppercase tracking-widest text-[#00D9A0] drop-shadow-[0_0_10px_#00D9A0]">
                  {revealStage === 1 ? 'PAYMENT VERIFIED' : revealStage === 2 ? 'UNLOCKING LICENSE...' : 'KEY UNLOCKED'}
                </div>
                <div className="text-[11px] font-mono-code text-[#A5B4C7]">
                  CRYPTOGRAPHIC KEY GENERATED
                </div>
              </div>

              {/* Gradually unblur key preview */}
              <div className="p-3 bg-[#080D14] border border-[#00D9A0] rounded text-center transition-all duration-700">
                <span className={`text-lg font-mono-code font-bold tracking-widest text-[#F4F9FF] transition-all duration-700 ${
                  revealStage >= 3 ? 'blur-0 opacity-100 drop-shadow-[0_0_10px_#00D9A0]' : 'blur-[8px] opacity-40'
                }`}>
                  {revealedKey || 'RVX-XXXX-XXXX-XXXX'}
                </span>
              </div>

            </div>
          )}

          {/* STEP 4: UNLOCKED KEY REVEAL & COPY */}
          {step === 'unlocked' && revealedKey && (
            <div className="space-y-4 text-center animate-fade-in">
              
              <div className="p-4 bg-[#0a1c14] border border-[#00D9A0] rounded space-y-3 shadow-[0_0_30px_rgba(0,217,160,0.25)]">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#00D9A0]/20 text-[#00D9A0] text-[10px] font-mono-code font-bold uppercase tracking-wider">
                  ✓ KEY UNLOCKED
                </div>

                <div>
                  <div className="text-[10px] text-[#A5B4C7] font-mono-code font-bold uppercase tracking-widest mb-1">
                    YOUR PURCHASES ACCESS KEY:
                  </div>

                  <div className="flex items-center justify-between bg-[#080D14] border border-[#00D9A0] px-3 py-2 rounded">
                    <span className="text-base sm:text-lg font-mono-code font-bold text-[#00D9A0] tracking-wider truncate drop-shadow-[0_0_8px_#00D9A0]">
                      {revealedKey}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="bg-[#122e22] hover:bg-[#1c4533] text-[#00D9A0] text-xs font-mono-code font-bold px-2.5 py-1 rounded ml-2 border border-[#00D9A0]/50 transition-colors cursor-pointer shrink-0"
                    >
                      {copiedKey ? 'COPIED!' : 'COPY'}
                    </button>
                  </div>
                </div>

                <p className="text-[10.5px] text-[#A5B4C7] font-sans">
                  This key is unique to your purchase. Save it safely!
                </p>
                <div className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#064e3b]/60 border border-[#00D9A0]/50 text-[#a7f3d0] text-[10px] font-mono-code font-bold">
                  <span>🔒</span>
                  <span>1-DEVICE LOCK: Works strictly on this device once activated</span>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleUseKey}
                  className="w-full bg-gradient-to-r from-[#00D9A0] to-[#059669] hover:brightness-110 text-[#05070B] font-tech font-black text-sm py-3 px-4 rounded tracking-wider uppercase cursor-pointer transition-transform active:scale-[0.98] shadow-lg shadow-[#00D9A0]/30"
                >
                  🚀 ACTIVATE KEY NOW
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs text-[#A5B4C7] hover:text-[#F4F9FF] font-mono-code block mx-auto cursor-pointer"
                >
                  Done
                </button>
              </div>

            </div>
          )}

          {/* RETRIEVE KEY STEP */}
          {step === 'retrieve' && (
            <form onSubmit={handleRetrieveKey} className="space-y-3">
              <div>
                <h3 className="text-xs font-tech font-bold uppercase text-[#F4F9FF] tracking-wider mb-1">
                  Retrieve Purchased Access Key
                </h3>
                <p className="text-[11px] text-[#A5B4C7] font-mono-code">
                  Enter the Order ID from your payment receipt to retrieve your unlocked key.
                </p>
              </div>

              <div>
                <input
                  type="text"
                  value={retrieveOrderId}
                  onChange={(e) => setRetrieveOrderId(e.target.value.toUpperCase())}
                  placeholder="e.g. ORD_172967123_A1B2"
                  className="w-full bg-[#080D14] border border-[#00E5FF]/35 focus:border-[#00E5FF] px-3 py-2 rounded text-xs text-[#F4F9FF] font-mono-code outline-none uppercase"
                />
              </div>

              {errorMsg && (
                <div className="bg-[#240a0e] border border-[#f87171] text-[#f87171] p-2 rounded text-[11px] font-mono-code">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#00E5FF] to-[#167DFF] hover:brightness-110 text-[#05070B] text-xs font-tech font-black uppercase py-2.5 px-4 rounded cursor-pointer transition-all shadow-md"
              >
                {loading ? 'Searching...' : '🔍 Retrieve Key'}
              </button>

              <button
                type="button"
                onClick={() => setStep('checkout')}
                className="text-[10.5px] text-[#A5B4C7] hover:text-[#F4F9FF] font-mono-code block mx-auto underline cursor-pointer"
              >
                ← Back to purchase page
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};
