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
  /** Where the block renders relative to the page's core content.
   *  "top" (default) = above; "bottom" = below. Home has no core content,
   *  so both regions simply stack. */
  region?: "top" | "bottom";
  /** Block-specific settings (title overrides, limits, etc.). */
  settings?: Record<string, unknown>;
};

/** Per-page tab override — order in the array IS the tab order. */
export type PageTabConfig = {
  key: string;
  /** Override label (empty = registry default). */
  label?: string;
  hidden?: boolean;
};

/** Full per-page config. Legacy values were a bare PageBlockConfig[];
 *  resolvePageConfig normalizes both shapes. */
export type PageConfig = {
  blocks: PageBlockConfig[];
  tabs?: PageTabConfig[];
  /** Role-level page defaults (default filters, default tab, …) consumed by
   *  the page until the signed-in user makes their own choice. */
  options?: Record<string, unknown>;
};

export type PageLayoutsConfig = Record<string, PageBlockConfig[] | PageConfig>;

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
  { key: "intake",   label: "Intake",     icon: "inbox",    hash: "#/intake",          description: "Triage queue — complete startup data, commit or decline." },
  { key: "studies",  label: "Studies",    icon: "folder",   hash: "#/studies",         description: "Every study from intake through closeout." },
  { key: "pipeline", label: "Pipeline",   icon: "layers",   hash: "#/pipeline",        description: "Kanban view grouped by stage." },
  { key: "inbox",    label: "Inbox",      icon: "inbox",    hash: "#/inbox",           description: "Tasks routed to you and the roles you hold." },
  { key: "sites",    label: "Sites",      icon: "hospital", hash: "#/sites",           description: "Site profiles, capabilities, and qualification data." },

  { key: "org",         label: "Organization",     icon: "settings",  hash: "#/settings/org",       adminOnly: true, description: "Name, mode, prefix, region." },
  { key: "site-setup",  label: "Site setup",       icon: "hospital",  hash: "#/settings/site-setup", adminOnly: true, description: "Provision sites — add, code, deactivate. They then appear in the Sites directory to manage." },
  { key: "therapeutic-areas", label: "Therapeutic areas", icon: "layers", hash: "#/settings/therapeutic-areas", adminOnly: true, description: "The org's therapeutic-area list — feeds the study Therapeutic area field used for team access slicing." },
  { key: "members",     label: "Members",          icon: "users",     hash: "#/settings/members",   adminOnly: true, description: "Roster + tier management." },
  { key: "fields",      label: "Study fields",     icon: "file",      hash: "#/settings/fields",    adminOnly: true, description: "Per-record field definitions." },
  { key: "stages",      label: "Pipelines",        icon: "workflow",  hash: "#/settings/stages",    adminOnly: true, description: "Your stage backbones — each pipeline's stages, order, parallels and target days. Work streams are built on these." },
  { key: "teams",       label: "Teams & roles",    icon: "users",     hash: "#/settings/teams",     adminOnly: true, description: "Org structure." },
  { key: "access",      label: "Access roles",     icon: "shield",    hash: "#/settings/access",    adminOnly: true, description: "Module permissions per role." },
  { key: "nav",         label: "Nav designer",     icon: "layers",    hash: "#/settings/nav",       adminOnly: true, description: "Sidebar layout by role." },
  { key: "pages",       label: "Page designer",    icon: "workflow",  hash: "#/settings/pages",     adminOnly: true, description: "Drag-drop page layouts." },
  { key: "audit",       label: "Audit feed",       icon: "shield",    hash: "#/audit",              adminOnly: true, description: "Org-wide audit trail with CSV export." },
  { key: "work-streams", label: "Work streams", icon: "layers",  hash: "#/settings/work-streams", adminOnly: true, description: "Add the modules, tasks and teams for a pipeline's stages. Multiple work streams per pipeline." },
  { key: "forms",        label: "Intake forms",    icon: "mail",      hash: "#/settings/forms",        adminOnly: true, description: "External intake forms — public link, versioned, required-field enforcement." },
  { key: "sponsors",     label: "Sponsors & CROs", icon: "building",  hash: "#/settings/sponsors",     adminOnly: true, description: "Catalogs of sponsors and CROs — picked on studies, not retyped." },
  { key: "setup",        label: "Guided setup",    icon: "check",     hash: "#/setup",                 adminOnly: true, description: "First-run guided configuration." },
  { key: "settings",     label: "Settings",        icon: "settings",  hash: "#/settings",              adminOnly: true, description: "All configuration tools, explained." },
  { key: "my-studies",   label: "My Studies",      icon: "folder",    hash: "#/my-studies",            description: "Studies you're actively working." },
  { key: "team-tasks",   label: "Team tasks",      icon: "users",     hash: "#/team-tasks",            description: "Your team's open queue." },
  { key: "approvals",    label: "Approvals",       icon: "check",     hash: "#/approvals",             description: "Documents waiting on your signature or review." },
  { key: "calendar",     label: "Calendar",        icon: "layers",    hash: "#/calendar",              description: "Due dates and milestones." },
  { key: "amendments",   label: "Amendments",      icon: "file",      hash: "#/amendments",            description: "Intake for studies that already exist." },
  { key: "analytics",    label: "Analytics",       icon: "workflow",  hash: "#/analytics",             description: "Cycle times, throughput, and exports." },
  { key: "binders",      label: "Binders",         icon: "shield",    hash: "#/binders",               description: "eReg / eISF document binders." },
  { key: "expirations",  label: "Expirations",     icon: "alert",     hash: "#/expirations",           description: "Dated documents approaching expiry." },
];

