/** Nav + Page Layout configuration model.
 *
 *  An access_role row carries:
 *    nav:           NavGroupConfig[]                  — sidebar layout
 *    page_layouts:  PageLayoutsConfig                 — per-page block layouts
 *
 *  When either is empty, the system default for the user's tier is used.
 *  This keeps fresh installs working without any admin configuration.
 */

export type NavItemConfig = {
  /** Stable id — matches a registry entry so we can swap label/icon safely. */
  key: string;
  /** Override label (empty = use registry default). */
  label?: string;
  /** Override icon (empty = use registry default). */
  icon?: string;
  /** Hidden from this role's sidebar. */
  hidden?: boolean;
};

export type NavGroupConfig = {
  /** Group heading — admin can rename. */
  group: string;
  items: NavItemConfig[];
  /** Whole group hidden (collapses out of the sidebar entirely). */
  hidden?: boolean;
};

export type PageBlockConfig = {
  /** Stable instance id — generated when the block is added to the layout. */
  id: string;
  /** Block type key from BLOCK_REGISTRY. */
  block: string;
  /** Hide the block (keeps the row for re-enabling). */
  hidden?: boolean;
  /** Block-specific settings (title overrides, limits, etc.). */
  settings?: Record<string, unknown>;
};

export type PageLayoutsConfig = Record<string, PageBlockConfig[]>;

/* ============================================================================
 * Nav registry — the catalog of every nav item the app ships with.
 *
 * Admins can hide, rename, reorder, and regroup these; they can't invent new
 * routes from the designer (those need code). Adding a new entry here makes
 * it appear as an available item in the NavDesigner.
 * ========================================================================== */

export type NavRegistryEntry = {
  key: string;
  label: string;       // default label
  icon: string;        // default icon
  hash: string;        // route
  adminOnly?: boolean; // only show as available to admin/developer roles
  description: string;
};

export const NAV_REGISTRY: NavRegistryEntry[] = [
  { key: "home",     label: "Home",       icon: "home",     hash: "#/",                description: "Dashboard landing." },
  { key: "studies",  label: "Studies",    icon: "folder",   hash: "#/studies",         description: "Every study from intake through closeout." },
  { key: "pipeline", label: "Pipeline",   icon: "layers",   hash: "#/pipeline",        description: "Kanban view grouped by stage." },
  { key: "inbox",    label: "Inbox",      icon: "inbox",    hash: "#/inbox",           description: "Tasks routed to you and the roles you hold." },

  { key: "org",         label: "Organization",     icon: "settings",  hash: "#/settings/org",       adminOnly: true, description: "Name, mode, prefix, region." },
  { key: "members",     label: "Members",          icon: "users",     hash: "#/settings/members",   adminOnly: true, description: "Roster + tier management." },
  { key: "fields",      label: "Study fields",     icon: "file",      hash: "#/settings/fields",    adminOnly: true, description: "Per-record field definitions." },
  { key: "stages",      label: "Pipeline stages",  icon: "workflow",  hash: "#/settings/stages",    adminOnly: true, description: "Lifecycle stages." },
  { key: "teams",       label: "Teams & roles",    icon: "users",     hash: "#/settings/teams",     adminOnly: true, description: "Org structure." },
  { key: "access",      label: "Access roles",     icon: "shield",    hash: "#/settings/access",    adminOnly: true, description: "Module permissions per role." },
  { key: "nav",         label: "Nav designer",     icon: "layers",    hash: "#/settings/nav",       adminOnly: true, description: "Sidebar layout by role." },
  { key: "pages",       label: "Page designer",    icon: "workflow",  hash: "#/settings/pages",     adminOnly: true, description: "Drag-drop page layouts." },
  { key: "audit",       label: "Audit feed",       icon: "shield",    hash: "#/audit",              adminOnly: true, description: "Org-wide audit trail with CSV export." },
  { key: "work-streams", label: "Work Streams",    icon: "workflow",  hash: "#/settings/work-streams", adminOnly: true, description: "Pattern Builder — auto-spawn tasks per stage." },
];

