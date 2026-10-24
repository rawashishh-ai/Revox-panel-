// Shared stable device identifier helper for 1-Device locking across sessions

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'DEV-SERVER-FALLBACK';
  }

  const primaryKey = 'rvx_device_id';
  const legacyKey = 'sltx_device_id';

  try {
    let existing = localStorage.getItem(primaryKey) || localStorage.getItem(legacyKey);
    if (existing && existing.length >= 8) {
      if (!localStorage.getItem(primaryKey)) {
        localStorage.setItem(primaryKey, existing);
      }
      return existing;
    }

    const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase() +
      Date.now().toString(36).toUpperCase();
    const screenPart = `${window.screen?.width || 0}x${window.screen?.height || 0}`;
    const newId = `DEV-${randomPart}-${screenPart}`;

    localStorage.setItem(primaryKey, newId);
    localStorage.setItem(legacyKey, newId);
    return newId;
  } catch {
    return `DEV-FALLBACK-${navigator.userAgent.length || 16}`;
  }
}
