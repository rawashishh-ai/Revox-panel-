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
import { GetKeyChoiceModal } from './components/GetKeyChoiceModal';
import { BuyKeyPage } from './components/BuyKeyPage';
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
  const [showGetKeyChoiceModal, setShowGetKeyChoiceModal] = useState(false);
  const [isBuyKeyRoute, setIsBuyKeyRoute] = useState<boolean>(() => {
    try {
      const p = window.location.pathname.toLowerCase();
      return p === '/buy-key' || p === '/buy-key/';
    } catch {
      return false;
    }
  });
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
          if (!parsed.introVideoUrl || parsed.introVideoUrl.includes('gameplay_v14_1792905894809')) {
            parsed.introVideoUrl = '/uploads/gameplay_v12_1792903967616.mp4';
          }
          if (!parsed.themeColor || parsed.themeColor === '#A020F0') {
            parsed.themeColor = '#00E5FF';
          }
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
          themeColor: incoming.themeColor && incoming.themeColor !== '#A020F0' ? incoming.themeColor : '#00E5FF',
          buttonSettings: incoming.buttonSettings ?? prev?.buttonSettings,
          downloadHackUrl: incoming.downloadHackUrl ?? prev?.downloadHackUrl ?? 'https://t.me/silentx_phantom_official',
          setupVideoUrl: incoming.setupVideoUrl ?? prev?.setupVideoUrl ?? 'https://www.youtube.com/',
          introVideoUrl: (() => {
            const rawUrl =
              incoming.introVideoUrl ??
              incoming.buttonSettings?.introVideoUrl ??
              prev?.introVideoUrl ??
              '/uploads/gameplay_v12_1792903967616.mp4';
            if (
              !rawUrl ||
              rawUrl.includes('gameplay_v14_1792905894809')
            ) {
              return '/uploads/gameplay_v12_1792903967616.mp4';
            }
            return rawUrl;
          })(),
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
          keyPlans: Array.isArray(incoming.keyPlans) ? incoming.keyPlans : prev?.keyPlans,
          paymentGatewayConfigured:
            incoming.paymentGatewayConfigured !== undefined
              ? Boolean(incoming.paymentGatewayConfigured)
              : prev?.paymentGatewayConfigured,
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

  // 1. Admin URL Detection & Connection Check
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
  }, []);

  // 2. Authoritative Public Settings Endpoint, Firestore Real-Time Sync & SSE Stream
  useEffect(() => {
    let active = true;

    const unsubFirestore = onSnapshot(
      doc(db, 'websiteSettings', 'main'),
      snap => {
        if (active && snap.exists()) {
          applyAuthoritativeSettings(snap.data() as Partial<SiteSettings>);
        }
      },
      () => {}
    );

    fetch('/api/public/settings', { cache: 'no-store' })
      .then(async res => {
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) {
          throw new Error('Non-JSON settings response');
        }
        return res.json();
      })
      .then(data => {
        if (active && data.success && data.settings) {
          applyAuthoritativeSettings(data.settings, true);
        }
      })
      .catch(async () => {
        try {
          const snap = await getDoc(doc(db, 'websiteSettings', 'main'));
          if (active && snap.exists()) {
            applyAuthoritativeSettings(snap.data() as Partial<SiteSettings>);
          }
        } catch {}
      })
      .finally(() => {
        if (active) setInitialLoading(false);
      });

    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('settings-update', (e: MessageEvent) => {
      try {
        const updated = JSON.parse(e.data);
        applyAuthoritativeSettings(updated, true);
      } catch (err) {
        console.error('SSE settings-update parse error:', err);
      }
    });

    eventSource.addEventListener('initial', (e: MessageEvent) => {
      try {
        const initial = JSON.parse(e.data);
        applyAuthoritativeSettings(initial, true);
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
      unsubFirestore();
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
  // - Syncs /buy-key route state
  // - If user has NOT unlocked a key and presses Back on Key Entry screen, return to Gameplay screen!
  // - If user HAS unlocked a key and opened manual Gameplay view, pressing Back returns to Unlocked Dashboard!
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path === '/buy-key' || path === '/buy-key/') {
        setIsBuyKeyRoute(true);
        return;
      }
      setIsBuyKeyRoute(false);

      if (unlockedKeyData) {
        setManualGameplayView(false);
        setHasPassedIntro(true);
      } else if (window.history.state?.rvxView === 'key-entry') {
        setHasPassedIntro(true);
        setManualGameplayView(false);
      } else {
        setHasPassedIntro(false);
        setManualGameplayView(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [unlockedKeyData]);

  const showIntroVideoGate =
    !isBuyKeyRoute &&
    (manualGameplayView ||
      (!unlockedKeyData &&
        !hasPassedIntro &&
        activeSettings.introVideoEnabled !== false));

  if (isBuyKeyRoute) {
    return (
      <>
        <BuyKeyPage
          settings={activeSettings}
          onBack={() => {
            try {
              window.history.pushState({ rvxView: 'key-entry' }, '', '/');
            } catch {}
            setIsBuyKeyRoute(false);
            setHasPassedIntro(true);
            setManualGameplayView(false);
          }}
          onContinueWithKey={(verifiedKey) => {
            setPurchasedKey(verifiedKey);
            try {
              window.history.pushState({ rvxView: 'key-entry' }, '', '/');
            } catch {}
            setIsBuyKeyRoute(false);
            setHasPassedIntro(true);
            setManualGameplayView(false);
          }}
        />
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
      </>
    );
  }

  return (
    <div className="relative h-screen h-[100dvh] max-h-[100dvh] w-full bg-[#070B12] text-[#F4F7FB] flex flex-col justify-between overflow-hidden overscroll-none select-none">
      {/* Smooth, clean dark background depth without scanlines or dark muddy vignette */}
      <div className="fixed inset-0 vignette-radial z-0 pointer-events-none" />

      {/* Top Header Bar: Language Selector on Left + Gameplay Button on Right */}
      <header className="relative z-20 revox-shell pt-2.5 pb-1 flex items-center justify-between gap-2 shrink-0">
        {/* Left: Language Button */}
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
            className="relative overflow-hidden bg-[#101B28] hover:bg-[#152334] active:scale-95 border border-[#1B3345] hover:border-[#00CFE8] text-[#F4F7FB] text-xs font-bold tracking-wider px-3.5 py-1.5 rounded-[4px] flex items-center gap-1.5 cursor-pointer transition-all shadow-[0_3px_11px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(244,247,251,0.1)] hover:shadow-[0_0_13px_rgba(0,207,232,0.22)] font-tech uppercase shrink-0"
          >
            <span className="absolute top-0 left-2 right-2 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8]/48 to-transparent pointer-events-none" />
            <span>🎬</span>
            <span>GAMEPLAY</span>
          </button>
        )}
      </header>

      {/* Main Viewport Container — Strictly non-scrolling on Gameplay & Home pages */}
      <main className="relative z-10 revox-shell pt-0.5 pb-2.5 flex-1 min-h-0 flex flex-col overflow-hidden">
        {initialLoading && !settings ? (
          /* Clean Dark Gaming Loading Skeleton */
          <div className="w-full h-full max-h-[760px] my-auto flex flex-col justify-between py-1 animate-pulse overflow-hidden">
            <div className="h-40 w-full bg-[#101B28] border border-[#1B3345] rounded-[4px] p-4 flex flex-col justify-between shrink-0">
              <div className="h-4 w-1/3 bg-[#152334] rounded" />
              <div className="h-6 w-2/3 bg-[#152334] rounded" />
              <div className="space-y-2">
                <div className="h-3 w-full bg-[#0A111B] rounded" />
                <div className="h-3 w-5/6 bg-[#0A111B] rounded" />
                <div className="h-3 w-4/6 bg-[#0A111B] rounded" />
              </div>
              <div className="h-8 w-full bg-[#152334] rounded" />
            </div>

            <div className="flex-1 min-h-0 flex items-center justify-center my-1">
              <div className="w-24 h-24 rounded-full bg-[#101B28] border border-[#1B3345]" />
            </div>

            <div className="space-y-2 shrink-0">
              <div className="h-10 w-full bg-[#0A111B] border border-[#1B3345] rounded" />
              <div className="h-11 w-full bg-[#168BFF]/30 rounded" />
            </div>
          </div>
        ) : showIntroVideoGate ? (
          <div key="page-gameplay" className="w-full h-full flex-1 min-h-0 flex flex-col overflow-hidden animate-page-fade">
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
          <div key="page-dashboard" className="w-full h-full flex-1 min-h-0 flex flex-col justify-start pt-2 pb-2 overflow-hidden animate-page-fade">
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
          <div
            key="page-home"
            className="w-full h-full max-h-[760px] my-auto flex-1 min-h-0 flex flex-col justify-between gap-1.5 py-0.5 overflow-hidden animate-page-fade"
          >
            {/* 1. Announcement Card (with GET KEY INSTANTLY button inside) */}
            <AnnouncementCard
              settings={activeSettings}
              lang={lang}
              onOpenGetKeyChoice={() => setShowGetKeyChoiceModal(true)}
            />

            {/* 2. Dynamic Center Logo (Flexible height between card & form so page never scrolls) */}
            <div onClick={handleLogoSecretClick} className="cursor-default w-full flex-1 min-h-0 flex items-center justify-center overflow-hidden">
              <CenterLogo settings={activeSettings} />
            </div>

            {/* 3. Access Key Section (Heading, Input, PASTE, UNLOCK, Footer) */}
            <AccessKeyForm
              lang={lang}
              purchasedKey={purchasedKey}
              onOpenGetKey={() => setShowGetKeyChoiceModal(true)}
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

      {/* Dual Get Key Selection Modal (WhatsApp vs Website) */}
      <GetKeyChoiceModal
        isOpen={showGetKeyChoiceModal}
        settings={activeSettings}
        onClose={() => setShowGetKeyChoiceModal(false)}
        onSelectWebsite={() => {
          try {
            window.history.pushState({ rvxView: 'buy-key' }, '', '/buy-key');
          } catch {}
          setIsBuyKeyRoute(true);
        }}
      />

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
