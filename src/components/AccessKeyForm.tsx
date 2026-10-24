import React, { useState, useEffect } from 'react';
import { Language, VerificationResult } from '../types';
import { translations } from '../translations';
import { VerificationOverlay, VerificationState } from './VerificationOverlay';
import { getOrCreateDeviceId } from '../deviceId';

interface AccessKeyFormProps {
  lang: Language;
  purchasedKey?: string;
  onOpenGetKey?: () => void;
  onOpenAdmin?: () => void;
  onVerified: (keyData: NonNullable<VerificationResult['data']>) => void;
}

export const AccessKeyForm: React.FC<AccessKeyFormProps> = ({
  lang,
  purchasedKey,
  onOpenGetKey,
  onOpenAdmin,
  onVerified
}) => {
  const t = translations[lang];

  const [keyInput, setKeyInput] = useState('');

  useEffect(() => {
    if (purchasedKey) {
      setKeyInput(purchasedKey.trim().toUpperCase());
    }
  }, [purchasedKey]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState(false);
  const [shake, setShake] = useState(false);

  // Cinematic Verification Overlay State
  const [verifyState, setVerifyState] = useState<VerificationState>('idle');
  const [pendingKeyData, setPendingKeyData] = useState<VerificationResult['data'] | null>(null);
  const [overlayError, setOverlayError] = useState<string>('INVALID ACCESS KEY');

  const handlePaste = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          const cleaned = text.trim();
          setKeyInput(cleaned.toUpperCase());
          setErrorMessage(null);
          setPasteFeedback(true);
          setTimeout(() => setPasteFeedback(false), 1400);
        }
      } else {
        const prompted = window.prompt('Paste your Access Key:');
        if (prompted) {
          const cleaned = prompted.trim();
          setKeyInput(cleaned.toUpperCase());
          setErrorMessage(null);
        }
      }
    } catch {
      const prompted = window.prompt('Paste your Access Key:');
      if (prompted) {
        const cleaned = prompted.trim();
        setKeyInput(cleaned.toUpperCase());
        setErrorMessage(null);
      }
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const rawTrimmed = keyInput.trim();

    // Secret shortcut: typing admin password in Access Key box opens & unlocks Admin Panel with server token
    if (rawTrimmed.toUpperCase() === 'CRITICALXR-A4AE97-ASHISH12@@' && onOpenAdmin) {
      setKeyInput('');
      setErrorMessage(null);
      try {
        const adminRes = await fetch('/api/admin/verify-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: rawTrimmed.toUpperCase() })
        });
        const adminData = await adminRes.json();
        if (adminData.authorized && adminData.adminToken) {
          sessionStorage.setItem('revox_admin_token', adminData.adminToken);
        }
      } catch {}
      onOpenAdmin();
      return;
    }

    const cleanKey = rawTrimmed.toUpperCase();

    if (!cleanKey) {
      setErrorMessage(t.invalidKey);
      triggerShake();
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setVerifyState('verifying');

    try {
      const deviceId = getOrCreateDeviceId();
      const storedSessionToken =
        localStorage.getItem(`rvx_session_token_${cleanKey}`) ||
        localStorage.getItem(`sltx_session_token_${cleanKey}`) ||
        '';
      const response = await fetch('/api/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: cleanKey, deviceId, sessionToken: storedSessionToken })
      });

      let resData: any = null;
      try {
        resData = await response.json();
      } catch {
        resData = null;
      }

      // Ensure scanning animation has at least 800ms of visual time for cinematic feel
      await new Promise(r => setTimeout(r, 800));

      if (response.ok && resData && resData.valid && resData.data) {
        if (resData.data.sessionToken) {
          try {
            localStorage.setItem(`rvx_session_token_${cleanKey}`, resData.data.sessionToken);
            localStorage.setItem(`sltx_session_token_${cleanKey}`, resData.data.sessionToken);
          } catch {}
        }
        setPendingKeyData(resData.data);
        setVerifyState('success');
      } else {
        // Detailed server reason mapping so users see real problem instead of generic error
        const rawMsg = String(resData?.message || '').toLowerCase();
        const rawReason = String(resData?.reason || '').toLowerCase();

        let msg = 'INVALID ACCESS KEY';
        if (rawMsg.includes('expired') || rawReason === 'expired') {
          msg = 'KEY EXPIRED';
        } else if (
          rawMsg.includes('already used') ||
          rawMsg.includes('locked') ||
          rawMsg.includes('device') ||
          rawReason === 'device_locked' ||
          rawReason === 'locked' ||
          rawReason === 'logged_out'
        ) {
          msg = 'KEY ALREADY USED';
        } else if (
          rawMsg.includes('revoked') ||
          rawMsg.includes('deactivated') ||
          rawReason === 'revoked'
        ) {
          msg = 'KEY DEACTIVATED';
        } else if (
          rawMsg.includes('invalid') ||
          rawMsg.includes('not found') ||
          rawReason === 'not_found' ||
          rawReason === 'invalid' ||
          response.status === 404
        ) {
          msg = 'INVALID KEY';
        } else if (resData?.message) {
          msg = String(resData.message).toUpperCase();
        }

        setOverlayError(msg);
        setErrorMessage(msg);
        setVerifyState('error');
      }
    } catch (networkErr) {
      console.warn('Network verify error:', networkErr);
      await new Promise(r => setTimeout(r, 600));
      setOverlayError('SERVER CONNECTION ERROR');
      setErrorMessage('Server connection error. Check your internet.');
      setVerifyState('error');
    }
  };

  const handleSuccessComplete = () => {
    setVerifyState('idle');
    setLoading(false);
    if (pendingKeyData) {
      onVerified(pendingKeyData);
    }
  };

  const handleErrorComplete = () => {
    setVerifyState('idle');
    setLoading(false);
    triggerShake();
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  return (
    <div className="w-full max-w-[390px] mx-auto select-none shrink-0">
      
      {/* Cinematic Full-screen Verification Overlay */}
      <VerificationOverlay
        state={verifyState}
        errorMessage={overlayError}
        onSuccessComplete={handleSuccessComplete}
        onErrorComplete={handleErrorComplete}
      />

      {/* Top informational text */}
      <div className="text-center text-[#71717a] text-[10px] sm:text-[10.5px] font-semibold tracking-[0.22em] uppercase mb-1.5 font-mono-code">
        {t.noAccount}
      </div>

      {/* Label: ACCESS KEY with glowing purple square indicator */}
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-[#a855f7] shadow-[0_0_8px_#a855f7] inline-block" />
          <span className="text-[#a1a1aa] text-[10.5px] sm:text-[11px] font-bold tracking-[0.24em] uppercase font-mono-code">
            {t.accessKey}
          </span>
        </div>
        {errorMessage && (
          <span className="text-[#ef4444] text-[10px] font-mono-code font-bold tracking-wider uppercase animate-fade-in">
            {errorMessage}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        {/* Input container with 1px chamfered border & PASTE button inside on the right */}
        <div 
          className={`relative p-[1px] ${
            errorMessage ? 'bg-[#ef4444]' : 'bg-[#3b1c63] focus-within:bg-[#a855f7]'
          } clip-input-box transition-colors duration-200 ${shake ? 'animate-bounce' : ''}`}
        >
          <div className="bg-[#0e0e12] clip-input-box flex items-center justify-between px-3 py-1.5">
            <input
              type="text"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value.toUpperCase());
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="RVX-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck="false"
              className="w-full bg-transparent text-white placeholder-[#454552] text-sm sm:text-[15px] font-mono-code font-bold tracking-widest py-1.5 outline-none min-w-0"
            />

            <button
              type="button"
              onClick={handlePaste}
              disabled={loading}
              title="Paste from clipboard"
              className="bg-[#1b1429] hover:bg-[#271c3d] active:bg-[#130e1d] text-[#e4e4eb] text-[10.5px] sm:text-[11px] font-bold tracking-[0.16em] uppercase py-1.5 px-3 shrink-0 clip-paste-btn font-tech transition-colors cursor-pointer border border-[#4c1d95]"
            >
              {pasteFeedback ? t.pasted : t.paste}
            </button>
          </div>
        </div>

        {/* Full-width Electric Violet UNLOCK Button */}
        <button
          type="submit"
          disabled={loading}
          className="relative w-full bg-gradient-to-r from-[#9333ea] via-[#a855f7] to-[#6b21a8] hover:brightness-110 active:scale-[0.985] text-white py-2.5 sm:py-3 px-6 clip-unlock-btn font-tech font-black text-lg sm:text-xl tracking-[0.18em] uppercase transition-all duration-150 cursor-pointer violet-btn-glow flex items-center justify-center gap-2 disabled:opacity-75 disabled:cursor-not-allowed shadow-[0_4px_25px_rgba(168,85,247,0.5)] border-t border-white/25 overflow-hidden group"
        >
          <span className="absolute inset-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none animate-sheen" />
          {loading ? (
            <span className="relative z-10 text-base">{t.unlocking}</span>
          ) : (
            <>
              <span className="relative z-10 drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">{t.unlock}</span>
              <span className="relative z-10 text-lg transition-transform group-hover:translate-x-1">→</span>
            </>
          )}
        </button>
      </form>

      {/* Bottom informational text */}
      <div className="text-center mt-1.5 space-y-0.5">
        <div className="text-[#52525c] text-[10px] font-mono-code tracking-wide">
          {t.timeStarts}
        </div>
        <div className="text-[#686875] text-[10.5px] font-sans font-medium">
          {t.noKey}
        </div>
      </div>
    </div>
  );
};

