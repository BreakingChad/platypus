import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useOrgTable } from "../lib/useOrgTable";
import type {
  PipelineStageRow,
  ProfileRow,
  StudyRow,
  TaskRow,
  TeamRoleHolderRow,
} from "../lib/types";
import { computeHealth } from "../lib/studyHealth";
import { HealthDot } from "../components/ui/HealthDot";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";
import type { BlockContext } from "./registry";

/** MyStudiesBlock — surfaces studies relevant to the signed-in user.
 *
 *  A study is "mine" if any of:
 *    - The study's pi_name matches my full_name (case-insensitive trim)
 *    - I have an open task assigned to me on this study
 *    - I hold a role assigned to an open task on this study
 *
 *  Hides itself when nothing matches so the block is always meaningful.
 */
export function MyStudiesBlock({ ctx }: { ctx: BlockContext }) {
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;

  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "updated_at", realtime: true });
  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });
  const roleHolders = useOrgTable<TeamRoleHolderRow>("team_role_holders");

  const [myProfile, setMyProfile] = useState<ProfileRow | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled) setMyProfile((data as any) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const myRoleIds = useMemo(() => {
    if (!userId) return new Set<string>();
    return new Set(roleHolders.rows.filter((h) => h.user_id === userId).map((h) => h.team_role_id));
  }, [roleHolders.rows, userId]);

  const myStudies = useMemo(() => {
    if (!userId) return [];
    const me = (myProfile?.full_name ?? "").trim().toLowerCase();

    // Find study ids that touch me via open tasks (assigned to me or to my roles).
    const taskStudyIds = new Set<string>();
    for (const t of tasks.rows) {
      if (t.status !== "open" && t.status !== "in_progress") continue;
      if (!t.study_id) continue;
      if (t.assigned_to_user_id === userId) taskStudyIds.add(t.study_id);
      else if (t.assigned_to_role_id && myRoleIds.has(t.assigned_to_role_id)) {
        taskStudyIds.add(t.study_id);
      }
    }

    return studies.rows
      .filter((s) => {
        if (s.closed) return false;
        if (taskStudyIds.has(s.id)) return true;
        if (me && (s.pi_name ?? "").trim().toLowerCase() === me) return true;
        return false;
      })
      .map((s) => ({
        row: s,
        health: computeHealth(s, stages.rows),
        // Why is it "mine"? Useful for the chip.
        reason: taskStudyIds.has(s.id) ? "tasks" : "pi",
      }))
      .sort((a, b) => (b.row.updated_at ?? "").localeCompare(a.row.updated_at ?? ""))
      .slice(0, 8);
  }, [userId, myProfile, tasks.rows, myRoleIds, studies.rows, stages.rows]);

  if (myStudies.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          My studies
          <Pill tone="brand">{myStudies.length}</Pill>
        </h2>
        <button
          onClick={() => ctx.navigate("#/studies")}
          className="text-xs font-semibold text-brand-700 hover:underline flex items-center gap-1"
        >
          All studies <Icon name="chevron-right" size={10} />
        </button>
      </div>
      <Card flush>
        <ul className="divide-y divide-slate-100">
          {myStudies.map(({ row: s, health, reason }) => {
            const stage = s.stage_key ? stages.rows.find((st) => st.key === s.stage_key) : null;
            return (
              <li key={s.id}>
                <button
                  onClick={() => ctx.navigate(`#/studies/${s.id}`)}
                  className="w-full text-left px-4 py-2.5 hover:bg-brand-50/30 transition grid grid-cols-[120px_1fr_160px_120px] gap-3 items-center"
                >
                  <span className="font-mono text-xs text-slate-600 flex items-center gap-2">
                    <HealthDot health={health} variant="dot" />
                    {s.code}
                  </span>
                  <span className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {s.title}
                    </div>
                    {(s.sponsor || s.therapeutic_area) && (
                      <div className="text-[11px] text-slate-500 truncate">
                        {[s.sponsor, s.therapeutic_area].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </span>
                  <span>
                    {stage && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                        style={{ backgroundColor: stage.color }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                        {stage.label}
                      </span>
                    )}
                  </span>
                  <span className="text-right">
                    <Pill tone={reason === "pi" ? "info" : "neutral"}>
                      {reason === "pi" ? "you're PI" : "open tasks"}
                    </Pill>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
