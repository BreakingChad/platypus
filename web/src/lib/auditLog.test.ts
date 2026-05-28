import { describe, it, expect } from "vitest";
import { verifyChain } from "./auditLog";

/** auditLog.ts doesn't export fnv1a directly — but we can exercise it
 *  end-to-end via verifyChain by feeding it known event sequences. */

// Build the same canonical signing used inside auditLog.ts via the public
// verifyChain — we generate hashes by writing events and then verifying.
// Since we can't import fnv1a, the test focuses on the verifier's chain
// invariants: prev_hash linkage and tamper detection.

// A helper that mirrors the public canonical signing path: we precompute
// hashes by feeding events through verifyChain with no expected prev_hash
// and reading what the function reports. For deterministic test fixtures
// we hand-pin known-good hashes computed offline.

// Hash for prev_hash="" ts="t1" actor="alice" action="created" payload="{}"
// canonical = "|t1|alice|created|{}"
const KNOWN_HASH_1 = computeFnv1aLocal("|t1|alice|created|{}");
// Hash for prev_hash=KNOWN_HASH_1 ts="t2" actor="alice" action="closed" payload="{}"
const KNOWN_HASH_2 = computeFnv1aLocal(KNOWN_HASH_1 + "|t2|alice|closed|{}");

function computeFnv1aLocal(input: string): string {
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET = 0x811c9dc5 >>> 0;
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

describe("verifyChain", () => {
  it("returns ok for a clean two-event chain", () => {
    const events = [
      {
        id: "e1",
        prev_hash: null,
        event_hash: KNOWN_HASH_1,
        created_at: "t1",
        actor_id: "alice",
        action: "created",
        payload: {},
      },
      {
        id: "e2",
        prev_hash: KNOWN_HASH_1,
        event_hash: KNOWN_HASH_2,
        created_at: "t2",
        actor_id: "alice",
        action: "closed",
        payload: {},
      },
    ];
    const r = verifyChain(events);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.count).toBe(2);
  });

  it("detects prev_hash mismatch (broken linkage)", () => {
    const events = [
      {
        id: "e1",
        prev_hash: null,
        event_hash: KNOWN_HASH_1,
        created_at: "t1",
        actor_id: "alice",
        action: "created",
        payload: {},
      },
      {
        id: "e2",
        prev_hash: "deadbeef", // wrong
        event_hash: KNOWN_HASH_2,
        created_at: "t2",
        actor_id: "alice",
        action: "closed",
        payload: {},
      },
    ];
    const r = verifyChain(events);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.brokenAtEventId).toBe("e2");
      expect(r.reason).toMatch(/prev_hash/);
    }
  });

  it("detects event_hash mismatch (tampered payload)", () => {
    const events = [
      {
        id: "e1",
        prev_hash: null,
        event_hash: KNOWN_HASH_1,
        created_at: "t1",
        actor_id: "alice",
        action: "created",
        payload: { tampered: true }, // doesn't match the hash
      },
    ];
    const r = verifyChain(events);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/event_hash/);
  });

  it("returns ok for empty event list", () => {
    const r = verifyChain([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.count).toBe(0);
  });

  it("walks events in created_at order (out-of-order input still verifies)", () => {
    const reversed = [
      {
        id: "e2",
        prev_hash: KNOWN_HASH_1,
        event_hash: KNOWN_HASH_2,
        created_at: "t2",
        actor_id: "alice",
        action: "closed",
        payload: {},
      },
      {
        id: "e1",
        prev_hash: null,
        event_hash: KNOWN_HASH_1,
        created_at: "t1",
        actor_id: "alice",
        action: "created",
        payload: {},
      },
    ];
    const r = verifyChain(reversed);
    expect(r.ok).toBe(true);
  });
});
