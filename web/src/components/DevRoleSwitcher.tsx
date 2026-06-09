import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentOrg } from "../lib/OrgContext";
import { useAuth } from "../auth/useAuth";
import { writeAuditEvent } from "../lib/auditLog";
import type {
  AccessRoleRow,
  TeamRow,
  TeamRoleRow,
  TeamRoleHolderRow,
} from "../lib/types";

/** DevRoleSwitcher — developer-tier testing tool in the user menu.
 *
 *  Lets a developer hop between access roles and team-role holderships
 *  without round-tripping through Members / Team Builder, so any persona
 *  can be tested in seconds:
 *
 *  - Access role  → updates own org_members.access_role_id, then reloads
 *    (nav + permissions resolve at load).
 *  - Team roles   → toggles own team_role_holders rows live; affects what
 *    the workstream engine assigns to you and team task views. No reload.
 *
 *  Mutations hit the same tables as the real admin surfaces and are
 *  audit-logged as dev_* actions, so the chain stays complete even during
 *  testing. Rendered only for tier === 'developer'.
 */
export function DevRoleSwitcher() {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const accessRoles = useOrgTable<AccessRoleRow>("access_roles", { orderBy: "name" });
  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position" });
  const teamRoles = useOrgTable<TeamRoleRow>("team_roles", { orderBy: "position" });
  const holders = useOrgTable<TeamRoleHolderRow>("team_role_holders", { realtime: true });

  const [memberId, setMemberId] = useState<string | null>(null);
  const [accessRoleId, setAccessRoleId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!userId || !orgId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("org_members")
        .select("id, access_role_id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled || !data) return;
      setMemberId((data as any).id);
      setAccessRoleId((data as any).access_role_id ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, orgId]);

  const myHolderRows = holders.rows.filter((h) => h.user_id === userId);

  const pickAccessRole = async (nextId: string) => {
    if (!memberId || !orgId || !userId) return;
    setBusy("access");
    try {
      const { error } = await supabase
        .from("org_members")
        .update({ access_role_id: nextId || null } as any)
        .eq("id", memberId);
      if (error) throw error;
      setAccessRoleId(nextId);
      void writeAuditEvent({
        orgId,
        actorId: userId,
        actorEmail: userEmail,
        entityType: "member",
        entityId: memberId,
        action: "dev_access_role_switch",
        payload: {
          to: nextId || null,
          to_name: accessRoles.rows.find((r) => r.id === nextId)?.name ?? null,
        },
      });
      // Nav + permissions resolve at load — reload to apply the new lens.
      setReloading(true);
      setTimeout(() => window.location.reload(), 350);
    } catch {
      setBusy(null);
    }
  };

  const toggleTeamRole = async (role: TeamRoleRow) => {
    if (!orgId || !userId) return;
    const existing = myHolderRows.find((h) => h.team_role_id === role.id);
    setBusy(role.id);
    try {
      if (existing) {
        const { error } = await supabase
          .from("team_role_holders")
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("team_role_holders")
          .insert({ org_id: orgId, team_role_id: role.id, user_id: userId } as any);
        if (error) throw error;
      }
      void writeAuditEvent({
        orgId,
        actorId: userId,
        actorEmail: userEmail,
        entityType: "member",
        entityId: userId,
        action: existing ? "dev_team_role_dropped" : "dev_team_role_taken",
        payload: { team_role_id: role.id, title: role.title },
      });
      void holders.refresh?.();
    } finally {
      setBusy(null);
    }
  };

  if (!memberId) return null;

  return (
    <div className="border-t border-slate-100 mt-1 pt-2 pb-1">
      <div className="px-3 pb-1.5 text-[11px] font-semibold text-amber-600 uppercase tracking-wider">
        Developer · act as
      </div>

      <div className="px-3 pb-2">
        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
          Access role
        </label>
        <select
          value={accessRoleId}
          disabled={busy === "access" || reloading}
          onChange={(e) => void pickAccessRole(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none disabled:opacity-60"
        >
          <option value="">— none —</option>
          {accessRoles.rows
            .filter((r) => r.status !== "archived")
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
        {reloading && (
          <div className="text-[11px] text-slate-500 mt-1">Applying — reloading…</div>
        )}
      </div>

      <div className="px-3 pb-1">
        <div className="text-[11px] font-semibold text-slate-500 mb-1">
          Team roles I hold
        </div>
        <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
          {teams.rows.map((team) => {
            const roles = teamRoles.rows.filter((r) => r.team_id === team.id);
            if (roles.length === 0) return null;
            return (
              <div key={team.id} className="px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: team.color }}
                  />
                  {team.name}
                </div>
                {roles.map((role) => {
                  const held = myHolderRows.some((h) => h.team_role_id === role.id);
                  return (
                    <label
                      key={role.id}
                      className="flex items-center gap-2 py-0.5 pl-3.5 text-sm text-slate-700 cursor-pointer hover:text-slate-900"
                    >
                      <input
                        type="checkbox"
                        checked={held}
                        disabled={busy === role.id}
                        onChange={() => void toggleTeamRole(role)}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="truncate">{role.title}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
          {teams.rows.length === 0 && (
            <div className="px-2 py-2 text-[11px] text-slate-400">
              No teams configured yet.
            </div>
          )}
        </div>
        <p className="text-[10px] text-slate-400 mt-1 leading-snug">
          Hits the real tables, audit-logged as dev actions. Team toggles apply
          to newly spawned tasks immediately.
        </p>
      </div>
    </div>
  );
}