export function navEntry(key: string): NavRegistryEntry | undefined {
  return NAV_REGISTRY.find((n) => n.key === key);
}

/* ============================================================================
 * Default nav — used when an access_role has no nav config of its own.
 * Admin-only entries are filtered at resolve time based on the user's tier.
 * ========================================================================== */

export const DEFAULT_NAV: NavGroupConfig[] = [
  {
    group: "Workspace",
    items: [
      { key: "home" },
      { key: "studies" },
      { key: "pipeline" },
      { key: "inbox" },
    ],
  },
  {
    group: "Configure",
    items: [
      { key: "org" },
      { key: "members" },
      { key: "fields" },
      { key: "stages" },
      { key: "teams" },
      { key: "access" },
      { key: "nav" },
      { key: "pages" },
      { key: "audit" },
      { key: "work-streams" },
    ],
  },
];

/** Resolve a nav config + the user's admin status into the final shown
 *  groups. Empty groups are dropped. Admin-only items hide for non-admins
 *  regardless of the role config (defense in depth — RLS still gates writes).
 */
export function resolveNav(
  config: NavGroupConfig[] | null | undefined,
  opts: { isAdmin: boolean }
): { group: string; items: { key: string; label: string; icon: string; hash: string }[] }[] {
  const src = config && config.length > 0 ? config : DEFAULT_NAV;
  return src
    .filter((g) => !g.hidden)
    .map((g) => ({
      group: g.group,
      items: g.items
        .filter((it) => !it.hidden)
        .map((it) => {
          const reg = navEntry(it.key);
          if (!reg) return null;
          if (reg.adminOnly && !opts.isAdmin) return null;
          return {
            key: reg.key,
            label: it.label || reg.label,
            icon: it.icon || reg.icon,
            hash: reg.hash,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    }))
    .filter((g) => g.items.length > 0);
}

/* ============================================================================
 * Designable pages — surfaces the PageLayoutDesigner can edit.
 * Each entry advertises the block ids it allows and a default layout.
 * ========================================================================== */

export type PageRegistryEntry = {
  key: string;            // pageKey used in page_layouts jsonb
  label: string;
  description: string;
  allowedBlocks: string[]; // block keys (from BLOCK_REGISTRY)
  defaultLayout: PageBlockConfig[];
};

export const PAGE_REGISTRY: PageRegistryEntry[] = [
  {
    key: "home",
    label: "Home",
    description: "The dashboard everyone lands on. Mix and match KPI strips, stage breakdowns, recent activity, work tiles.",
    allowedBlocks: [
      "quick-start",
      "setup-checklist",
      "directors-pulse",
      "tasks-due",
      "my-studies",
      "at-risk-studies",
      "workload",
      "kpi-strip",
      "stage-breakdown",
      "recent-activity",
      "cycle-time",
      "setup-hub",
      "work-tiles",
    ],
    defaultLayout: [
      { id: "blk-quick-start", block: "quick-start" },
      { id: "blk-setup-checklist", block: "setup-checklist" },
      { id: "blk-directors-pulse", block: "directors-pulse" },
      { id: "blk-tasks-due", block: "tasks-due" },
      { id: "blk-kpi-strip", block: "kpi-strip" },
      { id: "blk-recent-activity", block: "recent-activity", settings: { limit: 5 } },
    ],
  },
];

export function pageEntry(pageKey: string): PageRegistryEntry | undefined {
  return PAGE_REGISTRY.find((p) => p.key === pageKey);
}

export function resolvePageLayout(
  pageKey: string,
  layouts: PageLayoutsConfig | null | undefined
): PageBlockConfig[] {
  const fromConfig = layouts?.[pageKey];
  if (fromConfig && fromConfig.length > 0) return fromConfig;
  return pageEntry(pageKey)?.defaultLayout ?? [];
}

/** Generate a stable, unique block instance id. */
export function newBlockId(blockType: string): string {
  return `blk-${blockType}-${Math.random().toString(36).slice(2, 9)}`;
}
