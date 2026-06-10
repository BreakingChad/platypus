import { describe, it, expect } from "vitest";
import { pickEscalationTargetRole, daysOverdue } from "./escalations";

const roles = [
  { id: "dir", team_id: "t1", level: 1 },
  { id: "mgr", team_id: "t1", level: 2 },
  { id: "crc", team_id: "t1", level: 3 },
  { id: "other-mgr", team_id: "t2", level: 2 },
];

describe("pickEscalationTargetRole", () => {
  it("escalates one level up within the same team", () => {
    expect(pickEscalationTargetRole("crc", roles)).toBe("mgr");
    expect(pickEscalationTargetRole("mgr", roles)).toBe("dir");
  });
  it("top of the hierarchy has nowhere to go", () => {
    expect(pickEscalationTargetRole("dir", roles)).toBeNull();
  });
  it("never crosses teams", () => {
    expect(pickEscalationTargetRole("other-mgr", roles)).toBeNull();
  });
  it("null/unknown source roles return null", () => {
    expect(pickEscalationTargetRole(null, roles)).toBeNull();
    expect(pickEscalationTargetRole("ghost", roles)).toBeNull();
  });
  it("skips levels when the middle is empty", () => {
    const sparse = [
      { id: "dir", team_id: "t1", level: 1 },
      { id: "crc", team_id: "t1", level: 3 },
    ];
    expect(pickEscalationTargetRole("crc", sparse)).toBe("dir");
  });
});

describe("daysOverdue", () => {
  const now = new Date("2026-06-09T12:00:00Z");
  it("whole days, floored", () => {
    expect(daysOverdue("2026-06-07T12:00:00Z", now)).toBe(2);
    expect(daysOverdue("2026-06-07T00:00:00Z", now)).toBe(2);
    expect(daysOverdue("2026-06-09T00:00:00Z", now)).toBe(0);
  });
});
