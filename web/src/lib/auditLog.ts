import { supabase } from "./supabase";

/** Audit logger — appends hash-chained events to public.audit_events.
 *
 *  The hash chain works per (org_id, entity_type, entity_id) — every new
 *  event for the same entity carries the previous event's hash, giving us
 *  a tamper-evident sequence. event_hash is FNV-1a over the canonical
 *  prev_hash || ts || actor || action || JSON(payload).
 *
 *  Client-side hashing is fine here — audit_events.insert is RLS-gated to
 *  `actor_id = auth.uid()`, and the chain is read-only via RLS (no update
 *  or delete policies). Even if someone could craft a hash mismatch, the
 *  verify-chain function on the read side would surface it.
 */

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5 >>> 0;

function fnv1a(input: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function canonicalize(payload: unknown): string {
  // Stable JSON: sort object keys recursively. Arrays preserve order.
  return JSON.stringify(payload, sortReplacer);
}
function sortReplacer(_k: string, v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return Object.keys(v as object)
      .sort()
      .reduce<Record<string, unknown>>((out, k) => {
        out[k] = (v as Record<string, unknown>)[k];
        return out;
      }, {});
  }
  return v;
}

export type AuditWriteInput = {
  orgId: string;
  entityType: string;
  entityId: string | null;
  action: string;
  actorId: string;
  actorEmail?: string | null;
  payload?: Record<string, unknown>;
};

/** Window event fired when an audit write ultimately fails — the AppShell
 *  watcher surfaces it as a visible warning (0047: failures are no longer
 *  silent; the business mutation succeeded but its trail entry did not). */
export const AUDIT_WRITE_FAILED_EVENT = "platypus:audit-write-failed";

export async function writeAuditEvent(input: AuditWriteInput): Promise<void> {
  const payload = input.payload ?? {};

  // Chain-head writes can race (two clients appending to the same entity).
  // 0047 adds unique indexes so the loser gets a 23505 — refetch and retry.
  const attempts = input.entityId ? 3 : 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let prev_hash: string | null = null;
    if (input.entityId) {
      const { data: prev } = await supabase
        .from("audit_events")
        .select("event_hash")
        .eq("entity_type", input.entityType)
        .eq("entity_id", input.entityId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      prev_hash = (prev as any)?.event_hash ?? null;
    }

    // ts is part of the hash input, so it must be STORED too (0047) —
    // otherwise content verification can never recompute the hash.
    const ts = new Date().toISOString();
    const canonical = [
      prev_hash ?? "",
      ts,
      input.actorId,
      input.action,
      canonicalize(payload),
    ].join("|");
    const event_hash = fnv1a(canonical);

    const { error } = await supabase.from("audit_events").insert({
      org_id: input.orgId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      actor_id: input.actorId,
      actor_email: input.actorEmail ?? null,
      payload,
      prev_hash,
      event_hash,
      ts,
      user_agent: navigator.userAgent.slice(0, 256),
    } as any);

    if (!error) return;
    lastError = error;
    if ((error as any)?.code !== "23505") break; // only retry chain races
  }

  // eslint-disable-next-line no-console
  console.warn("[audit] insert failed:", lastError);
  try {
    window.dispatchEvent(
      new CustomEvent(AUDIT_WRITE_FAILED_EVENT, {
        detail: { action: input.action, entityType: input.entityType },
      })
    );
  } catch {
    /* non-browser context (tests) */
  }
}

/** Verify the integrity of a chain. Walks events in order, checks linkage,
 *  and recomputes content hashes where possible.
 *
 *  Events written before 0047 never stored the hashed timestamp, so their
 *  content hash cannot be recomputed — they are LINKAGE-verified only and
 *  counted in `legacyCount`. Events with `ts` get full verification. */
export type ChainVerifyResult =
  | { ok: true; count: number; legacyCount: number }
  | { ok: false; brokenAtEventId: string; reason: string };

export function verifyChain(
  events: {
    id: string;
    prev_hash: string | null;
    event_hash: string;
    created_at: string;
    ts?: string | null;
    actor_id: string | null;
    action: string;
    payload: Record<string, unknown>;
  }[]
): ChainVerifyResult {
  const sorted = [...events].sort(
    (a, b) =>
      (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
      a.id.localeCompare(b.id)
  );
  let expectedPrev: string | null = null;
  let legacyCount = 0;
  for (const e of sorted) {
    if (e.prev_hash !== expectedPrev) {
      return { ok: false, brokenAtEventId: e.id, reason: "prev_hash mismatch" };
    }
    if (e.ts) {
      const canonical = [
        e.prev_hash ?? "",
        e.ts,
        e.actor_id ?? "",
        e.action,
        canonicalize(e.payload),
      ].join("|");
      if (fnv1a(canonical) !== e.event_hash) {
        return { ok: false, brokenAtEventId: e.id, reason: "event_hash mismatch" };
      }
    } else {
      legacyCount += 1; // pre-0047: linkage-verified only
    }
    expectedPrev = e.event_hash;
  }
  return { ok: true, count: sorted.length, legacyCount };
}
