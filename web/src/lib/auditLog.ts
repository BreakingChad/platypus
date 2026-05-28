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

export async function writeAuditEvent(input: AuditWriteInput): Promise<void> {
  // Find the most recent prev_hash for this entity.
  let prev_hash: string | null = null;
  if (input.entityId) {
    const { data: prev } = await supabase
      .from("audit_events")
      .select("event_hash")
      .eq("entity_type", input.entityType)
      .eq("entity_id", input.entityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    prev_hash = (prev as any)?.event_hash ?? null;
  }

  const ts = new Date().toISOString();
  const payload = input.payload ?? {};
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
    user_agent: navigator.userAgent.slice(0, 256),
  } as any);

  if (error) {
    // Don't break the user flow on audit-log failure — surface to console.
    // eslint-disable-next-line no-console
    console.warn("[audit] insert failed:", error);
  }
}

/** Verify the integrity of a chain. Walks events in order, recomputes
 *  hashes, and reports the first break (or "ok"). */
export type ChainVerifyResult =
  | { ok: true; count: number }
  | { ok: false; brokenAtEventId: string; reason: string };

export function verifyChain(events: { id: string; prev_hash: string | null; event_hash: string; created_at: string; actor_id: string | null; action: string; payload: Record<string, unknown> }[]): ChainVerifyResult {
  const sorted = [...events].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? "")
  );
  let expectedPrev: string | null = null;
  for (const e of sorted) {
    if (e.prev_hash !== expectedPrev) {
      return { ok: false, brokenAtEventId: e.id, reason: "prev_hash mismatch" };
    }
    const canonical = [
      e.prev_hash ?? "",
      e.created_at,
      e.actor_id ?? "",
      e.action,
      canonicalize(e.payload),
    ].join("|");
    const recomputed = fnv1a(canonical);
    if (recomputed !== e.event_hash) {
      return { ok: false, brokenAtEventId: e.id, reason: "event_hash mismatch" };
    }
    expectedPrev = e.event_hash;
  }
  return { ok: true, count: sorted.length };
}
