import { useState } from "react";
import { useToast } from "../lib/Toast";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { useDismissable } from "../lib/useDismissable";
import type { PipelineStageRow, SiteRow, StudyRow, StudySiteRow } from "../lib/types";
import { HealthDot } from "../components/ui/HealthDot";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";

/** CRM-style study header pieces (Wave S1) — highlights strip, stage path,
 *  multi-site related list. A study runs at MANY sites at once. */

/* ---------- highlights strip ---------- */
export function HighlightsStrip({
  study,
  health,
  siteCount,
}: {
  study: StudyRow;
  health: { level: string; daysInStage: number; targetDays: number; summary: string } | null;
  siteCount: number;
}) {
  const goal = Number((study.custom_field_values as any)?.accrualGoal ?? 0);
  const cells: { l: string; v: React.ReactNode }[] = [
    { l: "Sponsor", v: study.sponsor || dash() },
    { l: "PI", v: study.pi_name || dash() },
    { l: "Phase", v: study.phase || dash() },
    { l: "Enrollment", v: goal > 0 ? `0 / ${goal}` : dash() },
    { l: "Sites", v: siteCount > 0 ? `${siteCount}` : dash() },
    {
      l: "Health",
      v:
        health && !study.closed && health.level !== "unknown" ? (
          <span className="inline-flex items-center gap-1.5">
            <HealthDot health={health as any} variant="dot" />
            {health.targetDays > 0 ? `${health.daysInStage}d / ${health.targetDays}d` : "—"}
          </span>
        ) : (
          dash()
        ),
    },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 rounded-xl border border-slate-200 bg-white overflow-hidden">
      {cells.map((c, i) => (
        <div
          key={c.l}
          className={
            "px-3 py-2 " +
            (i % 6 !== 5 ? "border-r border-slate-100 " : "") +
            "border-b border-slate-100 sm:border-b-0"
          }
        >
          <div className="text-[10px] uppercase tracking-wider text-slate-400">{c.l}</div>
          <div className="text-sm text-slate-900 truncate mt-0.5">{c.v}</div>
        </div>
      ))}
    </div>
  );
}
const dash = () => <span className="text-slate-300">—</span>;

