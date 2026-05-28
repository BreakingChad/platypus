import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("renders a simple two-column table", () => {
    const csv = toCsv([
      ["code", "title"],
      ["STU-001", "Alpha trial"],
      ["STU-002", "Beta trial"],
    ]);
    expect(csv).toBe("code,title\nSTU-001,Alpha trial\nSTU-002,Beta trial");
  });

  it("quotes cells containing commas", () => {
    const csv = toCsv([
      ["title", "tags"],
      ["Phase II, multi-arm", "oncology"],
    ]);
    expect(csv).toBe('title,tags\n"Phase II, multi-arm",oncology');
  });

  it("escapes internal quotes by doubling", () => {
    const csv = toCsv([
      ["title"],
      ['Said "hello"'],
    ]);
    expect(csv).toBe('title\n"Said ""hello"""');
  });

  it("quotes cells with newlines", () => {
    const csv = toCsv([
      ["note"],
      ["line one\nline two"],
    ]);
    expect(csv).toBe('note\n"line one\nline two"');
  });

  it("renders null and undefined as empty strings", () => {
    const csv = toCsv([
      ["a", "b", "c"],
      [null, undefined, "x"],
    ]);
    expect(csv).toBe("a,b,c\n,,x");
  });

  it("stringifies numbers without quoting", () => {
    const csv = toCsv([
      ["count", "ratio"],
      [42, 0.5],
    ]);
    expect(csv).toBe("count,ratio\n42,0.5");
  });

  it("handles an empty matrix", () => {
    expect(toCsv([])).toBe("");
  });

  it("handles a single empty row", () => {
    expect(toCsv([[]])).toBe("");
  });
});
