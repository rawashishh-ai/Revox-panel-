export type Language = 'EN' | 'HI';

export interface ButtonSettings {
  downloadHackUrl?: string;
  setupVideoUrl?: string;
  downloadButtonText?: string;
  setupVideoButtonText?: string;
  keySalesEnabled?: boolean;
  keyPriceINR?: number;
  keySaleDurationDays?: number;
  introVideoUrl?: string;
  introVideoEnabled?: boolean;
  introVideoTitle?: string;
  introVideoButtonText?: string;
  introFeaturePoints?: string[];
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
  keyPriceINR?: number;
  keySaleDurationDays?: number;
  updatedAt?: string;
  updatedBy?: string;
  version?: number;
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
  amount: number;
  currency: string;
  paymentStatus: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  purchasedAt: string;
  paidAt?: string;
  assignedKeyId?: string;
  assignedKey?: string;
  keyDeliveryStatus: 'PENDING' | 'DELIVERED';
  paymentUrl?: string;
  upiIntentUrl?: string;
  tranzupiRef?: string;
}

export interface PaymentStats {
  totalSalesINR: number;
  successfulCount: number;
  pendingCount: number;
  failedCount: number;
  keysSoldCount: number;
}

export interface VerificationResult {
  valid: boolean;
  message?: string;
  data?: {
    key: string;
    customerName?: string;
    durationDays: number;
    durationUnit?: 'minutes' | 'hours' | 'days' | 'lifetime';
    durationValue?: number;
    status: 'active' | 'revoked' | 'expired';
    activatedAt: string | null;
    expiresAt: string | null;
    remainingMs: number | null;
    boundDeviceId?: string | null;
    sessionToken?: string | null;
    notes?: string;
  };
}
