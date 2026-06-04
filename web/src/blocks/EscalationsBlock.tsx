import { useOrgTable } from "../lib/useOrgTable";
import { fmtDate } from "../lib/dates";
import type { TaskRow, StudyRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";
import type { BlockContext } from "./registry";

/** EscalationsBlock — every open escalation across the portfolio, most
 *  overdue first. The "what's on fire" surface. Hides when quiet. */
export function EscalationsBlock({ ctx }: { ctx: BlockContext }) {
  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });

  const open = tasks.rows.filter(
    (t) => t.kind === "escalation" && (t.status === "open" || t.status === "in_progress")
  );
  if (open.length === 0) return null;

  const byStudy = new Map(studies.rows.map((s) => [s.id, s]));
  const now = Date.now();

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
            <Icon name="alert" size={14} />
          </span>
          Open escalations
        </h2>
        <span className="text-xs font-mono text-slate-500">{open.length}</span>
      </div>
      <Card flush className="overflow-hidden border-red-100">
        <ul className="divide-y divide-slate-100">
          {open.slice(0, 8).map((t) => {
            const study = t.study_id ? byStudy.get(t.study_id) : null;
            const overdue = t.due_at ? new Date(t.due_at).getTime() < now : false;
            return (
              <li key={t.id}>
                <button
                  onClick={() =>
                    ctx.navigate(study ? `#/studies/${study.id}` : "#/inbox")
                  }
                  className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-red-50/40 transition"
                >
                  <Pill tone="danger">escalation</Pill>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 truncate">
                      {t.title}
                    </span>
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
    </section>
  );
}
