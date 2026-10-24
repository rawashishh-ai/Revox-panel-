// Cryptographically secure RVX access key generator

export function generateClientCryptoKey(prefix = 'RVX'): string {
  const cleanPrefix = (prefix || 'RVX').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'RVX';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const block = (): string => {
    let result = '';
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const array = new Uint8Array(4);
      window.crypto.getRandomValues(array);
      for (let i = 0; i < 4; i++) {
        result += chars[array[i] % chars.length];
      }
    } else {
      for (let i = 0; i < 4; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    return result;
  };

  return `${cleanPrefix}-${block()}-${block()}-${block()}`;
}
