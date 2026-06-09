import { useMemo } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import { useStickyState } from "../lib/useStickyState";
import type { TaskRow, StudyRow, PipelineStageRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Select } from "../components/ui/Select";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Loader } from "../components/ui/Loader";

/** Calendar — "Upcoming": every dated thing across the portfolio in one place.
 *
 *  Events are synthesized from open tasks that carry a due date (the work-stream
 *  engine, handoffs, escalations, and manual tasks all produce these). Two
 *  groupings: By study (a card per study) and By time (overdue → later buckets).
 *  Every row drills into the study — clinical-trial users work IN the study.
 *  Modeled on the proof-of-concept's schedule view.
 */

type CalEvent = {
  id: string;
  date: string;
  kindLabel: string;
  color: string;
  title: string;
  studyId: string | null;
};

const KIND_META: Record<string, { label: string; color: string }> = {
  escalation: { label: "Escalation", color: "#EF4444" },
  handoff: { label: "Handoff", color: "#7C3AED" },
  external_handoff: { label: "Handoff", color: "#7C3AED" },
  date: { label: "Task", color: "#F59E0B" },
  manual: { label: "Task", color: "#F59E0B" },
};

const SECTION_META: { key: string; label: string; color: string }[] = [
  { key: "overdue", label: "Overdue", color: "#B91C1C" },
  { key: "today", label: "Today", color: "#4F46E5" },
  { key: "thisWeek", label: "This week", color: "#0284C7" },
  { key: "next30", label: "Next 30 days", color: "#64748B" },
  { key: "later", label: "Later", color: "#94A3B8" },
];

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export function CalendarPage({ onNavigate }: { onNavigate: (h: string) => void }) {
  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });

  const [groupBy, setGroupBy] = useStickyState<string>("calendar/groupBy", "study");
  const [studyFilter, setStudyFilter] = useStickyState<string>("calendar/studyFilter", "");

  const studyById = useMemo(() => {
    const m: Record<string, StudyRow> = {};
    for (const s of studies.rows) m[s.id] = s;
    return m;
  }, [studies.rows]);

  const stageColor = (key: string | null) =>
    (key ? stages.rows.find((s) => s.key === key)?.color : null) ?? "#94A3B8";

  /** Open, dated tasks → events. */
  const events = useMemo<CalEvent[]>(() => {
    return tasks.rows
      .filter((t) => t.due_at && (t.status === "open" || t.status === "in_progress"))
      .map((t) => {
        const meta = KIND_META[t.kind] ?? { label: "Task", color: "#F59E0B" };
        return { id: t.id, date: t.due_at as string, kindLabel: meta.label, color: meta.color, title: t.title, studyId: t.study_id };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [tasks.rows]);

  const visible = useMemo(
    () => events.filter((ev) => ev.studyId && studyById[ev.studyId]).filter((ev) => !studyFilter || ev.studyId === studyFilter),
    [events, studyFilter, studyById]
  );

  const timeBuckets = useMemo(() => {
    const today = startOfToday();
    const b: Record<string, CalEvent[]> = { overdue: [], today: [], thisWeek: [], next30: [], later: [] };
    for (const ev of visible) {
      const days = Math.round((new Date(ev.date).getTime() - today.getTime()) / 86400000);
      if (days < 0) b.overdue.push(ev);
      else if (days === 0) b.today.push(ev);
      else if (days <= 7) b.thisWeek.push(ev);
      else if (days <= 30) b.next30.push(ev);
      else b.later.push(ev);
    }
    return b;
  }, [visible]);

  const studyGroups = useMemo(() => {
    const byStudy = new Map<string, CalEvent[]>();
    for (const ev of visible) {
      const k = ev.studyId as string;
      if (!byStudy.has(k)) byStudy.set(k, []);
      byStudy.get(k)!.push(ev);
    }
    return [...byStudy.entries()]
      .map(([studyId, items]) => ({ study: studyById[studyId], items }))
      .filter((g) => g.study)
      .sort((a, b) => new Date(a.items[0].date).getTime() - new Date(b.items[0].date).getTime());
  }, [visible, studyById]);

  const studyOptions = useMemo(
    () => [...studies.rows].sort((a, b) => a.code.localeCompare(b.code)),
    [studies.rows]
  );

  const renderRow = (ev: CalEvent, showStudyChip: boolean) => {
    const today = startOfToday();
    const d = new Date(ev.date);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    const overdue = days < 0;
    const study = ev.studyId ? studyById[ev.studyId] : null;
    const rel = overdue ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${days}d`;
    return (
      <button
        key={ev.id}
        onClick={() => study && onNavigate(`#/studies/${study.id}`)}
        className="w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 flex items-center gap-3.5 hover:bg-brand-50/30 transition"
      >
        <div className="w-12 text-center flex-shrink-0">
          <div className={"text-[10px] font-mono uppercase " + (overdue ? "text-red-600" : "text-slate-400")}>{d.toLocaleString("en-US", { month: "short" })}</div>
          <div className={"text-xl font-semibold leading-tight " + (overdue ? "text-red-600" : "text-slate-900")}>{d.getDate()}</div>
        </div>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider flex-shrink-0" style={{ color: ev.color, backgroundColor: `${ev.color}14` }}>{ev.kindLabel}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900 truncate">{ev.title}</div>
          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
            {showStudyChip && study && (
              <span className="inline-flex items-center gap-1 font-mono">
                <Icon name="folder" size={10} className="text-slate-400" />{study.code}
              </span>
            )}
            <span className={overdue ? "text-red-600 font-semibold" : ""}>{rel}</span>
          </div>
        </div>
        <Icon name="chevron-right" size={14} className="text-slate-300 flex-shrink-0" />
      </button>
    );
  };

  const loading = tasks.loading && events.length === 0;

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Workspace"
        title="Upcoming"
        subtitle="Every dated task across your portfolio, in one place. Group by study to see each study's runway, or by time to work the overdue list down."
        actions={
          <div className="flex items-center gap-2">
            <div className="w-48">
              <Select value={studyFilter} onChange={(e) => setStudyFilter(e.target.value)} aria-label="Filter by study" className="py-1.5 text-sm">
                <option value="">All studies</option>
                {studyOptions.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
              </Select>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white overflow-hidden">
              {([["study", "By study"], ["time", "By time"]] as const).map(([k, label], i) => (
                <button key={k} onClick={() => setGroupBy(k)}
                  className={"px-3 py-1.5 text-sm font-semibold transition " + (i === 1 ? "border-l border-slate-200 " : "") + (groupBy === k ? "bg-brand-gradient text-white" : "text-slate-600 hover:text-slate-900")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {loading ? (
        <Card className="mt-6"><Loader label="Loading schedule…" /></Card>
      ) : visible.length === 0 ? (
        <Card className="mt-6">
          <EmptyState iconName="calendar" title="No upcoming events"
            sub={studyFilter ? "Try clearing the study filter." : "When studies have tasks with due dates, they'll appear here."} />
        </Card>
      ) : groupBy === "study" ? (
        <div className="mt-6 space-y-5">
          {studyGroups.map((g) => (
            <Card key={g.study.id} flush className="overflow-hidden">
              <button onClick={() => onNavigate(`#/studies/${g.study.id}`)}
                className="w-full text-left px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2.5 hover:bg-slate-100 transition">
                <Icon name="folder" size={13} className="text-slate-400 flex-shrink-0" />
                <span className="font-mono text-xs font-semibold text-slate-700">{g.study.code}</span>
                <span className="text-sm text-slate-700 truncate flex-1">{g.study.title}</span>
                <span className="text-[11px] font-mono text-slate-400">{g.items.length} event{g.items.length === 1 ? "" : "s"}</span>
              </button>
              {g.items.map((ev) => renderRow(ev, false))}
            </Card>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {SECTION_META.map(({ key, label, color }) => {
            const evs = timeBuckets[key];
            if (!evs || evs.length === 0) return null;
            return (
              <div key={key}>
                <div className="flex items-baseline gap-2.5 mb-2 px-1">
                  <span className="font-mono text-[11px] uppercase tracking-wider font-semibold" style={{ color }}>{label}</span>
                  <span className="text-xs text-slate-400">{evs.length} event{evs.length === 1 ? "" : "s"}</span>
                </div>
                <Card flush className="overflow-hidden">{evs.map((ev) => renderRow(ev, true))}</Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
