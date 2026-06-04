import { useOrgTable } from "../lib/useOrgTable";
import { fmtDate } from "../lib/dates";
import { useAuth } from "../auth/useAuth";
import type { TaskRow, StudyRow } from "../lib/types";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";

/** Approvals — everything waiting on YOUR signature, review, or
 *  acknowledgment, across every study. Document actions route here via
 *  send-for-action; completing them happens in the study (principle #1). */
export function Approvals({ onNavigate }: { onNavigate: (h: string) => void }) {
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const byStudy = new Map(studies.rows.map((s) => [s.id, s]));

  const waiting = tasks.rows.filter(
    (t) => t.action_type && t.status !== "done" && t.assigned_to_user_id === userId
  );
  const now = Date.now();

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Team work"
        title="Approvals"
        subtitle="Documents waiting on you — sign, review, or acknowledge. Each opens inside its study so the context is right there."
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
          <Card flush className="overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {waiting.map((t) => {
                const study = t.study_id ? byStudy.get(t.study_id) : null;
                const overdue = t.due_at ? new Date(t.due_at).getTime() < now : false;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => onNavigate(study ? `#/studies/${study.id}` : "#/inbox")}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-brand-50/30 transition"
                    >
                      <Pill tone="brand">{String(t.action_type).replace(/_/g, " ")}</Pill>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-slate-900 truncate">{t.title}</span>
                        <span className="block text-[11px] text-slate-500 truncate">
                          {study ? `${study.code} · ${study.title}` : "No study"}
                        </span>
                      </span>
                      {t.due_at && (
                        <span className={"text-[11px] font-mono whitespace-nowrap " + (overdue ? "text-red-700 font-bold" : "text-slate-500")}>
                          {overdue ? "overdue " : "due "}
                          {fmtDate(t.due_at)}
                        </span>
                      )}
                      <Icon name="chevron-right" size={13} className="text-slate-300" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
