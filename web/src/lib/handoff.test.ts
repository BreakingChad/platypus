import { describe, it, expect } from "vitest";
import { buildHandoffReceipt, HANDOFF_RECEIPT_PREFIX } from "./handoff";

const base = {
  id: "task1",
  org_id: "org1",
  study_id: "study1",
  stage_key: "regulatory",
  kind: "handoff" as const,
  title: "Hand budget to coordination",
  position: 30,
  handoff_to_role_id: "role_crc",
};

const opts = { holderIds: [] as string[], actorUserId: "u1", now: new Date("2026-06-03T12:00:00Z") };

describe("buildHandoffReceipt", () => {
  it("returns null for non-handoff kinds", () => {
    expect(buildHandoffReceipt({ ...base, kind: "manual" as any }, opts)).toBeNull();
    expect(buildHandoffReceipt({ ...base, kind: "escalation" as any }, opts)).toBeNull();
  });

  it("returns null when no receiving role is set", () => {
    expect(buildHandoffReceipt({ ...base, handoff_to_role_id: null }, opts)).toBeNull();
  });

  it("builds an open receipt for the receiving role with the prefix title", () => {
    const r = buildHandoffReceipt(base, opts)!;
    expect(r.title).toBe(`${HANDOFF_RECEIPT_PREFIX}Hand budget to coordination`);
    expect(r.assigned_to_role_id).toBe("role_crc");
    expect(r.status).toBe("open");
    expect(r.kind).toBe("manual");
    expect(r.study_id).toBe("study1");
    expect(r.stage_key).toBe("regulatory");
    expect(r.created_by).toBe("u1");
    expect(r.receipt_of_task_id).toBe("task1"); // 0047 dedupe key
  });

  it("is due 2 days after completion", () => {
    const r = buildHandoffReceipt(base, opts)!;
    expect(r.due_at).toBe("2026-06-05T12:00:00.000Z");
  });

  it("auto-assigns when exactly one person holds the receiving role", () => {
    const r = buildHandoffReceipt(base, { ...opts, holderIds: ["alice"] })!;
    expect(r.assigned_to_user_id).toBe("alice");
  });

  it("leaves multi-holder roles on the role queue", () => {
    const r = buildHandoffReceipt(base, { ...opts, holderIds: ["alice", "bob"] })!;
    expect(r.assigned_to_user_id).toBeNull();
    expect(r.assigned_to_role_id).toBe("role_crc");
  });

  it("survives a null study (org-level handoffs)", () => {
    const r = buildHandoffReceipt({ ...base, study_id: null, stage_key: null }, opts)!;
    expect(r.study_id).toBeNull();
    expect(r.stage_key).toBeNull();
  });
});
