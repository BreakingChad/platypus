import { describe, it, expect } from "vitest";
import { dueBucket } from "./inboxBuckets";

// Wednesday noon
const now = new Date("2026-06-03T12:00:00");

describe("dueBucket", () => {
  it("null/invalid → none", () => {
    expect(dueBucket(null, now)).toBe("none");
    expect(dueBucket(undefined, now)).toBe("none");
    expect(dueBucket("not-a-date", now)).toBe("none");
  });
  it("before today → overdue (even by a minute)", () => {
    expect(dueBucket("2026-06-02T23:59:00", now)).toBe("overdue");
    expect(dueBucket("2026-05-01T00:00:00", now)).toBe("overdue");
  });
  it("today stays today — morning or evening", () => {
    expect(dueBucket("2026-06-03T08:00:00", now)).toBe("today");
    expect(dueBucket("2026-06-03T23:00:00", now)).toBe("today");
  });
  it("within 7 days → week; beyond → later", () => {
    expect(dueBucket("2026-06-06T09:00:00", now)).toBe("week");
    expect(dueBucket("2026-06-09T23:00:00", now)).toBe("week");
    expect(dueBucket("2026-06-10T01:00:00", now)).toBe("later");
    expect(dueBucket("2026-08-01T00:00:00", now)).toBe("later");
  });
});
