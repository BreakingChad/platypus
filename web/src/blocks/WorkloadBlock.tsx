import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import type { TaskRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { UserAvatar } from "../components/ui/UserAvatar";
import type { BlockContext } from "./registry";

/** WorkloadBlock — admin-only.
 *  Per-user open / overdue task counts so directors can spot who's drowning.
 *
 *  Visualisation: each row is a member with two stacked bars (open + overdue)
 *  proportional to the org max. Sorted by total open desc, then overdue desc.
 */

type WorkloadRow = {
  userId: string;
  email: string;
  avatarSrc: string | null;
  open: number;
  overdue: number;
};

export function WorkloadBlock({ ctx: _ctx }: { ctx: BlockContext }) {
  const { isAdmin } = useCurrentMember();
  const { orgId } = useCurrentOrg();
  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });

  const [profiles, setProfiles] = useState<Record<string, { label: string; src: string | null }>>({});

  // Pull profiles for all org members so we have names/emails to show.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data: mems } = await supabase
        .from("org_members")
        .select("user_id")
        .eq("org_id", orgId);
      if (!mems || cancelled) return;
      const ids = mems.map((m: any) => m.user_id);
      if (ids.length === 0) {
        setProfiles({});
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("id, email, full_name, avatar_url")
        .in("id", ids);
      if (cancelled) return;
      const map: Record<string, { label: string; src: string | null }> = {};
      (data ?? []).forEach((p: any) => {
        map[p.id] = {
          label: p.full_name || p.email || p.id.slice(0, 8),
          src: p.avatar_url ?? null,
        };
      });
      setProfiles(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, tasks.rows.length]);

  const rows: WorkloadRow[] = useMemo(() => {
    const now = Date.now();
    const counts: Record<string, { open: number; overdue: number }> = {};
    for (const t of tasks.rows) {
      if (t.status !== "open" && t.status !== "in_progress") continue;
      if (!t.assigned_to_user_id) continue;
      const c = (counts[t.assigned_to_user_id] = counts[t.assigned_to_user_id] ?? { open: 0, overdue: 0 });
      c.open += 1;
      if (t.due_at && new Date(t.due_at).getTime() < now) c.overdue += 1;
    }
    const arr: WorkloadRow[] = Object.entries(counts).map(([uid, c]) => ({
      userId: uid,
      email: profiles[uid]?.label ?? uid.slice(0, 8),
      avatarSrc: profiles[uid]?.src ?? null,
      open: c.open,
      overdue: c.overdue,
    }));
    arr.sort((a, b) => b.open - a.open || b.overdue - a.overdue);
    return arr;
  }, [tasks.rows, profiles]);

  if (!isAdmin) return null;
  if (rows.length === 0) return null;

  const maxOpen = Math.max(1, ...rows.map((r) => r.open));

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          Coordinator workload
        </h2>
      </div>
      <Card>
        <div className="space-y-3">
          {rows.map((r) => {
            const overload = r.open >= 8 || r.overdue >= 3;
            const busy = !overload && (r.open >= 4 || r.overdue >= 1);
            const tone = overload ? "Overloaded" : busy ? "Busy" : "Capacity";
            const toneCls = overload
              ? "text-red-700"
              : busy
              ? "text-amber-800"
              : "text-emerald-700";
            return (
              <div key={r.userId}>
                <div className="flex items-center gap-2 mb-1">
                  <UserAvatar name={r.email} src={r.avatarSrc} />
                  <span className="text-sm font-semibold text-slate-900 truncate min-w-0">
                    {r.email}
                  </span>
                  <span className={"text-[11px] font-semibold " + toneCls}>
                    {tone}
                  </span>
                  <div className="flex-1" />
                  <span className="text-xs font-mono text-slate-600">
                    {r.open} open
                    {r.overdue > 0 && (
                      <span className="text-red-700 font-bold"> · {r.overdue} overdue</span>
                    )}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
                  <div
                    className="bg-red-500"
                    style={{ width: `${(r.overdue / maxOpen) * 100}%` }}
                    title={`${r.overdue} overdue`}
                  />
                  <div
                    className="bg-brand-500"
                    style={{ width: `${((r.open - r.overdue) / maxOpen) * 100}%` }}
                    title={`${r.open - r.overdue} open (not overdue)`}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
          Overdue (red) + open-not-overdue (brand) stacked, normalized against the most-loaded
          person. Use this to redistribute work before someone drops a ball.
        </p>
      </Card>
    </section>
  );
}
