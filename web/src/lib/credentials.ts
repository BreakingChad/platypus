import type { StaffCredentialRow } from "./types";

/** Expiry status for a staff credential.
 *  - expired:   expires_on is in the past
 *  - expiring:  within `windowDays` (default 60) of expiry
 *  - ok:        far from expiry
 *  - none:      no expiry date (doesn't expire)
 */
export type CredentialStatus = "expired" | "expiring" | "ok" | "none";

export function credentialStatus(
  expiresOn: string | null | undefined,
  now: Date = new Date(),
  windowDays = 60
): CredentialStatus {
  if (!expiresOn) return "none";
  const exp = new Date(expiresOn + "T23:59:59");
  if (Number.isNaN(exp.getTime())) return "none";
  if (exp.getTime() < now.getTime()) return "expired";
  const msLeft = exp.getTime() - now.getTime();
  if (msLeft <= windowDays * 24 * 60 * 60 * 1000) return "expiring";
  return "ok";
}

/** Days until expiry (negative = days since it expired). null when no date. */
export function daysUntilExpiry(
  expiresOn: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!expiresOn) return null;
  const exp = new Date(expiresOn + "T23:59:59");
  if (Number.isNaN(exp.getTime())) return null;
  return Math.ceil((exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export const CREDENTIAL_KINDS: { key: StaffCredentialRow["kind"]; label: string }[] = [
  { key: "training", label: "Training" },
  { key: "license", label: "License" },
  { key: "certification", label: "Certification" },
  { key: "other", label: "Other" },
];

/** Sort: expired first, then closest expiry, then no-expiry, then label. */
export function sortCredentials(rows: StaffCredentialRow[], now: Date = new Date()): StaffCredentialRow[] {
  const rank: Record<CredentialStatus, number> = { expired: 0, expiring: 1, ok: 2, none: 3 };
  return [...rows].sort((a, b) => {
    const ra = rank[credentialStatus(a.expires_on, now)];
    const rb = rank[credentialStatus(b.expires_on, now)];
    if (ra !== rb) return ra - rb;
    const da = a.expires_on ?? "9999-12-31";
    const db = b.expires_on ?? "9999-12-31";
    if (da !== db) return da.localeCompare(db);
    return a.label.localeCompare(b.label);
  });
}
