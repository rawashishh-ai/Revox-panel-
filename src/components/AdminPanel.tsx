import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SiteSettings, AccessKey, AdminAuditLog } from '../types';
import { auth, googleProvider, db, storage } from '../firebase';
import { signInWithPopup, signOut } from 'firebase/auth';
import { doc, setDoc, getDocs, collection, deleteDoc, updateDoc, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Direct16x9VideoPlayer } from './IntroVideoScreen';
import { generateClientCryptoKey } from '../keyGenerator';

interface AdminPanelProps {
  currentSettings: SiteSettings;
  onUpdateSettings: (newSettings: SiteSettings) => void;
  onClose: () => void;
  initialAuthorized?: boolean;
}

type MainTab = 'create' | 'keys' | 'settings';
type KeyFilterType = 'all' | 'unused' | 'active' | 'expired' | 'deactivated';

function computeKeyDisplayStatus(
  k: AccessKey,
  nowMs: number
): 'UNUSED' | 'ACTIVE' | 'EXPIRED' | 'BLOCKED' {
  if (k.status === 'revoked') return 'BLOCKED';
  if (k.status === 'expired' || (k.expiresAt && new Date(k.expiresAt).getTime() <= nowMs)) {
    return 'EXPIRED';
  }
  if (!k.activatedAt) return 'UNUSED';
  return 'ACTIVE';
}

function formatDurationLabel(k: AccessKey): string {
  const unit = k.durationUnit || (k.durationDays === 0 ? 'lifetime' : 'days');
  const val = k.durationValue ?? k.durationDays;
  if (unit === 'lifetime' || (k.durationDays === 0 && !k.durationMs)) return 'Lifetime';
  if (unit === 'minutes') return `${val} Min${val === 1 ? '' : 's'}`;
  if (unit === 'hours') return `${val} Hour${val === 1 ? '' : 's'}`;
  return `${val} Day${val === 1 ? '' : 's'}`;
}

