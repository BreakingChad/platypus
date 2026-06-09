import { useOrgTable } from "../lib/useOrgTable";
import type { StudyRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

/** IntakeQueueBlock — studies awaiting triage.
 *  The cross-page version of the Intake page's queue. Hides when clear.
 *  (Data-completeness bar removed for now, matching the Intake page.) */
export function IntakeQueueBlock({ ctx }: { ctx: BlockContext }) {
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });

  const queue = studies.rows.filter(
    (s) => !s.closed && (s.stage_key === "intake" || s.stage_key === null) && !s.committed_at
  );
  if (queue.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
            <Icon name="inbox" size={14} />
          </span>
          Awaiting intake triage
        </h2>
        <button
          onClick={() => ctx.navigate("#/intake")}
          className="text-xs font-semibold text-brand-700 hover:underline"
        >
          Open intake →
        </button>
      </div>
      <Card flush className="overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {queue.slice(0, 6).map((s) => (
            <li key={s.id}>
              <button
                onClick={() => ctx.navigate(`#/studies/${s.id}`)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-brand-50/30 transition"
              >
                <span className="font-mono text-xs text-slate-500">{s.code}</span>
                <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 truncate">
                  {s.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
