import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import type {
  FieldDefinitionRow,
  PipelineStageRow,
  StudyRow,
} from "../lib/types";
import { seedDemoStudies } from "../lib/demoSeed";
import { useToast } from "../lib/Toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";

/** Home — the landing page after sign-in.
 *
 *  Layout:
 *   1. Page header with admin/member chip.
 *   2. Quick-start nudge for fresh orgs (admin + <3 studies).
 *   3. Metric chips: open studies, by priority, closed.
 *   4. Stage breakdown — stacked bar across configured stages, each
 *      coloured by stage.color, with click-through to the pipeline view
 *      filtered to that stage.
 *   5. Recent activity — last 5 studies updated.
 *   6. Setup hub — admin-editable surfaces.
 *   7. Work tiles — quick links to Studies / Pipeline / Inbox.
 */
export function Home({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin, tier, isDeveloper } = useCurrentMember();
  const toast = useToast();

  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", {
    orderBy: "position",
    realtime: true,
  });
  const studies = useOrgTable<StudyRow>("studies", {
    orderBy: "updated_at",
    realtime: true,
  });

  const studyFields = fields.rows.filter((f) => f.entity_type === "study");
  const fieldCount = studyFields.filter((f) => f.enabled).length;
  const stageCount = stages.rows.length;

  const [seeding, setSeeding] = useState(false);

  // Derived metrics (memoized).
  const metrics = useMemo(() => {
    const all = studies.rows;
    const open = all.filter((s) => !s.closed);
    const closed = all.filter((s) => s.closed);
    const highPriority = open.filter((s) => s.priority === "high");
    const unassigned = open.filter((s) => !s.stage_key);
    return {
      total: all.length,
      open: open.length,
      closed: closed.length,
      highPriority: highPriority.length,
      unassigned: unassigned.length,
    };
  }, [studies.rows]);

  // Per-stage counts.
  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of studies.rows) {
      if (s.closed) continue;
      const k = s.stage_key ?? "__unassigned__";
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [studies.rows]);

  const totalOpen = metrics.open;

  // Recent updates — last 5 non-closed studies by updated_at desc.
  const recent = useMemo(() => {
    return [...studies.rows]
      .filter((s) => !s.closed)
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, 5);
  }, [studies.rows]);

  // Quick-start eligibility.
  const showQuickStart =
    isAdmin && metrics.total < 3 && stageCount > 0 && !studies.loading;

  if (auth.status !== "signedIn") return null;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Workspace"
        title="Welcome back."
        subtitle={
          isAdmin
            ? "Configure how your organization runs studies. Every change writes live to Supabase and shapes what your team sees."
            : "Here's how your team has configured Platypus. Admins can change the operating model from the Configure section."
        }
        actions={
          tier ? (
            <Pill tone={isDeveloper ? "dev" : isAdmin ? "brand" : "neutral"}>
              {isDeveloper ? "Developer access" : isAdmin ? "Admin access" : `Tier: ${tier}`}
            </Pill>
          ) : null
        }
      />

      {/* QUICK START — only on fresh-ish orgs */}
      {showQuickStart && (
        <section className="mt-8">
          <div className="rounded-2xl border-2 border-brand-100 bg-gradient-to-br from-brand-50/60 to-white p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-brand-gradient text-white flex items-center justify-center flex-shrink-0">
              <Icon name="layers" size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider text-brand-700 mb-0.5">
                Quick start
              </div>
              <div className="font-display font-bold text-base text-slate-900">
                {metrics.total === 0
                  ? "Your portfolio is empty."
                  : "Want to see Platypus in motion?"}
              </div>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Load 8 demo studies across every stage of your pipeline. You can edit, advance,
                or delete them anytime. Existing studies are untouched.
              </p>
            </div>
            <Button
              variant="primary"
              onClick={async () => {
                if (!orgId) return;
                setSeeding(true);
                try {
                  const res = await seedDemoStudies(orgId, stages.rows);
                  if (res.inserted > 0) {
                    toast.success(
                      `Added ${res.inserted} demo stud${res.inserted === 1 ? "y" : "ies"}`
                    );
                  } else {
                    toast.info("Demo studies already loaded");
                  }
                } catch (e: any) {
                  toast.error(e?.message || "Couldn't load demo studies");
                } finally {
                  setSeeding(false);
                }
              }}
              disabled={seeding}
            >
              {seeding ? "Loading…" : "Load demo studies"}
            </Button>
          </div>
        </section>
      )}

      {/* METRIC CHIPS */}
      {metrics.total > 0 && (
        <section className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Open studies" value={metrics.open} highlight />
          <MetricCard label="High priority" value={metrics.highPriority} />
          <MetricCard label="Closed" value={metrics.closed} muted />
          <MetricCard
            label="Unassigned stage"
            value={metrics.unassigned}
            muted={metrics.unassigned === 0}
            warning={metrics.unassigned > 0}
          />
        </section>
      )}

      {/* STAGE BREAKDOWN */}
      {totalOpen > 0 && stages.rows.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-display font-bold text-slate-900">
              Stage breakdown
            </h2>
            <button
              onClick={() => onNavigate("#/pipeline")}
              className="text-xs font-semibold text-brand-700 hover:underline flex items-center gap-1"
            >
              Open pipeline view <Icon name="chevron-right" size={10} />
            </button>
          </div>
          <Card>
            {/* Stacked bar */}
            <div className="flex rounded-lg overflow-hidden border border-slate-200 mb-4 h-8">
              {stages.rows.map((stage) => {
                const c = stageCounts[stage.key] ?? 0;
                if (c === 0) return null;
                const pct = (c / totalOpen) * 100;
                return (
                  <button
                    key={stage.id}
                    onClick={() => onNavigate("#/pipeline")}
                    className="h-full flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-white hover:opacity-80 transition"
                    style={{ backgroundColor: stage.color, width: `${pct}%` }}
                    title={`${stage.label}: ${c} stud${c === 1 ? "y" : "ies"}`}
                  >
                    {pct > 8 ? c : ""}
                  </button>
                );
              })}
            </div>
            {/* Legend / per-stage rows */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {stages.rows.map((stage) => {
                const c = stageCounts[stage.key] ?? 0;
                return (
                  <button
                    key={stage.id}
                    onClick={() => onNavigate("#/pipeline")}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-slate-100 hover:border-brand-200 hover:bg-brand-50/30 transition text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: stage.color }}
                      />
                      <span className="text-xs font-semibold text-slate-700 truncate">
                        {stage.label}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-slate-500">{c}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        </section>
      )}

      {/* RECENT ACTIVITY */}
      {recent.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-display font-bold text-slate-900">
              Recently touched
            </h2>
            <button
              onClick={() => onNavigate("#/studies")}
              className="text-xs font-semibold text-brand-700 hover:underline flex items-center gap-1"
            >
              All studies <Icon name="chevron-right" size={10} />
            </button>
          </div>
          <Card flush>
            {recent.map((s) => {
              const stage = stages.rows.find((st) => st.key === s.stage_key);
              const updated = s.updated_at ? new Date(s.updated_at) : null;
              return (
                <button
                  key={s.id}
                  onClick={() => onNavigate(`#/studies/${s.id}`)}
                  className="w-full text-left px-4 py-2.5 border-b border-slate-100 last:border-b-0 hover:bg-brand-50/30 transition grid grid-cols-[100px_1fr_140px_120px] gap-3 items-center"
                >
                  <span className="font-mono text-xs text-slate-600">{s.code}</span>
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
                  <span className="text-xs text-slate-500 font-mono text-right">
                    {updated ? timeAgo(updated) : "—"}
                  </span>
                </button>
              );
            })}
          </Card>
        </section>
      )}

      {/* SETUP HUB */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-display font-bold text-slate-900">Setup hub</h2>
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            live · admin-driven
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <HubCard
            icon="file"
            title="Study fields"
            description="Choose what every study captures. Toggle, require, lock, add custom fields."
            status={fieldCount > 0 ? `${fieldCount} active` : "Ready"}
            statusTone="brand"
            onClick={() => onNavigate("#/settings/fields")}
            disabled={!isAdmin}
            disabledReason="Admin access required"
          />
          <HubCard
            icon="workflow"
            title="Pipeline stages"
            description="Design the stages every study moves through. Reorder, rename, retarget."
            status={stageCount > 0 ? `${stageCount} stages` : "Ready"}
            statusTone="brand"
            onClick={() => onNavigate("#/settings/stages")}
            disabled={!isAdmin}
            disabledReason="Admin access required"
          />
          <HubCard
            icon="users"
            title="Teams & roles"
            description="Build the teams that own work. Role slots survive turnover — swap holders, not workflows."
            status="Ready"
            statusTone="brand"
            onClick={() => onNavigate("#/settings/teams")}
            disabled={!isAdmin}
            disabledReason="Admin access required"
          />
          <HubCard
            icon="shield"
            title="Access roles"
            description="Who can see what. Module-level permissions and portfolio scope."
            status="Ready"
            statusTone="brand"
            onClick={() => onNavigate("#/settings/access")}
            disabled={!isAdmin}
            disabledReason="Admin access required"
          />
        </div>
      </section>

      {/* WORK SURFACES */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-display font-bold text-slate-900">Work surfaces</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <WorkTile icon="folder" label="Studies" onClick={() => onNavigate("#/studies")} />
          <WorkTile icon="layers" label="Pipeline" onClick={() => onNavigate("#/pipeline")} />
          <WorkTile icon="inbox" label="Inbox" onClick={() => onNavigate("#/inbox")} dimmed />
          <WorkTile
            icon="users"
            label="Members"
            onClick={() => onNavigate("#/settings/members")}
          />
        </div>
      </section>
    </div>
  );
}

/* ---------- pieces ---------- */

function MetricCard({
  label,
  value,
  highlight,
  muted,
  warning,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  muted?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (highlight
          ? "bg-brand-50/40 border-brand-100"
          : warning
          ? "bg-amber-50/40 border-amber-100"
          : muted
          ? "bg-slate-50 border-slate-200"
          : "bg-white border-slate-200")
      }
    >
      <div
        className={
          "text-[10px] font-bold uppercase tracking-wider mb-1 " +
          (warning ? "text-amber-700" : "text-slate-500")
        }
      >
        {label}
      </div>
      <div
        className={
          "text-2xl font-display font-extrabold tracking-tight " +
          (highlight
            ? "text-brand-700"
            : warning
            ? "text-amber-800"
            : muted
            ? "text-slate-400"
            : "text-slate-900")
        }
      >
        {value}
      </div>
    </div>
  );
}

