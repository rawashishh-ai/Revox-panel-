// Shared stable device identifier helper for strict 1-Device locking across sessions

function getCookieDeviceId(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  } catch {
    return null;
  }
}

function setCookieDeviceId(name: string, val: string) {
  if (typeof document === 'undefined') return;
  try {
    const expires = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(val)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch {}
}

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'DEV-SERVER-FALLBACK';
  }

  const primaryKey = 'rvx_device_id';
  const legacyKey = 'sltx_device_id';

  try {
    const existing =
      localStorage.getItem(primaryKey) ||
      localStorage.getItem(legacyKey) ||
      sessionStorage.getItem(primaryKey) ||
      getCookieDeviceId(primaryKey) ||
      getCookieDeviceId(legacyKey);

    if (existing && existing.length >= 8) {
      try {
        localStorage.setItem(primaryKey, existing);
        localStorage.setItem(legacyKey, existing);
        sessionStorage.setItem(primaryKey, existing);
        setCookieDeviceId(primaryKey, existing);
      } catch {}
      return existing;
    }

    const randomBytes = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(randomBytes);
    } else {
      for (let i = 0; i < 8; i++) randomBytes[i] = Math.floor(Math.random() * 256);
    }
    const hexPart = Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const screenPart = `${window.screen?.width || 0}x${window.screen?.height || 0}`;
    const newId = `DEV-${hexPart}-${screenPart}`;

    try {
      localStorage.setItem(primaryKey, newId);
      localStorage.setItem(legacyKey, newId);
      sessionStorage.setItem(primaryKey, newId);
      setCookieDeviceId(primaryKey, newId);
    } catch {}
    return newId;
  } catch {
    return `DEV-FALLBACK-${navigator.userAgent.length || 16}`;
  }
}

