import { PurchasePlan, SiteSettings, GetKeyPurchaseMode } from '../types';

/**
 * ============================================================================
 * REVOX PANEL — OWNER PURCHASE & WHATSAPP CONFIGURATION
 * ============================================================================
 * Website Owner Configuration:
 * 1. Set OWNER_WHATSAPP_NUMBER_OR_URL below (e.g. "919876543210" or "https://wa.me/...")
 *    OR configure it directly inside the Admin Panel -> Website Settings.
 * 2. Configure purchase plans below in DEFAULT_CONFIGURABLE_KEY_PLANS
 *    OR manage them live inside the Admin Panel -> Website Settings -> Purchase Plans.
 */
export const OWNER_WHATSAPP_NUMBER_OR_URL: string = 'https://wa.me/9623508876';

export const WHATSAPP_PURCHASE_MESSAGE =
  '👋 Hello REVOX PANEL!\n\n🔐 I want to buy an Access Key.\n\n💎 KEY PRICES:\n💳 7 DAYS ➜ ₹99\n💳 12 DAYS ➜ ₹149\n💳 21 DAYS ➜ ₹249\n💳 30 DAYS ➜ ₹299\n💳 PERMANENT ➜ ₹499\n\nPlease share payment details!';

/**
 * Resolves the active "GET KEY" purchase mode configured in Admin Panel:
 * - 'both': Customer can choose Website or WhatsApp
 * - 'website': Direct to Website (/buy-key) only
 * - 'whatsapp': Direct to WhatsApp only
 */
export function resolveGetKeyMode(settings?: SiteSettings | null): GetKeyPurchaseMode {
  const raw = settings?.getKeyMode || settings?.buttonSettings?.getKeyMode;
  if (raw === 'website' || raw === 'whatsapp' || raw === 'both') {
    return raw;
  }
  return 'both';
}

/**
 * Official REVOX PANEL Key Price Plans:
 * 💳 7 DAYS ➜ ₹99
 * 💳 12 DAYS ➜ ₹149
 * 💳 21 DAYS ➜ ₹249
 * 💳 30 DAYS ➜ ₹299
 * 💳 PERMANENT ➜ ₹499
 */
export const DEFAULT_CONFIGURABLE_KEY_PLANS: PurchasePlan[] = [
  {
    id: 'plan_7_days',
    name: '7 DAYS ACCESS KEY',
    priceINR: 99,
    currency: 'INR',
    validityLabel: '7 Days',
    durationValue: 7,
    durationUnit: 'days',
    description: 'Single-device locked access key for REVOX PANEL (7 Days validity).',
    available: true
  },
  {
    id: 'plan_12_days',
    name: '12 DAYS ACCESS KEY',
    priceINR: 149,
    currency: 'INR',
    validityLabel: '12 Days',
    durationValue: 12,
    durationUnit: 'days',
    description: 'Single-device locked access key for REVOX PANEL (12 Days validity).',
    available: true
  },
  {
    id: 'plan_21_days',
    name: '21 DAYS ACCESS KEY',
    priceINR: 249,
    currency: 'INR',
    validityLabel: '21 Days',
    durationValue: 21,
    durationUnit: 'days',
    description: 'Single-device locked access key for REVOX PANEL (21 Days validity).',
    available: true
  },
  {
    id: 'plan_30_days',
    name: '30 DAYS ACCESS KEY',
    priceINR: 299,
    currency: 'INR',
    validityLabel: '30 Days',
    durationValue: 30,
    durationUnit: 'days',
    description: 'Single-device locked access key for REVOX PANEL (30 Days validity).',
    available: true
  },
  {
    id: 'plan_permanent',
    name: 'PERMANENT ACCESS KEY',
    priceINR: 499,
    currency: 'INR',
    validityLabel: 'Permanent',
    durationValue: 0,
    durationUnit: 'lifetime',
    description: 'Permanent lifetime single-device locked access key for REVOX PANEL.',
    available: true
  }
];

export function isPlanFullyConfigured(plan: PurchasePlan): boolean {
  const hasName = Boolean(plan.name && plan.name.trim().length > 0);
  const hasPrice = typeof plan.priceINR === 'number' && Number.isFinite(plan.priceINR) && plan.priceINR > 0;
  const hasDuration =
    plan.durationUnit === 'lifetime' ||
    (typeof plan.durationValue === 'number' && Number.isFinite(plan.durationValue) && plan.durationValue > 0);
  return hasName && hasPrice && hasDuration;
}

export function isLegacyUnconfiguredKeyPlans(plans?: PurchasePlan[] | null): boolean {
  if (!Array.isArray(plans) || plans.length === 0) return true;
  const hasUnconfiguredPlaceholder = plans.some(
    p =>
      p.id === 'plan_custom_2' ||
      p.id === 'plan_custom_3' ||
      (p.name && p.name.includes('(Unconfigured)'))
  );
  if (hasUnconfiguredPlaceholder) return true;
  if (
    plans.length === 1 &&
    plans[0].id === 'plan_standard_30d' &&
    plans[0].priceINR === 1
  ) {
    return true;
  }
  return false;
}

