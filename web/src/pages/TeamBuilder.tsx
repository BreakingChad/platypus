import { confirmDialog } from "../lib/confirm";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import type {
  AccessRoleRow,
  TeamRow,
  TeamRoleRow,
  TeamRoleHolderRow,
  HierarchyKey,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Tip } from "../components/ui/Tip";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** Team Builder — admin-only.
 *
 *  Teams own modules in the Work Stream Builder. Roles live inside teams; people
 *  fill roles. Studies inherit role-driven task assignment — that's why this
 *  page is foundational. The structure here is what "person fills role" hangs
 *  off of in every downstream surface.
 */

const HIERARCHIES: { key: HierarchyKey; label: string; level: number }[] = [
  { key: "director",    label: "Director",    level: 1 },
  { key: "manager",     label: "Manager",     level: 2 },
  { key: "coordinator", label: "Coordinator", level: 3 },
  { key: "specialist",  label: "Specialist",  level: 4 },
  { key: "support",     label: "Support",     level: 5 },
];

const TEAM_COLORS = [
  "#4F46E5", "#7C3AED", "#0EA5E9", "#10B981",
  "#F59E0B", "#EF4444", "#64748B", "#EC4899",
];

type MemberSummary = {
  user_id: string;
  email: string;
  tier: string;
};

