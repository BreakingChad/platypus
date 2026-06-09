import { friendlyError } from "../lib/errors";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useOrgTable } from "../lib/useOrgTable";
import { useDismissable } from "../lib/useDismissable";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import type {
  AccessRoleRow,
  SiteRow,
  TeamRow,
  TeamRoleRow,
  TeamRoleHolderRow,
  HierarchyKey,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { MicroField } from "../components/ui/MicroField";
import { InfoTip } from "../components/ui/Tip";
import { AutoSaveNote } from "../components/ui/AutoSaveNote";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** Team Builder — admin-only.
 *
 *  Teams own modules in the Work Stream Builder. Roles live inside teams; people
 *  fill roles. Studies inherit role-driven task assignment — that's why this
 *  page is foundational.
 *
 *  Wave F3: teams mirror the org chart. Numbered LEVEL BOXES contain roles
 *  (Level 1 most senior); escalation is a consequence of structure — a task
 *  escalates up the levels — not a setting. One level per team "manages
 *  assignments" (it can assign tasks to itself and below). The team card
 *  carries a group email and a site scope (empty = all sites).
 */

/** Kept in sync for backward compatibility — `hierarchy_key` is NOT NULL in
 *  the schema and older surfaces may label by it. Levels are the real model. */
const levelToHierarchy = (level: number): HierarchyKey =>
  level <= 1 ? "director"
  : level === 2 ? "manager"
  : level === 3 ? "coordinator"
  : level === 4 ? "specialist"
  : "support";

type LevelSettings = { max_level?: number; assign_level?: number };

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
   *  pipeline stages each team owns. Roles land on levels 1-3. */
  const loadRecommended = async () => {
    setSeeding(true);
    try {
      const defs: { name: string; color: string; charter: string; roles: [string, number][] }[] = [
        { name: "Startup",    color: "#6366F1", charter: "Owns intake through site qualification.", roles: [["Startup Manager", 2], ["Startup Coordinator", 3]] },
        { name: "Budgets & Contracts", color: "#F59E0B", charter: "Owns budget & contract negotiation.", roles: [["Finance Manager", 2], ["Budget Analyst", 3]] },
        { name: "Regulatory", color: "#10B981", charter: "Owns regulatory & IRB submissions.", roles: [["Regulatory Manager", 2], ["Regulatory Coordinator", 3]] },
        { name: "Clinical Ops", color: "#EC4899", charter: "Owns activation onward.", roles: [["Ops Director", 1], ["Clinical Research Coordinator", 3]] },
      ];
      let pos = teams.rows.reduce((m, t) => Math.max(m, t.position), 0);
      for (const d of defs) {
        if (teams.rows.some((t) => t.name === d.name)) continue;
        pos += 10;
        const maxLevel = d.roles.reduce((m, [, lv]) => Math.max(m, lv), 1);
        const created = await teams.insert({
          name: d.name, color: d.color, charter: d.charter, status: "active", position: pos,
          level_settings: { max_level: maxLevel, assign_level: 1 },
        } as any);
        if (created) {
          let rpos = 0;
          for (const [title, level] of d.roles) {
            rpos += 10;
            await roles.insert({
              team_id: (created as any).id, title,
              hierarchy_key: levelToHierarchy(level), level, position: rpos,
            } as any);
          }
        }
      }
      toast.success(stamped("Recommended teams loaded — rename or reshape them freely"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn’t load recommended teams"));
    } finally {
      setSeeding(false);
    }
  };

  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position", realtime: true });
  const roles = useOrgTable<TeamRoleRow>("team_roles", { orderBy: "position", realtime: true });
  const holders = useOrgTable<TeamRoleHolderRow>("team_role_holders", { realtime: true });
  const accessRolesTbl = useOrgTable<AccessRoleRow>("access_roles", { realtime: true });
  const sitesTbl = useOrgTable<SiteRow>("sites", { orderBy: "name", realtime: true });

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
      toast.success(stamped(`Added team "${composer.name.trim()}"`));
      setComposer({ name: "", color: TEAM_COLORS[0], charter: "" });
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't add team"));
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
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Teams & roles"
        subtitle="Build the teams that own work, shaped like your org chart. Levels set the structure — Level 1 is most senior, tasks escalate up the levels, and the level you mark below manages assignments. Role slots survive turnover: when someone leaves, you swap holders, not workflows."
        actions={
          <div className="flex items-center gap-2">
            {teams.rows.length === 0 && (
              <Button variant="primary" size="sm" onClick={() => void loadRecommended()} disabled={seeding}>
                <Icon name="check" size={12} />
                {seeding ? "Loading…" : "Load recommended teams"}
              </Button>
            )}
          </div>
        }
      />
      <AutoSaveNote />

      {/* COMPOSER */}
      <Card primary className="mt-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-brand-700">
              Add a team
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Teams own one or more process modules in Task flows.
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_2fr_auto_auto] gap-3 items-end">
          <MicroField label="Team name">
            <Input
              value={composer.name}
              onChange={(e) => setComposer({ ...composer, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && composer.name.trim()) void addTeam();
              }}
              placeholder="e.g. Startup, Regulatory"
            />
          </MicroField>
          <MicroField label="Charter — what this team owns (optional)">
            <Input
              value={composer.charter}
              onChange={(e) => setComposer({ ...composer, charter: e.target.value })}
              placeholder="e.g. Owns intake through site qualification"
            />
          </MicroField>
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
            sites={sitesTbl.rows}
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
                if (created) toast.success(stamped(`Created access role "${name}"`));
                return (created as AccessRoleRow) ?? null;
              } catch (e: any) {
                toast.error(friendlyError(e, "Couldn't create access role"));
                return null;
              }
            }}
            holdersFor={holdersFor}
            members={members}
            onUpdate={(patch) =>
              teams
                .update(team.id, patch)
                .catch((e: any) => toast.error(friendlyError(e, "Update failed")))
            }
            onRemove={async () => {
              if (!(await confirmDialog({ title: "Remove team", message: `Remove "${team.name}"? Its roles and assignments go with it.`, confirmLabel: "Remove", danger: true })))
                return;
              try {
                await teams.remove(team.id);
                toast.success(stamped(`Removed "${team.name}"`));
              } catch (e: any) {
                toast.error(friendlyError(e, "Remove failed"));
              }
            }}
            onAddRole={async (data) => {
              const nextPos = rolesFor(team.id).reduce((m, r) => Math.max(m, r.position), 0) + 10;
              try {
                await roles.insert({
                  team_id: team.id,
                  title: data.title,
                  access_role_id: data.access_role_id ?? null,
                  hierarchy_key: levelToHierarchy(data.level),
                  level: data.level,
                  position: nextPos,
                } as any);
                toast.success(stamped(`Added role "${data.title}" at Level ${data.level}`));
              } catch (e: any) {
                toast.error(friendlyError(e, "Couldn't add role"));
              }
            }}
            onUpdateRole={(roleId, patch) =>
              roles
                .update(roleId, patch)
                .catch((e: any) => toast.error(friendlyError(e, "Update failed")))
            }
            onRemoveRole={async (roleId, title) => {
              if (!(await confirmDialog({ title: "Remove role", message: `Remove role "${title}"?`, confirmLabel: "Remove", danger: true }))) return;
              try {
                await roles.remove(roleId);
                toast.success(stamped(`Removed role "${title}"`));
              } catch (e: any) {
                toast.error(friendlyError(e, "Remove failed"));
              }
            }}
            onAssignHolder={async (roleId, userId) => {
              try {
                await holders.insert({ team_role_id: roleId, user_id: userId });
                toast.success(stamped("Assigned"));
              } catch (e: any) {
                toast.error(friendlyError(e, "Couldn't assign"));
              }
            }}
            onRemoveHolder={async (holderId) => {
              try {
                await holders.remove(holderId);
                toast.success(stamped("Removed"));
              } catch (e: any) {
                toast.error(friendlyError(e, "Couldn't remove"));
              }
            }}
          />
        ))}
      </div>

      <p className="text-xs text-slate-500 mt-6 leading-relaxed max-w-3xl">
        <strong>Levels</strong> mirror your org chart — Level 1 is most senior, and an escalated
        task moves up the levels. <strong>Manages assignments</strong> marks the level that hands
        out work: it can assign tasks to its own level and below. Tasks routed to a role
        auto-assign when one person holds it; multi-holder roles prompt for selection at the
        study level.
      </p>
    </div>
  );
}

