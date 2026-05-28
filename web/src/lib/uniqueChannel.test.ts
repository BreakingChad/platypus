import { describe, it, expect } from "vitest";
import { uniqueChannelName } from "./uniqueChannel";

describe("uniqueChannelName", () => {
  it("preserves the base prefix", () => {
    const n = uniqueChannelName("study-abc");
    expect(n.startsWith("study-abc-")).toBe(true);
  });

  it("produces a distinct suffix on each call", () => {
    const a = uniqueChannelName("x");
    const b = uniqueChannelName("x");
    expect(a).not.toEqual(b);
  });

  it("suffix length is ~6 chars of base36", () => {
    const n = uniqueChannelName("base");
    const suffix = n.replace(/^base-/, "");
    expect(suffix.length).toBeGreaterThan(2);
    expect(suffix.length).toBeLessThanOrEqual(6);
    expect(suffix).toMatch(/^[0-9a-z]+$/);
  });
});
