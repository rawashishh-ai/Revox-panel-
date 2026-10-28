import { PurchasePlan, SiteSettings } from '../types';

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
  'Hello REVOX, I want to purchase an access key. Please share the available plans and purchase details.';

/**
 * Configurable Purchase Plan Templates.
 * Plan 1 reads existing plan data from the project (₹199 / 30 Days).
 * Additional plan slots are marked as requiring configuration until updated by the owner in Admin Panel.
 */
export const DEFAULT_CONFIGURABLE_KEY_PLANS: PurchasePlan[] = [
  {
    id: 'plan_standard_30d',
    name: 'REVOX ACCESS KEY',
    priceINR: 99,
    currency: 'INR',
    validityLabel: '30 Days Validity',
    durationValue: 30,
    durationUnit: 'days',
    description: 'Single-device locked access key for REVOX PANEL.',
    available: true
  },
  {
    id: 'plan_custom_2',
    name: 'Plan 02 (Unconfigured)',
    priceINR: null,
    currency: 'INR',
    validityLabel: 'Configuration Required',
    durationValue: null,
    durationUnit: 'days',
    description: 'Requires administrator configuration in Admin Panel before purchase.',
    available: false
  },
  {
    id: 'plan_custom_3',
    name: 'Plan 03 (Unconfigured)',
    priceINR: null,
    currency: 'INR',
    validityLabel: 'Configuration Required',
    durationValue: null,
    durationUnit: 'days',
    description: 'Requires administrator configuration in Admin Panel before purchase.',
    available: false
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

export function resolveConfiguredKeyPlans(settings?: SiteSettings | null): PurchasePlan[] {
  const rawPlans =
    settings?.keyPlans && Array.isArray(settings.keyPlans) && settings.keyPlans.length > 0
      ? settings.keyPlans
      : settings?.buttonSettings?.keyPlans &&
        Array.isArray(settings.buttonSettings.keyPlans) &&
        settings.buttonSettings.keyPlans.length > 0
      ? settings.buttonSettings.keyPlans
      : null;

  if (rawPlans) {
    return rawPlans.map((p, idx) => {
      const rawLabel = (p.validityLabel || '').trim();
      const unit = p.durationUnit || 'days';
      const durVal =
        typeof p.durationValue === 'number' && Number.isFinite(p.durationValue) && p.durationValue > 0
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

  // Read existing plan configuration from SiteSettings (keyPriceINR & keySaleDurationDays) if present
  const existingPrice =
    typeof settings?.keyPriceINR === 'number' && settings.keyPriceINR > 0
      ? settings.keyPriceINR
      : typeof settings?.buttonSettings?.keyPriceINR === 'number' && settings.buttonSettings.keyPriceINR > 0
      ? settings.buttonSettings.keyPriceINR
      : DEFAULT_CONFIGURABLE_KEY_PLANS[0].priceINR;

  const existingDuration =
    typeof settings?.keySaleDurationDays === 'number' && settings.keySaleDurationDays > 0
      ? settings.keySaleDurationDays
      : typeof settings?.buttonSettings?.keySaleDurationDays === 'number' &&
        settings.buttonSettings.keySaleDurationDays > 0
      ? settings.buttonSettings.keySaleDurationDays
      : DEFAULT_CONFIGURABLE_KEY_PLANS[0].durationValue;

  const existingEnabled =
    settings?.keySalesEnabled !== undefined
      ? Boolean(settings.keySalesEnabled)
      : settings?.buttonSettings?.keySalesEnabled !== undefined
      ? Boolean(settings.buttonSettings.keySalesEnabled)
      : true;

  return [
    {
      ...DEFAULT_CONFIGURABLE_KEY_PLANS[0],
      priceINR: existingPrice ?? null,
      durationValue: existingDuration ?? null,
      validityLabel: formatPlanValidity(existingDuration, 'days'),
      available: existingEnabled && Boolean(existingPrice && existingDuration)
    },
    ...DEFAULT_CONFIGURABLE_KEY_PLANS.slice(1)
  ];
}

export function formatPlanValidity(
  durationValue: number | null | undefined,
  durationUnit: 'minutes' | 'hours' | 'days' | 'lifetime' = 'days'
): string {
  if (durationUnit === 'lifetime') return 'Lifetime Validity';
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
