import { friendlyError } from "../lib/errors";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useEffect, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { TeamRoleRow, TeamRow } from "../lib/types";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import type { AccessRoleRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
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
  { key: "studies",      label: "Studies",       desc: "Study records and lifecycle" },
  { key: "documents",    label: "Documents",     desc: "TMF / ISF document management" },
  { key: "workflows",    label: "Workflows",     desc: "Work streams and pipelines" },
  { key: "approvals",    label: "Approvals",     desc: "Approval queues and e-signatures" },
  { key: "analytics",    label: "Analytics",     desc: "Reports, dashboards, audit logs" },
  { key: "admin",        label: "Admin",         desc: "Org configuration surfaces" },
];

const PERM_LEVELS: { key: string; label: string; tone: "neutral" | "info" | "brand" | "warning" }[] = [
  { key: "none",  label: "none",  tone: "neutral" },
  { key: "read",  label: "read",  tone: "info" },
  { key: "edit",  label: "edit",  tone: "brand" },
  { key: "admin", label: "admin", tone: "warning" },
];

const SCOPES = [
  { key: "all",       label: "All studies",       desc: "See every study in the org" },
  { key: "assigned",  label: "Assigned only",     desc: "Only studies they're assigned to" },
  { key: "ta",        label: "Therapeutic area",  desc: "Studies in specified TAs" },
  { key: "site",      label: "Site",              desc: "Studies at specified sites" },
];

export function AccessRoles() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const roles = useOrgTable<AccessRoleRow>("access_roles", { realtime: true });
  const teamRoles = useOrgTable<TeamRoleRow>("team_roles", { realtime: true });
  const teamsTbl = useOrgTable<TeamRow>("teams");

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
    return <div className="max-w-page-standard mx-auto px-4 md:px-6 py-8 text-sm text-slate-500"><Loader label="Checking permissions…" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-page-standard mx-auto px-4 md:px-6 py-8">
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
    <div className="max-w-page-standard mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Configure"
        title="Access roles"
        subtitle="Who can see what in Platypus. Module-level permissions + portfolio scope. Built-in roles (Director, Coordinator, …) are starting points — clone or rename to fit your org."
        actions={<Pill tone="brand">live · admin-driven</Pill>}
      />
      <AutoSaveNote />

      {/* COMPOSER */}
      <Card primary className="mt-6 mb-6">
        <div className="mb-3">
          <div className="text-sm font-semibold text-brand-700">
            Add an access role
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Starts with read-only studies access. Configure modules below.
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
        <strong>Portfolio scope</strong> bounds which studies a user can see; <strong>module
        permissions</strong> bound what they can do inside each surface. Combined, they're the
        per-user permission envelope. (Org-level admin/owner tiers still trump access roles.)
      </p>
    </div>
  );
}

/* ---------- Role card ---------- */

function RoleCard({
  role,
  usedBy,
  onUpdate,
  onRemove,
}: {
  role: AccessRoleRow;
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
    .map(([k, v]) => `${MODULES.find((m) => m.key === k)?.label ?? k}: ${v}`);

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
        <span className="text-[11px] font-semibold text-slate-500">
          scope: {role.portfolio_scope}
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
            <label className="block text-xs font-semibold text-slate-500 mb-2">
              Module permissions
            </label>
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
                    <div className="flex gap-0.5">
                      {PERM_LEVELS.map((p) => (
                        <button
                          key={p.key}
                          onClick={() => updateModule(m.key, p.key)}
                          className={
                            "px-2 py-0.5 rounded text-[11px] font-semibold transition " +
                            (level === p.key
                              ? p.tone === "neutral"
                                ? "bg-slate-300 text-slate-900"
                                : p.tone === "info"
                                ? "bg-sky-500 text-white"
                                : p.tone === "brand"
                                ? "bg-brand-600 text-white"
                                : "bg-amber-500 text-white"
                              : "bg-white text-slate-500 border border-slate-200 hover:border-slate-300")
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
              Portfolio scope
            </label>
            <Select
              value={role.portfolio_scope}
              onChange={(e) => onUpdate({ portfolio_scope: e.target.value })}
              className="max-w-md"
            >
              {SCOPES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} — {s.desc}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

/** Local-draft input — commits on blur or Enter instead of writing to the
 *  database per keystroke (which made typing lag behind the network). */
function DraftInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      placeholder={placeholder}
    />
  );
}
