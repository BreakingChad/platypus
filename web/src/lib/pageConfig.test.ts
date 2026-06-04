import { describe, it, expect } from "vitest";
import {
  ALL_BLOCK_KEYS,
  PAGE_REGISTRY,
  pageEntry,
  resolvePageConfig,
  resolvePageLayout,
  type PageBlockConfig,
  type PageLayoutsConfig,
} from "./navConfig";

const blk = (id: string, block: string, extra: Partial<PageBlockConfig> = {}): PageBlockConfig => ({
  id,
  block,
  settings: {},
  ...extra,
});

describe("resolvePageConfig", () => {
  it("normalizes a legacy bare array into a full PageConfig", () => {
    const layouts: PageLayoutsConfig = { studies: [blk("a", "kpi-strip")] };
    const cfg = resolvePageConfig("studies", layouts);
    expect(cfg.blocks).toHaveLength(1);
    expect(cfg.blocks[0].block).toBe("kpi-strip");
    expect(cfg.options).toEqual({});
  });

  it("falls back to registry defaults when nothing is stored", () => {
    const cfg = resolvePageConfig("home", null);
    expect(cfg.blocks).toEqual(pageEntry("home")!.defaultLayout);
  });

  it("empty stored blocks fall back to the page default layout", () => {
    const layouts: PageLayoutsConfig = { home: { blocks: [], options: {} } };
    const cfg = resolvePageConfig("home", layouts);
    expect(cfg.blocks).toEqual(pageEntry("home")!.defaultLayout);
  });

  it("keeps stored tab order and appends new registry tabs", () => {
    const layouts: PageLayoutsConfig = {
      "study-detail": {
        blocks: [],
        // stored before "documents" existed; custom order, one renamed+hidden
        tabs: [
          { key: "tasks" },
          { key: "overview", label: "Summary" },
          { key: "activity", hidden: true },
        ],
        options: {},
      },
    };
    const cfg = resolvePageConfig("study-detail", layouts);
    const keys = (cfg.tabs ?? []).map((t) => t.key);
    // stored order preserved first…
    expect(keys.slice(0, 3)).toEqual(["tasks", "overview", "activity"]);
    // …then registry tabs the stored config didn't know about
    expect(keys).toContain("feasibility");
    expect(keys).toContain("documents");
    // overrides survive
    const ov = cfg.tabs!.find((t) => t.key === "overview")!;
    expect(ov.label).toBe("Summary");
    expect(cfg.tabs!.find((t) => t.key === "activity")!.hidden).toBe(true);
  });

  it("drops stored tabs that no longer exist in the registry", () => {
    const layouts: PageLayoutsConfig = {
      "study-detail": { blocks: [], tabs: [{ key: "ghost-tab" }, { key: "overview" }], options: {} },
    };
    const keys = (resolvePageConfig("study-detail", layouts).tabs ?? []).map((t) => t.key);
    expect(keys).not.toContain("ghost-tab");
    expect(keys).toContain("overview");
  });

  it("resolvePageLayout stays compatible with both shapes", () => {
    const legacy: PageLayoutsConfig = { inbox: [blk("x", "tasks-due")] };
    const modern: PageLayoutsConfig = { inbox: { blocks: [blk("y", "escalations")], options: {} } };
    expect(resolvePageLayout("inbox", legacy)[0].block).toBe("tasks-due");
    expect(resolvePageLayout("inbox", modern)[0].block).toBe("escalations");
  });

  it("region defaults to top when unset", () => {
    const layouts: PageLayoutsConfig = {
      pipeline: { blocks: [blk("a", "kpi-strip"), blk("b", "escalations", { region: "bottom" })], options: {} },
    };
    const cfg = resolvePageConfig("pipeline", layouts);
    expect(cfg.blocks.filter((b) => (b.region ?? "top") === "top")).toHaveLength(1);
    expect(cfg.blocks.filter((b) => b.region === "bottom")).toHaveLength(1);
  });
});

describe("page registry sanity", () => {
  it("every page's allowedBlocks reference known block keys", () => {
    const known = new Set(ALL_BLOCK_KEYS);
    for (const p of PAGE_REGISTRY) {
      for (const k of p.allowedBlocks) expect(known.has(k)).toBe(true);
      for (const b of p.defaultLayout) expect(known.has(b.block)).toBe(true);
    }
  });

  it("ALL_BLOCK_KEYS has no duplicates", () => {
    expect(new Set(ALL_BLOCK_KEYS).size).toBe(ALL_BLOCK_KEYS.length);
  });

  it("page keys are unique and tabs/options well-formed", () => {
    const keys = PAGE_REGISTRY.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PAGE_REGISTRY) {
      for (const t of p.tabs ?? []) expect(t.key.length).toBeGreaterThan(0);
      for (const o of p.optionsSchema ?? []) {
        expect(["boolean", "select"]).toContain(o.kind);
        if (o.kind === "select") expect((o.choices ?? []).length).toBeGreaterThan(0);
      }
    }
  });
});
