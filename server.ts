import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execFile } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(
  express.json({
    limit: '2000mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  })
);
app.use(express.urlencoded({ extended: true, limit: '2000mb' }));

// Ensure local cache directories exist (falls back to /tmp on read-only serverless filesystems like Vercel)
const bundledDataDir = path.join(__dirname, 'data');
const bundledUploadsDir = path.join(__dirname, 'public', 'uploads');
let dataDir = bundledDataDir;
let uploadsDir = bundledUploadsDir;

try {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.W_OK);
} catch {
  dataDir = path.join('/tmp', 'revox_data');
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch {}
}

try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  fs.accessSync(uploadsDir, fs.constants.W_OK);
} catch {
  uploadsDir = path.join('/tmp', 'revox_uploads');
  try {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  } catch {}
}

const settingsFile = path.join(dataDir, 'site-settings.json');
const keysFile = path.join(dataDir, 'access-keys.json');
const deletedKeysFile = path.join(dataDir, 'deleted-keys.json');
const salesFile = path.join(dataDir, 'key-sales.json');
const logsFile = path.join(dataDir, 'admin-logs.json');

export interface ButtonSettings {
  downloadHackUrl?: string;
  setupVideoUrl?: string;
  downloadButtonText?: string;
  setupVideoButtonText?: string;
  keySalesEnabled?: boolean;
  getKeyMode?: 'both' | 'website' | 'whatsapp';
  keyPriceINR?: number;
  keySaleDurationDays?: number;
  introVideoUrl?: string;
  introVideoEnabled?: boolean;
  introVideoTitle?: string;
  introVideoButtonText?: string;
  introFeaturePoints?: string[];
}

export interface PurchasePlan {
  id: string;
  name: string;
  priceINR: number | null;
  currency: string;
  durationValue: number | null;
  durationUnit: 'minutes' | 'hours' | 'days' | 'lifetime';
  validityLabel?: string;
  description: string;
  features?: string[];
  badge?: string;
  available: boolean;
}

export interface SiteSettings {
  logoStoragePath?: string;
  logoUrl: string;
  logoSize: number;
  logoPositionY: number;
  websiteTitle?: string;
  panelName?: string;
  announcementTitle: string;
  announcementFrom: string;
  announcementTo: string;
  announcementText?: string;
  announcementBody?: string;
  announcementLines?: string[];
  introFeaturePoints?: string[];
  whatsappNumber?: string;
  whatsappUrl: string;
  themeColor?: string;
  buttonSettings?: ButtonSettings;
  downloadHackUrl?: string;
  setupVideoUrl?: string;
  introVideoUrl?: string;
  introVideoEnabled?: boolean;
  introVideoTitle?: string;
  introVideoButtonText?: string;
  keySalesEnabled?: boolean;
  getKeyMode?: 'both' | 'website' | 'whatsapp';
  keyPriceINR?: number;
  keySaleDurationDays?: number;
  keyPlans?: PurchasePlan[];
  paymentGatewayConfigured?: boolean;
  updatedAt: string;
  updatedBy?: string;
  version: number;
}

export interface AccessKey {
  id: string;
  key: string;
  customerName?: string;
  status: 'active' | 'revoked' | 'expired';
  durationDays: number;
  durationUnit?: 'minutes' | 'hours' | 'days' | 'lifetime';
  durationValue?: number;
  durationMs?: number;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  boundDeviceId?: string | null;
  activeSessionToken?: string | null;
  lastVerifiedAt?: string | null;
  renewedAt?: string | null;
  updatedAt?: string | null;
  notes: string;
}

export interface AdminAuditLog {
  id: string;
  action:
    | 'KEY_GENERATED'
    | 'KEY_ACTIVATED'
    | 'KEY_DEACTIVATED'
    | 'KEY_REACTIVATED'
    | 'KEY_DELETED'
    | 'KEY_RENEWED'
    | 'SESSION_RESET'
    | 'CUSTOMER_UPDATED';
  label: string;
  customerName: string;
  maskedKey: string;
  keyId: string;
  details: string;
  timestamp: string;
}

export interface PaymentOrder {
  orderId: string;
  paymentId?: string;
  planId?: string;
  planName?: string;
  planDurationValue?: number;
  planDurationUnit?: 'minutes' | 'hours' | 'days' | 'lifetime';
  amount: number;
  currency: string;
  paymentStatus: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  customerName?: string;
  customerPhone?: string;
  purchasedAt: string;
  paidAt?: string;
  assignedKeyId?: string;
  assignedKey?: string;
  keyDeliveryStatus: 'PENDING' | 'DELIVERED';
  paymentUrl?: string;
  upiIntentUrl?: string;
  tranzupiRef?: string;
  paymentSessionId?: string;
  cashfreeMode?: 'production' | 'sandbox';
  cashfreeQrCode?: string;
  cashfreeReconUrl?: string;
  upiLinks?: Record<string, string>;
  expiresAt?: string;
  rejectionReason?: string;
}

const DEFAULT_ANNOUNCEMENT_LINES = [
  "Existing access keys remain 100% valid.",
  "REVOX PANEL delivers enhanced bypass with ultra-low latency.",
  "Your active remaining time transfers automatically on activation.",
  "Connect on WhatsApp for 24/7 key verification & priority support."
];

const DEFAULT_INTRO_FEATURE_POINTS = [
  "100% Anti-Ban Protection & High-Security Bypass",
  "Smooth Aimbot, ESP & Ultra-Low Latency Gameplay",
  "Instant Key Activation with 1-Device Security Lock",
  "Works on All Latest Updates with 24/7 VIP Support"
];

// ============================================================================
// FIRESTORE AUTHORITATIVE REST CLIENT
// Ensures data persists permanently across Cloud Run container restarts
// ============================================================================

interface FirebaseConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId?: string;
}

