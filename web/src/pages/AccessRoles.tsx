import { friendlyError } from "../lib/errors";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useEffect, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { TeamRoleRow, TeamRow, SiteRow, StudyRow } from "../lib/types";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import type { AccessRoleRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { DraftInput } from "../components/ui/DraftInput";
import { PageHeader } from "../components/ui/PageHeader";
import { AutoSaveNote } from "../components/ui/AutoSaveNote";
import { EmptyState } from "../components/ui/EmptyState";

/** AccessRoles — admin-only.
 *
 *  An "access role" controls what a user CAN see/do in Platypus:
 *  module-level permissions (none / read / edit / admin), portfolio scope
 *  (assigned-only / all), TA & site scope. Org admins define them once;
 *  every user gets one access role and inherits the permissions.
 *
 *  Compare and contrast with TeamBuilder: that's about *what work you own*;
 *  this is about *what you're allowed to do in the system*.
 */

const MODULES = [
  { key: "studies",      label: "Studies",              desc: "Study records and lifecycle" },
  { key: "documents",    label: "ISF documents",        desc: "Site file (ISF) binders — site-level docs" },
  { key: "regulatory",   label: "Regulatory documents", desc: "Regulatory / eReg (TMF) — often a dedicated team" },
  { key: "sites",        label: "Sites directory",      desc: "The org's sites catalog and profiles" },
  { key: "approvals",    label: "Approvals",            desc: "Approval queues and e-signatures" },
  { key: "workflows",    label: "Workstreams",          desc: "Stage pipelines, task flows, and tasks" },
  { key: "analytics",    label: "Analytics",            desc: "Reports, dashboards, audit log" },
  { key: "admin",        label: "Configuration",        desc: "All Settings — Foundation, People & roles, Governance" },
];

// Human-facing permission levels (keys stay none/read/edit/admin in the data).
const PERM_LEVELS: { key: string; label: string; tone: "neutral" | "info" | "brand" | "warning" }[] = [
  { key: "none",  label: "No access", tone: "neutral" },
  { key: "read",  label: "View",      tone: "info" },
  { key: "edit",  label: "Edit",      tone: "brand" },
  { key: "admin", label: "Full",      tone: "warning" },
];
const levelLabel = (k: string) => PERM_LEVELS.find((p) => p.key === k)?.label ?? k;

const scopeLabel = (k: string) => {
  switch (k) {
    case "all": return "All studies";
    case "assigned": return "Assigned only";
    case "site": return "By site";
    case "ta": return "By area";
    case "site_and_ta": return "By site & area";
    case "site_or_ta": return "By site or area";
    default: return k;
  }
};

export function AccessRoles() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const roles = useOrgTable<AccessRoleRow>("access_roles", { realtime: true });
  const teamRoles = useOrgTable<TeamRoleRow>("team_roles", { realtime: true });
  const teamsTbl = useOrgTable<TeamRow>("teams");
  const sitesTbl = useOrgTable<SiteRow>("sites", { orderBy: "name" });
  const studiesTbl = useOrgTable<StudyRow>("studies");
  const orgSites = sitesTbl.rows.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name }));
  const taSuggestions = Array.from(
    new Set(studiesTbl.rows.map((s) => (s.therapeutic_area ?? "").trim()).filter(Boolean))
  ).sort();

  const [composer, setComposer] = useState({ name: "", description: "" });

  const addRole = async () => {
    if (!composer.name.trim()) return;
    try {
      await roles.insert({
        name: composer.name.trim(),
        description: composer.description.trim() || null,
        builtin: false,
        modules: { studies: "read" } as any,
        portfolio_scope: "assigned",
        ta_scope: [],
        site_scope: [],
        function_overrides: {} as any,
        admin_scope: [],
        status: "active",
        former_names: [],
      });
      toast.success(stamped(`Added access role "${composer.name.trim()}"`));
      setComposer({ name: "", description: "" });
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't add role"));
    }
  };

  if (memberLoading) {
    return <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8 text-sm text-slate-500"><Loader label="Checking permissions…" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader
          kicker="Configure"
          title="Access roles"
          subtitle="Module-level permissions and portfolio scope."
        />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can change access roles. Ask an owner or admin on your team."
          />
        </Card>
      </div>
    );
  }

  const sortedRoles = [...roles.rows].sort((a, b) => {
    // builtins first, then by name
    if (a.builtin && !b.builtin) return -1;
    if (!a.builtin && b.builtin) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Access roles"
        subtitle="What each person can see and do. Everyone gets one access role. Built-in roles (Director, Coordinator, …) are starting points — rename or add your own to fit your org."
      />
      <AutoSaveNote />

      {/* COMPOSER */}
      <Card primary className="mt-6 mb-6">
        <div className="mb-3">
          <div className="text-sm font-semibold text-brand-700">
            Add an access role
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Starts with view-only access to Studies. Open it below to set what it can do and see.
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr_auto] gap-2 items-center">
          <Input
            value={composer.name}
            onChange={(e) => setComposer({ ...composer, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && composer.name.trim()) void addRole();
            }}
            placeholder="Role name (e.g. Investigator, Auditor)"
          />
          <Input
            value={composer.description}
            onChange={(e) =>
              setComposer({ ...composer, description: e.target.value })
            }
            placeholder="Description (optional)"
          />
          <Button onClick={addRole} disabled={!composer.name.trim()}>
            + Add
          </Button>
        </div>
      </Card>

      {roles.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-6">
          <strong>Error:</strong> {roles.error}
        </div>
      )}

      {roles.loading && sortedRoles.length === 0 && (
        <div className="text-sm text-slate-500 mb-6">Loading roles…</div>
      )}

      <div className="space-y-3">
        {sortedRoles.map((role) => (
          <RoleCard
            key={role.id}
            role={role}
            sites={orgSites}
            taSuggestions={taSuggestions}
            usedBy={teamRoles.rows
              .filter((tr) => tr.access_role_id === role.id)
              .map((tr) => teamsTbl.rows.find((t) => t.id === tr.team_id)?.name ?? "team")
              .filter((v, i, a) => a.indexOf(v) === i)}
            onUpdate={(patch) =>
              roles
                .update(role.id, patch)
                .catch((e: any) => toast.error(friendlyError(e, "Update failed")))
            }
            onRemove={async () => {
              if (role.builtin) {
                toast.error("Built-in roles can't be removed — rename or clone them instead");
                return;
              }
              if (!(await confirmDialog({ title: "Remove role", message: `Remove "${role.name}"? This can\u2019t be undone.`, confirmLabel: "Remove", danger: true }))) return;
              try {
                await roles.remove(role.id);
                toast.success(stamped(`Removed "${role.name}"`));
              } catch (e: any) {
                toast.error(friendlyError(e, "Remove failed"));
              }
            }}
          />
        ))}
      </div>

      <p className="text-xs text-slate-500 mt-6 leading-relaxed max-w-3xl">
        A role's <strong>scope</strong> sets which studies a person sees; its <strong>permissions</strong>
        set what they can do in each area. Together they're that person's access. (Org owner and admin
        tiers still override access roles.)
      </p>
    </div>
  );
}

