/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SiteSettings, Language, VerificationResult } from './types';
import { AnnouncementCard } from './components/AnnouncementCard';
import { CenterLogo } from './components/CenterLogo';
import { AccessKeyForm } from './components/AccessKeyForm';
import { LanguageSelector } from './components/LanguageSelector';
import { AuthorizedDashboard } from './components/AuthorizedDashboard';
import { AdminPanel } from './components/AdminPanel';
import { GetKeyModal } from './components/GetKeyModal';
import { IntroVideoScreen } from './components/IntroVideoScreen';
import { db, testConnection } from './firebase';
import { doc, getDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { getOrCreateDeviceId } from './deviceId';

const CACHED_SETTINGS_STORAGE_KEY = 'rvx_published_settings_v3';

export default function App() {
  const [lang, setLang] = useState<Language>('EN');
  const [unlockedKeyData, setUnlockedKeyData] = useState<VerificationResult['data'] | null>(() => {
    try {
      const stored =
        localStorage.getItem('rvx_activated_key') ||
        localStorage.getItem('sltx_activated_key');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!parsed.expiresAt || new Date(parsed.expiresAt).getTime() > Date.now()) {
          return parsed;
        } else {
          localStorage.removeItem('rvx_activated_key');
          localStorage.removeItem('sltx_activated_key');
        }
      }
    } catch {}
    return null;
  });

  // If user is unlocked, open directly on the unlocked dashboard; otherwise always start from Gameplay screen
  const [hasPassedIntro, setHasPassedIntro] = useState<boolean>(() => {
    try {
      const stored =
        localStorage.getItem('rvx_activated_key') ||
        localStorage.getItem('sltx_activated_key');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!parsed.expiresAt || new Date(parsed.expiresAt).getTime() > Date.now()) {
          return true;
        }
      }
    } catch {}
    return false;
  });
  const [manualGameplayView, setManualGameplayView] = useState<boolean>(false);

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminPreAuthorized, setAdminPreAuthorized] = useState(false);
  const [showGetKeyModal, setShowGetKeyModal] = useState(false);
  const [purchasedKey, setPurchasedKey] = useState<string>('');
  const [logoClickCount, setLogoClickCount] = useState(0);

  // Track highest confirmed version & timestamp to strictly block stale overwrites
  const latestVersionRef = useRef<number>(0);
  const latestUpdatedAtRef = useRef<number>(0);

  // Initialize from last verified published cache if available; otherwise wait for authoritative fetch
  const [settings, setSettings] = useState<SiteSettings | null>(() => {
    try {
      const cached = localStorage.getItem(CACHED_SETTINGS_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as SiteSettings;
        if (parsed && parsed.announcementTitle) {
          latestVersionRef.current = Number(parsed.version) || 1;
          latestUpdatedAtRef.current = parsed.updatedAt ? new Date(parsed.updatedAt).getTime() : 0;
          return parsed;
        }
      }
    } catch {}
    return null;
  });

  const [initialLoading, setInitialLoading] = useState<boolean>(() => settings === null);

  // Version-guarded settings applier: never allows an older response to overwrite a newer confirmed version
  const applyAuthoritativeSettings = useCallback(
    (incoming: Partial<SiteSettings> | null | undefined, forceAdminOverride = false) => {
      if (!incoming || typeof incoming !== 'object') return;

      const incVersion = Number(incoming.version) || 1;
      const incTime = incoming.updatedAt ? new Date(incoming.updatedAt).getTime() : 0;

      if (!forceAdminOverride) {
        // Reject stale version
        if (latestVersionRef.current > 0 && incVersion < latestVersionRef.current) {
          return;
        }
        // If same version, reject older timestamp
        if (
          incVersion === latestVersionRef.current &&
          latestUpdatedAtRef.current > 0 &&
          incTime > 0 &&
          incTime < latestUpdatedAtRef.current
        ) {
          return;
        }
      }

      latestVersionRef.current = Math.max(latestVersionRef.current, incVersion);
      if (incTime > 0) {
        latestUpdatedAtRef.current = Math.max(latestUpdatedAtRef.current, incTime);
      }

      setSettings(prev => {
        const resolvedPanelName = (
          incoming.panelName ??
          incoming.websiteTitle ??
          prev?.panelName ??
          prev?.websiteTitle ??
          'REVOX PANEL'
        ).trim();
        const resolvedWebsiteTitle = (
          incoming.websiteTitle ??
          incoming.panelName ??
          prev?.websiteTitle ??
          prev?.panelName ??
          'REVOX PANEL'
        ).trim();

        const merged: SiteSettings = {
          logoUrl: incoming.logoUrl ?? prev?.logoUrl ?? '/assets/revox-logo.png',
          logoStoragePath: incoming.logoStoragePath ?? prev?.logoStoragePath ?? '',
          logoSize: typeof incoming.logoSize === 'number' ? incoming.logoSize : (prev?.logoSize ?? 155),
          logoPositionY: typeof incoming.logoPositionY === 'number' ? incoming.logoPositionY : (prev?.logoPositionY ?? 0),
          websiteTitle: resolvedWebsiteTitle,
          panelName: resolvedPanelName,
          announcementTitle: incoming.announcementTitle ?? prev?.announcementTitle ?? "WE'RE MOVING",
          announcementFrom: (incoming.announcementFrom && incoming.announcementFrom !== 'SILENTX') ? incoming.announcementFrom : ((prev?.announcementFrom && prev.announcementFrom !== 'SILENTX') ? prev.announcementFrom : 'ANTIBAN'),
          announcementTo: incoming.announcementTo ?? prev?.announcementTo ?? resolvedPanelName,
          announcementText: incoming.announcementText ?? prev?.announcementText ?? '',
          announcementBody: incoming.announcementBody ?? prev?.announcementBody ?? '',
          announcementLines: Array.isArray(incoming.announcementLines)
            ? incoming.announcementLines
            : (prev?.announcementLines ?? [
                "Existing access keys remain 100% valid.",
                "REVOX PANEL delivers enhanced bypass with ultra-low latency.",
                "Your active remaining time transfers automatically on activation.",
                "Connect on WhatsApp for 24/7 key verification & priority support."
              ]),
          introFeaturePoints: Array.isArray(incoming.introFeaturePoints)
            ? incoming.introFeaturePoints
            : Array.isArray(incoming.buttonSettings?.introFeaturePoints)
            ? incoming.buttonSettings!.introFeaturePoints
            : (prev?.introFeaturePoints ?? [
                "100% Anti-Ban Protection & High-Security Bypass",
                "Smooth Aimbot, ESP & Ultra-Low Latency Gameplay",
                "Instant Key Activation with 1-Device Security Lock",
                "Works on All Latest Updates with 24/7 VIP Support"
              ]),
          whatsappNumber: incoming.whatsappNumber ?? prev?.whatsappNumber ?? '',
          whatsappUrl: incoming.whatsappUrl ?? prev?.whatsappUrl ?? 'https://wa.me/1234567890',
          themeColor: incoming.themeColor ?? prev?.themeColor ?? '#A020F0',
          buttonSettings: incoming.buttonSettings ?? prev?.buttonSettings,
          downloadHackUrl: incoming.downloadHackUrl ?? prev?.downloadHackUrl ?? 'https://t.me/silentx_phantom_official',
          setupVideoUrl: incoming.setupVideoUrl ?? prev?.setupVideoUrl ?? 'https://www.youtube.com/',
          introVideoUrl: incoming.introVideoUrl ?? incoming.buttonSettings?.introVideoUrl ?? prev?.introVideoUrl ?? '',
          introVideoEnabled:
            incoming.introVideoEnabled !== undefined
              ? Boolean(incoming.introVideoEnabled)
              : incoming.buttonSettings?.introVideoEnabled !== undefined
              ? Boolean(incoming.buttonSettings.introVideoEnabled)
              : (prev?.introVideoEnabled ?? true),
          introVideoTitle:
            incoming.introVideoTitle ??
            incoming.buttonSettings?.introVideoTitle ??
            prev?.introVideoTitle ??
            'WITH PANEL GAMEPLAY',
          introVideoButtonText:
            incoming.introVideoButtonText ??
            incoming.buttonSettings?.introVideoButtonText ??
            prev?.introVideoButtonText ??
            'CONTINUE',
          keySalesEnabled: incoming.keySalesEnabled ?? prev?.keySalesEnabled ?? true,
          keyPriceINR: typeof incoming.keyPriceINR === 'number' ? incoming.keyPriceINR : (prev?.keyPriceINR ?? 199),
          keySaleDurationDays: typeof incoming.keySaleDurationDays === 'number' ? incoming.keySaleDurationDays : (prev?.keySaleDurationDays ?? 30),
          updatedAt: incoming.updatedAt ?? prev?.updatedAt ?? new Date().toISOString(),
          updatedBy: incoming.updatedBy ?? prev?.updatedBy ?? 'admin',
          version: incVersion
        };

        try {
          localStorage.setItem(CACHED_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
        } catch {}

        if (typeof document !== 'undefined') {
          document.title = merged.websiteTitle || merged.panelName || 'REVOX PANEL';
        }

        return merged;
      });

      setInitialLoading(false);
    },
    []
  );

  // 1. Canonical Firestore listener on `websiteSettings/main` (single listener per active session)
  useEffect(() => {
    testConnection();

    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    if (
      params.get('admin') === 'true' ||
      params.get('admin') === '1' ||
      params.has('admin') ||
      path === '/admin' ||
      path === '/admin/' ||
      hash === '#admin'
    ) {
      setHasPassedIntro(true);
      setAdminOpen(true);
    }

    const unsubMain = onSnapshot(
      doc(db, 'websiteSettings', 'main'),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as Partial<SiteSettings>;
          applyAuthoritativeSettings(data);
        }
      },
      (error) => {
        console.warn('Firestore websiteSettings/main listener fallback active:', error.message);
      }
    );

    return () => {
      unsubMain();
    };
  }, [applyAuthoritativeSettings]);

  // 2. Versioned Public Settings Endpoint & Real-Time SSE Broadcast Stream
  useEffect(() => {
    let active = true;

    fetch('/api/public/settings', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (active && data.success && data.settings) {
          applyAuthoritativeSettings(data.settings);
        }
      })
      .catch(err => console.warn('Public settings fetch notice:', err))
      .finally(() => {
        if (active) setInitialLoading(false);
      });

    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('settings-update', (e: MessageEvent) => {
      try {
        const updated = JSON.parse(e.data);
        applyAuthoritativeSettings(updated);
      } catch (err) {
        console.error('SSE settings-update parse error:', err);
      }
    });

    eventSource.addEventListener('initial', (e: MessageEvent) => {
      try {
        const initial = JSON.parse(e.data);
        applyAuthoritativeSettings(initial);
      } catch (err) {
        console.error('SSE initial parse error:', err);
      }
    });

    eventSource.addEventListener('key-revoked', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        setUnlockedKeyData(prev => {
          if (prev && payload.key && prev.key.toUpperCase() === String(payload.key).toUpperCase()) {
            try {
              localStorage.removeItem('rvx_activated_key');
              localStorage.removeItem('sltx_activated_key');
            } catch {}
            return null;
          }
          return prev;
        });
      } catch {}
    });

    eventSource.addEventListener('key-session-reset', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        setUnlockedKeyData(prev => {
          if (prev && payload.key && prev.key.toUpperCase() === String(payload.key).toUpperCase()) {
            try {
              localStorage.removeItem('rvx_activated_key');
              localStorage.removeItem('sltx_activated_key');
              localStorage.removeItem(`rvx_session_token_${prev.key.toUpperCase()}`);
              localStorage.removeItem(`sltx_session_token_${prev.key.toUpperCase()}`);
            } catch {}
            return null;
          }
          return prev;
        });
      } catch {}
    });

    eventSource.addEventListener('key-updated', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        setUnlockedKeyData(prev => {
          if (prev && payload.key && prev.key.toUpperCase() === String(payload.key).toUpperCase()) {
            if (payload.status === 'revoked' || payload.status === 'expired') {
              try {
                localStorage.removeItem('rvx_activated_key');
                localStorage.removeItem('sltx_activated_key');
              } catch {}
              return null;
            }
            const next = {
              ...prev,
              status: payload.status || prev.status,
              expiresAt: payload.expiresAt !== undefined ? payload.expiresAt : prev.expiresAt
            };
            try {
              localStorage.setItem('rvx_activated_key', JSON.stringify(next));
              localStorage.setItem('sltx_activated_key', JSON.stringify(next));
            } catch {}
            return next;
          }
          return prev;
        });
      } catch {}
    });

    return () => {
      active = false;
      eventSource.close();
    };
  }, [applyAuthoritativeSettings]);

  // 3. Server-Side + Direct Firestore Active Session Validation (ensures deactivated/deleted/reset keys are immediately revoked)
  useEffect(() => {
    if (!unlockedKeyData?.key) return;
    let cancelled = false;

    const validateFirestoreSessionFallback = async (cleanKey: string) => {
      try {
        const deviceId = getOrCreateDeviceId();
        let found: any = null;

        // 1. O(1) direct document lookup by key string
        try {
          const directSnap = await getDoc(doc(db, 'accessKeys', cleanKey));
          if (directSnap.exists()) {
            found = { ...directSnap.data(), id: directSnap.id };
          }
        } catch {}

        // 2. Fallback query for older keys
        let snapEmpty = false;
        if (!found) {
          const q = query(collection(db, 'accessKeys'), where('status', 'in', ['active', 'revoked', 'expired']));
          const snap = await getDocs(q);
          if (cancelled) return;
          snapEmpty = snap.empty;
          snap.forEach((docSnap) => {
            const d = docSnap.data();
            const kVal = String(d.key || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
            if (kVal === cleanKey) {
              found = { ...d, id: d.id || docSnap.id };
            }
          });
        }

        if (cancelled) return;

        if (!found) {
          if (!snapEmpty) {
            localStorage.removeItem('rvx_activated_key');
            localStorage.removeItem('sltx_activated_key');
            setUnlockedKeyData(null);
            setHasPassedIntro(false);
          }
          return;
        }

        const isExpired = found.expiresAt ? new Date(found.expiresAt).getTime() <= Date.now() : false;
        const isDeviceMismatch = found.boundDeviceId && deviceId && found.boundDeviceId !== deviceId;
        if (found.status === 'revoked' || found.status === 'expired' || isExpired || isDeviceMismatch) {
          localStorage.removeItem('rvx_activated_key');
          localStorage.removeItem('sltx_activated_key');
          setUnlockedKeyData(null);
          setHasPassedIntro(false);
          return;
        }

        setUnlockedKeyData(prev => {
          if (!prev) return null;
          if (prev.expiresAt !== found.expiresAt || prev.status !== found.status) {
            const updated = { ...prev, status: found.status, expiresAt: found.expiresAt };
            try {
              localStorage.setItem('rvx_activated_key', JSON.stringify(updated));
              localStorage.setItem('sltx_activated_key', JSON.stringify(updated));
            } catch {}
            return updated;
          }
          return prev;
        });
      } catch (err) {
        console.warn('Firestore session validate fallback error:', err);
      }
    };

    const validateActiveSession = async () => {
      const cleanKey = unlockedKeyData.key.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
      try {
        const deviceId = getOrCreateDeviceId();
        const sessionToken =
          unlockedKeyData.sessionToken ||
          localStorage.getItem(`rvx_session_token_${cleanKey}`) ||
          localStorage.getItem(`sltx_session_token_${cleanKey}`) ||
          '';
        const res = await fetch('/api/session/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: cleanKey,
            deviceId,
            sessionToken
          })
        });
        if (cancelled) return;

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          await validateFirestoreSessionFallback(cleanKey);
          return;
        }

        if (res.status === 404) {
          await validateFirestoreSessionFallback(cleanKey);
          return;
        }

        if (res.status === 403 || res.status === 400) {
          const errData = await res.json().catch(() => null);
          // Only invalidate session if key was explicitly expired, revoked, deleted, closed, or locked to another device
          if (
            errData &&
            (errData.reason === 'expired' ||
              errData.reason === 'revoked' ||
              errData.reason === 'deleted' ||
              errData.reason === 'logged_out' ||
              errData.reason === 'device_locked')
          ) {
            localStorage.removeItem('rvx_activated_key');
            localStorage.removeItem('sltx_activated_key');
            setUnlockedKeyData(null);
            setHasPassedIntro(false);
            return;
          }
        }

        if (res.ok) {
          const data = await res.json();
          if (data.valid && data.data) {
            if (data.data.sessionToken) {
              try {
                localStorage.setItem(`rvx_session_token_${cleanKey}`, data.data.sessionToken);
                localStorage.setItem(`sltx_session_token_${cleanKey}`, data.data.sessionToken);
              } catch {}
            }
            setUnlockedKeyData(prev => {
              if (!prev) return null;
              if (
                prev.expiresAt !== data.data.expiresAt ||
                prev.status !== data.data.status ||
                !prev.sessionToken
              ) {
                const updated = { ...prev, ...data.data };
                try {
                  localStorage.setItem('rvx_activated_key', JSON.stringify(updated));
                  localStorage.setItem('sltx_activated_key', JSON.stringify(updated));
                } catch {}
                return updated;
              }
              return prev;
            });
          }
        }
      } catch (err) {
        // Network drops or serverless deployment fallback to Firestore
        await validateFirestoreSessionFallback(cleanKey);
      }
    };

    validateActiveSession();
    const timer = setInterval(validateActiveSession, 12000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [unlockedKeyData?.key]);

  // Keyboard shortcut to open admin: Ctrl + Alt + A
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.key === 'a' || e.key === 'A')) {
        setAdminOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Secret triple-click on center logo to open admin panel (requires password)
  const handleLogoSecretClick = () => {
    setLogoClickCount(prev => {
      const next = prev + 1;
      if (next >= 3) {
        setAdminPreAuthorized(false);
        setAdminOpen(true);
        return 0;
      }
      setTimeout(() => setLogoClickCount(0), 1200);
      return next;
    });
  };

  // Fallback object if offline on very first boot after timeout
  const activeSettings: SiteSettings = settings || {
    logoUrl: '/assets/revox-logo.png',
    logoSize: 290,
    logoPositionY: 0,
    websiteTitle: 'REVOX PANEL',
    panelName: 'REVOX PANEL',
    announcementTitle: "WE'RE MOVING",
    announcementFrom: 'ANTIBAN',
    announcementTo: 'REVOX PANEL',
    announcementBody: '',
    announcementLines: [
      "Existing access keys remain 100% valid.",
      "REVOX PANEL delivers enhanced bypass with ultra-low latency.",
      "Your active remaining time transfers automatically on activation.",
      "Connect on WhatsApp for 24/7 key verification & priority support."
    ],
    introFeaturePoints: [
      "100% Anti-Ban Protection & High-Security Bypass",
      "Smooth Aimbot, ESP & Ultra-Low Latency Gameplay",
      "Instant Key Activation with 1-Device Security Lock",
      "Works on All Latest Updates with 24/7 VIP Support"
    ],
    whatsappUrl: 'https://wa.me/1234567890',
    downloadHackUrl: 'https://t.me/silentx_phantom_official',
    setupVideoUrl: 'https://www.youtube.com/',
    introVideoUrl: '',
    introVideoEnabled: true,
    introVideoTitle: 'WITH PANEL GAMEPLAY',
    introVideoButtonText: 'CONTINUE',
    version: 1
  };

  // Browser Back button handler:
  // - If user has NOT unlocked a key and presses Back on Key Entry screen, return to Gameplay screen!
  // - If user HAS unlocked a key and opened manual Gameplay view, pressing Back returns to Unlocked Dashboard!
  useEffect(() => {
    const handlePopState = () => {
      if (unlockedKeyData) {
        setManualGameplayView(false);
        setHasPassedIntro(true);
      } else {
        setHasPassedIntro(false);
        setManualGameplayView(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [unlockedKeyData]);

  const showIntroVideoGate =
    manualGameplayView ||
    (!unlockedKeyData &&
      !hasPassedIntro &&
      activeSettings.introVideoEnabled !== false);

  return (
    <div className="relative h-[100dvh] max-h-[100dvh] bg-[#050505] text-[#e4e4e7] flex flex-col justify-between overflow-hidden select-none">
      {/* Background scanline pattern & radial gradient vignette */}
      <div className="fixed inset-0 scanlines-overlay z-0 pointer-events-none" />
      <div className="fixed inset-0 vignette-radial z-0 pointer-events-none" />

      {/* Top Header Bar: Language Selector on Left + Gameplay Button on Right */}
      <header className="relative z-10 w-full max-w-[390px] mx-auto px-4 pt-3 pb-0.5 flex items-center justify-between shrink-0">
        {/* Left: Language Button (placed where Admin button used to be) */}
        <LanguageSelector currentLang={lang} onLanguageChange={setLang} />

        {/* Right: Gameplay Button (shown ONLY on the Access Key login page) */}
        {!showIntroVideoGate && !unlockedKeyData && (
          <button
            type="button"
            onClick={() => {
              try {
                window.history.pushState({ rvxView: 'gameplay' }, '');
              } catch {}
              setHasPassedIntro(false);
              setManualGameplayView(true);
            }}
            title="Watch Panel Gameplay Video"
            className="bg-[#120d1d] hover:bg-[#1e1430] active:scale-95 border border-[#A020F0]/60 text-[#e9d5ff] hover:text-white text-xs font-bold tracking-wider px-3 py-1.5 rounded-[4px] flex items-center gap-1.5 cursor-pointer transition-all shadow-[0_0_12px_rgba(160,32,240,0.25)] font-tech uppercase"
          >
            <span>🎬</span>
            <span>GAMEPLAY</span>
          </button>
        )}
      </header>

      {/* Main Viewport Container */}
      <main
        className={`relative z-10 w-full max-w-[390px] mx-auto px-4 py-1 flex-1 flex flex-col justify-between min-h-0 ${
          showIntroVideoGate ? 'overflow-y-auto' : 'overflow-hidden'
        }`}
      >
        {initialLoading && !settings ? (
          /* Premium Dark Purple Loading Skeleton (prevents old hardcoded settings from flashing) */
          <div className="flex flex-col justify-between h-full py-2 animate-pulse">
            <div className="h-44 w-full bg-[#0e0c14] border border-[#3b1c63]/60 rounded-[4px] p-4 flex flex-col justify-between">
              <div className="h-4 w-1/3 bg-[#27173d] rounded" />
              <div className="h-6 w-2/3 bg-[#321b4f] rounded" />
              <div className="space-y-2">
                <div className="h-3 w-full bg-[#1e1330] rounded" />
                <div className="h-3 w-5/6 bg-[#1e1330] rounded" />
                <div className="h-3 w-4/6 bg-[#1e1330] rounded" />
              </div>
              <div className="h-8 w-full bg-[#27173d] rounded" />
            </div>

            <div className="flex items-center justify-center my-4">
              <div className="w-28 h-28 rounded-full bg-[#1a1029] border border-[#4c1d95]/40" />
            </div>

            <div className="space-y-2.5">
              <div className="h-11 w-full bg-[#120e1a] border border-[#3b1c63]/50 rounded" />
              <div className="h-10 w-full bg-[#24113b] rounded" />
              <div className="h-12 w-full bg-[#3b1564] rounded" />
            </div>
          </div>
        ) : showIntroVideoGate ? (
          <div key="page-gameplay" className="flex-1 flex flex-col animate-page-fade">
            <IntroVideoScreen
              settings={activeSettings}
              lang={lang}
              onContinue={() => {
                if (!unlockedKeyData) {
                  try {
                    window.history.pushState({ rvxView: 'key-entry' }, '');
                  } catch {}
                }
                setHasPassedIntro(true);
                setManualGameplayView(false);
              }}
            />
          </div>
        ) : unlockedKeyData ? (
          <div key="page-dashboard" className="flex-1 flex flex-col justify-start pt-5 overflow-y-auto animate-page-fade">
            <AuthorizedDashboard
              keyData={unlockedKeyData}
              lang={lang}
              settings={activeSettings}
              onDisconnect={() => {
                const keyToLock = unlockedKeyData?.key;
                try {
                  const deviceId = getOrCreateDeviceId();
                  if (keyToLock) {
                    fetch('/api/session/logout', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key: keyToLock, deviceId })
                    }).catch(() => {});
                    localStorage.removeItem(`rvx_session_token_${keyToLock.toUpperCase()}`);
                    localStorage.removeItem(`sltx_session_token_${keyToLock.toUpperCase()}`);
                  }
                  localStorage.removeItem('rvx_activated_key');
                  localStorage.removeItem('sltx_activated_key');
                  localStorage.removeItem('rvx_has_passed_intro');
                } catch {}
                setUnlockedKeyData(null);
              }}
            />
          </div>
        ) : (
          <div key="page-home" className="flex flex-col justify-between h-full py-1 animate-page-fade">
            {/* Announcement Card */}
            <AnnouncementCard settings={activeSettings} lang={lang} />

            {/* Dynamic Center Logo (Secret 3 taps to open admin panel) */}
            <div onClick={handleLogoSecretClick} className="cursor-default">
              <CenterLogo settings={activeSettings} />
            </div>

            {/* Access Key Section */}
            <AccessKeyForm
              lang={lang}
              onOpenAdmin={() => {
                setAdminPreAuthorized(true);
                setAdminOpen(true);
              }}
              onVerified={(data) => {
                try {
                  localStorage.setItem('rvx_activated_key', JSON.stringify(data));
                  localStorage.setItem('sltx_activated_key', JSON.stringify(data));
                } catch {}
                setHasPassedIntro(true);
                setManualGameplayView(false);
                setUnlockedKeyData(data);
              }}
            />
          </div>
        )}
      </main>

      {/* Admin Panel Modal */}
      {adminOpen && (
        <AdminPanel
          currentSettings={activeSettings}
          initialAuthorized={adminPreAuthorized}
          onUpdateSettings={(updated) => applyAuthoritativeSettings(updated, true)}
          onClose={() => {
            setAdminOpen(false);
            setAdminPreAuthorized(false);
          }}
        />
      )}
    </div>
  );
}
