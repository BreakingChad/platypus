import { useMemo, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import { fmtDay } from "../lib/dates";
import { useAuth } from "../auth/useAuth";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { TaskRow, StudyRow, PipelineStageRow, TeamRoleRow, DocumentRow } from "../lib/types";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { TaskDetail } from "./Inbox";

/** Approvals — everything waiting on YOUR signature, review, or
 *  acknowledgment, across every study. Same split-view model as the Inbox:
 *  ≥xl the reading pane is docked; the act itself happens inside the study
 *  (principle #1), so the pane's primary action takes you there. */
export function Approvals({ onNavigate }: { onNavigate: (h: string) => void }) {
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const { isAdmin } = useCurrentMember();
  const isXl = useMediaQuery("(min-width: 1280px)");

  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const roles = useOrgTable<TeamRoleRow>("team_roles", {});
  const documents = useOrgTable<DocumentRow>("documents", {});

  const byStudy = useMemo(() => new Map(studies.rows.map((s) => [s.id, s])), [studies.rows]);
  const stageByKey = useMemo(() => {
    const m: Record<string, PipelineStageRow> = {};
    for (const s of stages.rows) m[s.key] = s;
    return m;
  }, [stages.rows]);

  const waiting = useMemo(
    () =>
      tasks.rows.filter(
        (t) => t.action_type && t.status !== "done" && t.assigned_to_user_id === userId
      ),
    [tasks.rows, userId]
  );
  const now = Date.now();

  const [selId, setSelId] = useState<string | null>(null);
  const sel = waiting.find((t) => t.id === selId) ?? waiting[0] ?? null;

  const goToTask = (t: TaskRow) => {
    const study = t.study_id ? byStudy.get(t.study_id) : null;
    onNavigate(study ? `#/studies/${study.id}` : "#/inbox");
  };

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Work queues"
        title="Approvals"
        subtitle="Documents waiting on you — sign, review, or acknowledge. The act itself happens inside the study, so the context is always in front of you."
      />
      <div className="mt-6">
        {waiting.length === 0 ? (
          <Card>
            <EmptyState
              iconName="check"
              title="Nothing waiting on you"
              sub="When someone sends you a document to sign, review, or acknowledge, it lands here (and in your Inbox)."
            />
          </Card>
        ) : (
          <div className="xl:grid xl:grid-cols-[minmax(420px,640px)_minmax(0,1fr)] xl:gap-4 xl:items-start">
            <Card flush className="overflow-hidden">
              <ul className="divide-y divide-slate-100">
                {waiting.map((t) => {
                  const study = t.study_id ? byStudy.get(t.study_id) : null;
                  const overdue = t.due_at ? new Date(t.due_at).getTime() < now : false;
                  const selected = sel?.id === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => (isXl ? setSelId(t.id) : goToTask(t))}
                        className={
                          "w-full text-left px-4 py-3 flex items-center gap-3 transition border-l-2 " +
                          (selected && isXl
                            ? "bg-brand-50/70 border-l-brand-500"
                            : "hover:bg-brand-50/30 border-l-transparent")
                        }
                      >
                        <Pill tone="brand">{String(t.action_type).replace(/_/g, " ")}</Pill>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-slate-900 truncate">{t.title}</span>
                          <span className="block text-[11px] text-slate-500 truncate">
                            {study ? `${study.code} · ${study.title}` : "No study"}
                          </span>
                        </span>
                        {t.due_at && (
                          <span
                            className={
                              "text-[11px] font-mono whitespace-nowrap " +
                              (overdue ? "text-red-700 font-bold" : "text-slate-500")
                            }
                          >
                            {overdue ? "overdue " : "due "}
                            {fmtDay(t.due_at)}
                          </span>
                        )}
                        <Icon name="chevron-right" size={13} className="text-slate-300 xl:hidden" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>

            {/* Docked reading pane (≥ xl) — read here, act in the study */}
            <div className="hidden xl:flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden sticky top-20 max-h-[calc(100vh-110px)] min-h-[340px]">
              {sel ? (
                <TaskDetail
                  key={sel.id}
                  task={sel}
                  study={sel.study_id ? byStudy.get(sel.study_id) ?? null : null}
                  stage={sel.stage_key ? stageByKey[sel.stage_key] ?? null : null}
                  role={sel.assigned_to_role_id ? roles.rows.find((r) => r.id === sel.assigned_to_role_id) ?? null : null}
                  doc={sel.document_id ? documents.rows.find((d) => d.id === sel.document_id) ?? null : null}
                  isAdmin={isAdmin}
                  onNavigate={onNavigate}
                  onComplete={() => goToTask(sel)}
                  onReopen={() => goToTask(sel)}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center p-10 text-center">
                  <div>
                    <Icon name="check" size={24} className="mx-auto text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600 mt-3">Nothing selected</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
