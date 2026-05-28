import { describe, it, expect } from "vitest";
import {
  resolveNav,
  resolvePageLayout,
  DEFAULT_NAV,
  PAGE_REGISTRY,
  newBlockId,
} from "./navConfig";

describe("resolveNav", () => {
  it("falls back to DEFAULT_NAV when config is null/empty", () => {
    const resAdmin = resolveNav(null, { isAdmin: true });
    const resAdminEmpty = resolveNav([], { isAdmin: true });
    expect(resAdmin.length).toBeGreaterThan(0);
    expect(resAdminEmpty.length).toBeGreaterThan(0);
    expect(JSON.stringify(resAdmin)).toEqual(JSON.stringify(resAdminEmpty));
  });

  it("filters admin-only items when isAdmin=false", () => {
    const adminView = resolveNav(null, { isAdmin: true });
    const memberView = resolveNav(null, { isAdmin: false });

    // Configure group should disappear entirely for members (all items are admin-only).
    expect(adminView.find((g) => g.group === "Configure")).toBeDefined();
    expect(memberView.find((g) => g.group === "Configure")).toBeUndefined();
  });

  it("respects per-item 'hidden' overrides", () => {
    const cfg = [
      {
        group: "Workspace",
        items: [
          { key: "home" },
          { key: "studies", hidden: true },
        ],
      },
    ];
    const out = resolveNav(cfg, { isAdmin: true });
    const ws = out.find((g) => g.group === "Workspace");
    expect(ws).toBeDefined();
    expect(ws!.items.map((i) => i.key)).toEqual(["home"]);
  });

  it("respects per-group 'hidden' overrides (group dropped from output)", () => {
    const cfg = [
      { group: "Workspace", items: [{ key: "home" }] },
      { group: "Configure", items: [{ key: "org" }], hidden: true },
    ];
    const out = resolveNav(cfg, { isAdmin: true });
    expect(out.map((g) => g.group)).toEqual(["Workspace"]);
  });

  it("uses label/icon override when provided, falls back to registry default otherwise", () => {
    const cfg = [
      {
        group: "Workspace",
        items: [
          { key: "home", label: "Dashboard", icon: "layers" },
          { key: "studies" }, // no override
        ],
      },
    ];
    const out = resolveNav(cfg, { isAdmin: true });
    const items = out[0]!.items;
    expect(items[0]).toEqual(expect.objectContaining({ key: "home", label: "Dashboard", icon: "layers" }));
    expect(items[1]).toEqual(expect.objectContaining({ key: "studies", label: "Studies", icon: "folder" }));
  });

  it("drops unknown keys silently", () => {
    const cfg = [{ group: "Workspace", items: [{ key: "home" }, { key: "ghost" }] }];
    const out = resolveNav(cfg, { isAdmin: true });
    expect(out[0]!.items.map((i) => i.key)).toEqual(["home"]);
  });

  it("drops empty groups from output", () => {
    const cfg = [
      { group: "Workspace", items: [{ key: "home" }] },
      { group: "Empty", items: [] },
    ];
    const out = resolveNav(cfg, { isAdmin: true });
    expect(out.map((g) => g.group)).toEqual(["Workspace"]);
  });
});

describe("resolvePageLayout", () => {
  it("returns the page's default layout when config is null", () => {
    const layout = resolvePageLayout("home", null);
    const expected = PAGE_REGISTRY.find((p) => p.key === "home")!.defaultLayout;
    expect(layout).toEqual(expected);
  });

  it("returns the configured layout when present", () => {
    const custom = [{ id: "blk-x", block: "kpi-strip" }];
    const layout = resolvePageLayout("home", { home: custom });
    expect(layout).toEqual(custom);
  });

  it("returns empty array for unknown pages with no defaults", () => {
    const layout = resolvePageLayout("ghost_page", null);
    expect(layout).toEqual([]);
  });
});

describe("newBlockId", () => {
  it("produces unique ids per invocation", () => {
    const a = newBlockId("kpi-strip");
    const b = newBlockId("kpi-strip");
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^blk-kpi-strip-/);
  });
});
