import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { uniqueChannelName } from "../lib/uniqueChannel";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import type {
  StudyRow,
  PipelineStageRow,
  FieldDefinitionRow,
  FieldType,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { HealthDot } from "../components/ui/HealthDot";
import { computeHealth, HEALTH_TONE } from "../lib/studyHealth";
import { writeAuditEvent } from "../lib/auditLog";
import { spawnTasksForStageEntry } from "../lib/workStreamEngine";
import { useCurrentOrg } from "../lib/OrgContext";
import { useAuth } from "../auth/useAuth";
import { ActivityTab } from "./StudyDetail.activity";
import { TasksTab } from "./StudyDetail.tasks";

/** StudyDetail — full record. Header (code + title + stage chip + actions),
 *  tabbed body (Overview / Activity / Documents / Audit), inline editing on
 *  the Overview form for admins.
 *
 *  Source of fields: the org's field_definitions. Source of stage list:
 *  pipeline_stages. Every change writes back to studies + custom_field_values.
 */

const KEY_TO_COLUMN: Record<string, keyof StudyRow> = {
  shortTitle: "title",
  sponsor: "sponsor",
  nct: "nct",
  therapeuticArea: "therapeutic_area",
  phase: "phase",
  piName: "pi_name",
  studyKind: "study_kind",
  priority: "priority",
};

function studyValueFor(key: string, study: StudyRow): unknown {
  const col = KEY_TO_COLUMN[key];
  if (col) return (study as any)[col] ?? null;
  return (study.custom_field_values ?? {})[key] ?? null;
}

type Tab = "overview" | "activity" | "tasks" | "documents" | "audit";

export function StudyDetail({
  studyId,
  onBack,
}: {
  studyId: string;
  onBack: () => void;
}) {
  const { isAdmin } = useCurrentMember();
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", {
    orderBy: "position",
    realtime: true,
  });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", {
    orderBy: "position",
    realtime: true,
  });

  const [study, setStudy] = useState<StudyRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [advancing, setAdvancing] = useState(false);
  const [activityCount, setActivityCount] = useState<number | null>(null);
  const [openTaskCount, setOpenTaskCount] = useState<number | null>(null);
  const [savingClose, setSavingClose] = useState(false);

  // Load + realtime-subscribe to this single study.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("studies")
        .select("*")
        .eq("id", studyId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setLoadError(error.message);
      else setStudy(data as unknown as StudyRow);
    })();

    // Subscribe to changes on this specific row.
    const channel = supabase
      .channel(uniqueChannelName(`study-${studyId}`))
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "studies",
          filter: `id=eq.${studyId}`,
        },
        (payload: any) => {
          if (!cancelled) setStudy(payload.new as StudyRow);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [studyId]);

  // Tab badge counts (audit events + open tasks). Cheap COUNT queries.
  useEffect(() => {
    let cancelled = false;
    const reload = async () => {
      const [{ count: aCount }, { count: tCount }] = await Promise.all([
        supabase
          .from("audit_events")
          .select("*", { count: "exact", head: true })
          .eq("entity_type", "study")
          .eq("entity_id", studyId),
        supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("study_id", studyId)
          .in("status", ["open", "in_progress"]),
      ]);
      if (cancelled) return;
      setActivityCount(aCount ?? 0);
      setOpenTaskCount(tCount ?? 0);
    };
    void reload();

    // Refresh counts when realtime fires on either table for this study.
    const ch1 = supabase
      .channel(uniqueChannelName(`badge-audit-${studyId}`))
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "audit_events", filter: `entity_id=eq.${studyId}` },
        () => void reload()
      )
      .subscribe();
    const ch2 = supabase
      .channel(uniqueChannelName(`badge-tasks-${studyId}`))
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "tasks", filter: `study_id=eq.${studyId}` },
        () => void reload()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, [studyId]);

  const stage = useMemo(
    () => (study?.stage_key ? stages.rows.find((s) => s.key === study.stage_key) : null),
    [stages.rows, study?.stage_key]
  );

  const health = useMemo(
    () => (study ? computeHealth(study, stages.rows) : null),
    [study, stages.rows]
  );

  const studyFields = useMemo(
    () =>
      fields.rows
        .filter((f) => f.entity_type === "study" && f.enabled)
        .sort((a, b) => a.position - b.position),
    [fields.rows]
  );

  const sections = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of studyFields) if (!seen.has(f.section)) {
      seen.add(f.section);
      out.push(f.section);
    }
    return out;
  }, [studyFields]);

  if (loadError) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Card>
          <EmptyState
            iconName="alert"
            title="Couldn't load study"
            sub={loadError}
            action={
              <Button variant="primary" onClick={onBack}>
                Back to studies
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (!study) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 text-sm text-slate-500">Loading study…</div>
    );
  }

  const fieldValue = (f: FieldDefinitionRow): unknown => {
    const col = KEY_TO_COLUMN[f.key];
    if (col) return (study as any)[col];
    return study.custom_field_values?.[f.key];
  };

  const writeField = async (f: FieldDefinitionRow, v: unknown) => {
    if (!isAdmin) {
      toast.error("Admin access required to edit study fields");
      return;
    }
    const col = KEY_TO_COLUMN[f.key];
    let patch: Partial<StudyRow>;
    if (col) {
      patch = { [col]: v as any } as Partial<StudyRow>;
    } else {
      const nextCfv = { ...(study.custom_field_values ?? {}) };
      if (v === null || v === undefined || v === "") delete nextCfv[f.key];
      else nextCfv[f.key] = v as any;
      patch = { custom_field_values: nextCfv };
    }
    try {
      const { error } = await supabase.from("studies").update(patch as any).eq("id", study.id);
      if (error) throw error;
      // Audit log
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "study", entityId: study.id,
          action: "field_updated",
          payload: {
            field_key: f.key,
            field_label: f.label,
            from: studyValueFor(f.key, study),
            to: v,
          },
        });
      }
      toast.success(`Updated ${f.label}`);
    } catch (e: any) {
      toast.error(e?.message || "Update failed");
    }
  };

  const advanceStage = async (nextKey: string) => {
    if (!isAdmin) {
      toast.error("Admin access required");
      return;
    }
    setAdvancing(true);
    try {
      const patch: Partial<StudyRow> = { stage_key: nextKey };
      // First time we transition out of intake we record committed_at.
      if (study.stage_key === "intake" && nextKey !== "intake" && !study.committed_at) {
        patch.committed_at = new Date().toISOString();
      }
      const { error } = await supabase.from("studies").update(patch as any).eq("id", study.id);
      if (error) throw error;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "study", entityId: study.id,
          action: "stage_changed",
          payload: {
            from: study.stage_key ?? null,
            to: nextKey,
            from_label: stages.rows.find((s) => s.key === study.stage_key)?.label ?? null,
            to_label: stages.rows.find((s) => s.key === nextKey)?.label ?? nextKey,
          },
        });
        // Fire the work stream engine — spawn tasks per configured module.
        try {
          const res = await spawnTasksForStageEntry({
            orgId,
            studyId: study.id,
            stageKey: nextKey,
            actorUserId: userId,
          });
          if (res.spawned > 0) {
            toast.info(`Spawned ${res.spawned} task${res.spawned === 1 ? "" : "s"} from ${res.modules} module${res.modules === 1 ? "" : "s"}`);
          }
        } catch (e: any) {
          toast.error(`Stage advanced but task spawn failed: ${e?.message ?? "unknown"}`);
        }
      }
      toast.success(`Moved to ${stages.rows.find((s) => s.key === nextKey)?.label ?? nextKey}`);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't advance stage");
    } finally {
      setAdvancing(false);
    }
  };

  const toggleClosed = async () => {
    if (!isAdmin) {
      toast.error("Admin access required");
      return;
    }
    setSavingClose(true);
    try {
      const patch: Partial<StudyRow> = {
        closed: !study.closed,
        closed_at: !study.closed ? new Date().toISOString() : null,
      };
      const { error } = await supabase.from("studies").update(patch as any).eq("id", study.id);
      if (error) throw error;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "study", entityId: study.id,
          action: study.closed ? "reopened" : "closed",
          payload: {},
        });
      }
      toast.success(study.closed ? "Reopened study" : "Closed study");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't update");
    } finally {
      setSavingClose(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-700 transition mb-4"
      >
        <Icon name="chevron-right" size={12} className="rotate-180" />
        Back to studies
      </button>

      <PageHeader
        kicker={`Study · ${study.code}`}
        title={study.title}
        subtitle={
          <>
            {[study.sponsor, study.nct, study.therapeutic_area, study.phase]
              .filter(Boolean)
              .join(" · ") || (
              <span className="text-slate-400 italic">No identifiers set yet</span>
            )}
          </>
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {stage && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
                style={{ backgroundColor: stage.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                {stage.label}
              </span>
            )}
            {health && !study.closed && <HealthDot health={health} variant="pill" />}
            {study.closed && <Pill tone="neutral">closed</Pill>}
            {isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                onClick={toggleClosed}
                disabled={savingClose}
              >
                {study.closed ? "Reopen" : "Close study"}
              </Button>
            )}
          </div>
        }
      />

      {/* Health bar — full-width context strip with elapsed / target / projection */}
      {health && stage && !study.closed && health.level !== "unknown" && (
        <div
          className={
            "mt-6 rounded-xl border px-4 py-3 flex items-center gap-3 flex-wrap " +
            HEALTH_TONE[health.level].bg + " " + HEALTH_TONE[health.level].border
          }
        >
          <div className={"w-2 h-8 rounded-full " + HEALTH_TONE[health.level].dot} />
          <div className="flex-1 min-w-0">
            <div className={"text-xs font-bold uppercase tracking-wider " + HEALTH_TONE[health.level].text}>
              {HEALTH_TONE[health.level].label} in {stage.label}
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              {health.summary}
            </div>
          </div>
          {/* Stage progress bar */}
          {health.targetDays > 0 && (
            <div className="w-48 hidden md:block">
              <div className="h-2 rounded-full bg-white/60 border border-slate-200 overflow-hidden">
                <div
                  className={"h-full rounded-full " + HEALTH_TONE[health.level].dot}
                  style={{
                    width:
                      Math.min(100, Math.round((health.daysInStage / health.targetDays) * 100)) +
                      "%",
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                <span>0</span>
                <span>target {health.targetDays}d</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stage advance bar — admins only */}
      {isAdmin && stages.rows.length > 0 && (
        <Card className="mt-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Move to stage
            </div>
            <div className="flex flex-wrap gap-1.5">
              {stages.rows.map((s) => {
                const active = s.key === study.stage_key;
                return (
                  <button
                    key={s.id}
                    disabled={advancing || active}
                    onClick={() => advanceStage(s.key)}
                    className={
                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition flex items-center gap-1.5 " +
                      (active
                        ? "border-transparent text-white cursor-default"
                        : "bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:-translate-y-[1px]")
                    }
                    style={active ? { backgroundColor: s.color } : undefined}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Tabs */}
      <div className="mt-6 border-b border-slate-200 flex items-center gap-1">
        {([
          ["overview", "Overview", null],
          ["activity", "Activity", activityCount],
          ["tasks", "Tasks", openTaskCount],
          ["documents", "Documents", null],
          ["audit", "Audit", activityCount],
        ] as [Tab, string, number | null][]).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={
              "px-3 py-2 text-sm font-semibold transition border-b-2 -mb-px flex items-center gap-1.5 " +
              (tab === key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-900")
            }
          >
            {label}
            {count !== null && count > 0 && (
              <span
                className={
                  "text-[10px] font-mono px-1.5 py-0.5 rounded-full " +
                  (tab === key
                    ? "bg-brand-100 text-brand-700"
                    : "bg-slate-100 text-slate-500")
                }
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="mt-5">
        {tab === "overview" && (
          <div className="space-y-5">
            {studyFields.length === 0 && (
              <Card>
                <EmptyState
                  iconName="file"
                  title="No fields configured"
                  sub="Head to Settings → Study fields to choose what every study captures."
                />
              </Card>
            )}
            {sections.map((section) => {
              const sectionFields = studyFields.filter((f) => f.section === section);
              if (sectionFields.length === 0) return null;
              return (
                <Card key={section}>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    {section}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {sectionFields.map((f) => (
                      <FieldEditor
                        key={f.id}
                        field={f}
                        value={fieldValue(f)}
                        editable={
                          isAdmin && !(f.lock_after_commit && Boolean(study.committed_at))
                        }
                        lockReason={
                          f.lock_after_commit && Boolean(study.committed_at)
                            ? "Locked after commit"
                            : undefined
                        }
                        onSave={(v) => writeField(f, v)}
                      />
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {tab === "activity" && (
          <ActivityTab studyId={study.id} study={study} stages={stages.rows} />
        )}

        {tab === "tasks" && (
          <TasksTab studyId={study.id} stages={stages.rows} stageKey={study.stage_key} onNavigate={(h) => { window.location.hash = h; }} />
        )}

        {tab === "documents" && (
          <Card>
            <EmptyState
              iconName="folder"
              title="Documents — coming with TMF/ISF"
              sub="The integrated binder lands in a later phase. Every doc with required metadata, hash-chained audit, 21 CFR Part 11 e-signatures, and EML drag-drop."
            />
          </Card>
        )}

        {tab === "audit" && (
          <ActivityTab studyId={study.id} showChain study={study} stages={stages.rows} />
        )}
      </div>
    </div>
  );
}

/* ---------- Inline field editor ---------- */

function FieldEditor({
  field,
  value,
  editable,
  lockReason,
  onSave,
}: {
  field: FieldDefinitionRow;
  value: unknown;
  editable: boolean;
  lockReason?: string;
  onSave: (v: unknown) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    await onSave(draft);
    setEditing(false);
  };

  const display = formatValue(value, field.field_type as FieldType);

  if (!editable) {
    return (
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
          {field.label}
          {lockReason && (
            <span title={lockReason} className="text-slate-300 inline-flex">
              <Icon name="lock" size={10} />
            </span>
          )}
        </div>
        <div className="text-sm text-slate-900">{display}</div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="group">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </div>
        <button
          onClick={() => setEditing(true)}
          className="text-left w-full text-sm text-slate-900 hover:text-brand-700 transition rounded px-1.5 py-0.5 -mx-1.5 hover:bg-brand-50/50 flex items-center gap-2"
        >
          {display}
          <span className="opacity-0 group-hover:opacity-100 transition text-[10px] font-mono text-brand-600 uppercase tracking-wider">
            edit
          </span>
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        {field.label}
      </div>
      <div className="flex items-center gap-1.5">
        <FieldInput
          field={field}
          value={draft}
          onChange={setDraft}
          autoFocus
          onEnter={commit}
        />
        <Button size="sm" variant="primary" onClick={commit}>
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(value);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  autoFocus,
  onEnter,
}: {
  field: FieldDefinitionRow;
  value: unknown;
  onChange: (v: unknown) => void;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  switch (field.field_type as FieldType) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-brand-500 w-4 h-4"
          />
          Yes
        </label>
      );
    case "number":
      return (
        <Input
          type="number"
          autoFocus={autoFocus}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter();
          }}
        />
      );
    case "date":
      return (
        <Input
          type="date"
          autoFocus={autoFocus}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter();
          }}
        />
      );
    case "dropdown": {
      const opts = (field.options as { values?: string[] } | null)?.values ?? [];
      if (opts.length === 0) {
        return (
          <Input
            autoFocus={autoFocus}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onEnter) onEnter();
            }}
          />
        );
      }
      return (
        <Select
          autoFocus={autoFocus}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">— Select —</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    }
    default:
      return (
        <Input
          autoFocus={autoFocus}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter();
          }}
        />
      );
  }
}

function formatValue(v: unknown, type: FieldType): React.ReactNode {
  if (v === null || v === undefined || v === "") {
    return <span className="text-slate-400 italic">—</span>;
  }
  if (type === "boolean") return v ? "Yes" : "No";
  if (type === "date" && typeof v === "string") {
    try {
      return new Date(v).toLocaleDateString();
    } catch {
      return String(v);
    }
  }
  if (type === "number") return String(v);
  return String(v);
}