export function navEntry(key: string): NavRegistryEntry | undefined {
  return NAV_REGISTRY.find((n) => n.key === key);
}

/* ============================================================================
 * Default nav — used when an access_role has no nav config of its own.
 * Admin-only entries are filtered at resolve time based on the user's tier.
 * ========================================================================== */

export const DEFAULT_NAV: NavGroupConfig[] = [
  /* Plan A (Chad, 2026-06-03): the nav reads like a workday — what needs
     me (Work queues), what I'm looking at (Studies), what I look up
     (Directory). "Pipeline tools" dissolved: Intake is a work queue, By
     stage is a view of All Studies, Amendments is a tab on Intake, Sites
     is reference data. */
  {
    group: "Workspace",
    items: [
      { key: "home", label: "Today" },
      { key: "calendar" },
    ],
  },
  {
    group: "Work queues",
    items: [
      { key: "inbox" },
      { key: "intake" },
      { key: "team-tasks" },
      { key: "approvals" },
      { key: "expirations" },
    ],
  },
  {
    group: "Studies",
    items: [
      { key: "studies", label: "All Studies" },
      { key: "my-studies" },
    ],
  },
  {
    group: "Directory",
    items: [
      { key: "sites" },
    ],
  },
  {
    // Hidden (Chad, 2026-06-03): eReg/binders deferred to a later date.
    // The per-study Documents tab (upload, versions, e-sign, audit) is
    // unaffected — this only removes the standalone Binders module from
    // the sidebar. Re-show here or per role in the nav designer.
    group: "Documents",
    hidden: true,
    items: [
      { key: "binders" },
    ],
  },
  {
    group: "Insights",
    items: [
      { key: "analytics" },
      // Hidden by default (Chad, 2026-06-03): the audit chain lives inside
      // each study's Activity tab for daily work; the org-wide feed stays
      // reachable via Settings → Governance and the nav designer can
      // re-show it per role (inspections, QA).
      { key: "audit", label: "Audit Trail", hidden: true },
    ],
  },
  {
    group: "Configure",
    items: [
      { key: "settings" },
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

export type PageOptionChoice = { value: string; label: string };
export type PageOptionSchema = {
  key: string;
  label: string;
  kind: "boolean" | "select";
  choices?: PageOptionChoice[];
  description?: string;
  /** What an UNSET boolean means in the app — keeps the designer checkbox
   *  honest (e.g. column toggles default to shown). */
  defaultValue?: boolean;
};

export type PageRegistryEntry = {
  key: string;            // pageKey used in page_layouts jsonb
  label: string;
  description: string;
  /** What the page's built-in content is — shown as the locked anchor in
   *  the designer. Undefined = the page is fully block-driven (Home). */
  coreLabel?: string;
  allowedBlocks: string[]; // block keys (from BLOCK_REGISTRY)
  defaultLayout: PageBlockConfig[];
  /** Tabs the page's core content exposes (designable: order/rename/hide). */
  tabs?: { key: string; label: string }[];
  /** Role-level page defaults the designer can set. */
  optionsSchema?: PageOptionSchema[];
};

/** Every registered block — any block can go on any page. */
export const ALL_BLOCK_KEYS = [
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
  "escalations",
  "intake-queue",
  "site-coverage",
];

export const PAGE_REGISTRY: PageRegistryEntry[] = [
  {
    key: "home",
    label: "Home",
    description: "The dashboard everyone lands on — fully block-driven.",
    allowedBlocks: ALL_BLOCK_KEYS,
    defaultLayout: [
      { id: "blk-quick-start", block: "quick-start" },
      { id: "blk-setup-checklist", block: "setup-checklist" },
      { id: "blk-directors-pulse", block: "directors-pulse" },
      { id: "blk-tasks-due", block: "tasks-due" },
      { id: "blk-kpi-strip", block: "kpi-strip" },
      { id: "blk-recent-activity", block: "recent-activity", settings: { limit: 5 } },
    ],
  },
  {
    key: "intake",
    label: "Intake",
    description: "The triage queue. Add context blocks above or below it.",
    coreLabel: "Intake triage queue (completeness, commit, decline)",
    allowedBlocks: ALL_BLOCK_KEYS,
    defaultLayout: [],
  },
  {
    key: "studies",
    label: "Studies",
    description: "The full portfolio list. Surround it with the signals each role needs.",
    coreLabel: "Portfolio list (filters, search, bulk actions)",
    allowedBlocks: ALL_BLOCK_KEYS,
    defaultLayout: [],
    optionsSchema: [
      { key: "showClosed", label: "Show closed studies by default", kind: "boolean", description: "Users can still toggle it; this sets the starting point for people in this role." },
      { key: "healthFilter", label: "Default health filter", kind: "select", choices: [
        { value: "all", label: "All" },
        { value: "red", label: "Overdue" },
        { value: "yellow", label: "At risk" },
        { value: "green", label: "Healthy" },
      ] },
      { key: "showHealthColumn", label: "Show the Health column", kind: "boolean", defaultValue: true, description: "Unchecked hides it for this role; the dot on the code stays." },
      { key: "showPiColumn", label: "Show the PI column", kind: "boolean", defaultValue: true },
      { key: "showCreatedColumn", label: "Show the Created column", kind: "boolean", defaultValue: true },
    ],
  },
  {
    key: "pipeline",
    label: "Pipeline",
    description: "The kanban board grouped by stage.",
    coreLabel: "Stage kanban (drag to advance)",
    allowedBlocks: ALL_BLOCK_KEYS,
    defaultLayout: [],
    optionsSchema: [
      { key: "showClosed", label: "Show closed studies by default", kind: "boolean" },
      { key: "viewMode", label: "Default board view", kind: "select", choices: [
        { value: "scroll", label: "Columns (horizontal scroll)" },
        { value: "tabbed", label: "Tabbed by stage" },
      ], description: "Users can still switch views; this sets the starting point." },
    ],
  },
  {
    key: "sites",
    label: "Sites",
    description: "The site information collection system.",
    coreLabel: "Site list + profile drawer",
    allowedBlocks: ALL_BLOCK_KEYS,
    defaultLayout: [],
  },
  {
    key: "inbox",
    label: "Inbox",
    description: "Tasks routed to each person and their roles.",
    coreLabel: "Task queue (mine / team / all)",
    allowedBlocks: ALL_BLOCK_KEYS,
    defaultLayout: [],
    optionsSchema: [
      { key: "defaultTab", label: "Default queue", kind: "select", choices: [
        { value: "mine", label: "Mine" },
        { value: "team", label: "My team's roles" },
        { value: "all", label: "All open (admins)" },
      ] },
    ],
  },
  {
    key: "audit",
    label: "Audit feed",
    description: "The org-wide audit chain (admin).",
    coreLabel: "Audit chain (filters, CSV export, verify)",
    allowedBlocks: ALL_BLOCK_KEYS,
    defaultLayout: [],
  },
  {
    key: "study-detail",
    label: "Study record",
    description: "The study page itself — reorder, rename, or hide its tabs; set the default tab; add blocks above or below the record.",
    coreLabel: "Study record (header, health, stage bar + tabs)",
    allowedBlocks: ALL_BLOCK_KEYS,
    defaultLayout: [],
    tabs: [
      { key: "overview", label: "Overview" },
      { key: "feasibility", label: "Feasibility" },
      { key: "sites", label: "Sites" },
      { key: "startup", label: "Startup docs" },
      { key: "workstream", label: "Work stream" },
      { key: "activity", label: "Activity" },
      { key: "tasks", label: "Tasks" },
      { key: "documents", label: "Documents" },
    ],
    optionsSchema: [
      { key: "defaultTab", label: "Default tab", kind: "select", choices: [
        { value: "overview", label: "Overview" },
        { value: "feasibility", label: "Feasibility" },
        { value: "activity", label: "Activity" },
        { value: "tasks", label: "Tasks" },
        { value: "documents", label: "Documents" },
      ] },
    ],
  },
];

export function pageEntry(pageKey: string): PageRegistryEntry | undefined {
  return PAGE_REGISTRY.find((p) => p.key === pageKey);
}

/** Normalize either stored shape (legacy array | PageConfig object) into a
 *  full PageConfig, falling back to the registry defaults. */
export function resolvePageConfig(
  pageKey: string,
  layouts: PageLayoutsConfig | null | undefined
): PageConfig {
  const raw = layouts?.[pageKey];
  const entry = pageEntry(pageKey);
  const registryTabs = (entry?.tabs ?? []).map((t) => ({ key: t.key }));
  if (Array.isArray(raw)) {
    return { blocks: raw.length > 0 ? raw : entry?.defaultLayout ?? [], tabs: registryTabs, options: {} };
  }
  if (raw && typeof raw === "object") {
    const blocks = Array.isArray(raw.blocks) && raw.blocks.length > 0 ? raw.blocks : entry?.defaultLayout ?? [];
    // Merge stored tab config with the registry: keep stored order, append
    // any new registry tabs the stored config doesn't know about yet.
    const stored = Array.isArray(raw.tabs) ? raw.tabs : [];
    const known = new Set(stored.map((t) => t.key));
    const valid = new Set((entry?.tabs ?? []).map((t) => t.key));
    const tabs = [
      ...stored.filter((t) => valid.has(t.key)),
      ...registryTabs.filter((t) => !known.has(t.key)),
    ];
    return { blocks, tabs, options: raw.options ?? {} };
  }
  return { blocks: entry?.defaultLayout ?? [], tabs: registryTabs, options: {} };
}

export function resolvePageLayout(
  pageKey: string,
  layouts: PageLayoutsConfig | null | undefined
): PageBlockConfig[] {
  return resolvePageConfig(pageKey, layouts).blocks;
}

/** Generate a stable, unique block instance id. */
export function newBlockId(blockType: string): string {
  return `blk-${blockType}-${Math.random().toString(36).slice(2, 9)}`;
}