function HubCard({
  icon,
  title,
  description,
  status,
  statusTone,
  onClick,
  disabled,
  disabledReason,
}: {
  icon: string;
  title: string;
  description: string;
  status: string;
  statusTone: "brand" | "neutral" | "warning";
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={
        "text-left rounded-2xl border p-5 transition group " +
        (disabled
          ? "border-slate-200 bg-slate-50/40 opacity-70 cursor-not-allowed"
          : "border-slate-200 bg-white hover:border-brand-500 hover:bg-brand-50/30 hover:-translate-y-[1px] hover:shadow-sm")
      }
    >
      <div className="flex items-start justify-between mb-2.5">
        <div
          className={
            "w-10 h-10 rounded-xl flex items-center justify-center " +
            (disabled ? "bg-slate-100 text-slate-400" : "bg-brand-50 text-brand-600")
          }
        >
          <Icon name={icon} size={20} />
        </div>
        <Pill tone={statusTone}>{status}</Pill>
      </div>
      <div className="font-display font-bold text-base text-slate-900 mb-1">{title}</div>
      <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
      {!disabled && (
        <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-700 opacity-0 group-hover:opacity-100 transition">
          Open
          <Icon name="chevron-right" size={12} />
        </div>
      )}
      {disabled && disabledReason && (
        <div className="mt-3 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
          {disabledReason}
        </div>
      )}
    </button>
  );
}

function WorkTile({
  icon,
  label,
  onClick,
  dimmed,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  dimmed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-xl border px-4 py-3 transition flex items-center gap-3 text-left " +
        (dimmed
          ? "border-slate-200 bg-slate-50/40 opacity-70"
          : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30")
      }
    >
      <div
        className={
          "w-8 h-8 rounded-lg flex items-center justify-center " +
          (dimmed ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-slate-500")
        }
      >
        <Icon name={icon} size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        {dimmed && (
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            coming next
          </div>
        )}
      </div>
      <Icon name="chevron-right" size={14} className="text-slate-300" />
    </button>
  );
}

/* ---------- helpers ---------- */

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return d.toLocaleDateString();
}