/* ---------- Role card ---------- */

function RoleCard({
  role,
  sites,
  taSuggestions,
  usedBy,
  onUpdate,
  onRemove,
}: {
  role: AccessRoleRow;
  sites: { id: string; name: string }[];
  taSuggestions: string[];
  usedBy?: string[];
  onUpdate: (patch: Partial<AccessRoleRow>) => void;
  onRemove: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(role.name);
  const [expanded, setExpanded] = useState(false);

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== role.name) onUpdate({ name: next });
    setEditingName(false);
  };

  const moduleLevel = (key: string) => (role.modules?.[key] as string) || "none";
  const updateModule = (key: string, level: string) => {
    const next = { ...(role.modules || {}) };
    if (level === "none") delete next[key];
    else next[key] = level as any;
    onUpdate({ modules: next as any });
  };

  // Permission summary for header
  const grants = Object.entries(role.modules || {})
    .filter(([, v]) => Boolean(v) && (v as string) !== "none")
    .map(([k, v]) => `${MODULES.find((m) => m.key === k)?.label ?? k}: ${levelLabel(v as string)}`);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-200">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-slate-400 hover:text-slate-900"
          title={expanded ? "Collapse" : "Expand"}
        >
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
        </button>
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameDraft(role.name);
                setEditingName(false);
              }
            }}
            className="font-display font-bold text-base text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none focus:border-brand-500"
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="font-display font-bold text-base text-slate-900 hover:text-brand-700 transition"
            title="Click to rename"
          >
            {role.name}
          </button>
        )}
        {role.builtin && <Pill tone="neutral">built-in</Pill>}
        {(usedBy ?? []).map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            title={`In use by the ${t} team`}
          >
            <Icon name="users" size={9} />
            {t}
          </span>
        ))}
        {grants.length > 0 && (
          <span className="text-[10px] font-mono text-slate-400 truncate hidden md:inline">
            {grants.slice(0, 3).join(" · ")}
            {grants.length > 3 ? " · …" : ""}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-slate-500 hidden sm:inline">
          Sees <span className="font-semibold text-slate-700">{scopeLabel(role.portfolio_scope)}</span>
        </span>
        {!role.builtin && (
          <button
            onClick={onRemove}
            className="text-slate-400 hover:text-red-600 transition text-lg leading-none"
            title="Remove role"
          >
            ×
          </button>
        )}
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Description
            </label>
            <DraftInput
              value={role.description ?? ""}
              onCommit={(v) => onUpdate({ description: v || null })}
              placeholder="What does this role do?"
            />
          </div>

          {/* Modules grid */}
          <div>
            <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
              <label className="block text-xs font-semibold text-slate-500">
                What can this role do?
              </label>
              <span className="text-[10px] text-slate-400">View = read-only · Edit = create &amp; change · Full = manage &amp; configure</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {MODULES.map((m) => {
                const level = moduleLevel(m.key);
                return (
                  <div
                    key={m.key}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-100 bg-slate-50/50"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {m.label}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{m.desc}</div>
                    </div>
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden flex-shrink-0">
                      {PERM_LEVELS.map((p) => (
                        <button
                          key={p.key}
                          onClick={() => updateModule(m.key, p.key)}
                          className={
                            "px-2.5 py-1 text-[11px] font-semibold transition border-l border-slate-200 first:border-l-0 " +
                            (level === p.key
                              ? p.tone === "neutral"
                                ? "bg-slate-200 text-slate-800"
                                : p.tone === "info"
                                ? "bg-sky-500 text-white"
                                : p.tone === "brand"
                                ? "bg-brand-600 text-white"
                                : "bg-amber-500 text-white"
                              : "bg-white text-slate-500 hover:bg-slate-50")
                          }
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Portfolio scope */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">
              Which studies can this role see?
            </label>
            <ScopeEditor role={role} sites={sites} taSuggestions={taSuggestions} onUpdate={onUpdate} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- portfolio scope editor (All / Assigned / Limited to sites &/| areas) ---------- */
function ScopeEditor({
  role, sites, taSuggestions, onUpdate,
}: {
  role: AccessRoleRow;
  sites: { id: string; name: string }[];
  taSuggestions: string[];
  onUpdate: (patch: Partial<AccessRoleRow>) => void;
}) {
  const base: "all" | "assigned" | "limited" =
    role.portfolio_scope === "all" ? "all" : role.portfolio_scope === "assigned" ? "assigned" : "limited";
  const selSites = role.site_scope ?? [];
  const selTAs = role.ta_scope ?? [];
  const comb: "and" | "or" = role.portfolio_scope === "site_and_ta" ? "and" : "or";
  const [taInput, setTaInput] = useState("");

  const mode = (siteIds: string[], tas: string[], c: "and" | "or") => {
    if (siteIds.length && tas.length) return c === "and" ? "site_and_ta" : "site_or_ta";
    if (siteIds.length) return "site";
    if (tas.length) return "ta";
    return "site_or_ta"; // limited, nothing chosen yet
  };
  const setBase = (b: string) =>
    onUpdate({ portfolio_scope: b === "all" ? "all" : b === "assigned" ? "assigned" : mode(selSites, selTAs, comb) });
  const toggleSite = (id: string) => {
    const next = selSites.includes(id) ? selSites.filter((x) => x !== id) : [...selSites, id];
    onUpdate({ site_scope: next, portfolio_scope: mode(next, selTAs, comb) });
  };
  const addTA = (t: string) => {
    const v = t.trim();
    if (!v || selTAs.includes(v)) return;
    const next = [...selTAs, v];
    onUpdate({ ta_scope: next, portfolio_scope: mode(selSites, next, comb) });
    setTaInput("");
  };
  const removeTA = (t: string) => {
    const next = selTAs.filter((x) => x !== t);
    onUpdate({ ta_scope: next, portfolio_scope: mode(selSites, next, comb) });
  };

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
        {(["all", "assigned", "limited"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setBase(k)}
            className={"px-3 py-1.5 text-xs font-semibold border-l border-slate-200 first:border-l-0 transition " + (base === k ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}
          >
            {k === "all" ? "All studies" : k === "assigned" ? "Assigned only" : "Limited to…"}
          </button>
        ))}
      </div>

      {base === "limited" && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-3 max-w-xl">
          {selSites.length > 0 && selTAs.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] flex-wrap">
              <span className="text-slate-500">Show studies that match</span>
              <div className="inline-flex rounded border border-slate-200 overflow-hidden">
                <button onClick={() => onUpdate({ portfolio_scope: mode(selSites, selTAs, "or") })} className={"px-2 py-0.5 font-semibold " + (comb === "or" ? "bg-brand-600 text-white" : "bg-white text-slate-600")}>ANY — site or area</button>
                <button onClick={() => onUpdate({ portfolio_scope: mode(selSites, selTAs, "and") })} className={"px-2 py-0.5 font-semibold border-l border-slate-200 " + (comb === "and" ? "bg-brand-600 text-white" : "bg-white text-slate-600")}>ALL — site and area</button>
              </div>
            </div>
          )}
          <div>
            <div className="text-[11px] font-semibold text-slate-500 mb-1">Sites</div>
            {sites.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic">No sites yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {sites.map((s) => {
                  const on = selSites.includes(s.id);
                  return (
                    <button key={s.id} onClick={() => toggleSite(s.id)} className={"text-[11px] rounded-full border px-2.5 py-1 transition " + (on ? "border-brand-400 bg-brand-50 text-brand-800 font-semibold" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
                      {on ? "✓ " : ""}{s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold text-slate-500 mb-1">Therapeutic areas</div>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {selTAs.length === 0 && <span className="text-[11px] text-slate-400 italic">None</span>}
              {selTAs.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-200 text-brand-800 text-[11px] px-2 py-0.5">
                  {t}<button onClick={() => removeTA(t)} className="hover:text-red-600" aria-label={`Remove ${t}`}>×</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input list={`scope-ta-${role.id}`} value={taInput} onChange={(e) => setTaInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTA(taInput); }} placeholder="Add area…" className="text-xs border border-slate-200 rounded px-2 py-1 w-44 outline-none focus:border-brand-300" />
              <datalist id={`scope-ta-${role.id}`}>{taSuggestions.filter((t) => !selTAs.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
              <button onClick={() => addTA(taInput)} disabled={!taInput.trim()} className="text-[11px] font-semibold text-brand-700 disabled:text-slate-300">add</button>
            </div>
          </div>
          {selSites.length === 0 && selTAs.length === 0 && (
            <p className="text-[11px] text-amber-600">Pick at least one site or area — or switch to All / Assigned.</p>
          )}
        </div>
      )}
    </div>
  );
}

// DraftInput now lives in components/ui/DraftInput (shared — the module
// drawer caught the same per-keystroke-write disease).
