import { describe, it, expect } from "vitest";
import { flowColumns, mergeWithPrevious, canMergeWithPrevious } from "./flow";
import type { PipelineStageRow } from "./types";

function st(p: Partial<PipelineStageRow> & { id: string; position: number }): PipelineStageRow {
  return {
    org_id: "o", key: p.id, label: p.id.toUpperCase(), icon_key: "layers",
    color: "#000", target_days: 14, owner_team_id: null, terminal: false,
    is_core: false, created_at: "", parallel_group: null, ...p,
  } as PipelineStageRow;
}

describe("flowColumns", () => {
  it("all sequential → one column each, in position order", () => {
    const cols = flowColumns([st({ id: "b", position: 20 }), st({ id: "a", position: 10 })]);
    expect(cols.map((c) => c.stages.map((s) => s.id))).toEqual([["a"], ["b"]]);
  });
  it("adjacent stages sharing a group collapse into one lane", () => {
    const cols = flowColumns([
      st({ id: "intake", position: 10 }),
      st({ id: "reg", position: 20, parallel_group: 20 }),
      st({ id: "budget", position: 30, parallel_group: 20 }),
      st({ id: "ctms", position: 40 }),
    ]);
    expect(cols.map((c) => c.stages.map((s) => s.id))).toEqual([
      ["intake"], ["reg", "budget"], ["ctms"],
    ]);
    expect(cols[1].group).toBe(20);
  });
  it("non-adjacent same-group ids do NOT merge across a gap", () => {
    const cols = flowColumns([
      st({ id: "a", position: 10, parallel_group: 99 }),
      st({ id: "b", position: 20 }),
      st({ id: "c", position: 30, parallel_group: 99 }),
    ]);
    expect(cols.length).toBe(3);
  });
});

describe("mergeWithPrevious", () => {
  const stages = [st({ id: "a", position: 10 }), st({ id: "b", position: 20 }), st({ id: "c", position: 30 })];
  it("groups a stage with its predecessor using the predecessor's position", () => {
    const patches = mergeWithPrevious(stages, "b");
    expect(patches).toEqual([
      { id: "a", parallel_group: 10 },
      { id: "b", parallel_group: 10 },
    ]);
  });
  it("reuses an existing predecessor group", () => {
    const s2 = [st({ id: "a", position: 10, parallel_group: 10 }), st({ id: "b", position: 20 }), st({ id: "c", position: 30 })];
    expect(mergeWithPrevious(s2, "b")).toEqual([{ id: "b", parallel_group: 10 }]);
  });
  it("first stage can't merge up", () => {
    expect(mergeWithPrevious(stages, "a")).toEqual([]);
  });
});

describe("canMergeWithPrevious", () => {
  const stages = [st({ id: "a", position: 10 }), st({ id: "b", position: 20, parallel_group: 10 })];
  it("false for the first stage", () => {
    expect(canMergeWithPrevious(stages, "a")).toBe(false);
  });
  it("false when already grouped with predecessor", () => {
    const grouped = [st({ id: "a", position: 10, parallel_group: 10 }), st({ id: "b", position: 20, parallel_group: 10 })];
    expect(canMergeWithPrevious(grouped, "b")).toBe(false);
  });
});