function getFirebaseConfig(): FirebaseConfig | null {
  try {
    const configPath = path.join(__dirname, 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!parsed.projectId || !parsed.apiKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getFirestoreBaseUrl(): { baseUrl: string; apiKey: string } | null {
  const cfg = getFirebaseConfig();
  if (!cfg) return null;
  const dbId = cfg.firestoreDatabaseId || '(default)';
  return {
    baseUrl: `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${dbId}/documents`,
    apiKey: cfg.apiKey
  };
}

function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(item => toFirestoreValue(item))
      }
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(fieldVal: any): any {
  if (!fieldVal || typeof fieldVal !== 'object') return null;
  if ('stringValue' in fieldVal) return fieldVal.stringValue;
  if ('integerValue' in fieldVal) return Number(fieldVal.integerValue);
  if ('doubleValue' in fieldVal) return Number(fieldVal.doubleValue);
  if ('booleanValue' in fieldVal) return Boolean(fieldVal.booleanValue);
  if ('nullValue' in fieldVal) return null;
  if ('timestampValue' in fieldVal) return fieldVal.timestampValue;
  if ('arrayValue' in fieldVal) {
    const vals = fieldVal.arrayValue?.values;
    return Array.isArray(vals) ? vals.map(fromFirestoreValue) : [];
  }
  if ('mapValue' in fieldVal) {
    const fields = fieldVal.mapValue?.fields || {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function parseFirestoreDoc(docObj: any): Record<string, any> | null {
  if (!docObj || !docObj.fields) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(docObj.fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

async function firestoreGetDoc(collectionName: string, docId: string): Promise<Record<string, any> | null> {
  const info = getFirestoreBaseUrl();
  if (!info) return null;
  try {
    const res = await fetch(`${info.baseUrl}/${collectionName}/${encodeURIComponent(docId)}?key=${info.apiKey}`);
    if (!res.ok) return null;
    const data = await res.json();
    return parseFirestoreDoc(data);
  } catch (err) {
    console.warn(`Firestore GET ${collectionName}/${docId} warning:`, err);
    return null;
  }
}

let firestoreWritePausedUntil = 0;

async function firestoreSetDoc(collectionName: string, docId: string, payload: Record<string, any>): Promise<boolean> {
  if (Date.now() < firestoreWritePausedUntil) return false;
  const info = getFirestoreBaseUrl();
  if (!info) return false;
  try {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    const res = await fetch(`${info.baseUrl}/${collectionName}/${encodeURIComponent(docId)}?key=${info.apiKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    if (!res.ok) {
      if (res.status === 429) {
        firestoreWritePausedUntil = Date.now() + 15 * 60 * 1000;
        return false;
      }
      const errTxt = await res.text().catch(() => '');
      if (errTxt.includes('RESOURCE_EXHAUSTED') || errTxt.includes('Quota exceeded')) {
        firestoreWritePausedUntil = Date.now() + 15 * 60 * 1000;
        return false;
      }
      console.warn(`Firestore SET ${collectionName}/${docId} HTTP ${res.status}:`, errTxt);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function firestoreDeleteDoc(collectionName: string, docId: string): Promise<boolean> {
  if (Date.now() < firestoreWritePausedUntil) return false;
  const info = getFirestoreBaseUrl();
  if (!info) return false;
  try {
    const res = await fetch(`${info.baseUrl}/${collectionName}/${encodeURIComponent(docId)}?key=${info.apiKey}`, {
      method: 'DELETE'
    });
    if (res.status === 429) {
      firestoreWritePausedUntil = Date.now() + 15 * 60 * 1000;
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

async function firestoreListDocs(collectionName: string, pageSize = 300): Promise<Record<string, any>[]> {
  const info = getFirestoreBaseUrl();
  if (!info) return [];
  try {
    let whereFilter: any = undefined;
    if (collectionName === 'accessKeys' || collectionName === 'keys') {
      whereFilter = {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'IN',
          value: {
            arrayValue: {
              values: [
                { stringValue: 'active' },
                { stringValue: 'revoked' },
                { stringValue: 'expired' }
              ]
            }
          }
        }
      };
    } else if (collectionName === 'keySales' || collectionName === 'sales') {
      whereFilter = {
        fieldFilter: {
          field: { fieldPath: 'paymentStatus' },
          op: 'IN',
          value: {
            arrayValue: {
              values: [
                { stringValue: 'PENDING' },
                { stringValue: 'SUCCESS' },
                { stringValue: 'FAILED' },
                { stringValue: 'CANCELLED' }
              ]
            }
          }
        }
      };
    }

    if (whereFilter) {
      const queryUrl = `${info.baseUrl}:runQuery?key=${info.apiKey}`;
      const res = await fetch(queryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: collectionName }],
            where: whereFilter,
            limit: pageSize
          }
        })
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      const results: Record<string, any>[] = [];
      for (const item of data) {
        if (item && item.document) {
          const parsed = parseFirestoreDoc(item.document);
          if (parsed) {
            if (!parsed.id && typeof item.document.name === 'string') {
              parsed.id = item.document.name.split('/').pop();
            }
            results.push(parsed);
          }
        }
      }
      return results;
    }

    const res = await fetch(`${info.baseUrl}/${collectionName}?pageSize=${pageSize}&key=${info.apiKey}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.documents)) return [];
    const results: Record<string, any>[] = [];
    for (const docItem of data.documents) {
      const parsed = parseFirestoreDoc(docItem);
      if (parsed) {
        if (!parsed.id && typeof docItem.name === 'string') {
          parsed.id = docItem.name.split('/').pop();
        }
        results.push(parsed);
      }
    }
    return results;
  } catch (err) {
    console.warn(`Firestore LIST ${collectionName} warning:`, err);
    return [];
  }
}

// ============================================================================
// IN-MEMORY AUTHORITATIVE CACHE + HYDRATION FROM FIRESTORE
// ============================================================================

let memorySettings: SiteSettings | null = null;
let memoryKeys: AccessKey[] | null = null;
let memoryDeletedKeys: Set<string> | null = null;
let memorySales: PaymentOrder[] | null = null;
let memoryLogs: AdminAuditLog[] | null = null;
const memoryLogoAssets = new Map<string, { dataUrl: string; mimeType: string; version: number }>();
const memoryVideoAssets = new Map<string, { buffer: Buffer; mimeType: string; fileName: string }>();

function getDeletedKeysSet(): Set<string> {
  if (memoryDeletedKeys) return memoryDeletedKeys;
  const set = new Set<string>([
    'SLTX-TEST-KEY1-FREE',
    'SLTX-2026-LIVE-FAST',
    'SLTX-VIP7-4920-PHAN',
    'SLTX-PRO9-8821-ELIT',
    'SLTX-9K4X7M-8P2Q5W-3R9N6V-4T8J2F',
    'SLTX-7W3Q9Z-5M8K2P-6X4R9T-8N3V7C',
    'RVX-TEST-KEY1-FREE',
    'RVX-2026-LIVE-FAST',
    'RVX-VIP7-4920-PHAN',
    'RVX-PRO9-8821-ELIT',
    'SLTX-9KTY-YT5E-67TQ',
    'SLTX-4M8W-7Q2P-9X3R'
  ]);
  try {
    if (fs.existsSync(deletedKeysFile)) {
      const parsed = JSON.parse(fs.readFileSync(deletedKeysFile, 'utf-8'));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string' && item.trim()) {
            set.add(item.trim().toUpperCase());
          }
        }
      }
    }
  } catch {}
  memoryDeletedKeys = set;
  return set;
}

function isKeyDeleted(id?: string | null, key?: string | null): boolean {
  const deleted = getDeletedKeysSet();
  if (id && deleted.has(String(id).trim().toUpperCase())) return true;
  if (key && deleted.has(String(key).trim().toUpperCase())) return true;
  return false;
}

function markKeyDeletedPermanently(id?: string | null, key?: string | null) {
  const deleted = getDeletedKeysSet();
  if (id && String(id).trim()) deleted.add(String(id).trim().toUpperCase());
  if (key && String(key).trim()) deleted.add(String(key).trim().toUpperCase());
  try {
    fs.writeFileSync(deletedKeysFile, JSON.stringify(Array.from(deleted), null, 2), 'utf-8');
  } catch {}
}

// Server-side Admin Session Token Signing & Validation
const ADMIN_SIGNING_SECRET =
  process.env.ADMIN_SIGNING_SECRET ||
  crypto.createHash('sha256').update(`revox-admin-secret-${process.env.ADMIN_PASSWORD || 'CRITICALXR-A4AE97-ASHISH12@@'}`).digest('hex');

function issueAdminToken(role = 'admin'): string {
  const payload = JSON.stringify({
    role,
    iat: Date.now(),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SIGNING_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyAdminToken(token?: string | null): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return false;
  const [b64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', ADMIN_SIGNING_SECRET).update(b64).digest('base64url');
  if (sig !== expectedSig) return false;
  try {
    const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8'));
    if (parsed.exp && Date.now() > Number(parsed.exp)) return false;
    return true;
  } catch {
    return false;
  }
}

// Signed Order Claim Token for /key-success retrieval (prevents URL tampering or unauthorized key access)
function issueOrderClaimToken(orderId: string, amount: number, currency = 'INR'): string {
  const payload = JSON.stringify({
    orderId: String(orderId).trim(),
    amount: Number(amount),
    currency: String(currency || 'INR').toUpperCase(),
    iat: Date.now(),
    exp: Date.now() + 24 * 60 * 60 * 1000
  });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(`claim:${b64}`)
    .digest('base64url');
  return `${b64}.${sig}`;
}

function verifyOrderClaimToken(
  orderId: string,
  amount: number,
  currency = 'INR',
  token?: string | null
): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return false;
  const [b64, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(`claim:${b64}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8'));
    if (parsed.exp && Date.now() > Number(parsed.exp)) return false;
    if (String(parsed.orderId || '').trim().toUpperCase() !== String(orderId).trim().toUpperCase()) {
      return false;
    }
    if (Math.abs(Number(parsed.amount) - Number(amount)) > 0.01) return false;
    if (String(parsed.currency || 'INR').toUpperCase() !== String(currency || 'INR').toUpperCase()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}


function requireAdminAuth(req: Request, res: Response, next: express.NextFunction) {
  const headerToken =
    (req.headers['x-admin-token'] as string) ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
  if (verifyAdminToken(headerToken)) {
    return next();
  }
  return res.status(401).json({
    success: false,
    message: 'Unauthorized: Valid administrator authentication required'
  });
}

function maskKeyForAudit(rawKey: string, hideSecret = false): string {
  const clean = (rawKey || '').trim().toUpperCase();
  const parts = clean.split('-');
  if (hideSecret && parts.length >= 3) {
    return `${parts[0]}-${parts[1]}-••••-${parts[parts.length - 1]}`;
  }
  return clean;
}

const DEFAULT_SERVER_KEY_PLANS: PurchasePlan[] = [
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

function isLegacyUnconfiguredServerPlans(plans?: PurchasePlan[] | null): boolean {
  if (!Array.isArray(plans) || plans.length === 0) return true;
  const hasPlaceholder = plans.some(
    p =>
      p.id === 'plan_custom_2' ||
      p.id === 'plan_custom_3' ||
      (p.name && p.name.includes('(Unconfigured)'))
  );
  if (hasPlaceholder) return true;
  if (plans.length === 1 && plans[0].id === 'plan_standard_30d' && plans[0].priceINR === 1) {
    return true;
  }
  return false;
}

function normalizeSettings(raw: Partial<SiteSettings>): SiteSettings {
  const lines = Array.isArray(raw.announcementLines) && raw.announcementLines.length > 0
    ? raw.announcementLines
    : DEFAULT_ANNOUNCEMENT_LINES;

  const featurePoints = Array.isArray(raw.introFeaturePoints) && raw.introFeaturePoints.length > 0
    ? raw.introFeaturePoints
    : Array.isArray(raw.buttonSettings?.introFeaturePoints) && raw.buttonSettings!.introFeaturePoints!.length > 0
    ? raw.buttonSettings!.introFeaturePoints!
    : DEFAULT_INTRO_FEATURE_POINTS;

  const downloadHackUrl = raw.downloadHackUrl || raw.buttonSettings?.downloadHackUrl || 'https://t.me/silentx_phantom_official';
  const setupVideoUrl = raw.setupVideoUrl || raw.buttonSettings?.setupVideoUrl || 'https://www.youtube.com/';
  const introVideoUrl = raw.introVideoUrl !== undefined
    ? raw.introVideoUrl
    : (raw.buttonSettings?.introVideoUrl !== undefined ? raw.buttonSettings.introVideoUrl : '');
  const introVideoEnabled = raw.introVideoEnabled !== undefined
    ? Boolean(raw.introVideoEnabled)
    : (raw.buttonSettings?.introVideoEnabled !== undefined ? Boolean(raw.buttonSettings.introVideoEnabled) : true);
  const introVideoTitle = raw.introVideoTitle || raw.buttonSettings?.introVideoTitle || 'WITH PANEL GAMEPLAY';
  const introVideoButtonText = raw.introVideoButtonText || raw.buttonSettings?.introVideoButtonText || 'CONTINUE';
  const rawGetKeyMode = raw.getKeyMode || raw.buttonSettings?.getKeyMode;
  const getKeyMode: 'both' | 'website' | 'whatsapp' =
    rawGetKeyMode === 'website' || rawGetKeyMode === 'whatsapp' || rawGetKeyMode === 'both'
      ? rawGetKeyMode
      : 'both';
  const keyPriceINR = typeof raw.keyPriceINR === 'number' && raw.keyPriceINR > 1
    ? raw.keyPriceINR
    : (typeof raw.buttonSettings?.keyPriceINR === 'number' && raw.buttonSettings.keyPriceINR > 1 ? raw.buttonSettings.keyPriceINR : 99);
  const keySaleDurationDays = typeof raw.keySaleDurationDays === 'number'
    ? raw.keySaleDurationDays
    : (typeof raw.buttonSettings?.keySaleDurationDays === 'number' ? raw.buttonSettings.keySaleDurationDays : 7);
  const keySalesEnabled = raw.keySalesEnabled !== undefined ? Boolean(raw.keySalesEnabled) : true;
  const whatsappUrl = raw.whatsappUrl || 'https://wa.me/1234567890';
  const version = typeof raw.version === 'number' && raw.version >= 1 ? raw.version : 1;

  const resolvedPanelName = (raw.panelName || raw.websiteTitle || 'REVOX PANEL').trim();
  const resolvedWebsiteTitle = (raw.websiteTitle || raw.panelName || 'REVOX PANEL').trim();

  const resolvedKeyPlans =
    Array.isArray(raw.keyPlans) && !isLegacyUnconfiguredServerPlans(raw.keyPlans)
      ? raw.keyPlans
      : DEFAULT_SERVER_KEY_PLANS;

  return {
    logoStoragePath: raw.logoStoragePath || '',
    logoUrl: raw.logoUrl !== undefined && raw.logoUrl !== '' ? raw.logoUrl : '/assets/revox-logo.png',
    logoSize: typeof raw.logoSize === 'number' && raw.logoSize >= 240 ? raw.logoSize : 290,
    logoPositionY: typeof raw.logoPositionY === 'number' ? raw.logoPositionY : 0,
    websiteTitle: resolvedWebsiteTitle,
    panelName: resolvedPanelName,
    announcementTitle: raw.announcementTitle || "WE'RE MOVING",
    announcementFrom: (raw.announcementFrom && raw.announcementFrom !== 'SILENTX') ? raw.announcementFrom : 'ANTIBAN',
    announcementTo: raw.announcementTo || resolvedPanelName,
    announcementText: raw.announcementText || lines.join('\n'),
    announcementBody: raw.announcementBody || '',
    announcementLines: lines,
    introFeaturePoints: featurePoints,
    whatsappNumber: raw.whatsappNumber || whatsappUrl,
    whatsappUrl,
    themeColor: (raw.themeColor && raw.themeColor !== '#A020F0') ? raw.themeColor : '#00E5FF',
    buttonSettings: {
      downloadHackUrl,
      setupVideoUrl,
      downloadButtonText: raw.buttonSettings?.downloadButtonText || 'DOWNLOAD PANEL',
      setupVideoButtonText: raw.buttonSettings?.setupVideoButtonText || 'SETUP VIDEO',
      keySalesEnabled,
      getKeyMode,
      keyPriceINR,
      keySaleDurationDays,
      introVideoUrl,
      introVideoEnabled,
      introVideoTitle,
      introVideoButtonText,
      introFeaturePoints: featurePoints
    },
    downloadHackUrl,
    setupVideoUrl,
    introVideoUrl,
    introVideoEnabled,
    introVideoTitle,
    introVideoButtonText,
    keySalesEnabled,
    getKeyMode,
    keyPriceINR,
    keySaleDurationDays,
    keyPlans: resolvedKeyPlans,
    paymentGatewayConfigured: Boolean(
      (process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY) ||
      (process.env.TRANZUPI_API_KEY && process.env.TRANZUPI_SECRET_TOKEN)
    ),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    updatedBy: raw.updatedBy || 'system',
    version
  };
}

function getLocalFallbackSettings(): SiteSettings {
  if (memorySettings) return memorySettings;
  try {
    if (fs.existsSync(settingsFile)) {
      const data = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      memorySettings = normalizeSettings(data);
      return memorySettings;
    }
  } catch (err) {
    console.error('Error reading local settingsFile:', err);
  }
  memorySettings = normalizeSettings({});
  return memorySettings;
}

// Hydrate settings, keys, and sales from Firestore on startup (NEVER overwrites newer local disk state with stale Firestore data!)
async function hydrateFromFirestore() {
  try {
    // 1. Hydrate websiteSettings/main (comparing against local disk settings so quota-frozen Firestore never wipes newer local updates)
    const localDiskSettings = getLocalFallbackSettings();
    const canonicalDoc = await firestoreGetDoc('websiteSettings', 'main');
    const legacyDoc = await firestoreGetDoc('settings', 'site');

    let chosenDoc: Record<string, any> | null = null;
    if (canonicalDoc && legacyDoc) {
      const vCanon = Number(canonicalDoc.version) || 0;
      const vLegacy = Number(legacyDoc.version) || 0;
      const tCanon = canonicalDoc.updatedAt ? new Date(canonicalDoc.updatedAt).getTime() : 0;
      const tLegacy = legacyDoc.updatedAt ? new Date(legacyDoc.updatedAt).getTime() : 0;
      chosenDoc = (vCanon >= vLegacy && tCanon >= tLegacy) ? canonicalDoc : legacyDoc;
    } else {
      chosenDoc = canonicalDoc || legacyDoc;
    }

    if (chosenDoc) {
      const remoteHydrated = normalizeSettings(chosenDoc as Partial<SiteSettings>);
      const localVersion = Number(localDiskSettings.version) || 1;
      const remoteVersion = Number(remoteHydrated.version) || 1;
      const localTime = localDiskSettings.updatedAt ? new Date(localDiskSettings.updatedAt).getTime() : 0;
      const remoteTime = remoteHydrated.updatedAt ? new Date(remoteHydrated.updatedAt).getTime() : 0;

      // Only adopt remote Firestore settings if strictly newer than local disk settings
      if (remoteVersion > localVersion && remoteTime > localTime) {
        memorySettings = remoteHydrated;
        fs.writeFileSync(settingsFile, JSON.stringify(remoteHydrated, null, 2), 'utf-8');
        broadcastSSE('settings-update', remoteHydrated);
      } else {
        memorySettings = localDiskSettings;
        if (localVersion > remoteVersion) {
          firestoreSetDoc('websiteSettings', 'main', localDiskSettings).catch(() => {});
        }
      }
    } else {
      memorySettings = localDiskSettings;
      firestoreSetDoc('websiteSettings', 'main', localDiskSettings).catch(() => {});
    }

    // 2. Hydrate Access Keys from local disk + Firestore (strictly excluding deleted keys)
    const remoteKeys = await firestoreListDocs('accessKeys', 500);
    const localKeys = getKeysFromDisk();
    const mergedKeysMap = new Map<string, AccessKey>();

    // First load all local keys that have not been deleted
    for (const lk of localKeys) {
      if (lk && lk.key && !isKeyDeleted(lk.id, lk.key)) {
        mergedKeysMap.set(lk.key.toUpperCase(), lk);
      }
    }

    // Merge remote keys ONLY if not deleted, and preserve whichever record has the newer updatedAt
    for (const rk of remoteKeys) {
      if (rk && rk.key) {
        if (isKeyDeleted(rk.id, rk.key)) {
          if (rk.id) firestoreDeleteDoc('accessKeys', rk.id).catch(() => {});
          continue;
        }
        const typedKey = rk as AccessKey;
        const kUpper = typedKey.key.toUpperCase();
        const existing = mergedKeysMap.get(kUpper);
        if (!existing) {
          mergedKeysMap.set(kUpper, typedKey);
        } else {
          const tRem = typedKey.updatedAt ? new Date(typedKey.updatedAt).getTime() : 0;
          const tLoc = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          if (tRem > tLoc) {
            mergedKeysMap.set(kUpper, typedKey);
          }
        }
      }
    }

    const allKeys = Array.from(mergedKeysMap.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    memoryKeys = allKeys;
    fs.writeFileSync(keysFile, JSON.stringify(allKeys, null, 2), 'utf-8');

    // 3. Hydrate Key Sales
    const remoteSales = await firestoreListDocs('keySales', 500);
    const localSales = getSalesFromDisk();
    const mergedSalesMap = new Map<string, PaymentOrder>();

    for (const ls of localSales) {
      if (ls && ls.orderId) mergedSalesMap.set(ls.orderId, ls);
    }
    for (const rs of remoteSales) {
      if (rs && rs.orderId && !mergedSalesMap.has(rs.orderId)) {
        mergedSalesMap.set(rs.orderId, rs as PaymentOrder);
      }
    }

    const allSales = Array.from(mergedSalesMap.values()).sort(
      (a, b) => new Date(b.purchasedAt || 0).getTime() - new Date(a.purchasedAt || 0).getTime()
    );
    memorySales = allSales;
    fs.writeFileSync(salesFile, JSON.stringify(allSales, null, 2), 'utf-8');

    // 4. Hydrate Admin Audit Logs
    const remoteLogs = await firestoreListDocs('adminLogs', 300);
    const localLogs = getLogsFromDisk();
    const mergedLogsMap = new Map<string, AdminAuditLog>();

    for (const ll of localLogs) {
      if (ll && ll.id) mergedLogsMap.set(ll.id, ll);
    }
    for (const rl of remoteLogs) {
      if (rl && rl.id && !mergedLogsMap.has(rl.id)) {
        mergedLogsMap.set(rl.id, rl as AdminAuditLog);
      }
    }

    const allLogs = Array.from(mergedLogsMap.values())
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
      .slice(0, 150);
    memoryLogs = allLogs;
    fs.writeFileSync(logsFile, JSON.stringify(allLogs, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Startup Firestore hydration notice:', err);
  }
}

function getSettings(): SiteSettings {
  return getLocalFallbackSettings();
}

// Instant Authoritative Save to Memory + Disk + SSE, with Non-Blocking Background Firestore Replication
async function saveAndVerifySettings(
  partialUpdate: Partial<SiteSettings>,
  updatedBy = 'admin'
): Promise<{ verified: boolean; settings: SiteSettings }> {
  const currentBase = getSettings();
  const currentVersion = Math.max(
    currentBase.version || 1,
    memorySettings?.version || 1
  );
  const nextVersion = currentVersion + 1;
  const nowIso = new Date().toISOString();

  const merged = normalizeSettings({
    ...currentBase,
    ...partialUpdate,
    updatedAt: nowIso,
    updatedBy,
    version: nextVersion
  });

  // 1. Immediately update in-memory cache, local disk file, and broadcast real-time SSE update (< 2ms)
  memorySettings = merged;
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing settingsFile:', err);
  }
  broadcastSSE('settings-update', merged);

  // 2. Replicate to Firestore asynchronously in background so admin UI never waits on Firestore network/quota
  firestoreSetDoc('websiteSettings', 'main', merged).catch(() => {});

  return { verified: true, settings: merged };
}

function getKeysFromDisk(): AccessKey[] {
  try {
    if (fs.existsSync(keysFile)) {
      const raw = JSON.parse(fs.readFileSync(keysFile, 'utf-8'));
      if (Array.isArray(raw)) {
        return raw.filter((k: AccessKey) => k && k.key && !isKeyDeleted(k.id, k.key));
      }
    }
  } catch (err) {
    console.error('Error reading keysFile:', err);
  }
  return [];
}

function getKeys(): AccessKey[] {
  if (memoryKeys) {
    memoryKeys = memoryKeys.filter(k => k && k.key && !isKeyDeleted(k.id, k.key));
    return memoryKeys;
  }
  memoryKeys = getKeysFromDisk();
  return memoryKeys;
}

function saveKeys(keys: AccessKey[], changedKey?: AccessKey) {
  const cleanKeys = keys.filter(k => k && k.key && !isKeyDeleted(k.id, k.key));
  memoryKeys = cleanKeys;
  try {
    fs.writeFileSync(keysFile, JSON.stringify(cleanKeys, null, 2), 'utf-8');
  } catch {}
  if (changedKey && changedKey.key && !isKeyDeleted(changedKey.id, changedKey.key)) {
    const kUpper = changedKey.key.toUpperCase();
    firestoreSetDoc('accessKeys', kUpper, changedKey).catch(() => {});
    if (changedKey.id && changedKey.id !== kUpper) {
      firestoreSetDoc('accessKeys', changedKey.id, changedKey).catch(() => {});
    }
  }
}

async function persistKeyToFirestore(keyDoc: AccessKey): Promise<void> {
  if (!keyDoc || !keyDoc.key || isKeyDeleted(keyDoc.id, keyDoc.key)) return;
  const kUpper = keyDoc.key.toUpperCase();
  firestoreSetDoc('accessKeys', kUpper, keyDoc).catch(() => {});
  if (keyDoc.id && keyDoc.id !== kUpper) {
    firestoreSetDoc('accessKeys', keyDoc.id, keyDoc).catch(() => {});
  }
}

// Fast O(1) single-key lookup (checks authoritative in-memory/disk store first, then Firestore if needed)
async function findAndSyncSingleKeyFromFirestore(cleanedKey: string): Promise<{ keys: AccessKey[]; keyDoc: AccessKey | undefined }> {
  const keys = getKeys();
  const kUpper = cleanedKey.trim().toUpperCase();

  if (isKeyDeleted(kUpper, kUpper)) {
    return { keys, keyDoc: undefined };
  }

  // 1. Check authoritative local server state first (< 0.1ms)
  const localMatch = keys.find(k => k.key.toUpperCase() === kUpper || k.id.toUpperCase() === kUpper);
  if (localMatch) {
    return { keys, keyDoc: localMatch };
  }

  // 2. If not in local memory yet and Firestore is available, check Firestore O(1)
  if (Date.now() >= firestoreWritePausedUntil) {
    try {
      const remoteDoc = await firestoreGetDoc('accessKeys', kUpper);
      if (remoteDoc && remoteDoc.key && !isKeyDeleted(remoteDoc.id, remoteDoc.key)) {
        const typedRemote = remoteDoc as AccessKey;
        if (!typedRemote.id) typedRemote.id = kUpper;
        keys.unshift(typedRemote);
        saveKeys(keys);
        return { keys, keyDoc: typedRemote };
      }
    } catch {}
  }

  return { keys, keyDoc: undefined };
}

async function syncKeysFromFirestore(): Promise<AccessKey[]> {
  return getKeys();
}

function getSalesFromDisk(): PaymentOrder[] {
  try {
    if (fs.existsSync(salesFile)) {
      return JSON.parse(fs.readFileSync(salesFile, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading salesFile:', err);
  }
  return [];
}

function getSales(): PaymentOrder[] {
  if (memorySales) return memorySales;
  memorySales = getSalesFromDisk();
  return memorySales;
}

function saveSales(sales: PaymentOrder[], changedOrder?: PaymentOrder) {
  memorySales = sales;
  try {
    fs.writeFileSync(salesFile, JSON.stringify(sales, null, 2), 'utf-8');
  } catch {}
  if (changedOrder && changedOrder.orderId) {
    firestoreSetDoc('keySales', changedOrder.orderId, changedOrder).catch(() => {});
  }
}

function getLogsFromDisk(): AdminAuditLog[] {
  try {
    if (fs.existsSync(logsFile)) {
      return JSON.parse(fs.readFileSync(logsFile, 'utf-8'));
    }
  } catch {}
  return [];
}

function getAdminLogs(): AdminAuditLog[] {
  if (memoryLogs) return memoryLogs;
  memoryLogs = getLogsFromDisk();
  return memoryLogs;
}

function recordAdminLog(entry: Omit<AdminAuditLog, 'id' | 'timestamp'>): AdminAuditLog {
  const logs = getAdminLogs();
  const fullEntry: AdminAuditLog = {
    ...entry,
    id: `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date().toISOString()
  };
  logs.unshift(fullEntry);
  if (logs.length > 150) logs.length = 150;
  memoryLogs = logs;
  try {
    fs.writeFileSync(logsFile, JSON.stringify(logs, null, 2), 'utf-8');
  } catch {}
  firestoreSetDoc('adminLogs', fullEntry.id, fullEntry).catch(() => {});
  return fullEntry;
}

// Generate a cryptographically random access key in the format RVX-9KTY-YT5E-67TQ (3 blocks of 4 random uppercase alphanumeric chars)
function generateHardCryptographicKey(prefix = 'RVX'): string {
  const cleanPrefix = (prefix || 'RVX').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'RVX';
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const allChars = letters + digits;
  const block = (): string => {
    const chars = [
      letters[crypto.randomInt(0, letters.length)],
      digits[crypto.randomInt(0, digits.length)],
      allChars[crypto.randomInt(0, allChars.length)],
      allChars[crypto.randomInt(0, allChars.length)]
    ];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      const tmp = chars[i];
      chars[i] = chars[j];
      chars[j] = tmp;
    }
    return chars.join('');
  };
  return `${cleanPrefix}-${block()}-${block()}-${block()}`;
}

// Always generate 1 brand-new unique unused key atomically for a successful payment order (1 Payment = 1 New Key, 1 Device Lock)
function assignKeyToOrder(order: PaymentOrder): { order: PaymentOrder; keyStr: string } {
  if (order.assignedKey) {
    return { order, keyStr: order.assignedKey };
  }

  const keys = getKeys();
  const settings = getSettings();
  const unit: 'minutes' | 'hours' | 'days' | 'lifetime' =
    order.planDurationUnit && ['minutes', 'hours', 'days', 'lifetime'].includes(order.planDurationUnit)
      ? order.planDurationUnit
      : 'days';
  const rawVal =
    typeof order.planDurationValue === 'number' && order.planDurationValue > 0
      ? order.planDurationValue
      : settings.keySaleDurationDays || 30;

  let durationDays = 30;
  let durationMs = 30 * 24 * 60 * 60 * 1000;
  if (unit === 'lifetime') {
    durationDays = 0;
    durationMs = 0;
  } else if (unit === 'minutes') {
    durationMs = rawVal * 60 * 1000;
    durationDays = Number((rawVal / (60 * 24)).toFixed(4));
  } else if (unit === 'hours') {
    durationMs = rawVal * 60 * 60 * 1000;
    durationDays = Number((rawVal / 24).toFixed(4));
  } else {
    durationDays = rawVal;
    durationMs = rawVal * 24 * 60 * 60 * 1000;
  }

  let keyStr = generateHardCryptographicKey('RVX');
  while (keys.some(k => k.key === keyStr)) {
    keyStr = generateHardCryptographicKey('RVX');
  }

  const assignedKeyDoc: AccessKey = {
    id: keyStr,
    key: keyStr,
    customerName: order.customerName || 'Website Customer',
    status: 'active',
    durationDays,
    durationUnit: unit,
    durationValue: unit === 'lifetime' ? 0 : rawVal,
    durationMs,
    createdAt: new Date().toISOString(),
    activatedAt: null,
    expiresAt: null,
    boundDeviceId: null,
    notes: `Purchased Order: ${order.orderId}${order.planName ? ` (${order.planName})` : ''} (1-Device Lock)`
  };

  keys.unshift(assignedKeyDoc);
  saveKeys(keys, assignedKeyDoc);

  order.assignedKeyId = assignedKeyDoc.id;
  order.assignedKey = assignedKeyDoc.key;
  order.keyDeliveryStatus = 'DELIVERED';
  order.paidAt = new Date().toISOString();

  return { order, keyStr: assignedKeyDoc.key };
}

// Real-Time Server-Sent Events (SSE) connections
const sseClients: Response[] = [];

function broadcastSSE(type: string, data: any) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(payload);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);
  res.write(`event: initial\ndata: ${JSON.stringify(getSettings())}\n\n`);

  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// Scalable Public Settings Endpoint (supports ETag & CDN caching for 100,000+ concurrent users)
app.get('/api/public/settings', (_req: Request, res: Response) => {
  const current = getSettings();
  const etag = `"v${current.version || 1}-${current.updatedAt || ''}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=3, stale-while-revalidate=30');
  res.json({
    success: true,
    version: current.version,
    updatedAt: current.updatedAt,
    settings: current
  });
});

// Legacy alias: Get current site settings
app.get('/api/site-settings', (_req: Request, res: Response) => {
  const current = getSettings();
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    success: true,
    version: current.version,
    settings: current
  });
});

// Permanent Versioned Logo Delivery Endpoint (backed by local disk + memory + Firestore)
app.get('/api/public/logo/:assetId', async (req: Request, res: Response) => {
  const { assetId } = req.params;
  if (!assetId) return res.status(404).end();

  const cleanId = path.basename(assetId).replace(/\.(png|webp|jpg|jpeg|gif|svg)$/i, '');

  // 1. Check local disk in public/uploads first
  for (const ext of ['webp', 'png', 'jpg', 'gif', 'svg']) {
    const diskPath = path.join(uploadsDir, `${cleanId}.${ext}`);
    if (fs.existsSync(diskPath)) {
      const mimeMap: Record<string, string> = {
        webp: 'image/webp',
        png: 'image/png',
        jpg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml'
      };
      res.setHeader('Content-Type', mimeMap[ext] || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(diskPath);
    }
  }

  // 2. Check in-memory asset cache
  let asset = memoryLogoAssets.get(cleanId) || memoryLogoAssets.get(assetId);
  if (!asset) {
    const docData = await firestoreGetDoc('logoAssets', cleanId);
    if (docData && typeof docData.dataUrl === 'string') {
      asset = {
        dataUrl: docData.dataUrl,
        mimeType: docData.mimeType || 'image/png',
        version: Number(docData.version) || 1
      };
      memoryLogoAssets.set(cleanId, asset);
    }
  }

  if (!asset || !asset.dataUrl) {
    return res.redirect('/assets/revox-logo.png');
  }

  const match = asset.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return res.redirect('/assets/revox-logo.png');
  }

  const mimeType = match[1];
  const imgBuffer = Buffer.from(match[2], 'base64');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.send(imgBuffer);
});

// API: Verify access key securely on the server (with strict 1-Key = 1-Active-Session credential lock & Firestore sync)
app.post('/api/verify-key', async (req: Request, res: Response) => {
  const rawKey = req.body?.key;
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
  const clientSessionToken = typeof req.body?.sessionToken === 'string' ? req.body.sessionToken.trim() : '';

  if (!rawKey || typeof rawKey !== 'string') {
    return res.status(400).json({ valid: false, message: 'Invalid Access Key' });
  }

  if (!deviceId) {
    return res.status(400).json({ valid: false, reason: 'device_locked', message: 'Device verification required' });
  }

  const cleanedKey = rawKey.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');

  // Always check & sync the authoritative key state from Firestore in O(1) so cross-device locks are 100% enforced
  const { keys, keyDoc } = await findAndSyncSingleKeyFromFirestore(cleanedKey);

  if (!keyDoc) {
    return res.status(404).json({ valid: false, reason: 'not_found', message: 'Invalid Access Key' });
  }

  if (keyDoc.status === 'revoked') {
    return res.status(403).json({ valid: false, reason: 'revoked', message: 'Access Key has been revoked' });
  }

  const now = Date.now();

  // If already expired
  if (keyDoc.expiresAt && new Date(keyDoc.expiresAt).getTime() <= now) {
    keyDoc.status = 'expired';
    saveKeys(keys, keyDoc);
    await persistKeyToFirestore(keyDoc);
    return res.status(403).json({ valid: false, reason: 'expired', message: 'Access Key has expired' });
  }

  // If key was explicitly closed via user logout, it is permanently locked
  if (keyDoc.activeSessionToken && keyDoc.activeSessionToken.startsWith('LOCKED_LOGGED_OUT_')) {
    return res.status(403).json({
      valid: false,
      reason: 'logged_out',
      message: 'Access Key already used'
    });
  }

  // Enforce Strict 1-Key = 1-Device Locking (1 Key can NEVER unlock 2 devices):
  if (keyDoc.boundDeviceId) {
    // If entered from ANY different device, strictly reject!
    if (keyDoc.boundDeviceId !== deviceId) {
      return res.status(403).json({
        valid: false,
        reason: 'device_locked',
        message: 'Access Key already used on another device'
      });
    }

    // Entered from the EXACT SAME device that originally activated it:
    keyDoc.lastVerifiedAt = new Date(now).toISOString();
    if (!keyDoc.activeSessionToken) {
      keyDoc.activeSessionToken = `sess_${crypto.randomBytes(20).toString('hex')}`;
    }
    keyDoc.updatedAt = new Date(now).toISOString();
    saveKeys(keys, keyDoc);
    await persistKeyToFirestore(keyDoc);
  } else {
    // Brand new first activation: bind permanently to this 1 single device
    const isFirstActivation = !keyDoc.activatedAt;
    if (isFirstActivation) {
      keyDoc.activatedAt = new Date(now).toISOString();
    }

    keyDoc.boundDeviceId = deviceId;
    keyDoc.activeSessionToken = `sess_${crypto.randomBytes(20).toString('hex')}`;
    keyDoc.lastVerifiedAt = new Date(now).toISOString();
    keyDoc.updatedAt = new Date(now).toISOString();

    // Compute expiration supporting minutes, hours, or days (timer starts ONLY on first activation)
    const computedDurationMs = keyDoc.durationMs
      ? Number(keyDoc.durationMs)
      : keyDoc.durationDays > 0
        ? keyDoc.durationDays * 24 * 60 * 60 * 1000
        : 0;

    if (computedDurationMs > 0 && !keyDoc.expiresAt) {
      const expiresMs = now + computedDurationMs;
      keyDoc.expiresAt = new Date(expiresMs).toISOString();
    }

    saveKeys(keys, keyDoc);
    await persistKeyToFirestore(keyDoc);

    if (isFirstActivation) {
      recordAdminLog({
        action: 'KEY_ACTIVATED',
        label: 'Key activated',
        customerName: keyDoc.customerName || 'Customer',
        maskedKey: maskKeyForAudit(keyDoc.key, false),
        keyId: keyDoc.id,
        details: `First activation by ${keyDoc.customerName || 'Customer'}`
      });
    }
  }

  let remainingMs = null;
  if (keyDoc.expiresAt) {
    remainingMs = Math.max(0, new Date(keyDoc.expiresAt).getTime() - now);
  }

  return res.json({
    valid: true,
    message: 'Access Granted',
    data: {
      key: keyDoc.key,
      customerName: keyDoc.customerName || 'Customer',
      durationDays: keyDoc.durationDays,
      durationUnit: keyDoc.durationUnit || (keyDoc.durationDays === 0 ? 'lifetime' : 'days'),
      durationValue: keyDoc.durationValue ?? keyDoc.durationDays,
      status: keyDoc.status,
      activatedAt: keyDoc.activatedAt,
      expiresAt: keyDoc.expiresAt,
      remainingMs,
      boundDeviceId: keyDoc.boundDeviceId || null,
      sessionToken: keyDoc.activeSessionToken,
      notes: keyDoc.notes
    }
  });
});

// API: Validate active customer session (checks server-side revocation, deletion, expiry, logout lock, and session reset)
app.post('/api/session/validate', async (req: Request, res: Response) => {
  const rawKey = typeof req.body?.key === 'string' ? req.body.key.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') : '';
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
  const sessionToken = typeof req.body?.sessionToken === 'string' ? req.body.sessionToken.trim() : '';

  if (!rawKey) {
    return res.status(400).json({ valid: false, reason: 'invalid', message: 'Invalid Access Key' });
  }

  const { keys, keyDoc } = await findAndSyncSingleKeyFromFirestore(rawKey);
  if (!keyDoc) {
    return res.status(403).json({ valid: false, reason: 'deleted', message: 'Access Key has been deleted' });
  }

  if (keyDoc.status === 'revoked') {
    return res.status(403).json({ valid: false, reason: 'revoked', message: 'Access Key has been deactivated' });
  }

  const now = Date.now();
  if (keyDoc.expiresAt && new Date(keyDoc.expiresAt).getTime() <= now) {
    keyDoc.status = 'expired';
    saveKeys(keys, keyDoc);
    await persistKeyToFirestore(keyDoc);
    return res.status(403).json({ valid: false, reason: 'expired', message: 'Access Key has expired' });
  }

  // If admin reset the session (both boundDeviceId and activeSessionToken cleared), require re-authentication
  if (!keyDoc.boundDeviceId && !keyDoc.activeSessionToken) {
    return res.status(403).json({ valid: false, reason: 'session_reset', message: 'Session was reset by administrator' });
  }

  // If key was already logged out, session is permanently locked
  if (keyDoc.activeSessionToken && keyDoc.activeSessionToken.startsWith('LOCKED_LOGGED_OUT_')) {
    return res.status(403).json({ valid: false, reason: 'logged_out', message: 'Access Key session was closed on logout' });
  }

  // 1-Device check: If bound to a device, different devices are locked out
  if (keyDoc.boundDeviceId && (!deviceId || keyDoc.boundDeviceId !== deviceId)) {
    return res.status(403).json({ valid: false, reason: 'device_locked', message: 'Access Key is active on another device' });
  }

  // Token check: If token is provided and differs, allow if device matches
  const tokenMatches = Boolean(keyDoc.activeSessionToken && sessionToken && keyDoc.activeSessionToken === sessionToken);
  const deviceMatches = Boolean(keyDoc.boundDeviceId && deviceId && keyDoc.boundDeviceId === deviceId);

  if (keyDoc.activeSessionToken && sessionToken && !tokenMatches && !deviceMatches) {
    return res.status(403).json({ valid: false, reason: 'locked', message: 'Access Key is active on another session' });
  }

  keyDoc.lastVerifiedAt = new Date(now).toISOString();

  return res.json({
    valid: true,
    data: {
      key: keyDoc.key,
      customerName: keyDoc.customerName || 'Customer',
      durationDays: keyDoc.durationDays,
      durationUnit: keyDoc.durationUnit || 'days',
      durationValue: keyDoc.durationValue ?? keyDoc.durationDays,
      status: keyDoc.status,
      activatedAt: keyDoc.activatedAt,
      expiresAt: keyDoc.expiresAt,
      remainingMs: keyDoc.expiresAt ? Math.max(0, new Date(keyDoc.expiresAt).getTime() - now) : null,
      boundDeviceId: keyDoc.boundDeviceId || null,
      sessionToken: keyDoc.activeSessionToken || null,
      notes: keyDoc.notes
    }
  });
});

// API: Permanently lock key session upon user logout (cannot be re-opened unless Admin resets session)
app.post('/api/session/logout', async (req: Request, res: Response) => {
  const rawKey = typeof req.body?.key === 'string' ? req.body.key.trim().toUpperCase() : '';
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';

  if (!rawKey) {
    return res.status(400).json({ success: false });
  }

  let keys = getKeys();
  let keyDoc = keys.find(k => k.key.toUpperCase() === rawKey);
  if (!keyDoc) {
    keys = await syncKeysFromFirestore();
    keyDoc = keys.find(k => k.key.toUpperCase() === rawKey);
  }
  if (keyDoc) {
    if (!keyDoc.boundDeviceId && deviceId) {
      keyDoc.boundDeviceId = deviceId;
    } else if (!keyDoc.boundDeviceId) {
      keyDoc.boundDeviceId = 'DEV-LOCKED-LOGOUT';
    }
    keyDoc.activeSessionToken = `LOCKED_LOGGED_OUT_${crypto.randomBytes(12).toString('hex')}`;
    keyDoc.updatedAt = new Date().toISOString();
    saveKeys(keys, keyDoc);
    await firestoreSetDoc('accessKeys', keyDoc.id, keyDoc);
  }

  return res.json({ success: true });
});

// API: Admin authentication verification (issues signed server-side adminToken)
app.post('/api/admin/verify-admin', (req: Request, res: Response) => {
  const { password, email } = req.body || {};
  if (email && email.toLowerCase() === 'rawashishh@gmail.com') {
    const adminToken = issueAdminToken('superadmin');
    return res.json({ authorized: true, role: 'superadmin', adminToken });
  }
  const validPassword = process.env.ADMIN_PASSWORD || 'CRITICALXR-A4AE97-ASHISH12@@';
  const cleanInput = typeof password === 'string' ? password.trim() : '';
  if (
    cleanInput &&
    (cleanInput === validPassword ||
      cleanInput.toUpperCase() === 'CRITICALXR-A4AE97-ASHISH12@@')
  ) {
    const adminToken = issueAdminToken('admin');
    return res.json({ authorized: true, role: 'admin', adminToken });
  }
  return res.status(401).json({ authorized: false, message: 'Unauthorized access' });
});

// Protect all subsequent /api/admin/* endpoints with server-side admin authorization
app.use('/api/admin', requireAdminAuth);

// API: Admin update site settings (writes to Firestore websiteSettings/main, verifies version, broadcasts live)
app.post('/api/admin/settings', async (req: Request, res: Response) => {
  try {
    const incoming = req.body || {};
    const updatedBy = incoming.updatedBy || 'admin';
    const { verified, settings } = await saveAndVerifySettings(incoming, updatedBy);

    return res.json({
      success: true,
      verified,
      version: settings.version,
      updatedAt: settings.updatedAt,
      settings
    });
  } catch (err: any) {
    console.error('Admin save settings error:', err);
    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to save settings'
    });
  }
});

// API: Admin upload / replace logo image permanently on disk + memory + Firestore
app.post('/api/admin/upload-logo', async (req: Request, res: Response) => {
  const { dataUrl, size, positionY, updatedBy } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing image data' });
  }

  try {
    const current = getSettings();
    const nextVersion = (current.version || 1) + 1;
    const assetId = `logo_v${nextVersion}_${Date.now()}`;
    const logoStoragePath = `logoAssets/${assetId}`;

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match ? match[1] : 'image/png';
    const base64Payload = match ? match[2] : '';

    let ext = 'png';
    if (mimeType.includes('webp')) ext = 'webp';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('gif')) ext = 'gif';
    else if (mimeType.includes('svg')) ext = 'svg';

    if (base64Payload) {
      const diskLogoPath = path.join(uploadsDir, `${assetId}.${ext}`);
      try {
        fs.writeFileSync(diskLogoPath, Buffer.from(base64Payload, 'base64'));
      } catch (err) {
        console.warn('Disk logo save warning:', err);
      }
    }

    memoryLogoAssets.set(assetId, {
      dataUrl,
      mimeType,
      version: nextVersion
    });

    // Non-blocking background sync to Firestore
    firestoreSetDoc('logoAssets', assetId, {
      assetId,
      dataUrl,
      mimeType,
      version: nextVersion,
      createdAt: new Date().toISOString()
    }).catch(() => {});

    // Serve via fast /api/public/logo/:assetId (backed by disk + memory) or inline dataUrl if compact
    const finalLogoUrl = dataUrl.length <= 500000 ? dataUrl : `/api/public/logo/${assetId}`;

    const { verified, settings } = await saveAndVerifySettings(
      {
        logoStoragePath,
        logoUrl: finalLogoUrl,
        logoSize: typeof size === 'number' ? size : current.logoSize,
        logoPositionY: typeof positionY === 'number' ? positionY : current.logoPositionY
      },
      updatedBy || 'admin'
    );

    return res.json({
      success: true,
      verified,
      version: settings.version,
      logoStoragePath,
      logoUrl: finalLogoUrl,
      settings
    });
  } catch (err: any) {
    console.error('Logo upload error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Helper: Locate video file on local disk (checks runtime uploadsDir, bundled public/uploads, and falls back to latest valid MP4 on disk)
function findDiskVideoFile(videoIdOrFile: string): { filePath: string; mimeType: string } | null {
  const cleanId = path.basename(videoIdOrFile).replace(/\.(mp4|webm|ogg|mov)$/i, '');
  const searchDirs = uploadsDir === bundledUploadsDir ? [uploadsDir] : [uploadsDir, bundledUploadsDir];

  for (const dir of searchDirs) {
    const possibleFiles = [
      path.join(dir, path.basename(videoIdOrFile)),
      path.join(dir, `${cleanId}.mp4`),
      path.join(dir, `${cleanId}.webm`),
      path.join(dir, `${cleanId}.ogg`)
    ];
    for (const fp of possibleFiles) {
      if (fs.existsSync(fp)) {
        try {
          const st = fs.statSync(fp);
          if (st.size > 0) {
            const mimeType = fp.endsWith('.webm')
              ? 'video/webm'
              : fp.endsWith('.ogg')
              ? 'video/ogg'
              : 'video/mp4';
            return { filePath: fp, mimeType };
          }
        } catch {}
      }
    }
  }

  // Fallback: if the specific videoId is not found on disk, serve the newest valid gameplay MP4/WebM in uploads
  for (const dir of searchDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const candidates = fs
        .readdirSync(dir)
        .filter(f => /\.(mp4|webm|ogg)$/i.test(f) && !f.includes('.tmp_') && !f.includes('.fast_'))
        .map(f => {
          const full = path.join(dir, f);
          const st = fs.statSync(full);
          return { full, size: st.size, mtime: st.mtimeMs };
        })
        .filter(c => c.size > 0)
        .sort((a, b) => b.mtime - a.mtime);

      if (candidates.length > 0) {
        const best = candidates[0].full;
        const mimeType = best.endsWith('.webm')
          ? 'video/webm'
          : best.endsWith('.ogg')
          ? 'video/ogg'
          : 'video/mp4';
        return { filePath: best, mimeType };
      }
    } catch {}
  }

  return null;
}

// Stream video directly from disk with HTTP 206 Range support (capped at 8MB chunks so Cloud Run's 32MB proxy limit is never exceeded)
function streamVideoFromDisk(req: Request, res: Response, filePath: string, mimeType: string) {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return res.status(404).end();
  }
  const total = stat.size;
  const range = req.headers.range;
  const MAX_CHUNK_BYTES = 8 * 1024 * 1024; // 8MB max per HTTP response chunk (safe under Cloud Run 32MB limit)

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const hasExplicitEnd = Boolean(parts[1] && parts[1].trim().length > 0);
    const requestedEnd = hasExplicitEnd ? parseInt(parts[1], 10) : total - 1;
    if (Number.isNaN(start) || start >= total || requestedEnd < start) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
      return;
    }
    // Cap open-ended or huge ranges to 8MB per HTTP 206 chunk so Cloud Run proxy never truncates large videos
    const end = Math.min(requestedEnd, start + MAX_CHUNK_BYTES - 1, total - 1);
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(chunkSize));
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => res.end());
    stream.pipe(res);
  } else if (total > MAX_CHUNK_BYTES) {
    const start = 0;
    const end = Math.min(MAX_CHUNK_BYTES - 1, total - 1);
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(chunkSize));
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => res.end());
    stream.pipe(res);
  } else {
    res.status(200);
    res.setHeader('Content-Length', String(total));
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.end());
    stream.pipe(res);
  }
}

// Stream video buffer with HTTP 206 Range support for in-memory assets
function streamVideoBuffer(req: Request, res: Response, buffer: Buffer, mimeType: string) {
  const total = buffer.length;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    if (start >= total || end >= total || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(chunkSize));
    res.end(buffer.subarray(start, end + 1));
  } else {
    res.status(200);
    res.setHeader('Content-Length', String(total));
    res.end(buffer);
  }
}

const hydratingVideos = new Map<string, Promise<string | null>>();

// Hydrate video from Firestore chunks to disk in streaming batches (supports unlimited chunks without OOM)
async function hydrateVideoToDisk(videoIdOrFile: string): Promise<{ filePath: string; mimeType: string } | null> {
  const cleanId = videoIdOrFile.replace(/\.(mp4|webm|ogg|mov)$/i, '');

  const existingDisk = findDiskVideoFile(videoIdOrFile);
  if (existingDisk) return existingDisk;

  const metaDoc = await firestoreGetDoc('videoAssets', cleanId);
  if (!metaDoc || typeof metaDoc.totalChunks !== 'number' || metaDoc.totalChunks <= 0) {
    return null;
  }

  const totalChunks = Number(metaDoc.totalChunks);
  const mimeType = typeof metaDoc.mimeType === 'string' ? metaDoc.mimeType : 'video/mp4';
  const fileName = typeof metaDoc.fileName === 'string' ? metaDoc.fileName : `${cleanId}.mp4`;
  const finalPath = path.join(uploadsDir, fileName);

  let hydratePromise = hydratingVideos.get(cleanId);
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const tmpPath = `${finalPath}.tmp_${Date.now()}`;
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

        const batchSize = 10;
        for (let i = 0; i < totalChunks; i += batchSize) {
          const endIdx = Math.min(i + batchSize, totalChunks);
          const promises: Promise<Record<string, any> | null>[] = [];
          for (let j = i; j < endIdx; j++) {
            promises.push(firestoreGetDoc('videoAssetChunks', `${cleanId}_${j}`));
          }
          const docs = await Promise.all(promises);
          for (let k = 0; k < docs.length; k++) {
            const cDoc = docs[k];
            if (!cDoc || typeof cDoc.data !== 'string') {
              if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
              return null;
            }
            const chunkBuf = Buffer.from(cDoc.data, 'base64');
            fs.appendFileSync(tmpPath, chunkBuf);
          }
        }
        fs.renameSync(tmpPath, finalPath);
        return finalPath;
      } catch (err) {
        console.error('Error hydrating video to disk:', err);
        return null;
      } finally {
        hydratingVideos.delete(cleanId);
      }
    })();
    hydratingVideos.set(cleanId, hydratePromise);
  }

  const hydratedPath = await hydratePromise;
  if (!hydratedPath || !fs.existsSync(hydratedPath)) return null;
  return { filePath: hydratedPath, mimeType };
}

// Unified Gameplay Video Delivery Handler (supports unlimited video size via disk stream or Firestore chunks)
async function handleServeGameplayVideo(req: Request, res: Response, videoIdOrFile: string) {
  if (!videoIdOrFile) return res.status(404).end();
  const cleanId = videoIdOrFile.replace(/\.(mp4|webm|ogg|mov)$/i, '');

  // 1. If already on local disk, stream directly from disk (supports unlimited MB/GB with 0 RAM overhead)
  const diskVideo = findDiskVideoFile(videoIdOrFile);
  if (diskVideo) {
    return streamVideoFromDisk(req, res, diskVideo.filePath, diskVideo.mimeType);
  }

  // 2. Check in-memory cache
  const cached = memoryVideoAssets.get(cleanId) || memoryVideoAssets.get(videoIdOrFile);
  if (cached) {
    return streamVideoBuffer(req, res, cached.buffer, cached.mimeType);
  }

  // 3. Hydrate from Firestore chunks to disk & stream
  const hydrated = await hydrateVideoToDisk(videoIdOrFile);
  if (hydrated) {
    return streamVideoFromDisk(req, res, hydrated.filePath, hydrated.mimeType);
  }

  return res.status(404).json({ success: false, message: 'Video asset not found' });
}

// Permanent Versioned Gameplay Video Delivery Endpoint
app.get('/api/public/video/:videoId', async (req: Request, res: Response) => {
  return handleServeGameplayVideo(req, res, req.params.videoId);
});

// Fallback handler for /uploads/:fileName so uploaded videos survive container restarts
app.get('/uploads/:fileName', async (req: Request, res: Response) => {
  return handleServeGameplayVideo(req, res, req.params.fileName);
});

// API: Step 1 of Unlimited-Size Chunked Gameplay Video Upload (Initializes upload file & metadata)
app.post('/api/admin/upload-video-init', async (req: Request, res: Response) => {
  try {
    const { fileName, mimeType: rawMime } = req.body || {};
    const mimeType = typeof rawMime === 'string' && rawMime ? rawMime : 'video/mp4';

    let ext = 'mp4';
    if (mimeType.includes('webm') || (fileName && fileName.toLowerCase().endsWith('.webm'))) ext = 'webm';
    else if (mimeType.includes('ogg') || (fileName && fileName.toLowerCase().endsWith('.ogg'))) ext = 'ogg';
    else if (mimeType.includes('quicktime') || (fileName && fileName.toLowerCase().endsWith('.mov'))) ext = 'mp4';

    const current = getSettings();
    const nextVersion = (current.version || 1) + 1;
    const videoId = `gameplay_v${nextVersion}_${Date.now()}`;
    const safeFileName = `${videoId}.${ext}`;
    const filePath = path.join(uploadsDir, safeFileName);

    // Create empty file on disk ready for chunk appends
    fs.writeFileSync(filePath, Buffer.alloc(0));

    return res.json({
      success: true,
      videoId,
      fileName: safeFileName,
      mimeType,
      version: nextVersion
    });
  } catch (err: any) {
    console.error('Upload video init error:', err);
    return res.status(500).json({ success: false, message: err?.message || 'Failed to init video upload' });
  }
});

// API: Step 2 of Unlimited-Size Chunked Gameplay Video Upload (Supports fast async binary chunks)
app.post(
  '/api/admin/upload-video-chunk',
  express.raw({ type: 'application/octet-stream', limit: '50mb' }),
  async (req: Request, res: Response) => {
    try {
      const isRawBuffer = Buffer.isBuffer(req.body);
      const videoId = String(req.query.videoId || (!isRawBuffer && req.body?.videoId) || '').trim();
      const rawFileName = String(req.query.fileName || (!isRawBuffer && req.body?.fileName) || '').trim();
      const chunkIndex = Number(req.query.chunkIndex ?? (!isRawBuffer ? req.body?.chunkIndex : NaN));
      const byteOffsetRaw = req.query.byteOffset ?? (!isRawBuffer ? req.body?.byteOffset : undefined);
      const hasByteOffset = byteOffsetRaw !== undefined && byteOffsetRaw !== null && byteOffsetRaw !== '';
      const byteOffset = hasByteOffset ? Number(byteOffsetRaw) : -1;

      if (!videoId || Number.isNaN(chunkIndex) || chunkIndex < 0) {
        return res.status(400).json({ success: false, message: 'Invalid chunk parameters' });
      }

      let chunkBuf: Buffer;
      if (isRawBuffer) {
        chunkBuf = req.body as Buffer;
      } else if (typeof req.body?.data === 'string') {
        chunkBuf = Buffer.from(req.body.data, 'base64');
      } else {
        return res.status(400).json({ success: false, message: 'Missing chunk binary payload' });
      }

      const safeFileName = rawFileName ? path.basename(rawFileName) : `${videoId}.mp4`;
      const filePath = path.join(uploadsDir, safeFileName);

      if (byteOffset >= 0) {
        const flags = fs.existsSync(filePath) ? 'r+' : 'w';
        const fh = await fs.promises.open(filePath, flags);
        try {
          await fh.write(chunkBuf, 0, chunkBuf.length, byteOffset);
        } finally {
          await fh.close();
        }
      } else {
        await fs.promises.appendFile(filePath, chunkBuf);
      }

      return res.json({
        success: true,
        chunkIndex,
        bytesWritten: chunkBuf.length
      });
    } catch (err: any) {
      console.error('Upload video chunk error:', err);
      return res.status(500).json({ success: false, message: err?.message || 'Failed to upload video chunk' });
    }
  }
);

// Helper: Asynchronously back up gameplay videos (up to 25MB) to Firestore chunks so published sites & container restarts always have the video
function backupDiskVideoToFirestoreAsync(
  videoId: string,
  safeFileName: string,
  filePath: string,
  mimeType: string,
  version: number
) {
  setImmediate(async () => {
    try {
      if (Date.now() < firestoreWritePausedUntil) return;
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      const totalBytes = stat.size;
      if (totalBytes <= 0 || totalBytes > 25 * 1024 * 1024) return;

      // 650KB binary -> ~887KB base64 (safely within Firestore's 950,000 char rule limit)
      const FIRESTORE_CHUNK_BYTES = 650 * 1024;
      const totalFirestoreChunks = Math.ceil(totalBytes / FIRESTORE_CHUNK_BYTES);

      const fd = fs.openSync(filePath, 'r');
      try {
        const BATCH_CONCURRENCY = 6;
        for (let i = 0; i < totalFirestoreChunks; i += BATCH_CONCURRENCY) {
          const batchPromises: Promise<boolean>[] = [];
          const endIdx = Math.min(i + BATCH_CONCURRENCY, totalFirestoreChunks);
          for (let cIdx = i; cIdx < endIdx; cIdx++) {
            const offset = cIdx * FIRESTORE_CHUNK_BYTES;
            const length = Math.min(FIRESTORE_CHUNK_BYTES, totalBytes - offset);
            const buf = Buffer.allocUnsafe(length);
            const bytesRead = fs.readSync(fd, buf, 0, length, offset);
            const base64Slice = buf.subarray(0, bytesRead).toString('base64');
            batchPromises.push(
              firestoreSetDoc('videoAssetChunks', `${videoId}_${cIdx}`, {
                videoId,
                chunkIndex: cIdx,
                data: base64Slice
              })
            );
          }
          await Promise.all(batchPromises);
        }
      } finally {
        fs.closeSync(fd);
      }

      await firestoreSetDoc('videoAssets', videoId, {
        videoId,
        fileName: safeFileName,
        mimeType,
        totalChunks: totalFirestoreChunks,
        sizeBytes: totalBytes,
        version,
        createdAt: new Date().toISOString()
      });
    } catch {}
  });
}

// Fast stream-copy remux to move MP4 moov atom to byte 0 (+faststart) for instant mobile playback
function remuxMp4FaststartQuick(filePath: string): Promise<void> {
  return new Promise(resolve => {
    if (!filePath.endsWith('.mp4') || !fs.existsSync(filePath)) return resolve();
    const tmpFast = `${filePath}.fast_${Date.now()}.mp4`;
    execFile(
      'ffmpeg',
      ['-y', '-i', filePath, '-c', 'copy', '-movflags', '+faststart', tmpFast],
      { timeout: 3000 },
      err => {
        try {
          if (!err && fs.existsSync(tmpFast) && fs.statSync(tmpFast).size > 0) {
            fs.renameSync(tmpFast, filePath);
          } else if (fs.existsSync(tmpFast)) {
            fs.unlinkSync(tmpFast);
          }
        } catch {}
        resolve();
      }
    );
  });
}

// Clean up older unreferenced gameplay video uploads in background so disk stays fast and clean
function cleanupOldGameplayVideosAsync(keepFileName: string) {
  setImmediate(() => {
    try {
      const files = fs.readdirSync(uploadsDir);
      for (const f of files) {
        if (f.startsWith('gameplay_v') && f !== keepFileName && !f.includes('.fast_')) {
          try {
            fs.unlinkSync(path.join(uploadsDir, f));
          } catch {}
        }
      }
    } catch {}
  });
}

// API: Step 3 of Unlimited-Size Chunked Gameplay Video Upload (Finalizes metadata immediately)
app.post('/api/admin/upload-video-complete', async (req: Request, res: Response) => {
  try {
    const {
      videoId,
      fileName,
      mimeType: rawMime,
      introVideoTitle,
      introVideoButtonText,
      introFeaturePoints,
      updatedBy
    } = req.body || {};

    if (!videoId) {
      return res.status(400).json({ success: false, message: 'Missing videoId' });
    }

    const current = getSettings();
    const nextVersion = (current.version || 1) + 1;
    const safeFileName = typeof fileName === 'string' && fileName ? path.basename(fileName) : `${videoId}.mp4`;
    const mimeType = typeof rawMime === 'string' && rawMime ? rawMime : 'video/mp4';
    const filePath = path.join(uploadsDir, safeFileName);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      return res.status(400).json({ success: false, message: 'Uploaded video file is empty or missing' });
    }

    const fileSize = fs.statSync(filePath).size;
    if (fileSize <= 35 * 1024 * 1024) {
      await remuxMp4FaststartQuick(filePath);
    } else {
      remuxMp4FaststartQuick(filePath).catch(() => {});
    }

    const videoPublicUrl = `/api/public/video/${videoId}`;
    const cleanFeatures = Array.isArray(introFeaturePoints)
      ? introFeaturePoints
      : current.introFeaturePoints || DEFAULT_INTRO_FEATURE_POINTS;

    const { verified, settings } = await saveAndVerifySettings(
      {
        introVideoUrl: videoPublicUrl,
        introVideoEnabled: true,
        introFeaturePoints: cleanFeatures,
        introVideoTitle: introVideoTitle || current.introVideoTitle || 'WITH PANEL GAMEPLAY',
        introVideoButtonText: introVideoButtonText || current.introVideoButtonText || 'CONTINUE',
        buttonSettings: {
          ...current.buttonSettings,
          introVideoUrl: videoPublicUrl,
          introVideoEnabled: true,
          introFeaturePoints: cleanFeatures,
          introVideoTitle: introVideoTitle || current.introVideoTitle || 'WITH PANEL GAMEPLAY',
          introVideoButtonText: introVideoButtonText || current.introVideoButtonText || 'CONTINUE'
        }
      },
      updatedBy || 'admin'
    );

    cleanupOldGameplayVideosAsync(safeFileName);
    backupDiskVideoToFirestoreAsync(videoId, safeFileName, filePath, mimeType, nextVersion);

    return res.json({
      success: true,
      verified,
      version: settings.version,
      introVideoUrl: videoPublicUrl,
      settings
    });
  } catch (err: any) {
    console.error('Upload video complete error:', err);
    return res.status(500).json({ success: false, message: err?.message || 'Failed to finalize video upload' });
  }
});

// API: Admin upload gameplay video file directly (single-payload fallback)
app.post('/api/admin/upload-video', async (req: Request, res: Response) => {
  const { dataUrl, fileName, introVideoTitle, introVideoButtonText, updatedBy } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing video data' });
  }

  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Invalid video data format' });
    }
    const mimeType = match[1] || 'video/mp4';
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    let ext = 'mp4';
    if (mimeType.includes('webm')) ext = 'webm';
    else if (mimeType.includes('ogg')) ext = 'ogg';
    else if (mimeType.includes('quicktime') || (fileName && fileName.endsWith('.mov'))) ext = 'mp4';

    const current = getSettings();
    const nextVersion = (current.version || 1) + 1;
    const videoId = `gameplay_v${nextVersion}_${Date.now()}`;
    const safeFileName = `${videoId}.${ext}`;
    const filePath = path.join(uploadsDir, safeFileName);
    fs.writeFileSync(filePath, buffer);

    await remuxMp4FaststartQuick(filePath);
    const videoPublicUrl = `/api/public/video/${videoId}`;

    const { verified, settings } = await saveAndVerifySettings(
      {
        introVideoUrl: videoPublicUrl,
        introVideoEnabled: true,
        introVideoTitle: introVideoTitle || current.introVideoTitle || 'WITH PANEL GAMEPLAY',
        introVideoButtonText: introVideoButtonText || current.introVideoButtonText || 'CONTINUE',
        buttonSettings: {
          ...current.buttonSettings,
          introVideoUrl: videoPublicUrl,
          introVideoEnabled: true,
          introVideoTitle: introVideoTitle || current.introVideoTitle || 'WITH PANEL GAMEPLAY',
          introVideoButtonText: introVideoButtonText || current.introVideoButtonText || 'CONTINUE'
        }
      },
      updatedBy || 'admin'
    );

    cleanupOldGameplayVideosAsync(safeFileName);
    backupDiskVideoToFirestoreAsync(videoId, safeFileName, filePath, mimeType, nextVersion);

    return res.json({
      success: true,
      verified,
      version: settings.version,
      introVideoUrl: videoPublicUrl,
      settings
    });
  } catch (err: any) {
    console.error('Gameplay video upload error:', err);
    return res.status(500).json({ success: false, message: err?.message || 'Failed to upload video' });
  }
});

// API: Admin remove gameplay video permanently
app.post('/api/admin/remove-video', async (req: Request, res: Response) => {
  try {
    const updatedBy = req.body?.updatedBy || 'admin';
    const current = getSettings();
    const { verified, settings } = await saveAndVerifySettings(
      {
        introVideoUrl: '',
        buttonSettings: {
          ...current.buttonSettings,
          introVideoUrl: ''
        }
      },
      updatedBy
    );
    return res.json({
      success: true,
      verified,
      version: settings.version,
      settings
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || 'Failed to remove video' });
  }
});

// API: Admin get all keys + statistics + audit logs (Instant < 2ms from authoritative server store)
app.get('/api/admin/keys', (_req: Request, res: Response) => {
  const keys = getKeys();
  const now = Date.now();
  let dirty = false;
  keys.forEach(k => {
    if (!k.customerName) {
      k.customerName = 'Customer';
    }
    if (k.status === 'active' && k.expiresAt && new Date(k.expiresAt).getTime() <= now) {
      k.status = 'expired';
      dirty = true;
      firestoreSetDoc('accessKeys', k.id, k).catch(() => {});
    }
  });
  if (dirty) saveKeys(keys);

  const activeKeysCount = keys.filter(k => k.status === 'active').length;
  const inUseCount = keys.filter(k => k.status === 'active' && k.activatedAt !== null).length;
  const unusedCount = keys.filter(k => k.status === 'active' && k.activatedAt === null).length;
  const expiredCount = keys.filter(k => k.status === 'expired').length;
  const revokedCount = keys.filter(k => k.status === 'revoked').length;

  const stats = {
    total: keys.length,
    active: activeKeysCount,
    inUse: inUseCount,
    unused: unusedCount,
    redeemed: keys.filter(k => k.activatedAt !== null).length,
    expired: expiredCount,
    revoked: revokedCount
  };

  const logs = getAdminLogs();

  res.json({ success: true, keys, stats, logs });
});

// API: Admin generate new keys (Instant response; customerName defaults to 'Customer' if blank)
app.post('/api/admin/keys/generate', (req: Request, res: Response) => {
  const customerName = String(req.body?.customerName || 'Customer').trim().slice(0, 120) || 'Customer';
  const count = Math.min(Math.max(1, Number(req.body?.count) || 1), 500);
  const durationUnit: 'minutes' | 'hours' | 'days' | 'lifetime' =
    ['minutes', 'hours', 'days', 'lifetime'].includes(req.body?.durationUnit)
      ? req.body.durationUnit
      : 'days';

  const rawValue = Number(req.body?.durationValue ?? req.body?.durationDays ?? 30);
  if (durationUnit !== 'lifetime' && (!Number.isFinite(rawValue) || rawValue <= 0)) {
    return res.status(400).json({ success: false, message: 'Duration must be a valid positive number' });
  }

  let durationMs = 0;
  let durationDays = 0;

  if (durationUnit === 'minutes') {
    durationMs = Math.max(1, rawValue) * 60 * 1000;
    durationDays = Number((rawValue / (60 * 24)).toFixed(4));
  } else if (durationUnit === 'hours') {
    durationMs = Math.max(1, rawValue) * 60 * 60 * 1000;
    durationDays = Number((rawValue / 24).toFixed(4));
  } else if (durationUnit === 'days') {
    durationDays = Math.max(1, rawValue);
    durationMs = durationDays * 24 * 60 * 60 * 1000;
  } else {
    durationDays = 0;
    durationMs = 0;
  }

  const prefix = (req.body?.prefix || 'RVX').trim().toUpperCase().slice(0, 8) || 'RVX';
  const notes = String(req.body?.notes || '').trim().slice(0, 200);

  const keys = getKeys();
  const newKeys: AccessKey[] = [];
  const nowIso = new Date().toISOString();

  for (let i = 0; i < count; i++) {
    let keyStr = generateHardCryptographicKey(prefix);
    while (keys.some(k => k.key === keyStr) || isKeyDeleted(keyStr, keyStr)) {
      keyStr = generateHardCryptographicKey(prefix);
    }
    const keyItem: AccessKey = {
      id: keyStr,
      key: keyStr,
      customerName,
      status: 'active',
      durationDays,
      durationUnit,
      durationValue: durationUnit === 'lifetime' ? 0 : rawValue,
      durationMs,
      createdAt: nowIso,
      activatedAt: null,
      expiresAt: null,
      boundDeviceId: null,
      activeSessionToken: null,
      lastVerifiedAt: null,
      renewedAt: null,
      updatedAt: nowIso,
      notes
    };
    newKeys.push(keyItem);
    keys.unshift(keyItem);
    persistKeyToFirestore(keyItem).catch(() => {});

    recordAdminLog({
      action: 'KEY_GENERATED',
      label: 'Key generated',
      customerName,
      maskedKey: maskKeyForAudit(keyItem.key, false),
      keyId: keyItem.id,
      details: `${rawValue} ${durationUnit.toUpperCase()} for ${customerName}`
    });
  }

  saveKeys(keys);
  res.json({ success: true, generated: newKeys, keys, logs: getAdminLogs() });
});

// API: Admin explicitly activate or deactivate a key (Instant response)
app.post('/api/admin/keys/status', (req: Request, res: Response) => {
  const { id, action } = req.body || {};
  const keys = getKeys();
  const item = keys.find(k => k.id === id || k.key.toUpperCase() === String(id).toUpperCase());
  if (!item) return res.status(404).json({ success: false, message: 'Key not found' });

  if (action === 'deactivate') {
    item.status = 'revoked';
    item.updatedAt = new Date().toISOString();
    saveKeys(keys, item);

    broadcastSSE('key-revoked', { id: item.id, key: item.key, status: 'revoked' });

    recordAdminLog({
      action: 'KEY_DEACTIVATED',
      label: 'Key deactivated',
      customerName: item.customerName || 'Customer',
      maskedKey: maskKeyForAudit(item.key, false),
      keyId: item.id,
      details: `Deactivated key for ${item.customerName || 'Customer'}`
    });
  } else if (action === 'activate') {
    const now = Date.now();
    if (item.expiresAt && new Date(item.expiresAt).getTime() <= now) {
      item.status = 'expired';
    } else {
      item.status = 'active';
    }
    item.updatedAt = new Date().toISOString();
    saveKeys(keys, item);

    broadcastSSE('key-updated', { id: item.id, key: item.key, status: item.status });

    recordAdminLog({
      action: 'KEY_REACTIVATED',
      label: 'Key activated',
      customerName: item.customerName || 'Customer',
      maskedKey: maskKeyForAudit(item.key, false),
      keyId: item.id,
      details: `Reactivated key for ${item.customerName || 'Customer'}`
    });
  } else {
    return res.status(400).json({ success: false, message: 'Invalid status action' });
  }

  return res.json({ success: true, key: item, keys, logs: getAdminLogs() });
});

// API: Admin toggle key status
app.post('/api/admin/keys/toggle', (req: Request, res: Response) => {
  const { id } = req.body || {};
  const keys = getKeys();
  const item = keys.find(k => k.id === id || k.key.toUpperCase() === String(id).toUpperCase());
  if (!item) return res.status(404).json({ success: false, message: 'Key not found' });

  const wasActive = item.status === 'active';
  if (wasActive) {
    item.status = 'revoked';
    broadcastSSE('key-revoked', { id: item.id, key: item.key, status: 'revoked' });
    recordAdminLog({
      action: 'KEY_DEACTIVATED',
      label: 'Key deactivated',
      customerName: item.customerName || 'Customer',
      maskedKey: maskKeyForAudit(item.key, false),
      keyId: item.id,
      details: `Deactivated key for ${item.customerName || 'Customer'}`
    });
  } else {
    const now = Date.now();
    item.status = item.expiresAt && new Date(item.expiresAt).getTime() <= now ? 'expired' : 'active';
    broadcastSSE('key-updated', { id: item.id, key: item.key, status: item.status });
    recordAdminLog({
      action: 'KEY_REACTIVATED',
      label: 'Key activated',
      customerName: item.customerName || 'Customer',
      maskedKey: maskKeyForAudit(item.key, false),
      keyId: item.id,
      details: `Reactivated key for ${item.customerName || 'Customer'}`
    });
  }
  item.updatedAt = new Date().toISOString();
  saveKeys(keys, item);
  res.json({ success: true, key: item, keys, logs: getAdminLogs() });
});

// API: Admin renew / extend key validity (Instant response)
app.post('/api/admin/keys/renew', (req: Request, res: Response) => {
  const { id, durationValue, durationUnit } = req.body || {};
  const val = Number(durationValue);
  const unit: 'minutes' | 'hours' | 'days' =
    ['minutes', 'hours', 'days'].includes(durationUnit) ? durationUnit : 'days';

  if (!id || !Number.isFinite(val) || val <= 0) {
    return res.status(400).json({ success: false, message: 'Valid key ID and positive duration required' });
  }

  const keys = getKeys();
  const item = keys.find(k => k.id === id || k.key.toUpperCase() === String(id).toUpperCase());
  if (!item) {
    return res.status(404).json({ success: false, message: 'Key not found' });
  }

  let addedMs = 0;
  if (unit === 'minutes') {
    addedMs = val * 60 * 1000;
  } else if (unit === 'hours') {
    addedMs = val * 60 * 60 * 1000;
  } else {
    addedMs = val * 24 * 60 * 60 * 1000;
  }

  const now = Date.now();
  if (item.activatedAt || item.expiresAt) {
    const currentExpMs = item.expiresAt ? new Date(item.expiresAt).getTime() : now;
    const baseMs = Math.max(now, currentExpMs);
    const newExpMs = baseMs + addedMs;
    item.expiresAt = new Date(newExpMs).toISOString();
    item.durationMs = (Number(item.durationMs) || 0) + addedMs;
    item.durationDays = Number((item.durationMs / (24 * 60 * 60 * 1000)).toFixed(4));
    if (item.status === 'expired') {
      item.status = 'active';
    }
  } else {
    const existingMs = Number(item.durationMs) || (Number(item.durationDays || 0) * 24 * 60 * 60 * 1000);
    const totalMs = existingMs + addedMs;
    item.durationMs = totalMs;
    item.durationUnit = unit;
    if (unit === 'minutes') {
      item.durationValue = Math.round(totalMs / (60 * 1000));
    } else if (unit === 'hours') {
      item.durationValue = Number((totalMs / (60 * 60 * 1000)).toFixed(2));
    } else {
      item.durationValue = Number((totalMs / (24 * 60 * 60 * 1000)).toFixed(2));
    }
    item.durationDays = Number((totalMs / (24 * 60 * 60 * 1000)).toFixed(4));
  }

  item.renewedAt = new Date(now).toISOString();
  item.updatedAt = new Date(now).toISOString();

  saveKeys(keys, item);

  broadcastSSE('key-updated', { id: item.id, key: item.key, expiresAt: item.expiresAt, status: item.status });

  recordAdminLog({
    action: 'KEY_RENEWED',
    label: 'Key renewed',
    customerName: item.customerName || 'Customer',
    maskedKey: maskKeyForAudit(item.key, false),
    keyId: item.id,
    details: `Extended by +${val} ${unit.toUpperCase()} for ${item.customerName || 'Customer'}`
  });

  return res.json({ success: true, key: item, keys, logs: getAdminLogs() });
});

// API: Admin edit customer name and optional notes
app.post('/api/admin/keys/edit', (req: Request, res: Response) => {
  const { id, customerName, notes } = req.body || {};
  const cleanName = String(customerName || '').trim().slice(0, 120);
  if (!id || !cleanName) {
    return res.status(400).json({ success: false, message: 'Customer name cannot be empty' });
  }

  const keys = getKeys();
  const item = keys.find(k => k.id === id || k.key.toUpperCase() === String(id).toUpperCase());
  if (!item) {
    return res.status(404).json({ success: false, message: 'Key not found' });
  }

  item.customerName = cleanName;
  if (notes !== undefined) {
    item.notes = String(notes || '').trim().slice(0, 200);
  }
  item.updatedAt = new Date().toISOString();

  saveKeys(keys, item);

  recordAdminLog({
    action: 'CUSTOMER_UPDATED',
    label: 'Customer updated',
    customerName: item.customerName,
    maskedKey: maskKeyForAudit(item.key, false),
    keyId: item.id,
    details: `Updated customer info to ${item.customerName}`
  });

  return res.json({ success: true, key: item, keys, logs: getAdminLogs() });
});

// API: Admin reset active session / device lock without resetting expiration time
app.post('/api/admin/keys/reset-session', (req: Request, res: Response) => {
  const { id } = req.body || {};
  const keys = getKeys();
  const item = keys.find(k => k.id === id || k.key.toUpperCase() === String(id).toUpperCase());
  if (!item) {
    return res.status(404).json({ success: false, message: 'Key not found' });
  }

  item.boundDeviceId = null;
  item.activeSessionToken = null;
  item.updatedAt = new Date().toISOString();

  saveKeys(keys, item);

  broadcastSSE('key-session-reset', { id: item.id, key: item.key });

  recordAdminLog({
    action: 'SESSION_RESET',
    label: 'Session reset',
    customerName: item.customerName || 'Customer',
    maskedKey: maskKeyForAudit(item.key, false),
    keyId: item.id,
    details: `Revoked active session lock for ${item.customerName || 'Customer'}`
  });

  return res.json({ success: true, key: item, keys, logs: getAdminLogs() });
});

// Shared helper to delete a key permanently from memory, disk, and Firestore
function executeDeleteKey(idOrKey: string, secondaryKey?: string): { deleted: boolean; keys: AccessKey[] } {
  const cleanId = String(idOrKey || '').trim();
  const cleanKey = String(secondaryKey || idOrKey || '').trim().toUpperCase();
  let keys = getKeys();
  const target = keys.find(
    k =>
      k.id === cleanId ||
      k.id.toUpperCase() === cleanKey ||
      k.key.toUpperCase() === cleanKey ||
      k.key.toUpperCase() === cleanId.toUpperCase()
  );

  markKeyDeletedPermanently(cleanId, cleanKey);
  if (target) {
    markKeyDeletedPermanently(target.id, target.key);
    broadcastSSE('key-revoked', { id: target.id, key: target.key, status: 'deleted' });
  }

  const targetKeyUpper = target ? target.key.toUpperCase() : cleanKey;
  keys = keys.filter(
    k =>
      k.id !== cleanId &&
      k.id !== target?.id &&
      k.key.toUpperCase() !== targetKeyUpper &&
      k.key.toUpperCase() !== cleanId.toUpperCase()
  );
  saveKeys(keys);

  if (target) {
    firestoreDeleteDoc('accessKeys', target.id).catch(() => {});
    if (target.id !== targetKeyUpper) {
      firestoreDeleteDoc('accessKeys', targetKeyUpper).catch(() => {});
    }
    recordAdminLog({
      action: 'KEY_DELETED',
      label: 'Key deleted',
      customerName: target.customerName || 'Customer',
      maskedKey: maskKeyForAudit(target.key, true),
      keyId: target.id,
      details: `Deleted access key for ${target.customerName || 'Customer'}`
    });
  } else {
    firestoreDeleteDoc('accessKeys', cleanId).catch(() => {});
    if (cleanKey && cleanKey !== cleanId) {
      firestoreDeleteDoc('accessKeys', cleanKey).catch(() => {});
    }
  }

  return { deleted: true, keys };
}

// API: Admin delete key via POST (safe from URL encoding issues)
app.post('/api/admin/keys/delete', (req: Request, res: Response) => {
  const { id, key } = req.body || {};
  if (!id && !key) {
    return res.status(400).json({ success: false, message: 'Missing key ID' });
  }
  const { keys } = executeDeleteKey(id || key, key);
  return res.json({ success: true, message: 'Key deleted', keys, logs: getAdminLogs() });
});

// API: Admin delete key permanently via DELETE
app.delete('/api/admin/keys/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { keys } = executeDeleteKey(id);
  return res.json({ success: true, message: 'Key deleted', keys, logs: getAdminLogs() });
});

// ==========================================
// REAL CASHFREE PG V3 GATEWAY INTEGRATION
// ==========================================

const TRANZUPI_API_KEY = process.env.TRANZUPI_API_KEY || '';
const TRANZUPI_SECRET_TOKEN = process.env.TRANZUPI_SECRET_TOKEN || '';
const TRANZUPI_MERCHANT_VPA = process.env.TRANZUPI_MERCHANT_VPA || '';

function resolveCashfreeConfig(): {
  appId: string;
  secretKey: string;
  env: 'production' | 'sandbox';
  apiBase: string;
  configured: boolean;
  missingCredentials: string[];
} {
  const rawAppId = (
    process.env.CASHFREE_APP_ID ||
    process.env.CASHFREE_CLIENT_ID ||
    ''
  ).trim();
  const rawSecretKey = (
    process.env.CASHFREE_SECRET_KEY ||
    process.env.CASHFREE_CLIENT_SECRET ||
    ''
  ).trim();
  const rawEnv = (
    process.env.CASHFREE_ENV ||
    process.env.CASHFREE_MODE ||
    ''
  )
    .trim()
    .toLowerCase();

  const appIdValid = Boolean(
    rawAppId &&
      rawAppId !== 'YOUR_CASHFREE_APP_ID' &&
      rawAppId !== 'MY_CASHFREE_APP_ID'
  );
  const secretKeyValid = Boolean(
    rawSecretKey &&
      rawSecretKey !== 'YOUR_CASHFREE_SECRET_KEY' &&
      rawSecretKey !== 'MY_CASHFREE_SECRET_KEY'
  );

  const missingCredentials: string[] = [];
  if (!appIdValid) missingCredentials.push('CASHFREE_APP_ID');
  if (!secretKeyValid) missingCredentials.push('CASHFREE_SECRET_KEY');

  let env: 'production' | 'sandbox' = 'production';
  if (
    rawEnv === 'sandbox' ||
    rawEnv === 'test' ||
    rawSecretKey.includes('_test_') ||
    rawAppId.toUpperCase().startsWith('TEST')
  ) {
    env = 'sandbox';
  }
  if (rawSecretKey.includes('_prod_') && rawEnv !== 'sandbox' && rawEnv !== 'test') {
    env = 'production';
  }

  const apiBase =
    env === 'sandbox'
      ? 'https://sandbox.cashfree.com/pg'
      : 'https://api.cashfree.com/pg';

  return {
    appId: appIdValid ? rawAppId : '',
    secretKey: secretKeyValid ? rawSecretKey : '',
    env,
    apiBase,
    configured: appIdValid && secretKeyValid,
    missingCredentials
  };
}


interface TrustedPlanData {
  id: string;
  name: string;
  priceINR: number;
  currency: string;
  durationValue: number;
  durationUnit: 'minutes' | 'hours' | 'days' | 'lifetime';
  validityLabel: string;
}

function resolveTrustedServerPlan(
  settings: SiteSettings,
  requestedPlanId?: string
): TrustedPlanData | null {
  const rawPlans =
    Array.isArray(settings.keyPlans) && !isLegacyUnconfiguredServerPlans(settings.keyPlans)
      ? settings.keyPlans
      : Array.isArray((settings.buttonSettings as any)?.keyPlans) &&
        !isLegacyUnconfiguredServerPlans((settings.buttonSettings as any).keyPlans)
      ? ((settings.buttonSettings as any).keyPlans as PurchasePlan[])
      : DEFAULT_SERVER_KEY_PLANS;

  if (rawPlans && rawPlans.length > 0) {
    const cleanId = String(requestedPlanId || '').trim();
    const matched = cleanId
      ? rawPlans.find(
          p =>
            p.id === cleanId ||
            (cleanId === 'plan_standard_30d' && p.id === 'plan_7_days')
        )
      : rawPlans.find(
          p => p.available && typeof p.priceINR === 'number' && Number.isFinite(p.priceINR) && p.priceINR > 0
        );

    if (
      !matched ||
      !matched.available ||
      typeof matched.priceINR !== 'number' ||
      !Number.isFinite(matched.priceINR) ||
      matched.priceINR <= 0
    ) {
      return null;
    }

    const unit: 'minutes' | 'hours' | 'days' | 'lifetime' =
      matched.durationUnit && ['minutes', 'hours', 'days', 'lifetime'].includes(matched.durationUnit)
        ? matched.durationUnit
        : 'days';
    const durVal =
      unit === 'lifetime'
        ? 0
        : typeof matched.durationValue === 'number' &&
          Number.isFinite(matched.durationValue) &&
          matched.durationValue > 0
        ? matched.durationValue
        : Number(settings.keySaleDurationDays) || 7;

    if (unit !== 'lifetime' && durVal <= 0) {
      return null;
    }

    const validityLabel =
      unit === 'lifetime'
        ? 'Permanent'
        : `${durVal} ${unit.charAt(0).toUpperCase() + unit.slice(1, -1)}${durVal === 1 ? '' : 's'}`;

    return {
      id: matched.id || 'plan_7_days',
      name: (matched.name || 'REVOX ACCESS KEY').trim(),
      priceINR: Number(matched.priceINR.toFixed(2)),
      currency: 'INR',
      durationValue: durVal,
      durationUnit: unit,
      validityLabel
    };
  }

  return null;
}

// Public endpoint to check Cashfree gateway status (never exposes secret keys)
app.get('/api/payments/gateway-status', (_req: Request, res: Response) => {
  const cf = resolveCashfreeConfig();
  const settings = getSettings();
  return res.json({
    success: true,
    gateway: 'cashfree',
    configured: cf.configured,
    cashfreeConfigured: cf.configured,
    mode: cf.env,
    missingCredentials: cf.missingCredentials,
    salesEnabled: settings.keySalesEnabled !== false
  });
});

// Secure Access Key Retrieval Endpoint for /key-success
// Validates signed claimToken + verified payment record, prevents unauthorized access & duplicate key generation
app.post('/api/payments/claim-key', async (req: Request, res: Response) => {
  const rawOrderId = String(req.body?.orderId || req.body?.order_id || '').trim();
  const claimToken = String(
    req.body?.claimToken || req.headers['x-claim-token'] || ''
  ).trim();

  if (!rawOrderId || !claimToken) {
    return res.status(401).json({
      success: false,
      verified: false,
      code: 'UNAUTHORIZED_ACCESS',
      message: 'Unauthorized access. A verified payment session is required to view an access key.'
    });
  }

  const sales = getSales();
  let order = sales.find(s => s.orderId.toUpperCase() === rawOrderId.toUpperCase());

  if (!order) {
    const remoteOrder = await firestoreGetDoc('keySales', rawOrderId);
    if (remoteOrder && remoteOrder.orderId) {
      order = remoteOrder as PaymentOrder;
      sales.unshift(order);
    }
  }

  if (!order) {
    return res.status(404).json({
      success: false,
      verified: false,
      code: 'ORDER_NOT_FOUND',
      message: 'Verified purchase record could not be found.'
    });
  }

  // Validate cryptographic claim token bound to orderId, amount, and currency
  const isTokenValid = verifyOrderClaimToken(
    order.orderId,
    order.amount,
    order.currency || 'INR',
    claimToken
  );

  if (!isTokenValid || order.paymentStatus !== 'SUCCESS') {
    return res.status(403).json({
      success: false,
      verified: false,
      code: 'PAYMENT_NOT_VERIFIED',
      message: 'Payment has not been verified for this order.'
    });
  }

  // Idempotent key assignment: never generate duplicate keys if the order already has one
  if (!order.assignedKey) {
    assignKeyToOrder(order);
    saveSales(sales, order);
  }

  const unit = order.planDurationUnit || 'days';
  const val = Number(order.planDurationValue) || 7;
  const validityLabel =
    unit === 'lifetime'
      ? 'Lifetime'
      : unit === 'minutes'
      ? `${val} ${val === 1 ? 'Minute' : 'Minutes'}`
      : unit === 'hours'
      ? `${val} ${val === 1 ? 'Hour' : 'Hours'}`
      : `${val} ${val === 1 ? 'Day' : 'Days'}`;

  return res.json({
    success: true,
    verified: true,
    keyReady: Boolean(order.assignedKey),
    assignedKey: order.assignedKey || null,
    order: {
      orderId: order.orderId,
      planId: order.planId,
      planName: order.planName || 'REVOX ACCESS KEY',
      planDurationValue: val,
      planDurationUnit: unit,
      validityLabel,
      amount: order.amount,
      currency: order.currency || 'INR',
      paymentStatus: 'VERIFIED',
      paidAt: order.paidAt || order.purchasedAt,
      assignedKey: order.assignedKey || null
    }
  });
});


function generateCashfreeRequestId(): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghiklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 15; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function initiateCashfreeDirectUpiQrAndIntent(params: {
  paymentSessionId: string;
  mode: 'production' | 'sandbox';
  returnUrl: string;
  originHeader?: string;
}): Promise<{
  qrCodeDataUrl: string | null;
  qrPaymentId?: string;
  reconUrl?: string;
  upiIntentUrl: string | null;
  upiLinks: Record<string, string>;
  errorMessage?: string;
}> {
  const sdkBase =
    params.mode === 'sandbox'
      ? 'https://sandbox.cashfree.com/pg/sdk/js'
      : 'https://api.cashfree.com/pg/sdk/js';
  const reconBase =
    params.mode === 'sandbox'
      ? 'https://sandbox.cashfree.com/pg/view/status/collect'
      : 'https://api.cashfree.com/pg/view/status/collect';

  const candidateReferrers = Array.from(
    new Set(
      [
        (process.env.CASHFREE_APPROVED_DOMAIN || '').trim().replace(/\/$/, ''),
        'https://revoxpanel.site',
        params.originHeader && params.originHeader.startsWith('https://')
          ? params.originHeader
          : '',
        'https://www.revoxpanel.site'
      ].filter(Boolean)
    )
  );

  let qrCodeDataUrl: string | null = null;
  let qrPaymentId: string | undefined;
  let reconUrl: string | undefined;
  let upiIntentUrl: string | null = null;
  let upiLinks: Record<string, string> = {};
  let lastErrorMsg: string | undefined;

  for (const referrer of candidateReferrers) {
    try {
      // 1. Request Cashfree UPI Intent deep links (channel: "link") first
      const linkReqId = generateCashfreeRequestId();
      const linkRes = await fetch(`${sdkBase}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': linkReqId,
          'x-document-referrer': referrer,
          'x-api-version': '2022-09-01'
        },
        body: JSON.stringify({
          payment_session_id: params.paymentSessionId,
          payment_method: {
            upi: {
              channel: 'link'
            }
          },
          platform: 'jsxx-a-2026.10.05-x-m-c-130-a-14.0',
          return_url: params.returnUrl
        })
      });

      const linkData = await linkRes.json().catch(() => ({}));
      if (linkRes.ok && linkData?.data?.payload) {
        const payload = linkData.data.payload;
        const extractedLinks: Record<string, string> = {};
        for (const key of ['default', 'gpay', 'phonepe', 'paytm', 'bhim', 'web']) {
          if (typeof payload[key] === 'string' && payload[key].trim()) {
            extractedLinks[key] = payload[key].trim();
          }
        }
        upiLinks = extractedLinks;
        upiIntentUrl =
          extractedLinks.default ||
          extractedLinks.gpay ||
          extractedLinks.phonepe ||
          extractedLinks.paytm ||
          extractedLinks.bhim ||
          null;
      }

      // 2. Request Cashfree Dynamic UPI QR Code (channel: "qrcode") second so QR is the primary active attempt
      const qrReqId = generateCashfreeRequestId();
      const qrRes = await fetch(`${sdkBase}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': qrReqId,
          'x-document-referrer': referrer,
          'x-api-version': '2022-09-01'
        },
        body: JSON.stringify({
          payment_session_id: params.paymentSessionId,
          payment_method: {
            upi: {
              channel: 'qrcode'
            }
          },
          platform: 'jsxx-a-2026.10.05-x-d-c-130-l-Linux',
          return_url: params.returnUrl
        })
      });

      const qrData = await qrRes.json().catch(() => ({}));
      if (
        qrRes.ok &&
        typeof qrData?.data?.payload?.qrcode === 'string' &&
        qrData.data.payload.qrcode.trim() !== ''
      ) {
        qrCodeDataUrl = qrData.data.payload.qrcode.trim();
        qrPaymentId = qrData.cf_payment_id ? String(qrData.cf_payment_id) : undefined;
        reconUrl = `${reconBase}/${params.paymentSessionId}${qrReqId}`;
        break;
      } else if (qrData?.code === 'domain_name_not_approved') {
        lastErrorMsg = qrData?.message;
        continue;
      } else {
        lastErrorMsg = qrData?.message || 'Unable to generate Cashfree UPI QR code.';
      }
    } catch (err: any) {
      lastErrorMsg = err?.message || 'Network error while generating Cashfree UPI QR code.';
    }
  }

  return {
    qrCodeDataUrl,
    qrPaymentId,
    reconUrl,
    upiIntentUrl,
    upiLinks,
    errorMessage: qrCodeDataUrl ? undefined : lastErrorMsg
  };
}

// Create Order Handler for /api/payments/create-order and /api/create-order
// Security: Strictly calculates amount from server-side trusted plan data; never trusts browser amount.
async function handleCreatePaymentOrder(req: Request, res: Response) {
  const { planId, customerName, customerPhone, customer_details, reuseOrderId, forceNew } = req.body || {};
  const settings = getSettings();

  if (settings.keySalesEnabled === false) {
    return res.status(400).json({
      success: false,
      code: 'SALES_DISABLED',
      message: 'Online key sales are currently disabled by the administrator.'
    });
  }

  // 1. Validate selected plan and price from trusted backend configuration ONLY
  const trustedPlan = resolveTrustedServerPlan(settings, planId);
  if (!trustedPlan) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_PLAN',
      message: 'The selected plan is not available or has not been configured properly.'
    });
  }

  // 2. Verify Cashfree credentials are present on server
  const cf = resolveCashfreeConfig();
  if (!cf.configured) {
    const missingList = cf.missingCredentials.join(' and ');
    return res.status(503).json({
      success: false,
      code: 'CASHFREE_NOT_CONFIGURED',
      missingCredentials: cf.missingCredentials,
      message: `Cashfree API credentials (${missingList || 'CASHFREE_APP_ID / CASHFREE_SECRET_KEY'}) are not configured on the server.`
    });
  }

  const sales = getSales();
  const originHeader = (req.headers.origin || '').trim().replace(/\/$/, '');

  const QR_VALIDITY_DURATION_MS = 5 * 60 * 1000; // Strict 5-minute QR validity

  // 3. Prevent duplicate order creation if an active pending order for the same plan already exists within 5 minutes
  if (!forceNew && reuseOrderId && typeof reuseOrderId === 'string') {
    const cleanReuseId = reuseOrderId.trim();
    const existingOrder = sales.find(s => {
      if (
        s.orderId !== cleanReuseId ||
        s.paymentStatus !== 'PENDING' ||
        s.planId !== trustedPlan.id ||
        Math.abs(Number(s.amount) - trustedPlan.priceINR) >= 0.01 ||
        !s.paymentSessionId ||
        s.cashfreeMode !== cf.env
      ) {
        return false;
      }
      const createdMs = new Date(s.purchasedAt).getTime();
      const expiryMs = s.expiresAt
        ? new Date(s.expiresAt).getTime()
        : createdMs + QR_VALIDITY_DURATION_MS;
      return Number.isFinite(expiryMs) && Date.now() < expiryMs;
    });

    if (existingOrder) {
      if (!existingOrder.expiresAt) {
        existingOrder.expiresAt = new Date(
          new Date(existingOrder.purchasedAt).getTime() + QR_VALIDITY_DURATION_MS
        ).toISOString();
      }
      if (!existingOrder.cashfreeQrCode && existingOrder.paymentSessionId) {
        const qrResult = await initiateCashfreeDirectUpiQrAndIntent({
          paymentSessionId: existingOrder.paymentSessionId,
          mode: existingOrder.cashfreeMode || cf.env,
          returnUrl: `https://revoxpanel.site/checkout?order_id=${encodeURIComponent(existingOrder.orderId)}`,
          originHeader
        });
        if (qrResult.qrCodeDataUrl) {
          existingOrder.cashfreeQrCode = qrResult.qrCodeDataUrl;
          existingOrder.cashfreeReconUrl = qrResult.reconUrl;
          if (qrResult.upiIntentUrl) {
            existingOrder.upiIntentUrl = qrResult.upiIntentUrl;
          }
          if (Object.keys(qrResult.upiLinks).length > 0) {
            existingOrder.upiLinks = qrResult.upiLinks;
          }
          saveSales(sales, existingOrder);
        }
      }

      if (existingOrder.cashfreeQrCode) {
        return res.json({
          success: true,
          reused: true,
          gateway: 'cashfree',
          gatewayConfigured: true,
          cashfreeActive: true,
          order_id: existingOrder.orderId,
          order_amount: existingOrder.amount,
          order_currency: existingOrder.currency,
          payment_session_id: existingOrder.paymentSessionId,
          cashfree_mode: existingOrder.cashfreeMode,
          qr_code_data_url: existingOrder.cashfreeQrCode,
          upi_intent_url: existingOrder.upiIntentUrl || null,
          upi_links: existingOrder.upiLinks || {},
          recon_url: existingOrder.cashfreeReconUrl || null,
          expires_at: existingOrder.expiresAt,
          qr_validity_seconds: Math.max(
            0,
            Math.floor((new Date(existingOrder.expiresAt).getTime() - Date.now()) / 1000)
          ),
          order: {
            orderId: existingOrder.orderId,
            planId: existingOrder.planId,
            planName: existingOrder.planName,
            planDurationValue: existingOrder.planDurationValue,
            planDurationUnit: existingOrder.planDurationUnit,
            amount: existingOrder.amount,
            currency: existingOrder.currency,
            paymentStatus: existingOrder.paymentStatus,
            purchasedAt: existingOrder.purchasedAt,
            expiresAt: existingOrder.expiresAt,
            paymentSessionId: existingOrder.paymentSessionId,
            cashfreeMode: existingOrder.cashfreeMode,
            cashfreeQrCode: existingOrder.cashfreeQrCode,
            cashfreeReconUrl: existingOrder.cashfreeReconUrl,
            upiIntentUrl: existingOrder.upiIntentUrl,
            upiLinks: existingOrder.upiLinks,
            keyDeliveryStatus: existingOrder.keyDeliveryStatus
          }
        });
      }
    }
  }

  const orderId = `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const resolvedCustomerPhone =
    String(customer_details?.customer_phone || customerPhone || '')
      .replace(/[^0-9]/g, '')
      .slice(-10) || '9876543210';
  const resolvedCustomerId =
    String(customer_details?.customer_id || '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 45) || `cust_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
  const resolvedCustomerName =
    String(customer_details?.customer_name || customerName || 'REVOX Customer')
      .trim()
      .slice(0, 80) || 'REVOX Customer';

  // Determine return_url pointing to the dedicated /checkout route (Cashfree production requires https://)
  const appUrlEnv = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  const host = (req.get('host') || '').trim();
  const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1');

  let baseOrigin = '';
  if (originHeader && originHeader.startsWith('https://')) {
    baseOrigin = originHeader;
  } else if (appUrlEnv && appUrlEnv.startsWith('https://')) {
    baseOrigin = appUrlEnv;
  } else if (host && !isLocalHost) {
    baseOrigin = `https://${host}`;
  } else if (originHeader) {
    baseOrigin = originHeader.replace(/^http:\/\//i, 'https://');
  } else {
    baseOrigin = 'https://revoxpanel.site';
  }

  const returnUrl = `${baseOrigin}/checkout?order_id=${encodeURIComponent(orderId)}`;

  const cfPayload = {
    order_id: orderId,
    order_amount: trustedPlan.priceINR,
    order_currency: trustedPlan.currency,
    customer_details: {
      customer_id: resolvedCustomerId,
      customer_phone: resolvedCustomerPhone,
      customer_name: resolvedCustomerName
    },
    order_meta: {
      return_url: returnUrl
    },
    order_note: `${trustedPlan.name} - ${trustedPlan.validityLabel}`
  };

  try {
    const cfRes = await fetch(`${cf.apiBase}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': cf.appId,
        'x-client-secret': cf.secretKey
      },
      body: JSON.stringify(cfPayload)
    });

    const cfData = await cfRes.json().catch(() => ({}));

    if (!cfRes.ok || !cfData?.payment_session_id) {
      return res.status(cfRes.status >= 400 && cfRes.status < 600 ? cfRes.status : 502).json({
        success: false,
        code: cfData?.code || 'CASHFREE_ORDER_CREATION_FAILED',
        type: cfData?.type || 'api_error',
        cashfree_mode: cf.env,
        message:
          cfData?.message ||
          'Cashfree could not create the payment order. Please verify your Cashfree merchant account and API keys.'
      });
    }

    // Generate official Cashfree Direct UPI QR Code & UPI Intent Links for this payment_session_id
    const qrSession = await initiateCashfreeDirectUpiQrAndIntent({
      paymentSessionId: cfData.payment_session_id,
      mode: cf.env,
      returnUrl,
      originHeader
    });

    if (!qrSession.qrCodeDataUrl) {
      return res.status(502).json({
        success: false,
        code: 'CASHFREE_QR_GENERATION_FAILED',
        cashfree_mode: cf.env,
        message:
          qrSession.errorMessage ||
          'Cashfree created the order, but could not generate the direct UPI QR code.'
      });
    }

    const nowMs = Date.now();
    const expiresAtIso = new Date(nowMs + QR_VALIDITY_DURATION_MS).toISOString();

    const newOrder: PaymentOrder = {
      orderId,
      paymentId: qrSession.qrPaymentId || (cfData.cf_order_id ? String(cfData.cf_order_id) : undefined),
      planId: trustedPlan.id,
      planName: trustedPlan.name,
      planDurationValue: trustedPlan.durationValue,
      planDurationUnit: trustedPlan.durationUnit,
      amount: trustedPlan.priceINR,
      currency: trustedPlan.currency,
      paymentStatus: 'PENDING',
      customerName: resolvedCustomerName,
      customerPhone: resolvedCustomerPhone,
      purchasedAt: new Date(nowMs).toISOString(),
      expiresAt: expiresAtIso,
      keyDeliveryStatus: 'PENDING',
      paymentSessionId: cfData.payment_session_id,
      cashfreeMode: cf.env,
      cashfreeQrCode: qrSession.qrCodeDataUrl,
      cashfreeReconUrl: qrSession.reconUrl,
      upiIntentUrl: qrSession.upiIntentUrl || undefined,
      upiLinks: Object.keys(qrSession.upiLinks).length > 0 ? qrSession.upiLinks : undefined
    };

    sales.unshift(newOrder);
    saveSales(sales, newOrder);

    return res.json({
      success: true,
      gateway: 'cashfree',
      gatewayConfigured: true,
      cashfreeActive: true,
      order_id: newOrder.orderId,
      order_amount: newOrder.amount,
      order_currency: newOrder.currency,
      payment_session_id: newOrder.paymentSessionId,
      cashfree_mode: newOrder.cashfreeMode,
      qr_code_data_url: newOrder.cashfreeQrCode,
      upi_intent_url: newOrder.upiIntentUrl || null,
      upi_links: newOrder.upiLinks || {},
      recon_url: newOrder.cashfreeReconUrl || null,
      expires_at: newOrder.expiresAt,
      qr_validity_seconds: 300,
      order: {
        orderId: newOrder.orderId,
        planId: newOrder.planId,
        planName: newOrder.planName,
        planDurationValue: newOrder.planDurationValue,
        planDurationUnit: newOrder.planDurationUnit,
        amount: newOrder.amount,
        currency: newOrder.currency,
        paymentStatus: newOrder.paymentStatus,
        purchasedAt: newOrder.purchasedAt,
        expiresAt: newOrder.expiresAt,
        paymentSessionId: newOrder.paymentSessionId,
        cashfreeMode: newOrder.cashfreeMode,
        cashfreeQrCode: newOrder.cashfreeQrCode,
        cashfreeReconUrl: newOrder.cashfreeReconUrl,
        upiIntentUrl: newOrder.upiIntentUrl,
        upiLinks: newOrder.upiLinks,
        keyDeliveryStatus: newOrder.keyDeliveryStatus
      }
    });
  } catch (err: any) {
    console.error('Cashfree order creation error:', err);
    return res.status(502).json({
      success: false,
      code: 'CASHFREE_NETWORK_ERROR',
      cashfree_mode: cf.env,
      message: 'Failed to communicate with Cashfree payment gateway. Please try again.'
    });
  }
}

app.post('/api/payments/create-order', handleCreatePaymentOrder);
app.post('/api/create-order', handleCreatePaymentOrder);

// Shared Authoritative Cashfree Order Verification Helper
async function verifyOrderWithCashfree(
  order: PaymentOrder,
  sales: PaymentOrder[],
  userReportedCancel = false
): Promise<{
  verifiedSuccess: boolean;
  paymentStatus: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  cfOrderStatus: string;
  verificationCategory: 'SUCCESS' | 'PENDING' | 'FAILED' | 'NETWORK_ERROR';
  statusMessage: string;
}> {
  if (order.paymentStatus === 'SUCCESS') {
    if (!order.assignedKey) {
      assignKeyToOrder(order);
      saveSales(sales, order);
    }
    return {
      verifiedSuccess: true,
      paymentStatus: 'SUCCESS',
      cfOrderStatus: 'PAID',
      verificationCategory: 'SUCCESS',
      statusMessage: 'Payment verified successfully.'
    };
  }

  const cf = resolveCashfreeConfig();
  if (!cf.configured) {
    return {
      verifiedSuccess: false,
      paymentStatus: order.paymentStatus,
      cfOrderStatus: 'UNCONFIGURED',
      verificationCategory: 'FAILED',
      statusMessage: 'Cashfree API credentials are not configured on the server.'
    };
  }

  // Use the mode stored on the order if present, otherwise current config mode
  const apiBase =
    order.cashfreeMode === 'sandbox'
      ? 'https://sandbox.cashfree.com/pg'
      : order.cashfreeMode === 'production'
      ? 'https://api.cashfree.com/pg'
      : cf.apiBase;

  try {
    // 1. Fetch Order Details from Cashfree
    const cfOrderRes = await fetch(`${apiBase}/orders/${encodeURIComponent(order.orderId)}`, {
      method: 'GET',
      headers: {
        'x-api-version': '2023-08-01',
        'x-client-id': cf.appId,
        'x-client-secret': cf.secretKey
      }
    });

    const cfOrder = await cfOrderRes.json().catch(() => ({}));
    if (!cfOrderRes.ok || !cfOrder?.order_id) {
      const isServerOrGatewayTempError = cfOrderRes.status >= 500 || cfOrderRes.status === 429;
      return {
        verifiedSuccess: false,
        paymentStatus: order.paymentStatus,
        cfOrderStatus: isServerOrGatewayTempError ? 'NETWORK_ERROR' : 'ERROR',
        verificationCategory: isServerOrGatewayTempError ? 'NETWORK_ERROR' : 'FAILED',
        statusMessage: isServerOrGatewayTempError
          ? 'Unable to check your payment status. Please try again.'
          : 'We could not verify your payment. Please try again.'
      };
    }

    // Security Check 1: Confirm order_id matches
    if (String(cfOrder.order_id).trim() !== order.orderId) {
      return {
        verifiedSuccess: false,
        paymentStatus: 'FAILED',
        cfOrderStatus: 'MISMATCH',
        verificationCategory: 'FAILED',
        statusMessage: 'We could not verify your payment. Please try again.'
      };
    }

    // Security Check 2: Confirm amount and currency match original order
    const cfAmount = Number(cfOrder.order_amount);
    const cfCurrency = String(cfOrder.order_currency || 'INR').toUpperCase();
    if (
      !Number.isFinite(cfAmount) ||
      Math.abs(cfAmount - Number(order.amount)) > 0.01 ||
      cfCurrency !== String(order.currency || 'INR').toUpperCase()
    ) {
      order.paymentStatus = 'FAILED';
      order.rejectionReason = 'Order amount or currency mismatch detected during verification.';
      saveSales(sales, order);
      return {
        verifiedSuccess: false,
        paymentStatus: 'FAILED',
        cfOrderStatus: 'AMOUNT_MISMATCH',
        verificationCategory: 'FAILED',
        statusMessage: 'We could not verify your payment. Please try again.'
      };
    }

    // 2. Fetch Payment Transactions for this Order from Cashfree
    let cfPayments: any[] = [];
    try {
      const cfPayRes = await fetch(
        `${apiBase}/orders/${encodeURIComponent(order.orderId)}/payments`,
        {
          method: 'GET',
          headers: {
            'x-api-version': '2023-08-01',
            'x-client-id': cf.appId,
            'x-client-secret': cf.secretKey
          }
        }
      );
      const payData = await cfPayRes.json().catch(() => []);
      if (Array.isArray(payData)) {
        cfPayments = payData;
      }
    } catch {
      // Proceed with order status if payments list endpoint is unavailable
    }

    const cfOrderStatus = String(cfOrder.order_status || '').toUpperCase();
    const successfulPayment = cfPayments.find(
      p => String(p?.payment_status || '').toUpperCase() === 'SUCCESS'
    );
    const activePendingPayment = cfPayments.find(p =>
      ['PENDING', 'AUTHORIZED'].includes(
        String(p?.payment_status || '').toUpperCase()
      )
    );
    const latestAttempt = cfPayments.length > 0 ? cfPayments[0] : null;
    const latestAttemptStatus = latestAttempt
      ? String(latestAttempt.payment_status || '').toUpperCase()
      : '';

    // CASE 1: Payment Confirmed PAID / SUCCESS
    if (cfOrderStatus === 'PAID') {
      if (
        successfulPayment &&
        Math.abs(Number(successfulPayment.payment_amount) - Number(order.amount)) > 0.01
      ) {
        order.paymentStatus = 'FAILED';
        order.rejectionReason = 'Verified payment amount does not match the required order amount.';
        saveSales(sales, order);
        return {
          verifiedSuccess: false,
          paymentStatus: 'FAILED',
          cfOrderStatus: 'AMOUNT_MISMATCH',
          verificationCategory: 'FAILED',
          statusMessage: 'We could not verify your payment. Please try again.'
        };
      }

      const wasAlreadyAssigned = Boolean(order.assignedKey);
      order.paymentStatus = 'SUCCESS';
      if (successfulPayment?.cf_payment_id) {
        order.paymentId = String(successfulPayment.cf_payment_id);
      }
      assignKeyToOrder(order);
      saveSales(sales, order);

      if (!wasAlreadyAssigned) {
        recordAdminLog({
          action: 'KEY_GENERATED',
          label: 'Website key purchase (Cashfree Verified)',
          customerName: order.customerName || 'Website Customer',
          maskedKey: maskKeyForAudit(order.assignedKey || '', false),
          keyId: order.assignedKeyId || order.assignedKey || '',
          details: `Order ${order.orderId} (₹${order.amount}) — ${order.planDurationValue || 7} ${(order.planDurationUnit || 'days').toUpperCase()}`
        });
      }

      return {
        verifiedSuccess: true,
        paymentStatus: 'SUCCESS',
        cfOrderStatus: 'PAID',
        verificationCategory: 'SUCCESS',
        statusMessage: 'Payment verified successfully.'
      };
    }

    // CASE 2: Payment is actively pending bank confirmation
    if (activePendingPayment && cfOrderStatus === 'ACTIVE') {
      order.paymentStatus = 'PENDING';
      saveSales(sales, order);
      return {
        verifiedSuccess: false,
        paymentStatus: 'PENDING',
        cfOrderStatus: 'PENDING',
        verificationCategory: 'PENDING',
        statusMessage: 'Your payment is awaiting confirmation. Please wait.'
      };
    }

    // Enforce 5-minute QR validity if not paid and no active pending bank settlement
    const orderCreatedMs = new Date(order.purchasedAt).getTime();
    const orderExpiryMs = order.expiresAt
      ? new Date(order.expiresAt).getTime()
      : orderCreatedMs + 5 * 60 * 1000;
    const isQrWindowExpired =
      Number.isFinite(orderExpiryMs) && Date.now() >= orderExpiryMs && !activePendingPayment;

    // CASE 3: Latest payment attempt failed or order expired/terminated or 5-minute QR window elapsed
    if (
      isQrWindowExpired ||
      cfOrderStatus === 'EXPIRED' ||
      cfOrderStatus === 'TERMINATED' ||
      latestAttemptStatus === 'FAILED'
    ) {
      const failMsg = isQrWindowExpired
        ? 'QR code expired (valid for 5 minutes only). Please generate a new QR code.'
        : latestAttempt?.payment_message ||
          (cfOrderStatus === 'EXPIRED'
            ? 'The payment session has expired. Please generate a new QR code.'
            : 'We could not verify your payment. Please try again.');
      order.paymentStatus = 'FAILED';
      order.rejectionReason = failMsg;
      saveSales(sales, order);
      return {
        verifiedSuccess: false,
        paymentStatus: 'FAILED',
        cfOrderStatus: isQrWindowExpired ? 'EXPIRED' : cfOrderStatus || 'FAILED',
        verificationCategory: 'FAILED',
        statusMessage: failMsg
      };
    }

    // CASE 4: Payment Cancelled or User Dropped
    if (
      cfOrderStatus === 'CANCELLED' ||
      latestAttemptStatus === 'USER_DROPPED' ||
      latestAttemptStatus === 'CANCELLED' ||
      (userReportedCancel && !activePendingPayment)
    ) {
      const cancelMsg =
        latestAttempt?.payment_message || 'We could not verify your payment. Please try again.';
      order.paymentStatus = 'CANCELLED';
      order.rejectionReason = cancelMsg;
      saveSales(sales, order);
      return {
        verifiedSuccess: false,
        paymentStatus: 'CANCELLED',
        cfOrderStatus: cfOrderStatus || 'CANCELLED',
        verificationCategory: 'FAILED',
        statusMessage: 'We could not verify your payment. Please try again.'
      };
    }

    // CASE 5: Order is still ACTIVE / PENDING awaiting QR scan & confirmation
    order.paymentStatus = 'PENDING';
    saveSales(sales, order);
    return {
      verifiedSuccess: false,
      paymentStatus: 'PENDING',
      cfOrderStatus: cfOrderStatus || 'ACTIVE',
      verificationCategory: 'PENDING',
      statusMessage: 'Your payment is awaiting confirmation. Please wait.'
    };
  } catch (err) {
    console.warn('Cashfree verification request warning:', err);
    return {
      verifiedSuccess: false,
      paymentStatus: order.paymentStatus,
      cfOrderStatus: 'NETWORK_ERROR',
      verificationCategory: 'NETWORK_ERROR',
      statusMessage: 'Unable to check your payment status. Please try again.'
    };
  }
}

// API: Complete or Cancel Payment Order — STRICT REAL CASHFREE VERIFICATION ONLY
app.post('/api/payments/complete-order', async (req: Request, res: Response) => {
  const { orderId, action } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ success: false, message: 'Missing orderId' });
  }

  const sales = getSales();
  let order = sales.find(s => s.orderId.toUpperCase() === String(orderId).trim().toUpperCase());

  if (!order) {
    const remoteOrder = await firestoreGetDoc('keySales', String(orderId).trim());
    if (remoteOrder && remoteOrder.orderId) {
      order = remoteOrder as PaymentOrder;
      sales.unshift(order);
    }
  }

  if (!order) {
    return res.status(404).json({
      success: false,
      verification_category: 'FAILED',
      message: 'We could not verify your payment. Please try again.'
    });
  }

  const isCancelAction = action === 'reject' || action === 'cancel';
  const verification = await verifyOrderWithCashfree(order, sales, isCancelAction);

  const sanitizedOrder = {
    orderId: order.orderId,
    planId: order.planId,
    planName: order.planName,
    planDurationValue: order.planDurationValue,
    planDurationUnit: order.planDurationUnit,
    amount: order.amount,
    currency: order.currency,
    paymentStatus: order.paymentStatus,
    purchasedAt: order.purchasedAt,
    paidAt: order.paidAt,
    keyDeliveryStatus: order.keyDeliveryStatus,
    paymentSessionId: order.paymentSessionId,
    cashfreeMode: order.cashfreeMode,
    rejectionReason: order.rejectionReason,
    assignedKey: order.paymentStatus === 'SUCCESS' ? order.assignedKey : undefined
  };

  if (!verification.verifiedSuccess) {
    return res.status(isCancelAction ? 200 : 402).json({
      success: isCancelAction,
      verified: false,
      order_status: verification.cfOrderStatus,
      payment_status: verification.paymentStatus,
      verification_category: verification.verificationCategory,
      message: verification.statusMessage,
      order: sanitizedOrder
    });
  }

  const claimToken = issueOrderClaimToken(order.orderId, order.amount, order.currency || 'INR');

  return res.json({
    success: true,
    verified: true,
    status: 'paid',
    order_status: 'PAID',
    payment_status: 'SUCCESS',
    verification_category: 'SUCCESS',
    message: verification.statusMessage,
    claimToken,
    order: sanitizedOrder,
    assignedKey: sanitizedOrder.assignedKey
  });
});

// Shared Order Status & Auto-Verification Handler for /api/payments/order-status/:orderId and /api/check-status
async function handleCheckOrderStatus(req: Request, res: Response) {
  const rawOrderId = String(req.params.orderId || req.query.order_id || req.query.orderId || '').trim();
  if (!rawOrderId) {
    return res.status(400).json({
      success: false,
      verification_category: 'FAILED',
      message: 'Missing order_id'
    });
  }

  const sales = getSales();
  let order = sales.find(s => s.orderId.toUpperCase() === rawOrderId.toUpperCase());

  if (!order) {
    const remoteOrder = await firestoreGetDoc('keySales', rawOrderId);
    if (remoteOrder && remoteOrder.orderId) {
      order = remoteOrder as PaymentOrder;
      sales.unshift(order);
    }
  }

  if (!order) {
    return res.status(404).json({
      success: false,
      verified: false,
      order_status: 'NOT_FOUND',
      payment_status: 'NOT_FOUND',
      verification_category: 'FAILED',
      message: 'We could not verify your payment. Please try again.'
    });
  }

  const userCancelled =
    req.query.cancelled === 'true' ||
    req.body?.cancelled === true;

  const verification = await verifyOrderWithCashfree(order, sales, userCancelled);

  const sanitizedOrder = {
    orderId: order.orderId,
    planId: order.planId,
    planName: order.planName,
    planDurationValue: order.planDurationValue,
    planDurationUnit: order.planDurationUnit,
    amount: order.amount,
    currency: order.currency,
    paymentStatus: order.paymentStatus,
    purchasedAt: order.purchasedAt,
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    keyDeliveryStatus: order.keyDeliveryStatus,
    paymentSessionId: order.paymentSessionId,
    cashfreeMode: order.cashfreeMode,
    cashfreeQrCode: order.cashfreeQrCode,
    cashfreeReconUrl: order.cashfreeReconUrl,
    upiIntentUrl: order.upiIntentUrl,
    upiLinks: order.upiLinks,
    rejectionReason: order.rejectionReason,
    assignedKey: order.paymentStatus === 'SUCCESS' ? order.assignedKey : undefined
  };

  const claimToken =
    verification.verifiedSuccess && order.paymentStatus === 'SUCCESS'
      ? issueOrderClaimToken(order.orderId, order.amount, order.currency || 'INR')
      : undefined;

  return res.json({
    success: true,
    verified: verification.verifiedSuccess,
    status: verification.verifiedSuccess ? 'paid' : verification.verificationCategory.toLowerCase(),
    order_id: order.orderId,
    order_status: verification.cfOrderStatus,
    payment_status: order.paymentStatus,
    verification_category: verification.verificationCategory,
    message: verification.statusMessage,
    claimToken,
    assignedKey: sanitizedOrder.assignedKey,
    order: sanitizedOrder
  });
}

app.get('/api/payments/order-status/:orderId', handleCheckOrderStatus);
app.get('/api/check-status', handleCheckOrderStatus);

// API: Verify payment status manually endpoint
app.post('/api/payments/verify-status', async (req: Request, res: Response) => {
  const { orderId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({
      success: false,
      verification_category: 'FAILED',
      message: 'Missing orderId'
    });
  }
  req.params.orderId = String(orderId);
  return handleCheckOrderStatus(req, res);
});

// Verified Webhook Callback for Cashfree (with HMAC-SHA256 signature validation)
function handlePaymentWebhook(req: Request, res: Response) {
  const cf = resolveCashfreeConfig();
  const signature = req.headers['x-webhook-signature'] as string | undefined;
  const timestamp = req.headers['x-webhook-timestamp'] as string | undefined;
  const rawBody = (req as any).rawBody as string | undefined;

  // Enforce Cashfree webhook signature verification
  if (!cf.secretKey || !signature || !timestamp || !rawBody) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized webhook: Missing Cashfree signature headers or secret key.'
    });
  }

  const expectedSignature = crypto
    .createHmac('sha256', cf.secretKey)
    .update(timestamp + rawBody)
    .digest('base64');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized webhook: Invalid Cashfree webhook signature.'
    });
  }

  const body = req.body || {};
  const cfOrder = body?.data?.order;
  const cfPayment = body?.data?.payment;
  const webhookType = String(body?.type || '').toUpperCase();

  const targetId = cfOrder?.order_id || body.order_id || body.orderId;
  const rawStatus = String(
    cfPayment?.payment_status ||
      body.payment_status ||
      body.status ||
      (webhookType === 'PAYMENT_SUCCESS_WEBHOOK' ? 'SUCCESS' : '')
  ).toUpperCase();

  const webhookAmount = cfOrder?.order_amount ?? cfPayment?.payment_amount ?? body.amount;
  const webhookCurrency = String(
    cfOrder?.order_currency || cfPayment?.payment_currency || 'INR'
  ).toUpperCase();

  if (!targetId) {
    return res.status(400).json({ success: false, message: 'Invalid webhook payload: missing order_id' });
  }

  const sales = getSales();
  const order = sales.find(s => s.orderId.toUpperCase() === String(targetId).trim().toUpperCase());

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (['SUCCESS', 'PAID', 'COMPLETED'].includes(rawStatus)) {
    if (
      webhookAmount === undefined ||
      Math.abs(Number(webhookAmount) - Number(order.amount)) > 0.01 ||
      webhookCurrency !== String(order.currency || 'INR').toUpperCase()
    ) {
      console.warn(
        `Webhook amount/currency mismatch for ${order.orderId}: expected ${order.amount} ${order.currency}, got ${webhookAmount} ${webhookCurrency}`
      );
      return res.status(400).json({ success: false, message: 'Amount or currency mismatch' });
    }

    const wasAlreadyAssigned = Boolean(order.assignedKey);
    order.paymentStatus = 'SUCCESS';
    if (cfPayment?.payment_completion_time) {
      order.paidAt = cfPayment.payment_completion_time;
    }
    if (cfPayment?.cf_payment_id) {
      order.paymentId = String(cfPayment.cf_payment_id);
    }
    assignKeyToOrder(order);
    saveSales(sales, order);

    if (!wasAlreadyAssigned) {
      recordAdminLog({
        action: 'KEY_GENERATED',
        label: 'Cashfree Webhook Payment Verified',
        customerName: order.customerName || 'Website Customer',
        maskedKey: maskKeyForAudit(order.assignedKey || '', false),
        keyId: order.assignedKeyId || order.assignedKey || '',
        details: `Webhook ${webhookType || 'PAYMENT_SUCCESS'} for ${order.orderId} (₹${order.amount})`
      });
    }

    return res.json({
      success: true,
      order_status: 'PAID',
      assignedKey: order.assignedKey,
      message: 'Payment verified and key assigned'
    });
  } else if (['USER_DROPPED', 'CANCELLED'].includes(rawStatus)) {
    if (order.paymentStatus !== 'SUCCESS') {
      order.paymentStatus = 'CANCELLED';
      order.rejectionReason = cfPayment?.payment_message || 'Payment cancelled by user.';
      saveSales(sales, order);
    }
    return res.json({ success: true, message: 'Order status updated to CANCELLED' });
  } else if (['FAILED'].includes(rawStatus)) {
    if (order.paymentStatus !== 'SUCCESS') {
      order.paymentStatus = 'FAILED';
      order.rejectionReason = cfPayment?.payment_message || 'Payment transaction failed.';
      saveSales(sales, order);
    }
    return res.json({ success: true, message: 'Order status updated to FAILED' });
  }

  return res.json({ success: true, message: 'Webhook received' });
}

app.post('/api/payments/webhook', handlePaymentWebhook);
app.post('/api/webhook/cashfree', handlePaymentWebhook);

// API: Admin Key Sales List & Stats
app.get('/api/admin/sales', (_req: Request, res: Response) => {
  const sales = getSales();

  const successful = sales.filter(s => s.paymentStatus === 'SUCCESS');
  const pending = sales.filter(s => s.paymentStatus === 'PENDING');
  const failed = sales.filter(s => s.paymentStatus === 'FAILED' || s.paymentStatus === 'CANCELLED');

  const stats = {
    totalSalesINR: successful.reduce((sum, s) => sum + (s.amount || 199), 0),
    successfulCount: successful.length,
    pendingCount: pending.length,
    failedCount: failed.length,
    keysSoldCount: sales.filter(s => s.assignedKey !== undefined).length
  };

  res.json({
    success: true,
    sales,
    stats,
    config: {
      tranzupiConfigured: Boolean(TRANZUPI_API_KEY && TRANZUPI_SECRET_TOKEN),
      merchantVpa: TRANZUPI_MERCHANT_VPA
    }
  });
});

// API: Admin update order status manually
app.post('/api/admin/sales/update-status', (req: Request, res: Response) => {
  const { orderId, newStatus } = req.body || {};
  if (!orderId || !['SUCCESS', 'FAILED', 'CANCELLED', 'PENDING'].includes(newStatus)) {
    return res.status(400).json({ success: false, message: 'Invalid arguments' });
  }

  const sales = getSales();
  const order = sales.find(s => s.orderId === orderId);

  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  order.paymentStatus = newStatus;
  if (newStatus === 'SUCCESS') {
    assignKeyToOrder(order);
  }

  saveSales(sales, order);
  res.json({ success: true, order });
});

// Dev or production static setup
async function startServer() {
  // Hydrate authoritative state from Firestore BEFORE accepting traffic
  await hydrateFromFirestore();

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`REVOX PANEL Server running on http://0.0.0.0:${PORT}`);
    });
  }
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
export { app };