/* ---------- stage path (chevrons) ---------- */
export function PathBar({
  stages,
  currentKey,
  isAdmin,
  advancing,
  onAdvance,
}: {
  stages: PipelineStageRow[];
  currentKey: string | null;
  isAdmin: boolean;
  advancing: boolean;
  onAdvance: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useDismissable("[data-stage-dd]", () => setOpen(false), open);
  if (stages.length === 0) return null;
  const curIdx = stages.findIndex((s) => s.key === currentKey);
  const current = curIdx >= 0 ? stages[curIdx] : null;
  const next = curIdx >= 0 && curIdx < stages.length - 1 ? stages[curIdx + 1] : null;
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="text-xs font-semibold text-slate-500">Stage</span>
      <div className="relative" data-stage-dd>
        <button
          onClick={() => isAdmin && setOpen((o) => !o)}
          disabled={advancing}
          className={
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition " +
            (isAdmin ? "hover:opacity-90 cursor-pointer" : "cursor-default")
          }
          style={{ backgroundColor: current?.color ?? "#64748b" }}
          aria-haspopup={isAdmin ? "listbox" : undefined}
          aria-expanded={open}
          title={isAdmin ? "Move to another stage" : current?.label}
        >
          {current?.label ?? "Unassigned"}
          {isAdmin && <Icon name="chevron-down" size={12} aria-hidden="true" />}
        </button>
        {open && (
          <div role="listbox" className="absolute left-0 top-full mt-1 z-50 w-60 bg-white border border-slate-200 rounded-xl shadow-xl py-1 max-h-80 overflow-y-auto">
            {stages.map((s, i) => {
              const active = i === curIdx;
              const done = curIdx >= 0 && i < curIdx;
              return (
                <button
                  key={s.id}
                  role="option"
                  aria-selected={active}
                  disabled={active}
                  onClick={() => { setOpen(false); onAdvance(s.key); }}
                  className={
                    "w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition " +
                    (active ? "text-slate-400 cursor-default" : "text-slate-700 hover:bg-slate-50")
                  }
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                  {s.label}
                  {active && <span className="ml-auto text-[10px] font-mono text-slate-400">current</span>}
                  {done && <span className="ml-auto text-[10px] font-mono text-slate-300">done</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

/* ---------- smart action button (split: next step + alternatives) ---------- */
export function SmartActionButton({
  study, stages, advancing, savingClose, onAdvance, onToggleClosed,
}: {
  study: StudyRow;
  stages: PipelineStageRow[];
  advancing: boolean;
  savingClose: boolean;
  onAdvance: (key: string) => void;
  onToggleClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  useDismissable("[data-smart-action]", () => setOpen(false), open);

  if (study.closed) {
    return (
      <button onClick={onToggleClosed} disabled={savingClose}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-60">
        Reopen study
      </button>
    );
  }

  const curIdx = stages.findIndex((s) => s.key === study.stage_key);
  const current = curIdx >= 0 ? stages[curIdx] : null;
  const next = curIdx >= 0 && curIdx < stages.length - 1 ? stages[curIdx + 1] : null;
  // Terminal stage (or no next) → the forward step is to close out, not advance.
  const atEnd = !next || (current?.terminal ?? false);
  const primaryLabel = atEnd ? "Close study" : `Advance → ${next!.label}`;
  const onPrimary = atEnd ? onToggleClosed : () => onAdvance(next!.key);

  return (
    <div className="relative inline-flex" data-smart-action>
      <button onClick={onPrimary} disabled={advancing || savingClose}
        className="rounded-l-lg bg-brand-gradient text-white px-3.5 py-1.5 text-sm font-semibold shadow-sm hover:opacity-95 transition disabled:opacity-60">
        {primaryLabel}
      </button>
      <button onClick={() => setOpen((o) => !o)} disabled={advancing || savingClose}
        className="rounded-r-lg bg-brand-gradient text-white px-2 py-1.5 border-l border-white/30 hover:opacity-95 transition disabled:opacity-60"
        aria-haspopup="menu" aria-expanded={open} aria-label="Other actions">
        <Icon name="chevron-down" size={13} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-50 w-56 bg-white border border-slate-200 rounded-xl shadow-xl py-1 max-h-80 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-100">Move to stage</div>
          {stages.map((s, i) => {
            const active = i === curIdx;
            return (
              <button key={s.id} role="menuitem" disabled={active}
                onClick={() => { setOpen(false); onAdvance(s.key); }}
                className={"w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition " + (active ? "text-slate-400 cursor-default" : "text-slate-700 hover:bg-slate-50")}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                {s.label}
                {active && <span className="ml-auto text-[10px] font-mono text-slate-400">current</span>}
                {s.terminal && !active && <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-slate-300">terminal</span>}
              </button>
            );
          })}
          <button role="menuitem" onClick={() => { setOpen(false); onToggleClosed(); }}
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition border-t border-slate-100">
            Close study
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- multi-site related list ---------- */
const SITE_STATUS: Record<string, { label: string; tone: "brand" | "success" | "neutral" }> = {
  selected: { label: "Selected", tone: "brand" },
  activated: { label: "Activated", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

export function StudySitesCard({
  study,
  sites,
  studySites,
  isAdmin,
  onAdd,
  onRemove,
  onStatus,
  onSetPrimary,
}: {
  study: StudyRow;
  sites: SiteRow[];
  studySites: StudySiteRow[];
  isAdmin: boolean;
  onAdd: (siteId: string) => void;
  onRemove: (row: StudySiteRow) => void;
  onStatus: (row: StudySiteRow, status: string) => void;
  onSetPrimary: (row: StudySiteRow) => void;
}) {
  const [adding, setAdding] = useState(false);
  useDismissable("[data-add-site]", () => setAdding(false), adding);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "(removed site)";
  const assignedIds = new Set(studySites.map((r) => r.site_id));
  const available = sites.filter((s) => !assignedIds.has(s.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
        <Icon name="hospital" size={14} className="text-slate-400" />
        <span className="text-sm font-semibold text-slate-800">Sites</span>
        <span className="text-[11px] font-mono text-slate-400">{studySites.length}</span>
        <div className="flex-1" />
        {isAdmin && (
          <div className="relative" data-add-site>
            <button
              onClick={() => setAdding((a) => !a)}
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              + Add site
            </button>
            {adding && (
              <div className="absolute right-0 top-full mt-1 z-20 w-60 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
                {available.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-slate-400 italic">
                    Every site is already on this study (or none exist yet).
                  </div>
                ) : (
                  available.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        onAdd(s.id);
                        setAdding(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 transition truncate"
                    >
                      {s.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {studySites.length === 0 ? (
        <div className="px-4 py-4 text-xs text-slate-400 italic">
          No sites yet. A study can run at many sites — add the first above.
        </div>
      ) : (
        studySites.map((r) => {
          const st = SITE_STATUS[r.site_status] ?? SITE_STATUS.selected;
          return (
            <div
              key={r.id}
              className="px-4 py-2.5 border-b border-slate-100 last:border-b-0 flex items-center gap-2"
            >
              <span className="text-sm text-slate-900 truncate flex-1">
                {siteName(r.site_id)}
                {r.is_primary && (
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-amber-600">primary</span>
                )}
              </span>
              {isAdmin ? (
                <select
                  value={r.site_status}
                  onChange={(e) => onStatus(r, e.target.value)}
                  className="text-[11px] rounded border border-slate-200 bg-white px-1.5 py-0.5"
                  aria-label="Site status"
                >
                  <option value="selected">Selected</option>
                  <option value="activated">Activated</option>
                  <option value="closed">Closed</option>
                </select>
              ) : (
                <Pill tone={st.tone}>{st.label}</Pill>
              )}
              {isAdmin && !r.is_primary && (
                <button
                  onClick={() => onSetPrimary(r)}
                  className="text-[10px] font-semibold text-slate-400 hover:text-amber-600"
                  title="Mark as the primary site"
                >
                  ★
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => onRemove(r)}
                  className="text-slate-300 hover:text-red-500 leading-none"
                  aria-label={`Remove ${siteName(r.site_id)}`}
                >
                  ×
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