/* ---------- Team card ---------- */

function TeamCard({
  team,
  roles,
  accessRoles,
  sites,
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
  sites: SiteRow[];
  onCreateAccessRole: (name: string) => Promise<AccessRoleRow | null>;
  holdersFor: (roleId: string) => TeamRoleHolderRow[];
  members: MemberSummary[];
  onUpdate: (patch: Partial<TeamRow>) => void;
  onRemove: () => void;
  onAddRole: (data: { title: string; level: number; access_role_id?: string | null }) => void;
  onUpdateRole: (roleId: string, patch: Partial<TeamRoleRow>) => void;
  onRemoveRole: (roleId: string, title: string) => void;
  onAssignHolder: (roleId: string, userId: string) => void;
  onRemoveHolder: (holderId: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(team.name);
  const [expanded, setExpanded] = useState(true);

  /* ---- levels model ---- */
  const settings = (team.level_settings ?? {}) as LevelSettings;
  const maxRoleLevel = roles.reduce((m, r) => Math.max(m, r.level), 1);
  const maxLevel = Math.max(settings.max_level ?? 1, maxRoleLevel);
  const levels = Array.from({ length: maxLevel }, (_, i) => i + 1);
  const assignLevel = Math.min(settings.assign_level ?? 1, maxLevel);
  const rolesAt = (lv: number) => roles.filter((r) => r.level === lv);

  const saveSettings = (patch: Partial<LevelSettings>) =>
    onUpdate({ level_settings: { max_level: maxLevel, assign_level: assignLevel, ...patch } } as Partial<TeamRow>);

  const addLevel = () => saveSettings({ max_level: maxLevel + 1 });
  const removeLevel = (lv: number) => {
    // Only the bottom level, only when empty — keeps the range continuous.
    if (lv !== maxLevel || maxLevel <= 1 || rolesAt(lv).length > 0) return;
    saveSettings({
      max_level: maxLevel - 1,
      assign_level: Math.min(assignLevel, maxLevel - 1),
    });
  };
  const moveRole = (role: TeamRoleRow, lv: number) =>
    onUpdateRole(role.id, { level: lv, hierarchy_key: levelToHierarchy(lv) } as Partial<TeamRoleRow>);

  /* ---- group email (draft → commit on blur/Enter) ---- */
  const [emailDraft, setEmailDraft] = useState(team.group_email ?? "");
  useEffect(() => setEmailDraft(team.group_email ?? ""), [team.group_email]);
  const commitEmail = () => {
    const v = emailDraft.trim();
    if (v !== (team.group_email ?? "")) onUpdate({ group_email: v || null } as Partial<TeamRow>);
  };

  /* ---- site scope ---- */
  const siteIds: string[] = Array.isArray(team.site_ids) ? (team.site_ids as string[]) : [];

  /* ---- role composer ---- */
  const [roleComposer, setRoleComposer] = useState({
    accessRoleId: "",
    newName: "",
    level: maxLevel,
  });
  const [creatingNew, setCreatingNew] = useState(false);
  const [busyAdd, setBusyAdd] = useState(false);

  const submitRole = async () => {
    if (busyAdd) return;
    setBusyAdd(true);
    try {
      const level = Math.min(Math.max(roleComposer.level, 1), maxLevel);
      if (creatingNew) {
        const name = roleComposer.newName.trim();
        if (!name) return;
        const created = await onCreateAccessRole(name);
        if (!created) return;
        onAddRole({ title: name, level, access_role_id: created.id });
      } else {
        const ar = accessRoles.find((r) => r.id === roleComposer.accessRoleId);
        if (!ar) return;
        onAddRole({ title: ar.name, level, access_role_id: ar.id });
      }
      setRoleComposer({ accessRoleId: "", newName: "", level });
      setCreatingNew(false);
    } finally {
      setBusyAdd(false);
    }
  };

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
          {roles.length} role{roles.length === 1 ? "" : "s"} · {maxLevel} level{maxLevel === 1 ? "" : "s"}
        </span>
        <span
          className="text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5"
          title={siteIds.length === 0 ? "This team works across every site" : "This team is scoped to specific sites"}
        >
          {siteIds.length === 0 ? "All sites" : `${siteIds.length} site${siteIds.length === 1 ? "" : "s"}`}
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

          {/* Team contacts & scope */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <MicroField label="Group email — where team notifications go (optional)">
              <Input
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                onBlur={commitEmail}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEmail();
                }}
                placeholder="e.g. startup-team@yoursite.org"
              />
            </MicroField>
            <MicroField label="Sites this team covers — none selected means all sites">
              <SiteScopePicker
                sites={sites}
                selected={siteIds}
                onChange={(next) => onUpdate({ site_ids: next } as Partial<TeamRow>)}
              />
            </MicroField>
          </div>

          {/* LEVEL BOXES */}
          <div className="space-y-2">
            {levels.map((lv) => {
              const lvRoles = rolesAt(lv);
              const isAssign = assignLevel === lv;
              const removable = lv === maxLevel && maxLevel > 1 && lvRoles.length === 0;
              return (
                <div
                  key={lv}
                  className={
                    "rounded-lg border " +
                    (isAssign ? "border-brand-200 bg-brand-50/30" : "border-slate-200 bg-slate-50/40")
                  }
                >
                  <div className="px-3 py-2 flex items-center gap-3 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-700">
                      Level {lv}
                      {lv === 1 && <span className="ml-1.5 text-[10px] font-semibold text-slate-400">most senior</span>}
                    </span>
                    <label
                      className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none"
                      title="The level that hands out work — it can assign tasks to its own level and below"
                    >
                      <input
                        type="radio"
                        name={`assign-${team.id}`}
                        checked={isAssign}
                        onChange={() => saveSettings({ assign_level: lv })}
                        className="accent-brand-500 w-3.5 h-3.5"
                      />
                      Manages assignments
                      <InfoTip side="bottom" label="The level that hands out work. Roles at this level can assign tasks to their own level and every level below it." />
                    </label>
                    {isAssign && (
                      <span className="text-[10px] text-brand-700">
                        Roles at this level can assign tasks to this level and below.
                      </span>
                    )}
                    <div className="flex-1" />
                    {removable && (
                      <button
                        onClick={() => removeLevel(lv)}
                        className="text-slate-400 hover:text-red-600 transition text-base leading-none"
                        title="Remove this empty level"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="px-3 py-2 space-y-1.5">
                    {lvRoles.length === 0 ? (
                      <div className="text-[11px] text-slate-400 italic py-0.5">
                        No roles at this level — add one below, or move a role here.
                      </div>
                    ) : (
                      lvRoles.map((role) => {
                        const rh = holdersFor(role.id);
                        return (
                          <div
                            key={role.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 bg-white"
                          >
                            <RoleRow
                              role={role}
                              levels={levels}
                              accessRole={accessRoles.find((ar) => ar.id === role.access_role_id) ?? null}
                              onMove={(toLv) => moveRole(role, toLv)}
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
                      })
                    )}
                  </div>
                </div>
              );
            })}
            <button
              onClick={addLevel}
              className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 hover:border-brand-300 hover:text-brand-700 transition"
            >
              + Level
            </button>
          </div>

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
              <Select
                value={String(Math.min(roleComposer.level, maxLevel))}
                onChange={(e) => setRoleComposer({ ...roleComposer, level: Number(e.target.value) })}
                className="w-28"
                aria-label="Level for the new role"
              >
                {levels.map((lv) => (
                  <option key={lv} value={lv}>
                    Level {lv}
                  </option>
                ))}
              </Select>
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

/* ---------- Site scope picker ---------- */

function SiteScopePicker({
  sites,
  selected,
  onChange,
}: {
  sites: SiteRow[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  useDismissable("[data-site-scope]", () => setOpen(false), open);
  const byId: Record<string, string> = {};
  sites.forEach((s) => (byId[s.id] = s.name));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="relative" data-site-scope>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-left text-slate-700 hover:border-slate-300 transition flex items-center justify-between gap-2"
        aria-expanded={open}
      >
        <span className="truncate">
          {selected.length === 0
            ? "All sites"
            : selected.map((id) => byId[id] ?? "(removed site)").join(", ")}
        </span>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-56 overflow-y-auto">
          {sites.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-slate-500 italic">
              No sites configured yet — add them under Configure → Sites.
            </div>
          ) : (
            <>
              {sites.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={() => toggle(s.id)}
                    className="accent-brand-500 w-3.5 h-3.5"
                  />
                  <span className="truncate">{s.name}</span>
                </label>
              ))}
              {selected.length > 0 && (
                <button
                  onClick={() => {
                    onChange([]);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-[11px] font-semibold text-brand-700 hover:bg-slate-50 border-t border-slate-100"
                >
                  Clear — cover all sites
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Role row ---------- */

function RoleRow({
  role,
  levels,
  accessRole,
  onMove,
  onUpdate,
  onRemove,
}: {
  role: TeamRoleRow;
  levels: number[];
  accessRole: AccessRoleRow | null;
  onMove: (toLevel: number) => void;
  onUpdate: (patch: Partial<TeamRoleRow>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(role.title);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== role.title) onUpdate({ title: next });
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
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
      {levels.length > 1 && (
        <Select
          value={String(role.level)}
          onChange={(e) => {
            const lv = Number(e.target.value);
            if (lv !== role.level) onMove(lv);
          }}
          className="text-[10px] py-0.5 px-1 w-24"
          aria-label={`Move ${role.title} to a level`}
          title="Move this role to another level"
        >
          {levels.map((lv) => (
            <option key={lv} value={lv}>
              Level {lv}
            </option>
          ))}
        </Select>
      )}
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

/* ---------- Holder list ---------- */

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
  useDismissable("[data-holder-picker]", () => setPicking(false), picking);

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
      <div className="relative" data-holder-picker>
        <button
          onClick={() => setPicking((p) => !p)}
          className="text-[11px] font-semibold text-slate-500 hover:text-brand-700 transition px-1.5 py-0.5 rounded border border-dashed border-slate-300 hover:border-brand-300"
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
