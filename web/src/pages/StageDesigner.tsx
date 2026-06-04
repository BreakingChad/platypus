import { friendlyError } from "../lib/errors";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { PipelineStageRow } from "../lib/types";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { Card } from "../components/ui/Card";
import { AutoSaveNote } from "../components/ui/AutoSaveNote";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Tip } from "../components/ui/Tip";
import { MicroField } from "../components/ui/MicroField";

/** Pipeline Stage Designer — admin-only.
 *  Studies move through stages. Stages are owned by exactly one team. The
 *  team designs the lifecycle they live in, so this surface is the literal
 *  spine of the operating model. */

const SWATCHES = [
  "#6366F1", // indigo
  "#7C3AED", // violet
  "#3B82F6", // blue
  "#06B6D4", // cyan
  "#0EA5E9", // sky
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#64748B", // slate
  "#EC4899", // pink
];

const ICON_KEYS = ["layers", "folder", "workflow", "check", "alert", "shield", "users", "file"];

export function StageDesigner() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const { rows, loading, error, insert, update, remove } =
    useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });

  const [composer, setComposer] = useState({
    label: "",
    color: SWATCHES[0],
    icon_key: "layers",
    target_days: 14,
    terminal: false,
  });

  const sorted = [...rows].sort((a, b) => a.position - b.position);

  const safeKey = (label: string) =>
    `stage_${Date.now().toString(36)}_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 28)}`;

  const addStage = async () => {
    if (!composer.label.trim()) return;
    const nextPos = sorted.reduce((m, s) => Math.max(m, s.position), 0) + 10;
    try {
      await insert({
        key: safeKey(composer.label),
        label: composer.label.trim(),
        color: composer.color,
        icon_key: composer.icon_key,
        target_days: composer.target_days,
        terminal: composer.terminal,
        is_core: false,
        position: nextPos,
      });
      toast.success(stamped(`Added "${composer.label.trim()}" stage`));
      setComposer({ ...composer, label: "" });
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't add stage"));
    }
  };

  const move = async (stage: PipelineStageRow, direction: "up" | "down") => {
    const idx = sorted.findIndex((s) => s.id === stage.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx];
    try {
      await update(stage.id, { position: other.position });
      await update(other.id, { position: stage.position });
    } catch (e: any) {
      toast.error(friendlyError(e, "Reorder failed"));
    }
  };

  const tryRemove = async (stage: PipelineStageRow) => {
    if (stage.is_core) {
      toast.error("Core stages can't be removed — disable them in the lifecycle instead");
      return;
    }
    if (!(await confirmDialog({ title: "Remove stage", message: `Remove "${stage.label}"? Studies already in this stage keep the value but no new studies will enter it.`, confirmLabel: "Remove", danger: true }))) return;
    try {
      await remove(stage.id);
      toast.success(stamped(`Removed "${stage.label}"`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Remove failed"));
    }
  };

  if (memberLoading) {
    return <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8 text-sm text-slate-500"><Loader label="Checking permissions…" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader
          kicker="Configure"
          title="Pipeline stages"
          subtitle="Design the stages every study moves through."
        />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can reshape the pipeline. Ask an owner or admin — once they change the stages, every study in your portfolio reflects the new lifecycle."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Pipeline stages"
        subtitle="Design the stages every study moves through, the colour they're shown in, how long they should take, and which stages are terminal."
        actions={<Pill tone="brand">live · admin-driven</Pill>}
      />
      <AutoSaveNote />

      {/* COMPOSER */}
      <Card primary className="mt-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-brand-700">
              Add a stage
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Stages will be ordered at the end of the pipeline — reorder afterward.
            </div>
          </div>
          <span className="text-xs text-slate-400">Changes save automatically</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_150px_120px_auto_auto] gap-3 items-end">
          <MicroField label="Stage name">
            <Input
              value={composer.label}
              onChange={(e) => setComposer({ ...composer, label: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && composer.label.trim()) void addStage();
              }}
              placeholder="e.g. Feasibility"
            />
          </MicroField>
          <MicroField label="Target days">
            <Tip label="How many days a study should spend in this stage. Powers the Health signal everywhere — studies read amber as they approach this number and red past it." block>
              <Input
                type="number"
                min={1}
                value={composer.target_days}
                onChange={(e) => setComposer({ ...composer, target_days: Number(e.target.value) || 1 })}
                aria-label="Target days for a study to spend in this stage"
              />
            </Tip>
          </MicroField>
          <MicroField label="Final stage?">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer whitespace-nowrap h-[38px]">
              <input
                type="checkbox"
                checked={composer.terminal}
                onChange={(e) => setComposer({ ...composer, terminal: e.target.checked })}
                className="accent-brand-500 w-4 h-4"
              />
              Studies end here
            </label>
          </MicroField>
          <MicroField label="Color">
            <div className="flex gap-1 h-[38px] items-center">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => setComposer({ ...composer, color: c })}
                  className={
                    "w-6 h-6 rounded-md border-2 transition " +
                    (composer.color === c ? "border-slate-900 scale-110" : "border-white hover:border-slate-200")
                  }
                  style={{ backgroundColor: c }}
                  aria-label={"Use color " + c}
                  title={c}
                />
              ))}
            </div>
          </MicroField>
          <Button onClick={addStage} disabled={!composer.label.trim()}>
            + Add stage
          </Button>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-6">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && sorted.length === 0 && (
        <div className="text-sm text-slate-500 mb-6">Loading stages…</div>
      )}

      {/* STAGE LIST */}
      {sorted.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2 text-[11px] text-slate-400 font-semibold">
            <span className="w-8" />
            <span className="w-9" />
            <span className="flex-1">Stage</span>
            <span className="w-20 text-center">Target days</span>
            <span className="w-20 text-center">Terminal</span>
            <span className="w-24 text-center">Order</span>
            <span className="w-8" />
          </div>
          {sorted.map((s, idx) => (
            <StageRow
              key={s.id}
              stage={s}
              isFirst={idx === 0}
              isLast={idx === sorted.length - 1}
              onUpdate={(patch) =>
                update(s.id, patch).catch((e: any) => toast.error(friendlyError(e, "Update failed")))
              }
              onMoveUp={() => move(s, "up")}
              onMoveDown={() => move(s, "down")}
              onRemove={() => tryRemove(s)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500 mt-6 leading-relaxed max-w-3xl">
        <strong>Core stages</strong> (intake, committed, activated, closeout) can be relabelled
        and recoloured but not removed — other parts of the app reference them. Custom stages
        are fully editable.
      </p>
    </div>
  );
}

function StageRow({
  stage,
  isFirst,
  isLast,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  stage: PipelineStageRow;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Partial<PipelineStageRow>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(stage.label);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const commitLabel = () => {
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== stage.label) onUpdate({ label: trimmed });
    setEditing(false);
  };

  return (
    <div className="px-4 py-2.5 border-b border-slate-100 last:border-b-0 flex items-center gap-2 group">
      {/* drag handle (visual only for now) */}
      <span className="w-8 text-slate-300 flex justify-center cursor-grab" title="Drag handle (visual)">
        <Icon name="layers" size={14} />
      </span>

      {/* color swatch — click opens palette */}
      <div className="relative w-9">
        <button
          onClick={() => setPaletteOpen((o) => !o)}
          className="w-7 h-7 rounded-md border-2 border-white shadow-sm hover:scale-110 transition"
          style={{ backgroundColor: stage.color }}
          title="Change colour"
        />
        {paletteOpen && (
          <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-2 flex gap-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onUpdate({ color: c });
                  setPaletteOpen(false);
                }}
                className="w-6 h-6 rounded-md border-2 border-white hover:border-slate-200 transition"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
      </div>

      {/* label + key */}
      <span className="flex-1 flex items-center gap-2 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              if (e.key === "Escape") {
                setDraftLabel(stage.label);
                setEditing(false);
              }
            }}
            className="text-sm font-semibold text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none focus:border-brand-500"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-sm font-semibold text-slate-900 hover:text-brand-700 transition text-left truncate"
            title="Click to rename"
          >
            {stage.label}
          </button>
        )}
        {stage.is_core && <Pill tone="neutral">core</Pill>}
        <span className="text-[10px] font-mono text-slate-400 truncate">{stage.key}</span>
      </span>

      {/* target days */}
      <span className="w-20 text-center">
        <input
          type="number"
          min={1}
          value={stage.target_days}
          onChange={(e) => onUpdate({ target_days: Number(e.target.value) || 1 })}
          className="w-14 text-sm rounded border border-slate-200 px-1.5 py-0.5 text-center focus:border-brand-500 outline-none"
        />
      </span>

      {/* terminal */}
      <span className="w-20 text-center">
        <input
          type="checkbox"
          checked={stage.terminal}
          onChange={(e) => onUpdate({ terminal: e.target.checked })}
          className="accent-brand-500 w-4 h-4 cursor-pointer"
        />
      </span>

      {/* order controls */}
      <span className="w-24 flex justify-center gap-1">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className="w-7 h-7 rounded border border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-700 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center justify-center"
          title="Move up"
        >
          <Icon name="chevron-up" size={12} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className="w-7 h-7 rounded border border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-700 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center justify-center"
          title="Move down"
        >
          <Icon name="chevron-down" size={12} />
        </button>
      </span>

      {/* remove */}
      <span className="w-8 text-center">
        {stage.is_core ? (
          <span title="Core stage — can't be removed" className="text-slate-300 inline-flex">
            <Icon name="lock" size={14} />
          </span>
        ) : (
          <button
            onClick={onRemove}
            title="Remove stage"
            className="text-slate-400 hover:text-red-600 transition text-lg leading-none"
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}
