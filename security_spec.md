# Security Specification & Threat Model

## 1. System Invariants
- **Public Read on Settings**: Any visitor must be able to read `/settings/site` to view the active logo, announcement, and WhatsApp contact link without authenticating.
- **Admin-Only Write on Settings**: Only authenticated administrators (`isAdmin()`) can modify `/settings/{settingId}`.
- **Restricted Key Reads**: General visitors cannot list or dump the `/keys` collection. Verification of keys is handled via secure backend or single-document lookup / verification transaction.
- **Admin-Only Key Management**: Key creation, updates (activate/deactivate), and deletion can only be executed by verified admins.
- **Bootstrap Admin**: `rawashishh@gmail.com` is bootstrapped as trusted administrator.
- **Input Hardening**: All keys, texts, and identifiers are strictly bounded by size limits and patterns to prevent Denial-of-Wallet or NoSQL injection.

## 2. Dirty Dozen Payloads (Rejection Targets)
1. **Unauthenticated Site Settings Hijack**: Anonymous user writes malicious `whatsappUrl` to `/settings/site` -> `PERMISSION_DENIED`.
2. **Key Collection Harvest**: Anonymous visitor issues a `getDocs(collection(db, 'keys'))` to scrape all active product keys -> `PERMISSION_DENIED`.
3. **Self-Minted Access Key**: Unauthenticated visitor attempts to `create` a new key doc in `/keys/{id}` with 9999 days validity -> `PERMISSION_DENIED`.
4. **Key Expiry Extension**: Visitor attempts to alter `expiresAt` or `status` in `/keys/{id}` directly -> `PERMISSION_DENIED`.
5. **Admin Self-Promotion**: Authenticated non-admin adds their own UID to `/admins/{uid}` -> `PERMISSION_DENIED`.
6. **Payload Bombing**: Attacker sends a 50MB string in `announcementBody` -> `PERMISSION_DENIED`.
7. **Document ID Poisoning**: Attacker uses path traversal / non-alphanumeric special characters in `{keyId}` -> `PERMISSION_DENIED`.
8. **Shadow Field Injection**: Admin update payload contains extraneous undocumented root fields -> `PERMISSION_DENIED`.
9. **Status Enumeration Violation**: Attacker writes status "superuser_bypass" instead of "active"|"revoked"|"expired" -> `PERMISSION_DENIED`.
10. **Unverified Email Impersonation**: Attacker creates Firebase account with fake email and unverified token -> `PERMISSION_DENIED`.
11. **Settings Document Deletion**: Attempt to delete `/settings/site` -> `PERMISSION_DENIED`.
12. **Blind List Query Bypass**: Client queries all keys where status == 'active' without admin credentials -> `PERMISSION_DENIED`.
