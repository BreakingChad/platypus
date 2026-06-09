import { describe, it, expect } from "vitest";
import { credentialStatus, daysUntilExpiry, sortCredentials } from "./credentials";
import type { StaffCredentialRow } from "./types";

const NOW = new Date("2026-06-09T12:00:00Z");

const cred = (over: Partial<StaffCredentialRow>): StaffCredentialRow => ({
  id: "c1",
  org_id: "o1",
  user_id: "u1",
  kind: "training",
  label: "GCP Training",
  issuer: null,
  identifier: null,
  issued_on: null,
  expires_on: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("credentialStatus", () => {
  it("none when no expiry", () => {
    expect(credentialStatus(null, NOW)).toBe("none");
    expect(credentialStatus(undefined, NOW)).toBe("none");
  });
  it("expired when in the past", () => {
    expect(credentialStatus("2026-06-08", NOW)).toBe("expired");
    expect(credentialStatus("2020-01-01", NOW)).toBe("expired");
  });
  it("not expired on the expiry day itself (valid through end of day)", () => {
    expect(credentialStatus("2026-06-09", NOW)).toBe("expiring");
  });
  it("expiring within the 60-day window", () => {
    expect(credentialStatus("2026-07-01", NOW)).toBe("expiring");
    expect(credentialStatus("2026-08-05", NOW)).toBe("expiring");
  });
  it("just past the window is ok", () => {
    expect(credentialStatus("2026-08-12", NOW)).toBe("ok");
  });
  it("ok beyond the window", () => {
    expect(credentialStatus("2026-12-01", NOW)).toBe("ok");
  });
  it("custom window", () => {
    expect(credentialStatus("2026-06-20", NOW, 5)).toBe("ok");
    expect(credentialStatus("2026-06-12", NOW, 5)).toBe("expiring");
  });
  it("garbage dates degrade to none", () => {
    expect(credentialStatus("not-a-date", NOW)).toBe("none");
  });
});

describe("daysUntilExpiry", () => {
  it("null without a date", () => {
    expect(daysUntilExpiry(null, NOW)).toBeNull();
  });
  it("positive days ahead", () => {
    expect(daysUntilExpiry("2026-06-19", NOW)).toBe(11);
  });
  it("negative once expired", () => {
    expect(daysUntilExpiry("2026-06-01", NOW)).toBeLessThan(0);
  });
});

describe("sortCredentials", () => {
  it("expired → expiring → ok → no-expiry", () => {
    const rows = [
      cred({ id: "ok", label: "B", expires_on: "2027-01-01" }),
      cred({ id: "none", label: "A", expires_on: null }),
      cred({ id: "expired", label: "C", expires_on: "2026-01-01" }),
      cred({ id: "soon", label: "D", expires_on: "2026-06-20" }),
    ];
    expect(sortCredentials(rows, NOW).map((r) => r.id)).toEqual([
      "expired",
      "soon",
      "ok",
      "none",
    ]);
  });
});