export function TeamBuilder() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const { orgId } = useCurrentOrg();
  const toast = useToast();

  const [seeding, setSeeding] = useState(false);
  /** Express seed: the standard site team structure, colors matched to the
   *  pipeline stages each team owns. */
  const loadRecommended = async () => {
    setSeeding(true);
    try {
      const defs = [
        { name: "Startup",    color: "#6366F1", charter: "Owns intake through site qualification.", roles: [["Startup Manager","manager",2],["Startup Coordinator","coordinator",3]] },
        { name: "Budgets & Contracts", color: "#F59E0B", charter: "Owns budget & contract negotiation.", roles: [["Finance Manager","manager",2],["Budget Analyst","specialist",3]] },
        { name: "Regulatory", color: "#10B981", charter: "Owns regulatory & IRB submissions.", roles: [["Regulatory Manager","manager",2],["Regulatory Coordinator","coordinator",3]] },
        { name: "Clinical Ops", color: "#EC4899", charter: "Owns activation onward.", roles: [["Ops Director","director",1],["Clinical Research Coordinator","coordinator",3]] },
      ];
      let pos = teams.rows.reduce((m, t) => Math.max(m, t.position), 0);
      for (const d of defs) {
        if (teams.rows.some((t) => t.name === d.name)) continue;
        pos += 10;
        const created = await teams.insert({ name: d.name, color: d.color, charter: d.charter, status: "active", position: pos } as any);
        if (created) {
          let rpos = 0;
          for (const [title, hk, level] of d.roles) {
            rpos += 10;
            await roles.insert({ team_id: (created as any).id, title, hierarchy_key: hk, level, position: rpos } as any);
          }
        }
      }
      toast.success("Recommended teams loaded — rename or reshape them freely");
    } catch (e: any) {
      toast.error(e?.message || "Couldn\u2019t load recommended teams");
    } finally {
      setSeeding(false);
    }
  };

  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position", realtime: true });
  const roles = useOrgTable<TeamRoleRow>("team_roles", { orderBy: "position", realtime: true });
  const holders = useOrgTable<TeamRoleHolderRow>("team_role_holders", { realtime: true });
  const accessRolesTbl = useOrgTable<AccessRoleRow>("access_roles", { realtime: true });

  const [members, setMembers] = useState<MemberSummary[]>([]);

  // Load the org's members + their emails (via profiles join — keep it simple).
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data: mems } = await supabase
        .from("org_members")
        .select("user_id, tier")
        .eq("org_id", orgId);
      if (!mems || cancelled) return;
      const ids = mems.map((m: any) => m.user_id);
      if (ids.length === 0) {
        setMembers([]);
        return;
      }
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", ids);
      const byId: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => (byId[p.id] = p.email));
      if (!cancelled) {
        setMembers(
          mems.map((m: any) => ({
            user_id: m.user_id,
            email: byId[m.user_id] ?? "(unknown)",
            tier: m.tier,
          }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, holders.rows.length]); // refresh when membership shifts indirectly

  const [composer, setComposer] = useState({
    name: "",
    color: TEAM_COLORS[0],
    charter: "",
  });

  const addTeam = async () => {
    if (!composer.name.trim()) return;
    const nextPos = teams.rows.reduce((m, t) => Math.max(m, t.position), 0) + 10;
    try {
      await teams.insert({
        name: composer.name.trim(),
        color: composer.color,
        charter: composer.charter.trim() || null,
        status: "active",
        position: nextPos,
      });
      toast.success(`Added team "${composer.name.trim()}"`);
      setComposer({ name: "", color: TEAM_COLORS[0], charter: "" });
    } catch (e: any) {
      toast.error(e?.message || "Couldn't add team");
    }
  };

  if (memberLoading) {
    return <div className="max-w-5xl mx-auto px-6 py-8 text-sm text-slate-500">Checking permissions…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <PageHeader
          kicker="Configure"
          title="Teams & roles"
          subtitle="The teams that own work in your operating model."
        />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can change the team structure. Ask an owner or admin on your team."
          />
        </Card>
      </div>
    );
  }

  const sortedTeams = [...teams.rows].sort((a, b) => a.position - b.position);
  const rolesFor = (teamId: string) =>
    roles.rows.filter((r) => r.team_id === teamId).sort((a, b) => a.position - b.position);
  const holdersFor = (roleId: string) =>
    holders.rows.filter((h) => h.team_role_id === roleId);

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Configure"
        title="Teams & roles"
        subtitle="Build the teams that own work. Role slots survive turnover — when someone leaves, you swap holders, not workflows. Hierarchy lets the app know who escalates to whom."
        actions={
          <div className="flex items-center gap-2">
            {teams.rows.length === 0 && (
              <Button variant="primary" size="sm" onClick={() => void loadRecommended()} disabled={seeding}>
                <Icon name="check" size={12} /> {seeding ? "Loading…" : "Load recommended teams"}
              </Button>
            )}
            <Pill tone="brand">live · admin-driven</Pill>
          </div>
        }
      />

      {/* COMPOSER */}
      <Card primary className="mt-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-bold text-brand-700 uppercase tracking-wider">
              Add a team
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Teams own one or more process modules in the Work Stream Builder.
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_2fr_auto_auto] gap-2 items-center">
          <Input
            value={composer.name}
            onChange={(e) => setComposer({ ...composer, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && composer.name.trim()) void addTeam();
            }}
            placeholder="Team name (e.g. Startup, Regulatory)"
          />
          <Input
            value={composer.charter}
            onChange={(e) => setComposer({ ...composer, charter: e.target.value })}
            placeholder="Charter (optional) — what does this team own?"
          />
          <div className="flex gap-1">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setComposer({ ...composer, color: c })}
                className={
                  "w-6 h-6 rounded-md border-2 transition " +
                  (composer.color === c
                    ? "border-slate-900 scale-110"
                    : "border-white hover:border-slate-200")
                }
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <Button onClick={addTeam} disabled={!composer.name.trim()}>
            + Add
          </Button>
        </div>
      </Card>

      {teams.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-6">
          <strong>Error:</strong> {teams.error}
        </div>
      )}

      {teams.loading && sortedTeams.length === 0 && (
        <div className="text-sm text-slate-500 mb-6">Loading teams…</div>
      )}

      {!teams.loading && sortedTeams.length === 0 && (
        <Card>
          <EmptyState
            iconName="users"
            title="No teams yet"
            sub="Add your first team above. A typical site has Startup, Regulatory, Coordination, and a Principal Investigator group."
          />
        </Card>
      )}

      {/* TEAM LIST */}
      <div className="space-y-3">
        {sortedTeams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            roles={rolesFor(team.id)}
            accessRoles={accessRolesTbl.rows}
            onCreateAccessRole={async (name) => {
              try {
                const created = await accessRolesTbl.insert({
                  name,
                  description: null,
                  builtin: false,
                  modules: { studies: "read" } as any,
                  portfolio_scope: "assigned",
                  ta_scope: [],
                  site_scope: [],
                  function_overrides: {} as any,
                  admin_scope: [],
                  status: "active",
                  former_names: [],
                } as any);
                if (created) toast.success(`Created access role "${name}"`);
                return (created as AccessRoleRow) ?? null;
              } catch (e: any) {
                toast.error(e?.message || "Couldn't create access role");
                return null;
              }
            }}
            holdersFor={holdersFor}
            members={members}
            onUpdate={(patch) =>
              teams
                .update(team.id, patch)
                .catch((e: any) => toast.error(e?.message || "Update failed"))
            }
            onRemove={async () => {
              if (!(await confirmDialog({ title: "Remove team", message: `Remove "${team.name}"? Its roles and assignments go with it.`, confirmLabel: "Remove", danger: true })))
                return;
              try {
                await teams.remove(team.id);
                toast.success(`Removed "${team.name}"`);
              } catch (e: any) {
                toast.error(e?.message || "Remove failed");
              }
            }}
            onAddRole={async (data) => {
              const nextPos = rolesFor(team.id).reduce((m, r) => Math.max(m, r.position), 0) + 10;
              try {
                await roles.insert({
                  team_id: team.id,
                  title: data.title,
                  access_role_id: data.access_role_id ?? null,
                  hierarchy_key: data.hierarchy_key,
                  level: HIERARCHIES.find((h) => h.key === data.hierarchy_key)?.level ?? 3,
                  position: nextPos,
                } as any);
                toast.success(`Added role "${data.title}"`);
              } catch (e: any) {
                toast.error(e?.message || "Couldn't add role");
              }
            }}
            onUpdateRole={(roleId, patch) =>
              roles
                .update(roleId, patch)
                .catch((e: any) => toast.error(e?.message || "Update failed"))
            }
            onRemoveRole={async (roleId, title) => {
              if (!(await confirmDialog({ title: "Remove role", message: `Remove role "${title}"?`, confirmLabel: "Remove", danger: true }))) return;
              try {
                await roles.remove(roleId);
                toast.success(`Removed role "${title}"`);
              } catch (e: any) {
                toast.error(e?.message || "Remove failed");
              }
            }}
            onAssignHolder={async (roleId, userId) => {
              try {
                await holders.insert({ team_role_id: roleId, user_id: userId });
                toast.success("Assigned");
              } catch (e: any) {
                toast.error(e?.message || "Couldn't assign");
              }
            }}
            onRemoveHolder={async (holderId) => {
              try {
                await holders.remove(holderId);
                toast.success("Removed");
              } catch (e: any) {
                toast.error(e?.message || "Couldn't remove");
              }
            }}
          />
        ))}
      </div>

      <p className="text-xs text-slate-500 mt-6 leading-relaxed max-w-3xl">
        <strong>Hierarchy</strong> sets the escalation chain — directors are at level 1, support at
        level 5. Tasks routed to a role auto-assign when one person holds it; multi-holder roles
        prompt for selection at the study level.
      </p>
    </div>
  );
}

