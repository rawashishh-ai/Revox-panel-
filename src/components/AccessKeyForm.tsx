import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { Language, VerificationResult } from '../types';
import { translations } from '../translations';
import { VerificationOverlay, VerificationState } from './VerificationOverlay';
import { getOrCreateDeviceId } from '../deviceId';

async function verifyKeyDirectlyWithFirestore(
  cleanKey: string,
  deviceId: string
): Promise<{
  valid: boolean;
  reason?: string;
  message?: string;
  data?: NonNullable<VerificationResult['data']>;
}> {
  if (!deviceId) {
    return { valid: false, reason: 'device_locked', message: 'Device verification required' };
  }

  let targetDocId: string | null = null;

  // 1. O(1) Direct lookup by key string (supports lakhs/millions of keys instantly)
  try {
    const directSnap = await getDoc(doc(db, 'accessKeys', cleanKey));
    if (directSnap.exists()) {
      targetDocId = directSnap.id;
    }
  } catch {}

  // 2. Fallback for older keys whose Firestore doc ID was key_...
  if (!targetDocId) {
    const q = query(
      collection(db, 'accessKeys'),
      where('status', 'in', ['active', 'revoked', 'expired'])
    );
    const snap = await getDocs(q);
    snap.forEach(docSnap => {
      if (docSnap.exists()) {
        const d = docSnap.data();
        const kVal = String(d.key || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
        if (kVal === cleanKey) {
          targetDocId = docSnap.id;
        }
      }
    });
  }

  if (!targetDocId) {
    return { valid: false, reason: 'not_found', message: 'Invalid Access Key' };
  }

  const docRef = doc(db, 'accessKeys', targetDocId);

  // 3. Atomic Firestore Transaction to guarantee 1 Key NEVER unlocks 2 devices simultaneously
  const txResult = await runTransaction(db, async (transaction) => {
    const docSnap = await transaction.get(docRef);
    if (!docSnap.exists()) {
      return { valid: false, reason: 'not_found', message: 'Invalid Access Key' };
    }

    const keyDoc = docSnap.data() as Record<string, any>;

    if (keyDoc.status === 'revoked') {
      return { valid: false, reason: 'revoked', message: 'Access Key has been revoked' };
    }

    const now = Date.now();
    if (keyDoc.expiresAt && new Date(keyDoc.expiresAt).getTime() <= now) {
      transaction.set(
        docRef,
        {
          key: String(keyDoc.key || cleanKey),
          status: 'expired',
          durationDays: Number(keyDoc.durationDays) || 30,
          createdAt: String(keyDoc.createdAt || new Date(now).toISOString())
        },
        { merge: true }
      );
      return { valid: false, reason: 'expired', message: 'Access Key has expired' };
    }

    if (keyDoc.activeSessionToken && String(keyDoc.activeSessionToken).startsWith('LOCKED_LOGGED_OUT_')) {
      return { valid: false, reason: 'logged_out', message: 'Access Key already used' };
    }

    const nowIso = new Date(now).toISOString();
    let activatedAt: string | null = keyDoc.activatedAt || null;
    let expiresAt: string | null = keyDoc.expiresAt || null;
    let boundDeviceId: string | null = keyDoc.boundDeviceId || null;
    let activeSessionToken: string | null = keyDoc.activeSessionToken || null;

    // Strict 1-Key = 1-Device check inside atomic transaction
    if (boundDeviceId) {
      if (boundDeviceId !== deviceId) {
        return { valid: false, reason: 'device_locked', message: 'Access Key already used on another device' };
      }
      if (!activeSessionToken) {
        activeSessionToken = `sess_${now}_${Math.random().toString(36).slice(2, 12)}`;
      }
    } else {
      if (!activatedAt) {
        activatedAt = nowIso;
      }
      boundDeviceId = deviceId;
      activeSessionToken = `sess_${now}_${Math.random().toString(36).slice(2, 12)}`;

      const durationDaysNum = Number(keyDoc.durationDays) || 0;
      const computedDurationMs = keyDoc.durationMs
        ? Number(keyDoc.durationMs)
        : durationDaysNum > 0
        ? durationDaysNum * 24 * 60 * 60 * 1000
        : 0;

      if (computedDurationMs > 0 && !expiresAt) {
        expiresAt = new Date(now + computedDurationMs).toISOString();
      }
    }

    const updatedFields = {
      id: targetDocId,
      key: String(keyDoc.key || cleanKey),
      customerName: keyDoc.customerName || 'Customer',
      status: 'active',
      durationDays: Number(keyDoc.durationDays) || 30,
      durationUnit: keyDoc.durationUnit || (Number(keyDoc.durationDays) === 0 ? 'lifetime' : 'days'),
      durationValue: keyDoc.durationValue ?? keyDoc.durationDays ?? 30,
      durationMs: keyDoc.durationMs ?? (Number(keyDoc.durationDays || 30) * 24 * 60 * 60 * 1000),
      createdAt: String(keyDoc.createdAt || nowIso),
      activatedAt,
      expiresAt,
      boundDeviceId,
      activeSessionToken,
      lastVerifiedAt: nowIso,
      updatedAt: nowIso,
      notes: keyDoc.notes || ''
    };

    transaction.set(docRef, updatedFields, { merge: true });
    if (targetDocId !== cleanKey) {
      transaction.set(doc(db, 'accessKeys', cleanKey), updatedFields, { merge: true });
    }

    const remainingMs = expiresAt ? Math.max(0, new Date(expiresAt).getTime() - now) : null;

    return {
      valid: true,
      message: 'Access Granted',
      data: {
        key: String(keyDoc.key || cleanKey),
        customerName: keyDoc.customerName || 'Customer',
        durationDays: Number(keyDoc.durationDays) || 30,
        durationUnit: keyDoc.durationUnit || (Number(keyDoc.durationDays) === 0 ? 'lifetime' : 'days'),
        durationValue: keyDoc.durationValue ?? keyDoc.durationDays ?? 30,
        status: 'active' as const,
        activatedAt,
        expiresAt,
        remainingMs,
        boundDeviceId,
        sessionToken: activeSessionToken || undefined,
        notes: keyDoc.notes || ''
      }
    };
  });

  return txResult;
}

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
      let tokenSaved = false;
      try {
        const adminRes = await fetch('/api/admin/verify-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: rawTrimmed.toUpperCase() })
        });
        const ct = adminRes.headers.get('content-type') || '';
        if (adminRes.ok && ct.includes('application/json')) {
          const adminData = await adminRes.json();
          if (adminData.authorized && adminData.adminToken) {
            sessionStorage.setItem('revox_admin_token', adminData.adminToken);
            tokenSaved = true;
          }
        }
      } catch {}
      if (!tokenSaved) {
        sessionStorage.setItem('revox_admin_token', 'local_admin_verified_' + Date.now());
      }
      onOpenAdmin();
      return;
    }

    const cleanKey = rawTrimmed.toUpperCase();

    if (!cleanKey) {
      setErrorMessage(t.invalidKey);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setVerifyState('verifying');

    const deviceId = getOrCreateDeviceId();

    try {
      const storedSessionToken =
        localStorage.getItem(`rvx_session_token_${cleanKey}`) ||
        localStorage.getItem(`sltx_session_token_${cleanKey}`) ||
        '';

      let responseOk = false;
      let responseStatus = 0;
      let resData: any = null;

      try {
        const response = await fetch('/api/verify-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: cleanKey, deviceId, sessionToken: storedSessionToken })
        });
        responseOk = response.ok;
        responseStatus = response.status;
        resData = await response.json();
      } catch {
        resData = null;
      }

      // If API did not find the key or API is unreachable/404 (e.g., on Vercel), verify directly against Firestore
      if (
        !(responseOk && resData && resData.valid && resData.data) &&
        (!resData || responseStatus === 404 || responseStatus >= 500 || resData?.reason === 'not_found')
      ) {
        try {
          const fsResult = await verifyKeyDirectlyWithFirestore(cleanKey, deviceId);
          if (fsResult.valid && fsResult.data) {
            responseOk = true;
            resData = fsResult;
          } else if (fsResult.reason && fsResult.reason !== 'not_found') {
            resData = fsResult;
          }
        } catch (fsErr) {
          console.warn('Firestore direct verify fallback warning:', fsErr);
        }
      }

      // Ensure scanning animation has at least 800ms of visual time for cinematic feel
      await new Promise(r => setTimeout(r, 800));

      if (responseOk && resData && resData.valid && resData.data) {
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
          responseStatus === 404 ||
          !resData
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
      <div className="text-center text-[#A5B4C7]/85 text-[10px] sm:text-[10.5px] font-semibold tracking-[0.22em] uppercase mb-1.5 font-mono-code">
        {t.noAccount}
      </div>

      {/* Label: ACCESS KEY with glowing cyan square indicator */}
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-[#00E5FF] shadow-[0_0_10px_#00E5FF,0_0_4px_#FFFFFF] inline-block" />
          <span className="text-[#F4F9FF]/90 text-[10.5px] sm:text-[11px] font-bold tracking-[0.24em] uppercase font-mono-code drop-shadow-[0_0_8px_rgba(0,229,255,0.35)]">
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
        {/* Input container with 1.2px chamfered specular cyan-white border, cyan focus glow & glossy PASTE button */}
        <div 
          className={`relative p-[1.2px] ${
            errorMessage
              ? 'bg-[#ef4444] shadow-[0_0_16px_rgba(239,68,68,0.35)]'
              : 'bg-gradient-to-r from-[#00E5FF]/70 via-[#F4F9FF]/55 to-[#42BFFF]/70 focus-within:from-[#00E5FF] focus-within:via-[#FFFFFF] focus-within:to-[#00E5FF] shadow-[0_6px_22px_-6px_rgba(0,229,255,0.28)] focus-within:shadow-[0_0_24px_rgba(0,229,255,0.48)]'
          } clip-input-box transition-all duration-200`}
        >
          <div className="relative bg-gradient-to-b from-[#060A10] via-[#080D14] to-[#0A111B] clip-input-box flex items-center justify-between px-3 py-1.5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.85),inset_0_0_16px_rgba(0,229,255,0.08)]">
            <span className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-[#00E5FF]/55 to-transparent pointer-events-none" />
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
              className="w-full bg-transparent text-[#FFFFFF] placeholder-[#4E647E] text-sm sm:text-[15px] font-mono-code font-bold tracking-widest py-1.5 outline-none min-w-0 drop-shadow-[0_0_8px_rgba(0,229,255,0.25)]"
            />

            <button
              type="button"
              onClick={handlePaste}
              disabled={loading}
              title="Paste from clipboard"
              className="relative bg-gradient-to-b from-[#132235] to-[#0A121E] hover:from-[#182C44] hover:to-[#0E1929] active:scale-95 text-[#FFFFFF] text-[10.5px] sm:text-[11px] font-bold tracking-[0.16em] uppercase py-1.5 px-3.5 shrink-0 clip-paste-btn font-tech transition-all cursor-pointer border border-[#00E5FF]/65 hover:border-[#FFFFFF] shadow-[0_0_12px_rgba(0,229,255,0.25),inset_0_1px_1px_rgba(255,255,255,0.35)] hover:shadow-[0_0_18px_rgba(0,229,255,0.48)]"
            >
              {pasteFeedback ? t.pasted : t.paste}
            </button>
          </div>
        </div>

        {/* Full-width High-Gloss Cyan-to-Electric-Blue Primary UNLOCK Button */}
        <button
          type="submit"
          disabled={loading}
          className="relative w-full cyber-primary-btn hover:brightness-110 active:scale-[0.985] text-[#05070B] py-2.5 sm:py-3 px-6 clip-unlock-btn font-tech font-black text-lg sm:text-xl tracking-[0.18em] uppercase transition-all duration-150 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-75 disabled:cursor-not-allowed border-t border-white/80 overflow-hidden group"
        >
          {/* Top-Half Glossy Mirror Reflection */}
          <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent pointer-events-none" />
          {/* Continuous Diagonal Mirror Sheen */}
          <span className="absolute inset-0 w-1/3 bg-gradient-to-r from-transparent via-white/55 to-transparent pointer-events-none animate-sheen" />
          {loading ? (
            <span className="relative z-10 text-base text-[#05070B] font-black">{t.unlocking}</span>
          ) : (
            <>
              <span className="relative z-10 drop-shadow-[0_1px_1px_rgba(255,255,255,0.45)]">{t.unlock}</span>
              <span className="relative z-10 text-lg transition-transform group-hover:translate-x-1 font-black">→</span>
            </>
          )}
        </button>
      </form>

      {/* Bottom informational text */}
      <div className="text-center mt-1.5 space-y-0.5">
        <div className="text-[#A5B4C7]/75 text-[10px] font-mono-code tracking-wide">
          {t.timeStarts}
        </div>
        <div className="text-[#F4F9FF]/85 text-[10.5px] font-sans font-medium">
          {t.noKey}
        </div>
      </div>
    </div>
  );
};