function formatShortTimeLeft(k: AccessKey, nowMs: number): string {
  const disp = computeKeyDisplayStatus(k, nowMs);
  if (disp === 'BLOCKED') return 'Blocked by Admin';
  if (disp === 'EXPIRED') return 'Expired (00:00)';
  if (!k.activatedAt) return `${formatDurationLabel(k)} (Not Used Yet)`;
  if (!k.expiresAt) return 'Lifetime';

  const diff = Math.max(0, new Date(k.expiresAt).getTime() - nowMs);
  if (diff <= 0) return 'Expired';

  const totalSec = Math.floor(diff / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (d > 0) return `${d}d ${h}h ${m}m left`;
  if (h > 0) return `${h}h ${m}m ${s}s left`;
  return `${m}m ${s}s left`;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  currentSettings,
  onUpdateSettings,
  onClose,
  initialAuthorized = false
}) => {
  const [adminToken, setAdminToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem('revox_admin_token') || '';
    } catch {
      return '';
    }
  });
  const [authorized, setAuthorized] = useState<boolean>(() => {
    try {
      return initialAuthorized || Boolean(sessionStorage.getItem('revox_admin_token'));
    } catch {
      return initialAuthorized;
    }
  });
  const [adminUser, setAdminUser] = useState<string | null>(
    initialAuthorized ? 'Admin' : null
  );
  const [passcode, setPasscode] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [verifyingAuth, setVerifyingAuth] = useState(false);

  // Simple 3-Tab Navigation: Create Key | All Keys | Website Settings
  const [activeTab, setActiveTab] = useState<MainTab>('create');

  // Live clock for countdowns
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Toast Notification
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => (prev?.message === message ? null : prev));
    }, 3000);
  };

  // Keys State
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [loadingKeys, setLoadingKeys] = useState<boolean>(false);

  // Key Generator State
  const [genCustomerName, setGenCustomerName] = useState('');
  const [genDurationValue, setGenDurationValue] = useState<string>('30');
  const [genDurationUnit, setGenDurationUnit] = useState<'minutes' | 'hours' | 'days'>('days');
  const [genCustomCount, setGenCustomCount] = useState<string>('1');
  const [genNotes, setGenNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [generatedBatch, setGeneratedBatch] = useState<AccessKey[]>([]);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Key List Search & Filter
  const [keySearch, setKeySearch] = useState('');
  const [keyFilter, setKeyFilter] = useState<KeyFilterType>('all');
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // Simple Modals for Delete & Renew (+Time)
  const [deleteTargetKey, setDeleteTargetKey] = useState<AccessKey | null>(null);
  const [deletingKey, setDeletingKey] = useState(false);

  const [renewTargetKey, setRenewTargetKey] = useState<AccessKey | null>(null);
  const [renewDurationVal, setRenewDurationVal] = useState<string>('7');
  const [renewDurationUnit, setRenewDurationUnit] = useState<'minutes' | 'hours' | 'days'>('days');
  const [renewingKey, setRenewingKey] = useState(false);

  // Website Settings State (All in one simple page)
  const [panelName, setPanelName] = useState(
    currentSettings.panelName || currentSettings.websiteTitle || 'REVOX PANEL'
  );
  const [logoSize, setLogoSize] = useState(
    currentSettings.logoSize && currentSettings.logoSize >= 240 ? currentSettings.logoSize : 290
  );
  const [logoPositionY, setLogoPositionY] = useState(currentSettings.logoPositionY || 0);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUrlInput, setLogoUrlInput] = useState(
    currentSettings.logoUrl?.startsWith('data:') ? '' : (currentSettings.logoUrl || '')
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [annTitle, setAnnTitle] = useState(currentSettings.announcementTitle || "WE'RE MOVING");
  const [annFrom, setAnnFrom] = useState(
    (currentSettings.announcementFrom && currentSettings.announcementFrom !== 'SILENTX')
      ? currentSettings.announcementFrom
      : 'ANTIBAN'
  );
  const [annLines, setAnnLines] = useState<string[]>(
    currentSettings.announcementLines && currentSettings.announcementLines.length > 0
      ? currentSettings.announcementLines
      : [
          'Existing access keys remain 100% valid.',
          'REVOX PANEL delivers enhanced bypass with ultra-low latency.',
          'Your active remaining time transfers automatically on activation.',
          'Connect on WhatsApp for 24/7 key verification & priority support.'
        ]
  );
  const [whatsappUrl, setWhatsappUrl] = useState(currentSettings.whatsappUrl || '');

  const [downloadHackUrl, setDownloadHackUrl] = useState(
    currentSettings.downloadHackUrl || 'https://t.me/silentx_phantom_official'
  );
  const [setupVideoUrl, setSetupVideoUrl] = useState(
    currentSettings.setupVideoUrl || 'https://www.youtube.com/'
  );

  const [introVideoUrl, setIntroVideoUrl] = useState(
    currentSettings.introVideoUrl || currentSettings.buttonSettings?.introVideoUrl || ''
  );
  const [introVideoEnabled, setIntroVideoEnabled] = useState<boolean>(
    currentSettings.introVideoEnabled !== undefined
      ? Boolean(currentSettings.introVideoEnabled)
      : currentSettings.buttonSettings?.introVideoEnabled !== undefined
      ? Boolean(currentSettings.buttonSettings.introVideoEnabled)
      : true
  );
  const [introFeaturePoints, setIntroFeaturePoints] = useState<string[]>(
    currentSettings.introFeaturePoints && currentSettings.introFeaturePoints.length > 0
      ? currentSettings.introFeaturePoints
      : [
          '100% Anti-Ban Protection & High-Security Bypass',
          'Smooth Aimbot, ESP & Ultra-Low Latency Gameplay',
          'Instant Key Activation with 1-Device Security Lock',
          'Works on All Latest Updates with 24/7 VIP Support'
        ]
  );
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(null);
  const [savingAllSettings, setSavingAllSettings] = useState(false);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPanelName(currentSettings.panelName || currentSettings.websiteTitle || 'REVOX PANEL');
    setLogoSize(
      currentSettings.logoSize && currentSettings.logoSize >= 240 ? currentSettings.logoSize : 290
    );
    setLogoPositionY(currentSettings.logoPositionY || 0);
    setAnnTitle(currentSettings.announcementTitle || "WE'RE MOVING");
    setAnnFrom(
      (currentSettings.announcementFrom && currentSettings.announcementFrom !== 'SILENTX')
        ? currentSettings.announcementFrom
        : 'ANTIBAN'
    );
    if (Array.isArray(currentSettings.announcementLines)) {
      setAnnLines(currentSettings.announcementLines);
    }
    if (Array.isArray(currentSettings.introFeaturePoints) && currentSettings.introFeaturePoints.length > 0) {
      setIntroFeaturePoints(currentSettings.introFeaturePoints);
    }
    setWhatsappUrl(currentSettings.whatsappUrl || '');
    setDownloadHackUrl(currentSettings.downloadHackUrl || 'https://t.me/silentx_phantom_official');
    setSetupVideoUrl(currentSettings.setupVideoUrl || 'https://www.youtube.com/');
    setIntroVideoUrl(currentSettings.introVideoUrl || currentSettings.buttonSettings?.introVideoUrl || '');
    setIntroVideoEnabled(
      currentSettings.introVideoEnabled !== undefined
        ? Boolean(currentSettings.introVideoEnabled)
        : currentSettings.buttonSettings?.introVideoEnabled !== undefined
        ? Boolean(currentSettings.buttonSettings.introVideoEnabled)
        : true
    );
  }, [currentSettings.version]);

  // Authenticated fetch helper
  const adminFetch = async (url: string, options: RequestInit = {}) => {
    const token = adminToken || sessionStorage.getItem('revox_admin_token') || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {})
    };
    if (token) {
      headers['x-admin-token'] = token;
    }
    const res = await fetch(url, {
      ...options,
      headers
    });
    return res;
  };

  useEffect(() => {
    if (initialAuthorized && !adminToken) {
      fetch('/api/admin/verify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'CRITICALXR-A4AE97-ASHISH12@@' })
      })
        .then(r => r.json())
        .then(d => {
          if (d.authorized && d.adminToken) {
            sessionStorage.setItem('revox_admin_token', d.adminToken);
            setAdminToken(d.adminToken);
            setAuthorized(true);
          }
        })
        .catch(() => {
          setAuthorized(true);
        });
    }
  }, [initialAuthorized, adminToken]);

  const fetchKeys = async (silent = false) => {
    if (!silent) setLoadingKeys(true);
    let apiKeys: AccessKey[] = [];
    let loadedFromApi = false;
    try {
      const res = await adminFetch('/api/admin/keys');
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {}

      if (res.ok && data?.success && Array.isArray(data.keys)) {
        apiKeys = data.keys;
        if (Array.isArray(data.logs)) setLogs(data.logs);
        loadedFromApi = true;
      }
    } catch (err) {
      console.warn('API fetchKeys error, trying Firestore fallback:', err);
    }

    if (loadedFromApi) {
      setKeys(apiKeys);
      if (!silent) setLoadingKeys(false);
      return;
    }

    // Fallback to Firestore if backend API is unreachable
    try {
      const q = query(
        collection(db, 'accessKeys'),
        where('status', 'in', ['active', 'revoked', 'expired'])
      );
      const querySnap = await getDocs(q);
      const firestoreKeys: AccessKey[] = [];
      querySnap.forEach(docSnap => {
        if (docSnap.exists()) {
          const d = docSnap.data();
          firestoreKeys.push({
            id: docSnap.id,
            key: d.key,
            customerName: d.customerName || 'Customer',
            durationDays: Number(d.durationDays) || 30,
            durationUnit: d.durationUnit || 'days',
            durationValue: d.durationValue ?? d.durationDays ?? 30,
            durationMs: d.durationMs,
            status: d.status || 'active',
            createdAt: d.createdAt || new Date().toISOString(),
            activatedAt: d.activatedAt || null,
            expiresAt: d.expiresAt || null,
            boundDeviceId: d.boundDeviceId || null,
            activeSessionToken: d.activeSessionToken || null,
            notes: d.notes || ''
          });
        }
      });

      const combined = firestoreKeys.sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
      setKeys(combined);
    } catch (fsErr) {
      console.warn('Firestore fallback fetchKeys warning:', fsErr);
    }

    if (!silent) setLoadingKeys(false);
  };

  useEffect(() => {
    if (authorized) {
      fetchKeys();
      const refreshInterval = setInterval(() => {
        fetchKeys(true);
      }, 12000);
      return () => clearInterval(refreshInterval);
    }
  }, [authorized, adminToken]);

  // Login Handlers
  const handlePasscodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const trimmed = passcode.trim();
    if (!trimmed) {
      setLoginError('Please enter Admin Password');
      return;
    }
    setVerifyingAuth(true);
    try {
      const res = await fetch('/api/admin/verify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: trimmed })
      });
      const data = await res.json();
      if (res.ok && data.authorized) {
        if (data.adminToken) {
          sessionStorage.setItem('revox_admin_token', data.adminToken);
          setAdminToken(data.adminToken);
        }
        setAuthorized(true);
        setAdminUser('Admin');
        setPasscode('');
        showToast('Welcome to Admin Panel', 'success');
      } else {
        setLoginError('Wrong Password! Try again.');
      }
    } catch {
      if (trimmed.toUpperCase() === 'CRITICALXR-A4AE97-ASHISH12@@') {
        setAuthorized(true);
        setAdminUser('Admin');
        setPasscode('');
        showToast('Welcome to Admin Panel', 'success');
      } else {
        setLoginError('Wrong Password! Try again.');
      }
    } finally {
      setVerifyingAuth(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoginError(null);
    setVerifyingAuth(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user?.email;
      try {
        const res = await fetch('/api/admin/verify-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok && data.authorized) {
          if (data.adminToken) {
            sessionStorage.setItem('revox_admin_token', data.adminToken);
            setAdminToken(data.adminToken);
          }
          setAuthorized(true);
          setAdminUser(email || 'Superadmin');
          showToast('Logged in via Google', 'success');
          return;
        }
      } catch {}
      if (email && email.toLowerCase() === 'rawashishh@gmail.com') {
        setAuthorized(true);
        setAdminUser(email);
        showToast('Logged in via Google', 'success');
      } else {
        setLoginError(`Email ${email} is not authorized`);
      }
    } catch (err: any) {
      setLoginError(err.message || 'Google Sign-In failed');
    } finally {
      setVerifyingAuth(false);
    }
  };

  const handleAdminLogout = () => {
    signOut(auth).catch(() => {});
    sessionStorage.removeItem('revox_admin_token');
    setAdminToken('');
    setAuthorized(false);
    setAdminUser(null);
  };

  // Key Actions
  const handleGenerateKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generating) return;
    setGenError(null);

    const cleanCustomer = genCustomerName.trim() || 'Customer';
    const durNum = Number(genDurationValue);
    if (!Number.isFinite(durNum) || durNum <= 0) {
      setGenError('Enter a valid duration number');
      return;
    }

    const quantity = Math.min(Math.max(1, Number(genCustomCount) || 1), 500);

    setGenerating(true);
    let generatedSuccessfully = false;

    // 1. Try backend API first
    try {
      const res = await adminFetch('/api/admin/keys/generate', {
        method: 'POST',
        body: JSON.stringify({
          customerName: cleanCustomer,
          durationValue: durNum,
          durationUnit: genDurationUnit,
          count: quantity,
          prefix: 'RVX',
          notes: genNotes.trim()
        })
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {}

      if (res.ok && data?.success && Array.isArray(data.generated)) {
        const newlyCreated: AccessKey[] = data.generated;
        setGeneratedBatch(newlyCreated);
        if (Array.isArray(data.logs)) setLogs(data.logs);
        await fetchKeys(true);
        showToast(`Generated ${newlyCreated.length} Key(s)!`, 'success');
        generatedSuccessfully = true;
      }
    } catch (apiErr) {
      console.warn('API generateKey failed, trying Firestore fallback:', apiErr);
    }

    // 2. Direct Firestore fallback (runs instantly if API returns 404 on Vercel/proxy)
    if (!generatedSuccessfully) {
      try {
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();

        let durationMs = 0;
        let durationDays = 0;
        if (genDurationUnit === 'minutes') {
          durationMs = Math.max(1, durNum) * 60 * 1000;
          durationDays = Number((durNum / (60 * 24)).toFixed(4));
        } else if (genDurationUnit === 'hours') {
          durationMs = Math.max(1, durNum) * 60 * 60 * 1000;
          durationDays = Number((durNum / 24).toFixed(4));
        } else {
          durationDays = Math.max(1, durNum);
          durationMs = durationDays * 24 * 60 * 60 * 1000;
        }

        const fallbackBatch: AccessKey[] = [];
        for (let i = 0; i < quantity; i++) {
          const uniqueKey = generateClientCryptoKey('RVX');
          const keyId = uniqueKey;
          const keyDocData: AccessKey = {
            id: keyId,
            key: uniqueKey,
            customerName: cleanCustomer,
            durationDays,
            durationUnit: genDurationUnit,
            durationValue: durNum,
            durationMs,
            status: 'active',
            createdAt: nowIso,
            activatedAt: null,
            expiresAt: null,
            boundDeviceId: null,
            activeSessionToken: null,
            notes: genNotes.trim()
          };

          await setDoc(doc(db, 'accessKeys', keyId), keyDocData);
          fallbackBatch.push(keyDocData);
        }

        setGeneratedBatch(fallbackBatch);
        setKeys(prev => [...fallbackBatch, ...prev]);
        showToast(`Generated ${fallbackBatch.length} Key(s)!`, 'success');
        generatedSuccessfully = true;
      } catch (fsErr: any) {
        console.error('Firestore fallback generation error:', fsErr);
        setGenError(fsErr?.message || 'Error generating key');
        showToast(fsErr?.message || 'Failed to generate key', 'error');
      }
    }

    setGenerating(false);
  };

  const handleCopyText = (text: string, idForFeedback?: string, customToast = 'Key Copied!') => {
    navigator.clipboard?.writeText(text);
    if (idForFeedback) {
      setCopiedKeyId(idForFeedback);
      setTimeout(() => {
        setCopiedKeyId(prev => (prev === idForFeedback ? null : prev));
      }, 1800);
    }
    showToast(customToast, 'info');
  };

  const handleSetKeyStatus = async (keyItem: AccessKey, action: 'activate' | 'deactivate') => {
    if (actionBusyId) return;
    setActionBusyId(keyItem.id);
    let success = false;
    const kUpper = keyItem.key.toUpperCase();
    try {
      const res = await adminFetch('/api/admin/keys/status', {
        method: 'POST',
        body: JSON.stringify({ id: keyItem.id, action })
      });
      const text = await res.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch {}
      if (res.ok && data?.success && data.key) {
        setKeys(prev => prev.map(k => (k.id === keyItem.id ? data.key : k)));
        success = true;
      }
    } catch {}

    if (!success) {
      try {
        const newStatus = action === 'deactivate' ? 'revoked' : 'active';
        await setDoc(doc(db, 'accessKeys', kUpper), { ...keyItem, status: newStatus }, { merge: true });
        if (keyItem.id !== kUpper) {
          await updateDoc(doc(db, 'accessKeys', keyItem.id), { status: newStatus }).catch(() => {});
        }
        setKeys(prev => prev.map(k => (k.id === keyItem.id ? { ...k, status: newStatus } : k)));
        success = true;
      } catch (err: any) {
        showToast(err?.message || 'Update failed', 'error');
      }
    }

    if (success) {
      showToast(action === 'deactivate' ? 'Key Blocked' : 'Key Unblocked', 'success');
    }
    setActionBusyId(null);
  };

  const handleResetKeySession = async (keyItem: AccessKey) => {
    if (actionBusyId) return;
    setActionBusyId(keyItem.id);
    let success = false;
    const kUpper = keyItem.key.toUpperCase();
    try {
      const res = await adminFetch('/api/admin/keys/reset-session', {
        method: 'POST',
        body: JSON.stringify({ id: keyItem.id })
      });
      const text = await res.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch {}
      if (res.ok && data?.success && data.key) {
        setKeys(prev => prev.map(k => (k.id === keyItem.id ? data.key : k)));
        success = true;
      }
    } catch {}

    if (!success) {
      try {
        const resetFields = {
          ...keyItem,
          boundDeviceId: null,
          activeSessionToken: null
        };
        await setDoc(doc(db, 'accessKeys', kUpper), resetFields, { merge: true });
        if (keyItem.id !== kUpper) {
          await updateDoc(doc(db, 'accessKeys', keyItem.id), {
            boundDeviceId: null,
            activeSessionToken: null
          }).catch(() => {});
        }
        setKeys(prev =>
          prev.map(k =>
            k.id === keyItem.id
              ? { ...k, boundDeviceId: null, activeSessionToken: null }
              : k
          )
        );
        success = true;
      } catch (err: any) {
        showToast(err?.message || 'Failed to unlock device', 'error');
      }
    }

    if (success) {
      showToast('Device Lock Reset! Key can be used again.', 'success');
    }
    setActionBusyId(null);
  };

  const handleConfirmDeleteKey = async () => {
    if (!deleteTargetKey || deletingKey) return;
    setDeletingKey(true);
    let success = false;
    const kUpper = deleteTargetKey.key.toUpperCase();
    try {
      const res = await adminFetch(`/api/admin/keys/${deleteTargetKey.id}`, {
        method: 'DELETE'
      });
      const text = await res.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch {}
      if (res.ok && data?.success) {
        success = true;
      }
    } catch {}

    if (!success) {
      try {
        await deleteDoc(doc(db, 'accessKeys', kUpper));
        if (deleteTargetKey.id !== kUpper) {
          await deleteDoc(doc(db, 'accessKeys', deleteTargetKey.id)).catch(() => {});
        }
        success = true;
      } catch (err: any) {
        showToast(err?.message || 'Delete failed', 'error');
      }
    }

    if (success) {
      setKeys(prev => prev.filter(k => k.id !== deleteTargetKey.id && k.key.toUpperCase() !== kUpper));
      setGeneratedBatch(prev => prev.filter(k => k.id !== deleteTargetKey.id && k.key.toUpperCase() !== kUpper));
      setDeleteTargetKey(null);
      showToast('Key Deleted', 'success');
    }
    setDeletingKey(false);
  };

  const handleConfirmRenewKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewTargetKey || renewingKey) return;
    const durVal = Number(renewDurationVal);
    if (!Number.isFinite(durVal) || durVal <= 0) {
      showToast('Enter a valid duration', 'error');
      return;
    }

    setRenewingKey(true);
    let success = false;
    try {
      const res = await adminFetch('/api/admin/keys/renew', {
        method: 'POST',
        body: JSON.stringify({
          id: renewTargetKey.id,
          durationValue: durVal,
          durationUnit: renewDurationUnit
        })
      });
      const text = await res.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch {}
      if (res.ok && data?.success && data.key) {
        setKeys(prev => prev.map(k => (k.id === renewTargetKey.id ? data.key : k)));
        success = true;
      }
    } catch {}

    if (!success) {
      try {
        const addedMs =
          renewDurationUnit === 'minutes'
            ? durVal * 60 * 1000
            : renewDurationUnit === 'hours'
            ? durVal * 60 * 60 * 1000
            : durVal * 24 * 60 * 60 * 1000;

        let newExpiresAt: string | null = null;
        if (renewTargetKey.expiresAt) {
          const baseMs = Math.max(Date.now(), new Date(renewTargetKey.expiresAt).getTime());
          newExpiresAt = new Date(baseMs + addedMs).toISOString();
        }

        const updatedPartial = {
          durationValue: durVal,
          durationUnit: renewDurationUnit,
          durationDays: renewDurationUnit === 'days' ? durVal : Number((addedMs / 86400000).toFixed(4)),
          durationMs: (renewTargetKey.durationMs || 0) + addedMs,
          status: 'active' as const,
          ...(newExpiresAt ? { expiresAt: newExpiresAt } : {})
        };

        await updateDoc(doc(db, 'accessKeys', renewTargetKey.id), updatedPartial);
        setKeys(prev =>
          prev.map(k => (k.id === renewTargetKey.id ? { ...k, ...updatedPartial } : k))
        );
        success = true;
      } catch (err: any) {
        showToast(err?.message || 'Failed to add time', 'error');
      }
    }

    if (success) {
      setRenewTargetKey(null);
      showToast(`Added +${durVal} ${renewDurationUnit}!`, 'success');
    }
    setRenewingKey(false);
  };

  // Live Key Metrics
  const liveMetrics = useMemo(() => {
    let total = keys.length;
    let active = 0;
    let unused = 0;
    let inUse = 0;
    let expired = 0;
    let deactivated = 0;

    for (const k of keys) {
      const st = computeKeyDisplayStatus(k, nowMs);
      if (st === 'BLOCKED') {
        deactivated++;
      } else if (st === 'EXPIRED') {
        expired++;
      } else if (st === 'UNUSED') {
        unused++;
        active++;
      } else {
        inUse++;
        active++;
      }
    }

    return { total, active, unused, inUse, expired, deactivated };
  }, [keys, nowMs]);

  const filteredKeys = useMemo(() => {
    const q = keySearch.trim().toUpperCase();
    return keys
      .filter(k => {
        const disp = computeKeyDisplayStatus(k, nowMs);
        if (keyFilter === 'unused' && disp !== 'UNUSED') return false;
        if (keyFilter === 'active' && disp !== 'ACTIVE') return false;
        if (keyFilter === 'expired' && disp !== 'EXPIRED') return false;
        if (keyFilter === 'deactivated' && disp !== 'BLOCKED') return false;

        if (q) {
          const matchKey = k.key.toUpperCase().includes(q);
          const matchCustomer = (k.customerName || '').toUpperCase().includes(q);
          const matchNotes = (k.notes || '').toUpperCase().includes(q);
          return matchKey || matchCustomer || matchNotes;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [keys, keySearch, keyFilter, nowMs]);

  // Settings Helpers
  const persistSettingsAuthoritatively = async (payload: Partial<SiteSettings>): Promise<SiteSettings> => {
    const res = await adminFetch('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({
        ...currentSettings,
        ...payload,
        updatedBy: adminUser || 'admin'
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success || !data.settings) {
      throw new Error(data.message || 'Failed to save settings');
    }

    const confirmedSettings: SiteSettings = data.settings;
    onUpdateSettings(confirmedSettings);
    return confirmedSettings;
  };

  const optimizeImageToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.onload = ev => {
        const rawDataUrl = ev.target?.result as string;
        if (!rawDataUrl) return reject(new Error('Empty image'));
        const img = new Image();
        img.onerror = () => resolve(rawDataUrl);
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            let w = img.width || 300;
            let h = img.height || 300;
            const maxDim = 420;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(rawDataUrl);
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const webpOut = canvas.toDataURL('image/webp', 0.88);
            resolve(webpOut.length <= 500000 ? webpOut : canvas.toDataURL('image/png'));
          } catch {
            resolve(rawDataUrl);
          }
        };
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const permanentDataUrl = await optimizeImageToDataUrl(file);
      const res = await adminFetch('/api/admin/upload-logo', {
        method: 'POST',
        body: JSON.stringify({
          dataUrl: permanentDataUrl,
          size: logoSize,
          positionY: logoPositionY,
          updatedBy: adminUser || 'admin'
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.settings) {
        throw new Error(data.message || 'Failed to upload logo');
      }
      onUpdateSettings(data.settings);
      setLogoUrlInput('');
      showToast('Logo Uploaded & Saved!', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Logo upload failed', 'error');
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const uploadRawChunkWithProgress = (
    videoId: string,
    safeFileName: string,
    chunkIndex: number,
    byteOffset: number,
    blob: Blob,
    onProgress: (loadedBytes: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const token = adminToken || sessionStorage.getItem('revox_admin_token') || '';
      const params = new URLSearchParams({
        videoId,
        fileName: safeFileName,
        chunkIndex: String(chunkIndex),
        byteOffset: String(byteOffset)
      });
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/admin/upload-video-chunk?${params.toString()}`, true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      if (token) {
        xhr.setRequestHeader('x-admin-token', token);
      }

      xhr.upload.onprogress = evt => {
        if (evt.lengthComputable) {
          onProgress(evt.loaded);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(blob.size);
          resolve();
        } else {
          let errMsg = `HTTP ${xhr.status}`;
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.message) errMsg = parsed.message;
          } catch {}
          reject(new Error(errMsg));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during video chunk upload'));
      xhr.onabort = () => reject(new Error('Video upload aborted'));
      xhr.send(blob);
    });
  };

  const handleVideoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const cleanFeatures = introFeaturePoints.map(p => p.trim()).filter(p => p.length > 0);
    setUploadingVideo(true);
    setVideoUploadProgress(1);

    // 4MB raw binary chunks with 4 parallel streams (0% Base64 overhead, full bandwidth speed, unlimited file size)
    const CHUNK_BYTE_SIZE = 4 * 1024 * 1024;
    const CONCURRENCY = 4;
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTE_SIZE));
    const mimeType = file.type || 'video/mp4';

    try {
      // 1. Primary Unlimited High-Speed Parallel Binary Upload
      const initRes = await adminFetch('/api/admin/upload-video-init', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          mimeType
        })
      });

      let initData: any = null;
      try {
        initData = await initRes.json();
      } catch {}

      if (initRes.ok && initData?.success && initData.videoId) {
        const { videoId, fileName: safeFileName } = initData;
        const loadedPerChunk = new Array<number>(totalChunks).fill(0);

        const updateOverallProgress = () => {
          if (file.size <= 0) {
            setVideoUploadProgress(100);
            return;
          }
          let totalLoaded = 0;
          for (let i = 0; i < totalChunks; i++) {
            totalLoaded += loadedPerChunk[i];
          }
          const pct = Math.min(99, Math.max(1, Math.round((totalLoaded / file.size) * 100)));
          setVideoUploadProgress(pct);
        };

        let nextChunkToAssign = 0;
        const uploadWorker = async () => {
          while (true) {
            const chunkIndex = nextChunkToAssign++;
            if (chunkIndex >= totalChunks) break;

            const start = chunkIndex * CHUNK_BYTE_SIZE;
            const end = Math.min(file.size, start + CHUNK_BYTE_SIZE);
            const sliceBlob = file.slice(start, end);

            let chunkUploaded = false;
            let lastChunkErr = '';
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                loadedPerChunk[chunkIndex] = 0;
                await uploadRawChunkWithProgress(
                  videoId,
                  safeFileName,
                  chunkIndex,
                  start,
                  sliceBlob,
                  loadedBytes => {
                    loadedPerChunk[chunkIndex] = loadedBytes;
                    updateOverallProgress();
                  }
                );
                chunkUploaded = true;
                break;
              } catch (err: any) {
                lastChunkErr = err?.message || 'Network error';
              }
            }

            if (!chunkUploaded) {
              throw new Error(lastChunkErr || `Failed on chunk ${chunkIndex + 1}/${totalChunks}`);
            }
          }
        };

        const workerCount = Math.min(CONCURRENCY, totalChunks);
        const workers: Promise<void>[] = [];
        for (let w = 0; w < workerCount; w++) {
          workers.push(uploadWorker());
        }
        await Promise.all(workers);

        setVideoUploadProgress(100);

        const completeRes = await adminFetch('/api/admin/upload-video-complete', {
          method: 'POST',
          body: JSON.stringify({
            videoId,
            fileName: safeFileName,
            mimeType,
            totalChunks,
            sizeBytes: file.size,
            introVideoTitle: 'WITH PANEL GAMEPLAY',
            introVideoButtonText: 'CONTINUE',
            introFeaturePoints: cleanFeatures,
            updatedBy: adminUser || 'admin'
          })
        });
        const completeData = await completeRes.json().catch(() => null);
        if (!completeRes.ok || !completeData?.success || !completeData.settings) {
          throw new Error(completeData?.message || 'Failed to finalize video upload');
        }

        setIntroVideoUrl(completeData.settings.introVideoUrl || completeData.introVideoUrl || '');
        setIntroVideoEnabled(true);
        onUpdateSettings(completeData.settings);
        showToast('Gameplay Video Uploaded!', 'success');
        return;
      }

      // 2. Fallback: Firebase Storage direct upload (if available)
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
      const cloudPath = `gameplayVideos/gameplay_${Date.now()}.${ext}`;
      const vRef = storageRef(storage, cloudPath);
      await uploadBytes(vRef, file, { contentType: mimeType });
      const cloudDownloadUrl = await getDownloadURL(vRef);

      if (cloudDownloadUrl && !cloudDownloadUrl.startsWith('blob:')) {
        await persistSettingsAuthoritatively({
          introVideoUrl: cloudDownloadUrl,
          introVideoEnabled: true,
          introFeaturePoints: cleanFeatures,
          buttonSettings: {
            ...currentSettings.buttonSettings,
            introVideoUrl: cloudDownloadUrl,
            introVideoEnabled: true,
            introFeaturePoints: cleanFeatures
          }
        });
        setIntroVideoUrl(cloudDownloadUrl);
        setIntroVideoEnabled(true);
        showToast('Gameplay Video Uploaded!', 'success');
        return;
      }
    } catch (err: any) {
      showToast(err?.message || 'Video upload failed', 'error');
    } finally {
      setUploadingVideo(false);
      setVideoUploadProgress(null);
      if (videoFileInputRef.current) videoFileInputRef.current.value = '';
    }
  };

  const handleSaveAllWebsiteSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (savingAllSettings) return;
    setSavingAllSettings(true);

    try {
      const cleanName = panelName.trim() || 'REVOX PANEL';
      const targetLogoUrl =
        logoUrlInput.trim() !== ''
          ? logoUrlInput.trim()
          : currentSettings.logoUrl || '/assets/revox-logo.png';

      let formattedWhatsapp = whatsappUrl.trim();
      const digitsOnly = formattedWhatsapp.replace(/[^0-9]/g, '');
      if (
        formattedWhatsapp &&
        !formattedWhatsapp.startsWith('http://') &&
        !formattedWhatsapp.startsWith('https://') &&
        digitsOnly.length >= 7
      ) {
        formattedWhatsapp = `https://wa.me/${digitsOnly}`;
        setWhatsappUrl(formattedWhatsapp);
      }

      let cleanVideoUrl = introVideoUrl.trim();
      if (
        cleanVideoUrl &&
        !cleanVideoUrl.startsWith('http') &&
        !cleanVideoUrl.startsWith('/') &&
        !cleanVideoUrl.startsWith('data:')
      ) {
        cleanVideoUrl = `https://${cleanVideoUrl}`;
        setIntroVideoUrl(cleanVideoUrl);
      }

      let cleanDownload = downloadHackUrl.trim();
      if (cleanDownload && !cleanDownload.startsWith('http') && !cleanDownload.startsWith('intent://')) {
        cleanDownload = `https://${cleanDownload}`;
        setDownloadHackUrl(cleanDownload);
      }

      let cleanSetup = setupVideoUrl.trim();
      if (cleanSetup && !cleanSetup.startsWith('http') && !cleanSetup.startsWith('intent://')) {
        cleanSetup = `https://${cleanSetup}`;
        setSetupVideoUrl(cleanSetup);
      }

      const cleanLines = annLines.map(l => l.trim()).filter(l => l.length > 0);
      const cleanFeatures = introFeaturePoints.map(p => p.trim()).filter(p => p.length > 0);

      await persistSettingsAuthoritatively({
        websiteTitle: cleanName,
        panelName: cleanName,
        announcementTo: cleanName,
        logoUrl: targetLogoUrl,
        logoSize,
        logoPositionY,
        announcementTitle: annTitle.trim() || "WE'RE MOVING",
        announcementFrom: annFrom.trim() || 'ANTIBAN',
        announcementLines: cleanLines,
        announcementText: cleanLines.join('\n'),
        whatsappNumber: formattedWhatsapp,
        whatsappUrl: formattedWhatsapp,
        introVideoUrl: cleanVideoUrl,
        introVideoEnabled,
        introFeaturePoints: cleanFeatures,
        downloadHackUrl: cleanDownload,
        setupVideoUrl: cleanSetup,
        buttonSettings: {
          ...currentSettings.buttonSettings,
          introVideoUrl: cleanVideoUrl,
          introVideoEnabled,
          introFeaturePoints: cleanFeatures,
          downloadHackUrl: cleanDownload,
          setupVideoUrl: cleanSetup
        }
      });

      showToast('All Website Settings Saved!', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to save settings', 'error');
    } finally {
      setSavingAllSettings(false);
    }
  };

  // ============================================================================
  // LOGIN SCREEN
  // ============================================================================
  if (!authorized) {
    return (
      <div className="fixed inset-0 z-50 bg-[#07060B]/95 backdrop-blur-xl flex items-center justify-center p-4 select-none">
        <div className="w-full max-w-[380px] bg-[#110E1C] border border-[#8B5CF6]/40 rounded-2xl p-6 shadow-[0_0_40px_rgba(139,92,246,0.2)] text-white relative animate-fade-in">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-[#1B162B] hover:bg-[#261F3D] text-[#A1A1AA] hover:text-white flex items-center justify-center cursor-pointer"
          >
            ✕
          </button>

          <div className="flex flex-col items-center text-center mb-5">
            <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/20 border border-[#8B5CF6]/50 flex items-center justify-center text-[#C4B5FD] text-xl font-bold mb-3">
              🔒
            </div>
            <h2 className="text-xl font-black font-tech tracking-wider uppercase text-white">
              ADMIN LOGIN
            </h2>
            <p className="text-xs text-[#9CA3AF] mt-1">
              Enter admin password to manage keys & website
            </p>
          </div>

          <form onSubmit={handlePasscodeLogin} className="space-y-3">
            <input
              type="password"
              value={passcode}
              onChange={e => {
                setPasscode(e.target.value);
                if (loginError) setLoginError(null);
              }}
              placeholder="Enter Admin Password"
              autoFocus
              className="w-full bg-[#09080F] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-4 py-3 text-sm text-white outline-none font-mono-code text-center tracking-wider"
            />

            {loginError && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400 text-center">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={verifyingAuth}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7C3AED] to-[#8B5CF6] hover:brightness-110 text-white font-tech font-bold tracking-wider uppercase text-sm cursor-pointer shadow-[0_4px_20px_rgba(139,92,246,0.35)] disabled:opacity-50"
            >
              {verifyingAuth ? 'OPENING...' : 'LOGIN TO ADMIN'}
            </button>
          </form>

          <div className="my-4 border-t border-[#221C35]" />

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={verifyingAuth}
            className="w-full bg-[#171326] hover:bg-[#211B36] border border-[#2E2646] text-[#E5E7EB] py-2.5 px-4 rounded-xl text-xs font-medium flex items-center justify-center gap-2 cursor-pointer"
          >
            <span className="font-bold text-[#A78BFA]">G</span>
            <span>Sign in with Google Admin</span>
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // CLEAN, SIMPLE & PROFESSIONAL ADMIN DASHBOARD
  // ============================================================================
  return (
    <div className="fixed inset-0 z-50 bg-[#08070C] text-white flex flex-col overflow-hidden select-none animate-fade-in">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] w-[90%] max-w-xs pointer-events-none animate-fade-in">
          <div
            className={`px-4 py-2.5 rounded-xl border shadow-xl flex items-center justify-center gap-2 text-xs font-semibold ${
              toast.type === 'error'
                ? 'bg-[#220C14] border-red-500/60 text-red-200'
                : 'bg-[#17112A] border-[#8B5CF6] text-white'
            }`}
          >
            <span>{toast.type === 'error' ? '⚠️' : '✓'}</span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Top Simple Header Bar */}
      <header className="bg-[#0E0C16] border-b border-[#221C34] px-4 py-3 shrink-0">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#8B5CF6] flex items-center justify-center font-tech font-black text-sm text-white shrink-0">
              RX
            </div>
            <div className="truncate">
              <div className="text-sm font-black font-tech tracking-wider text-white uppercase truncate">
                {currentSettings.panelName || 'REVOX PANEL'} — ADMIN
              </div>
              <div className="text-[11px] text-[#9CA3AF]">
                Simple Key & Website Manager
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span
              role="button"
              tabIndex={0}
              onClick={handleAdminLogout}
              className="text-xs font-mono-code font-bold text-[#9CA3AF] hover:text-red-400 cursor-pointer"
            >
              LOGOUT
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-[#1B162A] hover:bg-[#26203B] border border-[#342B4F] text-xs font-bold text-white cursor-pointer"
            >
              ✕ Exit
            </button>
          </div>
        </div>

        {/* Simple 3-Tab Switcher right inside the header */}
        <div className="max-w-2xl mx-auto mt-3 grid grid-cols-3 gap-1.5 bg-[#09080E] p-1 rounded-xl border border-[#221C34]">
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`py-2 px-2 rounded-lg font-tech font-bold text-xs sm:text-sm tracking-wider uppercase cursor-pointer transition-all ${
              activeTab === 'create'
                ? 'bg-[#8B5CF6] text-white shadow-[0_2px_12px_rgba(139,92,246,0.4)]'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            ⚡ CREATE KEY
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('keys')}
            className={`py-2 px-2 rounded-lg font-tech font-bold text-xs sm:text-sm tracking-wider uppercase cursor-pointer transition-all ${
              activeTab === 'keys'
                ? 'bg-[#8B5CF6] text-white shadow-[0_2px_12px_rgba(139,92,246,0.4)]'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            🔑 KEYS ({liveMetrics.total})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`py-2 px-2 rounded-lg font-tech font-bold text-xs sm:text-sm tracking-wider uppercase cursor-pointer transition-all ${
              activeTab === 'settings'
                ? 'bg-[#8B5CF6] text-white shadow-[0_2px_12px_rgba(139,92,246,0.4)]'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            ⚙️ SETTINGS
          </button>
        </div>
      </header>

      {/* Main Scrollable Area */}
      <main className="flex-1 overflow-y-auto p-4 pb-12">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Quick 4-Stat Strip (Always visible on Create & Keys tabs) */}
          {activeTab !== 'settings' && (
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => {
                  setKeyFilter('all');
                  setActiveTab('keys');
                }}
                className="bg-[#120F1D] hover:bg-[#191528] border border-[#26203B] rounded-xl p-2.5 text-center cursor-pointer"
              >
                <div className="text-lg sm:text-xl font-black font-mono-code text-white">
                  {liveMetrics.total}
                </div>
                <div className="text-[10px] font-bold text-[#A1A1AA] uppercase">Total</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setKeyFilter('unused');
                  setActiveTab('keys');
                }}
                className="bg-[#120F1D] hover:bg-[#191528] border border-[#8B5CF6]/30 rounded-xl p-2.5 text-center cursor-pointer"
              >
                <div className="text-lg sm:text-xl font-black font-mono-code text-[#C4B5FD]">
                  {liveMetrics.unused}
                </div>
                <div className="text-[10px] font-bold text-[#C4B5FD] uppercase">Unused</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setKeyFilter('active');
                  setActiveTab('keys');
                }}
                className="bg-[#120F1D] hover:bg-[#191528] border border-emerald-500/30 rounded-xl p-2.5 text-center cursor-pointer"
              >
                <div className="text-lg sm:text-xl font-black font-mono-code text-emerald-400">
                  {liveMetrics.inUse}
                </div>
                <div className="text-[10px] font-bold text-emerald-400 uppercase">In Use</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setKeyFilter('expired');
                  setActiveTab('keys');
                }}
                className="bg-[#120F1D] hover:bg-[#191528] border border-amber-500/30 rounded-xl p-2.5 text-center cursor-pointer"
              >
                <div className="text-lg sm:text-xl font-black font-mono-code text-amber-400">
                  {liveMetrics.expired}
                </div>
                <div className="text-[10px] font-bold text-amber-400 uppercase">Expired</div>
              </button>
            </div>
          )}

          {/* ====================================================================
              TAB 1: ⚡ CREATE NEW KEY (Clean, Fast & Simple)
              ==================================================================== */}
          {activeTab === 'create' && (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-[#120F1D] border border-[#28213E] rounded-2xl p-4 sm:p-5 space-y-4">
                <div>
                  <h2 className="text-base sm:text-lg font-black font-tech uppercase tracking-wider text-white">
                    CREATE NEW ACCESS KEY
                  </h2>
                  <p className="text-xs text-[#9CA3AF]">
                    1 Key works on 1 Device only. Timer starts when the user unlocks it.
                  </p>
                </div>

                <form onSubmit={handleGenerateKeys} className="space-y-4">
                  {/* 1. Customer Name */}
                  <div>
                    <label className="block text-xs font-bold text-[#D1D5DB] mb-1.5">
                      1. Customer Name
                    </label>
                    <input
                      type="text"
                      value={genCustomerName}
                      onChange={e => {
                        setGenCustomerName(e.target.value);
                        if (genError) setGenError(null);
                      }}
                      placeholder="Enter name (e.g. Rahul)"
                      className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-3.5 py-2.5 text-sm text-white outline-none"
                    />
                  </div>

                  {/* 2. Quick Duration Buttons */}
                  <div>
                    <label className="block text-xs font-bold text-[#D1D5DB] mb-1.5">
                      2. Select Validity Time
                    </label>
                    <div className="grid grid-cols-5 gap-1.5 mb-2.5">
                      {[
                        { label: '1Hr', val: '1', unit: 'hours' as const },
                        { label: '12Hr', val: '12', unit: 'hours' as const },
                        { label: '1 Day', val: '1', unit: 'days' as const },
                        { label: '7 Days', val: '7', unit: 'days' as const },
                        { label: '30 Days', val: '30', unit: 'days' as const }
                      ].map(p => {
                        const isSelected =
                          genDurationValue === p.val && genDurationUnit === p.unit;
                        return (
                          <button
                            key={p.label}
                            type="button"
                            onClick={() => {
                              setGenDurationValue(p.val);
                              setGenDurationUnit(p.unit);
                            }}
                            className={`py-2 rounded-lg font-mono-code font-bold text-xs border cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-[#8B5CF6] border-[#A78BFA] text-white'
                                : 'bg-[#09080E] border-[#29223E] text-[#9CA3AF] hover:text-white'
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Custom Duration Input + Unit */}
                    <div className="grid grid-cols-12 gap-2">
                      <input
                        type="number"
                        min={1}
                        max={9999}
                        value={genDurationValue}
                        onChange={e => setGenDurationValue(e.target.value)}
                        placeholder="Duration"
                        className="col-span-5 bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-3.5 py-2.5 text-sm font-mono-code text-white outline-none"
                      />
                      <div className="col-span-7 grid grid-cols-3 gap-1.5">
                        {(['minutes', 'hours', 'days'] as const).map(unit => (
                          <button
                            key={unit}
                            type="button"
                            onClick={() => setGenDurationUnit(unit)}
                            className={`py-2.5 rounded-xl font-tech font-bold text-xs uppercase border cursor-pointer ${
                              genDurationUnit === unit
                                ? 'bg-[#8B5CF6]/25 border-[#8B5CF6] text-white'
                                : 'bg-[#09080E] border-[#29223E] text-[#9CA3AF]'
                            }`}
                          >
                            {unit}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 3. How Many Keys */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-bold text-[#D1D5DB] mb-1.5">
                        3. Quantity
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {['1', '5', '10'].map(cnt => (
                          <button
                            key={cnt}
                            type="button"
                            onClick={() => setGenCustomCount(cnt)}
                            className={`py-2 rounded-xl font-mono-code font-bold text-xs border cursor-pointer ${
                              genCustomCount === cnt
                                ? 'bg-[#8B5CF6] border-[#A78BFA] text-white'
                                : 'bg-[#09080E] border-[#29223E] text-[#9CA3AF]'
                            }`}
                          >
                            {cnt}x
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#D1D5DB] mb-1.5">
                        Note (Optional)
                      </label>
                      <input
                        type="text"
                        value={genNotes}
                        onChange={e => setGenNotes(e.target.value)}
                        placeholder="e.g. Paid via UPI"
                        className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-3 py-2 text-xs text-white outline-none"
                      />
                    </div>
                  </div>

                  {genError && (
                    <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                      {genError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={generating}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#7C3AED] to-[#8B5CF6] hover:brightness-110 active:scale-[0.99] text-white font-tech font-black text-base tracking-wider uppercase cursor-pointer shadow-[0_4px_20px_rgba(139,92,246,0.4)] disabled:opacity-50"
                  >
                    {generating ? 'CREATING KEY...' : '⚡ GENERATE KEY NOW'}
                  </button>
                </form>
              </div>

              {/* Newly Generated Key Result Box */}
              {generatedBatch.length > 0 && (
                <div className="bg-[#111A17] border border-emerald-500/50 rounded-2xl p-4 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                      ✓ Key Ready to Share ({generatedBatch.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('keys')}
                      className="text-xs text-[#C4B5FD] underline cursor-pointer"
                    >
                      See in All Keys →
                    </button>
                  </div>

                  {generatedBatch.map(k => (
                    <div
                      key={k.id}
                      className="bg-[#09080E] border border-[#26203B] rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] text-[#9CA3AF]">
                          {k.customerName} · <span className="text-[#C4B5FD] font-semibold">{formatDurationLabel(k)}</span>
                        </div>
                        <div className="text-sm sm:text-base font-mono-code font-bold text-white break-all mt-0.5">
                          {k.key}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCopyText(k.key, k.id, 'Key Copied!')}
                          className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-tech font-bold text-xs uppercase cursor-pointer"
                        >
                          {copiedKeyId === k.id ? '✓ COPIED' : '📋 COPY KEY'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ====================================================================
              TAB 2: 🔑 ALL KEYS (Simple 1-Click Actions on Every Card)
              ==================================================================== */}
          {activeTab === 'keys' && (
            <div className="space-y-3 animate-fade-in">
              {/* Search & Filter Box */}
              <div className="bg-[#120F1D] border border-[#28213E] rounded-2xl p-3 space-y-2.5">
                <div className="relative">
                  <input
                    type="text"
                    value={keySearch}
                    onChange={e => setKeySearch(e.target.value)}
                    placeholder="🔍 Search by customer name or key..."
                    className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white outline-none"
                  />
                  {keySearch && (
                    <button
                      type="button"
                      onClick={() => setKeySearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9CA3AF] hover:text-white cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'all', label: `All (${liveMetrics.total})` },
                      { id: 'unused', label: `Unused (${liveMetrics.unused})` },
                      { id: 'active', label: `In Use (${liveMetrics.inUse})` },
                      { id: 'expired', label: `Expired (${liveMetrics.expired})` },
                      { id: 'deactivated', label: `Blocked (${liveMetrics.deactivated})` }
                    ] as { id: KeyFilterType; label: string }[]
                  ).map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setKeyFilter(tab.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        keyFilter === tab.id
                          ? 'bg-[#8B5CF6] text-white'
                          : 'bg-[#09080E] text-[#9CA3AF] hover:text-white border border-[#241E38]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Keys List */}
              {loadingKeys && keys.length === 0 ? (
                <div className="p-8 text-center bg-[#120F1D] border border-[#26203B] rounded-2xl text-xs text-[#9CA3AF]">
                  Loading keys...
                </div>
              ) : filteredKeys.length === 0 ? (
                <div className="p-8 text-center bg-[#120F1D] border border-[#26203B] rounded-2xl space-y-2">
                  <div className="text-sm font-bold text-white">No Keys Found</div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create')}
                    className="px-4 py-2 rounded-xl bg-[#8B5CF6] text-xs font-bold text-white cursor-pointer"
                  >
                    + Create New Key
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredKeys.map(k => {
                    const dispStatus = computeKeyDisplayStatus(k, nowMs);
                    const isBlocked = dispStatus === 'BLOCKED';
                    const isLockedToDevice = Boolean(k.boundDeviceId || k.activeSessionToken);

                    const badgeStyle =
                      dispStatus === 'ACTIVE'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : dispStatus === 'UNUSED'
                        ? 'bg-[#8B5CF6]/15 text-[#C4B5FD] border-[#8B5CF6]/40'
                        : dispStatus === 'EXPIRED'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-red-500/15 text-red-300 border-red-500/40';

                    return (
                      <div
                        key={k.id}
                        className="bg-[#120F1D] border border-[#292240] rounded-2xl p-3.5 space-y-3"
                      >
                        {/* Row 1: Customer Name + Status & Device Lock Pill */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-white truncate">
                              👤 {k.customerName || 'Customer'}
                            </div>
                            <div className="text-[11px] text-[#9CA3AF]">
                              ⏱ {formatShortTimeLeft(k, nowMs)}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`px-2 py-0.5 rounded-md border text-[10px] font-mono-code font-bold uppercase ${
                                isLockedToDevice
                                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              }`}
                            >
                              {isLockedToDevice ? '🔒 1-Device Used' : '🟢 Ready'}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-md border text-[10px] font-mono-code font-bold uppercase ${badgeStyle}`}
                            >
                              {dispStatus}
                            </span>
                          </div>
                        </div>

                        {/* Row 2: Key Code + Instant Copy Button */}
                        <div className="bg-[#09080E] border border-[#241E38] rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                          <span className="text-xs sm:text-sm font-mono-code font-bold text-[#E9D5FF] break-all">
                            {k.key}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyText(k.key, k.id)}
                            className="px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-tech font-bold text-xs uppercase cursor-pointer shrink-0"
                          >
                            {copiedKeyId === k.id ? '✓ COPIED' : 'COPY'}
                          </button>
                        </div>

                        {/* Row 3: 4 Simple 1-Click Action Buttons */}
                        <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                          {/* 1. Reset Device Lock (Allow Re-login) */}
                          <button
                            type="button"
                            disabled={!isLockedToDevice || actionBusyId === k.id}
                            onClick={() => handleResetKeySession(k)}
                            title="Unlock device so key can be opened again"
                            className="py-2 px-1.5 rounded-lg bg-[#1B162E] hover:bg-[#282044] border border-[#8B5CF6]/40 text-[11px] font-bold text-[#C4B5FD] cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed text-center"
                          >
                            🔓 Unlock
                          </button>

                          {/* 2. Add Time (+Time) */}
                          <button
                            type="button"
                            onClick={() => {
                              setRenewTargetKey(k);
                              setRenewDurationVal('7');
                              setRenewDurationUnit('days');
                            }}
                            className="py-2 px-1.5 rounded-lg bg-[#171E2E] hover:bg-[#1E293B] border border-sky-500/35 text-[11px] font-bold text-sky-300 cursor-pointer text-center"
                          >
                            ➕ +Time
                          </button>

                          {/* 3. Block / Unblock */}
                          <button
                            type="button"
                            disabled={actionBusyId === k.id}
                            onClick={() =>
                              handleSetKeyStatus(k, isBlocked ? 'activate' : 'deactivate')
                            }
                            className={`py-2 px-1.5 rounded-lg border text-[11px] font-bold cursor-pointer text-center ${
                              isBlocked
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                            }`}
                          >
                            {isBlocked ? '▶ Unblock' : '⏸ Block'}
                          </button>

                          {/* 4. Delete */}
                          <button
                            type="button"
                            onClick={() => setDeleteTargetKey(k)}
                            className="py-2 px-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-[11px] font-bold text-red-300 cursor-pointer text-center"
                          >
                            🗑 Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ====================================================================
              TAB 3: ⚙️ WEBSITE SETTINGS (All in One Clean Scrollable Page)
              ==================================================================== */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveAllWebsiteSettings} className="space-y-4 animate-fade-in">
              {/* SECTION 1: WEBSITE NAME & LOGO */}
              <div className="bg-[#120F1D] border border-[#28213E] rounded-2xl p-4 space-y-3.5">
                <h3 className="text-sm font-black font-tech uppercase tracking-wider text-[#C4B5FD]">
                  1. Website Name & Logo
                </h3>

                <div>
                  <label className="block text-xs font-semibold text-[#D1D5DB] mb-1">
                    Website / Panel Name (Updates Everywhere)
                  </label>
                  <input
                    type="text"
                    value={panelName}
                    onChange={e => setPanelName(e.target.value)}
                    placeholder="e.g. REVOX PANEL"
                    className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-3.5 py-2.5 text-sm font-bold text-white outline-none"
                  />
                </div>

                <div className="flex items-center gap-3.5 bg-[#09080E] p-3 rounded-xl border border-[#221C34]">
                  <div className="w-16 h-16 rounded-xl bg-[#141022] border border-[#2E2646] flex items-center justify-center overflow-hidden shrink-0 p-1">
                    <img
                      src={currentSettings.logoUrl || '/assets/revox-logo.png'}
                      alt="Logo"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                  <div className="space-y-2 flex-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={uploadingLogo}
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-tech font-bold text-xs uppercase cursor-pointer"
                      >
                        {uploadingLogo ? 'Uploading...' : '📁 Upload Logo'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLogoUrlInput('/assets/revox-logo.png')}
                        className="px-3 py-2 rounded-lg bg-[#1B162B] border border-[#8B5CF6]/40 text-xs font-bold text-[#C4B5FD] cursor-pointer"
                      >
                        Default Logo
                      </button>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#9CA3AF]">
                        Logo Size: {logoSize}px
                      </label>
                      <input
                        type="range"
                        min={80}
                        max={380}
                        value={logoSize}
                        onChange={e => setLogoSize(Number(e.target.value))}
                        className="w-full accent-[#8B5CF6]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: GAMEPLAY VIDEO & FEATURE POINTS */}
              <div className="bg-[#120F1D] border border-[#28213E] rounded-2xl p-4 space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black font-tech uppercase tracking-wider text-[#C4B5FD]">
                    2. Gameplay Video & Panel Points
                  </h3>
                  <label className="flex items-center gap-1.5 text-xs text-[#D1D5DB] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={introVideoEnabled}
                      onChange={e => setIntroVideoEnabled(e.target.checked)}
                      className="accent-[#8B5CF6]"
                    />
                    <span>Show on Start</span>
                  </label>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={videoFileInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/*"
                      onChange={handleVideoFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingVideo}
                      onClick={() => videoFileInputRef.current?.click()}
                      className="px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-tech font-bold text-xs uppercase cursor-pointer disabled:opacity-70"
                    >
                      {uploadingVideo
                        ? `Uploading Video${videoUploadProgress !== null ? ` (${videoUploadProgress}%)` : '...'}`
                        : '🎬 Upload MP4 Video (No MB Limit)'}
                    </button>
                    {introVideoUrl && (
                      <button
                        type="button"
                        onClick={() => setIntroVideoUrl('')}
                        className="px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-xs font-bold text-red-300 cursor-pointer"
                      >
                        Clear Video
                      </button>
                    )}
                  </div>

                  {uploadingVideo && videoUploadProgress !== null && (
                    <div className="w-full bg-[#09080E] border border-[#2E2646] rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-[#7C3AED] via-[#A855F7] to-[#C084FC] h-full transition-all duration-150"
                        style={{ width: `${Math.max(4, videoUploadProgress)}%` }}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-[#9CA3AF] mb-1">
                    Or Paste Video Link (YouTube / MP4)
                  </label>
                  <input
                    type="text"
                    value={introVideoUrl}
                    onChange={e => setIntroVideoUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-3.5 py-2 text-xs text-white outline-none"
                  />
                </div>

                {introVideoUrl && (
                  <div className="rounded-xl overflow-hidden border border-[#2E2646] bg-black">
                    <Direct16x9VideoPlayer videoUrl={introVideoUrl} />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[#D1D5DB] mb-1">
                    Panel Features / Points (Shown below Gameplay Video, 1 per line)
                  </label>
                  <textarea
                    rows={4}
                    value={introFeaturePoints.join('\n')}
                    onChange={e => setIntroFeaturePoints(e.target.value.split('\n'))}
                    placeholder="Write each feature point on a new line..."
                    className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl p-3 text-xs text-white outline-none leading-relaxed"
                  />
                </div>
              </div>

              {/* SECTION 3: WHATSAPP & HOME CARD */}
              <div className="bg-[#120F1D] border border-[#28213E] rounded-2xl p-4 space-y-3.5">
                <h3 className="text-sm font-black font-tech uppercase tracking-wider text-[#C4B5FD]">
                  3. WhatsApp Number & Home Notice
                </h3>

                <div>
                  <label className="block text-xs font-semibold text-[#D1D5DB] mb-1">
                    WhatsApp Number or Link (For "GET KEY" Button)
                  </label>
                  <input
                    type="text"
                    value={whatsappUrl}
                    onChange={e => setWhatsappUrl(e.target.value)}
                    placeholder="e.g. 919876543210"
                    className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-3.5 py-2.5 text-xs text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#D1D5DB] mb-1">
                    Home Announcement Points (1 per line)
                  </label>
                  <textarea
                    rows={3}
                    value={annLines.join('\n')}
                    onChange={e => setAnnLines(e.target.value.split('\n'))}
                    className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl p-3 text-xs text-white outline-none"
                  />
                </div>
              </div>

              {/* SECTION 4: DASHBOARD BUTTON LINKS */}
              <div className="bg-[#120F1D] border border-[#28213E] rounded-2xl p-4 space-y-3.5">
                <h3 className="text-sm font-black font-tech uppercase tracking-wider text-[#C4B5FD]">
                  4. Download Panel & Setup Video Links
                </h3>

                <div>
                  <label className="block text-xs font-semibold text-[#D1D5DB] mb-1">
                    DOWNLOAD PANEL Button Link
                  </label>
                  <input
                    type="text"
                    value={downloadHackUrl}
                    onChange={e => setDownloadHackUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-3.5 py-2.5 text-xs text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#D1D5DB] mb-1">
                    SETUP VIDEO Button Link
                  </label>
                  <input
                    type="text"
                    value={setupVideoUrl}
                    onChange={e => setSetupVideoUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-[#09080E] border border-[#2E2646] focus:border-[#8B5CF6] rounded-xl px-3.5 py-2.5 text-xs text-white outline-none"
                  />
                </div>
              </div>

              {/* ONE BIG SAVE BUTTON FOR ALL SETTINGS */}
              <button
                type="submit"
                disabled={savingAllSettings}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#7C3AED] to-[#8B5CF6] hover:brightness-110 text-white font-tech font-black text-base tracking-wider uppercase cursor-pointer shadow-[0_4px_25px_rgba(139,92,246,0.45)] disabled:opacity-50"
              >
                {savingAllSettings ? 'SAVING ALL CHANGES...' : '💾 SAVE ALL WEBSITE SETTINGS'}
              </button>
            </form>
          )}
        </div>
      </main>

      {/* Simple Modal: Delete Key Confirmation */}
      {deleteTargetKey && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-xs bg-[#120F1D] border border-red-500/50 rounded-2xl p-5 text-center space-y-3">
            <div className="text-base font-black font-tech uppercase text-white">
              Delete This Key?
            </div>
            <div className="text-xs font-mono-code text-red-300 break-all">
              {deleteTargetKey.customerName} · {deleteTargetKey.key}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTargetKey(null)}
                className="py-2.5 rounded-xl bg-[#1D182E] text-xs font-bold text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingKey}
                onClick={handleConfirmDeleteKey}
                className="py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-bold text-white cursor-pointer"
              >
                {deletingKey ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Simple Modal: Add Time (+Time) */}
      {renewTargetKey && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <form
            onSubmit={handleConfirmRenewKey}
            className="w-full max-w-xs bg-[#120F1D] border border-[#8B5CF6]/50 rounded-2xl p-5 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-black font-tech uppercase text-white">
                ➕ Add Extra Time
              </span>
              <button
                type="button"
                onClick={() => setRenewTargetKey(null)}
                className="text-xs text-[#9CA3AF] hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-[#9CA3AF] truncate">
              {renewTargetKey.customerName} · <span className="text-[#C4B5FD] font-mono-code">{renewTargetKey.key}</span>
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={9999}
                value={renewDurationVal}
                onChange={e => setRenewDurationVal(e.target.value)}
                className="w-24 bg-[#09080E] border border-[#2E2646] rounded-xl px-3 py-2 text-sm font-mono-code text-white outline-none"
              />
              <div className="flex-1 grid grid-cols-3 gap-1">
                {(['minutes', 'hours', 'days'] as const).map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setRenewDurationUnit(u)}
                    className={`rounded-lg text-[10px] font-bold uppercase cursor-pointer border ${
                      renewDurationUnit === u
                        ? 'bg-[#8B5CF6] border-[#A78BFA] text-white'
                        : 'bg-[#09080E] border-[#26203B] text-[#9CA3AF]'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRenewTargetKey(null)}
                className="py-2.5 rounded-xl bg-[#1D182E] text-xs font-bold text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={renewingKey}
                className="py-2.5 rounded-xl bg-[#8B5CF6] text-xs font-bold text-white cursor-pointer"
              >
                {renewingKey ? 'Adding...' : 'Add Time'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
