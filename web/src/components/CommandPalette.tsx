import { useEffect, useMemo, useRef, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { StudyRow, PipelineStageRow, TaskRow } from "../lib/types";
import { useCurrentMember } from "../lib/useCurrentMember";
import { Icon } from "./ui/Icon";

/** CommandPalette — Cmd-K / Ctrl-K search across studies + nav shortcuts.
 *
 *  Opens on the global hotkey. Type to filter. Up/Down to navigate, Enter to
 *  open. Esc to dismiss. Click off to dismiss.
 *
 *  Ranking: exact code match > code startsWith > title startsWith > word
 *  boundary > substring. Nav commands get a small constant boost so they
 *  surface even with thin queries.
 */

type Result = {
  id: string;
  kind: "study" | "nav" | "task";
  title: string;
  subtitle?: string;
  icon: string;
  color?: string;   // for stage chip
  score: number;
  navigateTo: string;
};

export function CommandPalette({
  onNavigate,
}: {
  onNavigate: (h: string) => void;
}) {
  const { isAdmin } = useCurrentMember();
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const tasksTable = useOrgTable<TaskRow>("tasks", { orderBy: "due_at" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hotkey wiring (⌘K / Ctrl-K). Also '/' from anywhere outside an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const isSlash = e.key === "/" && !inInput(e.target);
      if (isCmdK || isSlash) {
        e.preventDefault();
        setOpen(true);
        setQ("");
        setActiveIdx(0);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const stageByKey = useMemo(() => {
    const m: Record<string, PipelineStageRow> = {};
    for (const s of stages.rows) m[s.key] = s;
    return m;
  }, [stages.rows]);

  const navCommands = useMemo<Result[]>(() => {
    const baseNav: Omit<Result, "score">[] = [
      { id: "nav-home", kind: "nav", title: "Home", subtitle: "Dashboard", icon: "home", navigateTo: "#/" },
      { id: "nav-studies", kind: "nav", title: "Studies", subtitle: "All studies", icon: "folder", navigateTo: "#/studies" },
      { id: "nav-pipeline", kind: "nav", title: "Pipeline", subtitle: "Kanban view", icon: "layers", navigateTo: "#/pipeline" },
      { id: "nav-inbox", kind: "nav", title: "Inbox", subtitle: "My tasks (coming)", icon: "inbox", navigateTo: "#/inbox" },
      { id: "nav-profile", kind: "nav", title: "Profile", subtitle: "Your details", icon: "users", navigateTo: "#/profile" },
    ];
    if (isAdmin) {
      baseNav.push(
        { id: "nav-org", kind: "nav", title: "Organization settings", subtitle: "Configure your org", icon: "settings", navigateTo: "#/settings/org" },
        { id: "nav-members", kind: "nav", title: "Members", subtitle: "Manage access", icon: "users", navigateTo: "#/settings/members" },
        { id: "nav-fields", kind: "nav", title: "Study fields", subtitle: "Configure field definitions", icon: "file", navigateTo: "#/settings/fields" },
        { id: "nav-stages", kind: "nav", title: "Pipeline stages", subtitle: "Design the lifecycle", icon: "workflow", navigateTo: "#/settings/stages" },
        { id: "nav-teams", kind: "nav", title: "Teams & roles", subtitle: "Org structure", icon: "users", navigateTo: "#/settings/teams" },
        { id: "nav-access", kind: "nav", title: "Access roles", subtitle: "Module permissions", icon: "shield", navigateTo: "#/settings/access" },
      );
    }
    return baseNav.map((n) => ({ ...n, score: 0 }));
  }, [isAdmin]);

  // Ranking
  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    const openTasks = tasksTable.rows.filter(
      (t) => t.status === "open" || t.status === "in_progress"
    );
    const studyById = new Map(studies.rows.map((s) => [s.id, s]));

    if (!query) {
      // Empty query: recent studies + my open tasks + all nav commands.
      const recent = [...studies.rows]
        .filter((s) => !s.closed)
        .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        .slice(0, 5)
        .map((s) => studyToResult(s, stageByKey, 0));
      const recentTasks = [...openTasks]
        .sort((a, b) => {
          const aDue = a.due_at ? new Date(a.due_at).getTime() : Infinity;
          const bDue = b.due_at ? new Date(b.due_at).getTime() : Infinity;
          return aDue - bDue;
        })
        .slice(0, 5)
        .map((t) =>
          taskToResult(t, t.study_id ? studyById.get(t.study_id) : undefined, 0)
        );
      return [...recent, ...recentTasks, ...navCommands];
    }

    const studyResults = studies.rows
      .map((s) => {
        const score = rankStudy(s, query);
        return score === 0 ? null : studyToResult(s, stageByKey, score);
      })
      .filter(Boolean) as Result[];

    const taskResults = openTasks
      .map((t) => {
        const score = rankTask(t, query);
        return score === 0
          ? null
          : taskToResult(t, t.study_id ? studyById.get(t.study_id) : undefined, score);
      })
      .filter(Boolean) as Result[];

    const navResults = navCommands
      .map((n) => {
        const score = rankNav(n, query);
        return score === 0 ? null : { ...n, score: score + 0.5 };
      })
      .filter(Boolean) as Result[];

    return [...studyResults, ...taskResults, ...navResults]
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
  }, [q, studies.rows, tasksTable.rows, stageByKey, navCommands]);

  // Reset active index when results change
  useEffect(() => setActiveIdx(0), [q]);

  const pick = (r: Result) => {
    onNavigate(r.navigateTo);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-start justify-center p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[70vh]"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
          <Icon name="search" size={14} className="text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Universal search — studies, people, pages…"
            className="flex-1 outline-none text-sm font-medium text-slate-900 placeholder:text-slate-400 bg-transparent"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const r = results[activeIdx];
                if (r) pick(r);
              }
            }}
          />
          <kbd className="text-[10px] font-mono text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        <div className="flex-1 overflow-y-auto">
          {results.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-500">
              No results. Try a different query.
            </div>
          )}
          {results.map((r, idx) => (
            <button
              key={r.id}
              onClick={() => pick(r)}
              onMouseEnter={() => setActiveIdx(idx)}
              className={
                "w-full text-left px-4 py-2.5 flex items-center gap-3 transition " +
                (activeIdx === idx ? "bg-brand-50" : "hover:bg-slate-50")
              }
            >
              <div
                className={
                  "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 " +
                  (r.kind === "study"
                    ? "bg-white border border-slate-200"
                    : "bg-slate-100 text-slate-500")
                }
                style={r.color ? { borderLeft: `4px solid ${r.color}` } : undefined}
              >
                <Icon name={r.icon} size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {r.title}
                </div>
                {r.subtitle && (
                  <div className="text-[11px] text-slate-500 truncate">{r.subtitle}</div>
                )}
              </div>
              <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
                {r.kind === "study" ? "study" : r.kind === "task" ? "task" : "go to"}
              </span>
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50/80 text-[10px] font-mono text-slate-400 flex items-center justify-between">
          <span>
            <kbd className="text-[10px] mr-1">↑↓</kbd> navigate
            <kbd className="text-[10px] mx-2">↵</kbd> open
          </span>
          <span>
            <kbd className="text-[10px] mr-1">⌘K</kbd>or<kbd className="text-[10px] mx-1">/</kbd>to open
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- ranking helpers ---------- */

function rankTask(t: TaskRow, q: string): number {
  const lower = (t.title ?? "").toLowerCase();
  if (!lower) return 0;
  if (lower === q) return 25;
  if (lower.startsWith(q)) return 12;
  if (lower.includes(" " + q)) return 6;
  if (lower.includes(q)) return 3;
  return 0;
}

function rankStudy(s: StudyRow, q: string): number {
  const fields: [string, number][] = [
    [s.code ?? "", 5],
    [s.title ?? "", 3],
    [s.nct ?? "", 4],
    [s.sponsor ?? "", 2],
    [s.pi_name ?? "", 2],
    [s.therapeutic_area ?? "", 1],
    [s.phase ?? "", 1],
  ];
  let best = 0;
  for (const [val, weight] of fields) {
    const lower = val.toLowerCase();
    if (!lower) continue;
    if (lower === q) best = Math.max(best, weight * 10);
    else if (lower.startsWith(q)) best = Math.max(best, weight * 5);
    else if (lower.includes(` ${q}`) || lower.includes(`-${q}`))
      best = Math.max(best, weight * 3);
    else if (lower.includes(q)) best = Math.max(best, weight * 1.5);
  }
  return best;
}

function rankNav(n: Result, q: string): number {
  const fields = [n.title, n.subtitle ?? ""];
  for (const f of fields) {
    const lower = f.toLowerCase();
    if (lower === q) return 10;
    if (lower.startsWith(q)) return 5;
    if (lower.includes(q)) return 2;
  }
  return 0;
}

function taskToResult(t: TaskRow, study: StudyRow | undefined, score: number): Result {
  return {
    id: `task-${t.id}`,
    kind: "task",
    title: t.title,
    subtitle: [
      study?.code,
      t.kind,
      t.due_at ? `due ${new Date(t.due_at).toLocaleDateString()}` : null,
    ].filter(Boolean).join(" · ") || undefined,
    icon: "check",
    score,
    navigateTo: study ? `#/studies/${study.id}` : "#/inbox",
  };
}

function studyToResult(
  s: StudyRow,
  stageByKey: Record<string, PipelineStageRow>,
  score: number
): Result {
  const stage = s.stage_key ? stageByKey[s.stage_key] : undefined;
  return {
    id: `study-${s.id}`,
    kind: "study",
    title: `${s.code} · ${s.title}`,
    subtitle: [s.sponsor, stage?.label, s.therapeutic_area]
      .filter(Boolean)
      .join(" · ") || undefined,
    icon: "folder",
    color: stage?.color,
    score,
    navigateTo: `#/studies/${s.id}`,
  };
}

function inInput(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    t.isContentEditable
  );
}