/* ---------- Team card ---------- */

function TeamCard({
  team,
  roles,
  accessRoles,
  onCreateAccessRole,
  holdersFor,
  members,
  onUpdate,
  onRemove,
  onAddRole,
  onUpdateRole,
  onRemoveRole,
  onAssignHolder,
  onRemoveHolder,
}: {
  team: TeamRow;
  roles: TeamRoleRow[];
  accessRoles: AccessRoleRow[];
  onCreateAccessRole: (name: string) => Promise<AccessRoleRow | null>;
  holdersFor: (roleId: string) => TeamRoleHolderRow[];
  members: MemberSummary[];
  onUpdate: (patch: Partial<TeamRow>) => void;
  onRemove: () => void;
  onAddRole: (data: { title: string; hierarchy_key: HierarchyKey; access_role_id?: string | null }) => void;
  onUpdateRole: (roleId: string, patch: Partial<TeamRoleRow>) => void;
  onRemoveRole: (roleId: string, title: string) => void;
  onAssignHolder: (roleId: string, userId: string) => void;
  onRemoveHolder: (holderId: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(team.name);
  const [roleComposer, setRoleComposer] = useState({
    accessRoleId: "",
    newName: "",
    hierarchy_key: "coordinator" as HierarchyKey,
  });
  const [creatingNew, setCreatingNew] = useState(false);
  const [busyAdd, setBusyAdd] = useState(false);

  const submitRole = async () => {
    if (busyAdd) return;
    setBusyAdd(true);
    try {
      if (creatingNew) {
        const name = roleComposer.newName.trim();
        if (!name) return;
        const created = await onCreateAccessRole(name);
        if (!created) return;
        onAddRole({ title: name, hierarchy_key: roleComposer.hierarchy_key, access_role_id: created.id });
      } else {
        const ar = accessRoles.find((r) => r.id === roleComposer.accessRoleId);
        if (!ar) return;
        onAddRole({ title: ar.name, hierarchy_key: roleComposer.hierarchy_key, access_role_id: ar.id });
      }
      setRoleComposer({ accessRoleId: "", newName: "", hierarchy_key: "coordinator" });
      setCreatingNew(false);
    } finally {
      setBusyAdd(false);
    }
  };
  const [expanded, setExpanded] = useState(true);

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== team.name) onUpdate({ name: next });
    setEditingName(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div
        className="px-4 py-3 flex items-center gap-3 border-b border-slate-200"
        style={{ background: `linear-gradient(135deg, ${team.color}12, transparent 60%)` }}
      >
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-slate-400 hover:text-slate-900"
          title={expanded ? "Collapse" : "Expand"}
        >
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
        </button>
        <div className="w-2 h-8 rounded-full" style={{ backgroundColor: team.color }} />
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameDraft(team.name);
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
            {team.name}
          </button>
        )}
        <span className="text-[11px] font-mono text-slate-400">
          {roles.length} role{roles.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <button
          onClick={onRemove}
          className="text-slate-400 hover:text-red-600 transition text-lg leading-none"
          title="Remove team"
        >
          ×
        </button>
      </div>

      {expanded && (
        <div className="p-4 space-y-3">
          {team.charter && (
            <p className="text-xs text-slate-600 italic">"{team.charter}"</p>
          )}

          {/* Roles */}
          {roles.length === 0 ? (
            <div className="text-xs text-slate-500 italic">
              No roles yet — add one below.
            </div>
          ) : (
            <div className="space-y-1.5">
              {roles.map((role) => {
                const rh = holdersFor(role.id);
                return (
                  <div
                    key={role.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 bg-slate-50/50"
                  >
                    <RoleRow
                      role={role}
                      accessRole={accessRoles.find((ar) => ar.id === role.access_role_id) ?? null}
                      onUpdate={(patch) => onUpdateRole(role.id, patch)}
                      onRemove={() => onRemoveRole(role.id, role.title)}
                    />
                    <div className="flex-1" />
                    <HolderList
                      holders={rh}
                      members={members}
                      onAssign={(userId) => onAssignHolder(role.id, userId)}
                      onRemove={onRemoveHolder}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Role composer — roles come from Access Roles (one role concept).
              Quick-create makes the access role inline and returns here. */}
          <div className="pt-2 border-t border-slate-100 space-y-1.5">
            <div className="flex items-center gap-2">
              {creatingNew ? (
                <Input
                  value={roleComposer.newName}
                  onChange={(e) => setRoleComposer({ ...roleComposer, newName: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitRole();
                  }}
                  placeholder="New access role name (e.g. Startup Coordinator)"
                  className="text-sm"
                  autoFocus
                />
              ) : (
                <Select
                  value={roleComposer.accessRoleId}
                  onChange={(e) => setRoleComposer({ ...roleComposer, accessRoleId: e.target.value })}
                  className="text-sm"
                  aria-label="Pick an access role"
                >
                  <option value="">— Pick an access role —</option>
                  {accessRoles
                    .filter((r) => r.status === "active")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </Select>
              )}
              <Tip label="Seniority for escalation routing: L1 most senior. When a task escalates, it goes to the team's lowest level — auto-assigned if exactly one person holds that role.">
                <Select
                  value={roleComposer.hierarchy_key}
                  onChange={(e) =>
                    setRoleComposer({
                      ...roleComposer,
                      hierarchy_key: e.target.value as HierarchyKey,
                    })
                  }
                  className="w-36"
                  aria-label="Escalation hierarchy"
                >
                  {HIERARCHIES.map((h) => (
                    <option key={h.key} value={h.key}>
                      L{h.level} {h.label}
                    </option>
                  ))}
                </Select>
              </Tip>
              <Button
                size="sm"
                onClick={() => void submitRole()}
                disabled={busyAdd || (creatingNew ? !roleComposer.newName.trim() : !roleComposer.accessRoleId)}
              >
                + Role
              </Button>
            </div>
            <button
              onClick={() => setCreatingNew((v) => !v)}
              className="text-[11px] font-semibold text-brand-700 hover:underline"
            >
              {creatingNew ? "← Pick an existing access role instead" : "+ New access role (creates it and adds it here)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleRow({
  role,
  accessRole,
  onUpdate,
  onRemove,
}: {
  role: TeamRoleRow;
  accessRole: AccessRoleRow | null;
  onUpdate: (patch: Partial<TeamRoleRow>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(role.title);
  const hier = HIERARCHIES.find((h) => h.key === role.hierarchy_key);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== role.title) onUpdate({ title: next });
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className="text-[10px] font-bold text-slate-500 font-mono w-6 text-center"
        title={hier?.label}
      >
        L{role.level}
      </span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(role.title);
              setEditing(false);
            }
          }}
          className="text-sm font-semibold text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none focus:border-brand-500"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-sm font-semibold text-slate-900 hover:text-brand-700 transition truncate"
          title="Rename role"
        >
          {role.title}
        </button>
      )}
      {accessRole ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-brand-100 bg-brand-50 text-brand-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider flex-shrink-0"
          title={`Access role: ${accessRole.name} — permissions defined in Access Roles`}
        >
          <Icon name="shield" size={9} />
          {accessRole.name !== role.title ? accessRole.name : "linked"}
        </span>
      ) : (
        <span
          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 text-slate-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider flex-shrink-0"
          title="Not linked to an access role — re-add this role from the access-role picker to link it"
        >
          unlinked
        </span>
      )}
      <Select
        value={role.hierarchy_key}
        onChange={(e) => {
          const key = e.target.value as HierarchyKey;
          const level = HIERARCHIES.find((h) => h.key === key)?.level ?? 3;
          onUpdate({ hierarchy_key: key, level });
        }}
        className="text-[10px] py-0.5 px-1 w-24"
      >
        {HIERARCHIES.map((h) => (
          <option key={h.key} value={h.key}>
            {h.label}
          </option>
        ))}
      </Select>
      <button
        onClick={onRemove}
        className="text-slate-400 hover:text-red-600 transition text-base leading-none"
        title="Remove role"
      >
        ×
      </button>
    </div>
  );
}

function HolderList({
  holders,
  members,
  onAssign,
  onRemove,
}: {
  holders: TeamRoleHolderRow[];
  members: MemberSummary[];
  onAssign: (userId: string) => void;
  onRemove: (holderId: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  const assignedIds = new Set(holders.map((h) => h.user_id));
  const available = members.filter((m) => !assignedIds.has(m.user_id));

  const emailById: Record<string, string> = {};
  members.forEach((m) => (emailById[m.user_id] = m.email));

  return (
    <div className="flex items-center gap-1.5">
      {holders.length === 0 && (
        <span className="text-[10px] italic text-slate-400">Unassigned</span>
      )}
      {holders.map((h) => (
        <span
          key={h.id}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700"
        >
          {emailById[h.user_id] ?? h.user_id.slice(0, 6)}
          <button
            onClick={() => onRemove(h.id)}
            className="text-brand-400 hover:text-red-600 leading-none ml-0.5"
            title="Unassign"
          >
            ×
          </button>
        </span>
      ))}
      <div className="relative">
        <button
          onClick={() => setPicking((p) => !p)}
          className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-brand-700 transition px-1.5 py-0.5 rounded border border-dashed border-slate-300 hover:border-brand-300"
          title="Add holder"
        >
          + Assign
        </button>
        {picking && (
          <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-52 max-h-60 overflow-y-auto">
            {available.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-slate-500 italic">
                No more members to assign.
              </div>
            ) : (
              available.map((m) => (
                <button
                  key={m.user_id}
                  onClick={() => {
                    onAssign(m.user_id);
                    setPicking(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 truncate"
                >
                  {m.email}
                  <span className="ml-1 text-[9px] font-mono text-slate-400 uppercase tracking-wider">
                    {m.tier}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