export function resolveConfiguredKeyPlans(settings?: SiteSettings | null): PurchasePlan[] {
  const rawPlans =
    settings?.keyPlans && Array.isArray(settings.keyPlans) && settings.keyPlans.length > 0
      ? settings.keyPlans
      : settings?.buttonSettings?.keyPlans &&
        Array.isArray(settings.buttonSettings.keyPlans) &&
        settings.buttonSettings.keyPlans.length > 0
      ? settings.buttonSettings.keyPlans
      : null;

  if (rawPlans && !isLegacyUnconfiguredKeyPlans(rawPlans)) {
    return rawPlans.map((p, idx) => {
      const rawLabel = (p.validityLabel || '').trim();
      const unit = p.durationUnit || 'days';
      const durVal =
        unit === 'lifetime'
          ? 0
          : typeof p.durationValue === 'number' && Number.isFinite(p.durationValue) && p.durationValue > 0
          ? p.durationValue
          : null;
      const resolvedLabel =
        rawLabel && !/^\d+$/.test(rawLabel)
          ? rawLabel
          : formatPlanValidity(rawLabel ? Number(rawLabel) : durVal, unit);

      return {
        id: p.id || `plan_${idx + 1}`,
        name: (p.name || `Plan 0${idx + 1}`).trim(),
        priceINR:
          typeof p.priceINR === 'number' && Number.isFinite(p.priceINR) && p.priceINR > 0
            ? p.priceINR
            : null,
        currency: p.currency || 'INR',
        validityLabel: resolvedLabel,
        durationValue: durVal,
        durationUnit: unit,
        description: (p.description || '').trim(),
        available: Boolean(p.available)
      };
    });
  }

  return DEFAULT_CONFIGURABLE_KEY_PLANS.map(p => ({ ...p }));
}

export function formatPlanValidity(
  durationValue: number | null | undefined,
  durationUnit: 'minutes' | 'hours' | 'days' | 'lifetime' = 'days'
): string {
  if (durationUnit === 'lifetime') return 'Permanent';
  if (typeof durationValue !== 'number' || !Number.isFinite(durationValue) || durationValue <= 0) {
    return 'Configuration Required';
  }
  if (durationUnit === 'minutes') {
    return `${durationValue} Minute${durationValue === 1 ? '' : 's'}`;
  }
  if (durationUnit === 'hours') {
    return `${durationValue} Hour${durationValue === 1 ? '' : 's'}`;
  }
  return `${durationValue} Day${durationValue === 1 ? '' : 's'}`;
}

/**
 * Resolves the configured WhatsApp URL or phone number from project settings or OWNER_WHATSAPP_NUMBER_OR_URL.
 * Does not invent a phone number if unconfigured.
 */
export function resolveWhatsAppPurchaseUrl(
  settings?: SiteSettings | null,
  customMessage: string = WHATSAPP_PURCHASE_MESSAGE
): { configured: boolean; url: string } {
  const encodedMsg = encodeURIComponent(customMessage);

  const candidates = [
    settings?.whatsappUrl,
    settings?.whatsappNumber,
    OWNER_WHATSAPP_NUMBER_OR_URL
  ];

  let raw = '';
  for (const c of candidates) {
    const trimmed = (c || '').trim();
    if (
      trimmed &&
      trimmed !== 'https://wa.me/1234567890' &&
      trimmed !== '1234567890' &&
      trimmed !== 'https://wa.me/'
    ) {
      raw = trimmed;
      break;
    }
  }

  if (!raw) {
    return {
      configured: false,
      url: `https://wa.me/?text=${encodedMsg}`
    };
  }

  const waMeMatch = raw.match(/^(?:https?:\/\/)?(?:www\.)?wa\.me\/([0-9+]+)/i);
  const digitsOnly = raw.replace(/[^0-9]/g, '');

  if (waMeMatch || (!raw.startsWith('http://') && !raw.startsWith('https://'))) {
    let phoneDigits = waMeMatch ? waMeMatch[1].replace(/[^0-9]/g, '') : digitsOnly;
    if (phoneDigits.length === 10 && /^[6-9]/.test(phoneDigits)) {
      phoneDigits = `91${phoneDigits}`;
    }
    if (!phoneDigits) {
      return {
        configured: false,
        url: `https://wa.me/?text=${encodedMsg}`
      };
    }
    return {
      configured: true,
      url: `https://wa.me/${phoneDigits}?text=${encodedMsg}`
    };
  }

  if (raw.includes('whatsapp.com')) {
    const separator = raw.includes('?') ? '&' : '?';
    return {
      configured: true,
      url: raw.includes('text=') ? raw : `${raw}${separator}text=${encodedMsg}`
    };
  }

  const separator = raw.includes('?') ? '&' : '?';
  return {
    configured: true,
    url: `${raw}${separator}text=${encodedMsg}`
  };
}
