import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { fmtDate } from "../lib/dates";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
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
  SiteRow,
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
import { StartupDocsTab } from "./StudyDetail.startupDocs";
import { VersionBar } from "./StudyDetail.versionBar";
import { HighlightsStrip, PathBar, StudySitesCard, SmartActionButton } from "./StudyDetail.crm";
import { StudyWorkstreamTab } from "./StudyDetail.workstreamTab";
import type { StudySiteRow } from "../lib/types";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useDismissable } from "../lib/useDismissable";
import { TasksTab } from "./StudyDetail.tasks";
import { DocumentsTab } from "./StudyDetail.documents";
import { NotesCard } from "./StudyDetail.notes";
import { FeasibilityTab } from "./StudyDetail.feasibility";
import { PageBlocks } from "../blocks/PageBlocks";
import { AiSummaryCard } from "./StudyDetail.aiSummary";
import { IntakeDecisionBar } from "../components/CommitToPortfolio";
import { useResolvedConfig } from "../lib/useResolvedConfig";
import { pageEntry } from "../lib/navConfig";

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

type Tab = "overview" | "feasibility" | "sites" | "startup" | "workstream" | "activity" | "tasks" | "documents";

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
  const sites = useOrgTable<SiteRow>("sites", { orderBy: "name" });
  const studySites = useOrgTable<StudySiteRow>("study_sites", { realtime: true });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", {
    orderBy: "position",
    realtime: true,
  });

  const [study, setStudy] = useState<StudyRow | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tabs are designable per role (Page designer → Study record): order,
  // labels, hidden, and the default tab all come from the role's config.
  useEffect(() => {
    if (!orgId) return;
    let c = false;
    supabase.from("orgs").select("ai_enabled").eq("id", orgId).maybeSingle().then(({ data }) => {
      if (!c && data) setAiEnabled((data as { ai_enabled?: boolean }).ai_enabled !== false);
    });
    return () => { c = true; };
  }, [orgId]);
  const { configFor } = useResolvedConfig();
  const pageCfg = configFor("study-detail");
  const registryTabs = pageEntry("study-detail")?.tabs ?? [];
  const tabCfgs: { key: string; label?: string; hidden?: boolean }[] =
    pageCfg.tabs ?? registryTabs.map((t) => ({ key: t.key }));
  const visibleTabs = tabCfgs
    .filter((t) => !t.hidden)
    .map((t) => ({
      key: t.key as Tab,
      label: t.label || registryTabs.find((r) => r.key === t.key)?.label || t.key,
    }));
  const safeTabs = visibleTabs.length > 0
    ? visibleTabs
    : registryTabs.map((t) => ({ key: t.key as Tab, label: t.label }));
  const roleDefaultTab = (pageCfg.options?.defaultTab as Tab | undefined) ?? "overview";
  const [tab, setTabRaw] = useState<Tab | null>(null);
  const effectiveTab: Tab = (() => {
    const want = tab ?? roleDefaultTab;
    return safeTabs.some((t) => t.key === want) ? want : safeTabs[0].key;
  })();
  const setTab = (t: Tab) => setTabRaw(t);
  // ≥xl: Tasks/Notes/Activity live in the docked work pane; the top tabs slim
  // down and the record gets the main column (Option B, Chad 2026-06-03).
  const isXl = useMediaQuery("(min-width: 1280px)");
  const shownTab: Tab = isXl && (effectiveTab === "tasks" || effectiveTab === "activity") ? "overview" : effectiveTab;
  const [advancing, setAdvancing] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [activityCount, setActivityCount] = useState<number | null>(null);
  const [openTaskCount, setOpenTaskCount] = useState<number | null>(null);
  const [documentCount, setDocumentCount] = useState<number | null>(null);
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
  }, [studyId, reloadTick]);

  // Tab badge counts (audit events + open tasks). Cheap COUNT queries.
  useEffect(() => {
    let cancelled = false;
    const reload = async () => {
      const [{ count: aCount }, { count: tCount }, { count: dCount }] = await Promise.all([
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
        supabase
          .from("documents")
          .select("*", { count: "exact", head: true })
          .eq("study_id", studyId)
          .eq("archived", false),
      ]);
      if (cancelled) return;
      setActivityCount(aCount ?? 0);
      setOpenTaskCount(tCount ?? 0);
      setDocumentCount(dCount ?? 0);
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
    const ch3 = supabase
      .channel(uniqueChannelName(`badge-docs-${studyId}`))
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "documents", filter: `study_id=eq.${studyId}` },
        () => void reload()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      supabase.removeChannel(ch3);
    };
  }, [studyId, reloadTick]);

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
      <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
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
      <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8"><Loader label="Loading study…" /></div>
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
      toast.success(stamped(`Updated ${f.label}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Update failed"));
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
      // Stamp stage-entry time (best-effort; no-op until migration 0010 runs).
      void supabase.from("studies").update({ stage_entered_at: new Date().toISOString() } as any).eq("id", study.id);
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
      toast.success(stamped(`Moved to ${stages.rows.find((s) => s.key === nextKey)?.label ?? nextKey}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't advance stage"));
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
      toast.success(stamped(study.closed ? "Reopened study" : "Closed study"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't update"));
    } finally {
      setSavingClose(false);
    }
  };

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-700 transition mb-4"
      >
        <Icon name="chevron-right" size={12} className="rotate-180" />
        Back to studies
      </button>

      <PageBlocks pageKey="study-detail" region="top" navigate={(h) => { window.location.hash = h; }} />

      <IntakeDecisionBar
        study={study}
        onChanged={() => setReloadTick((t) => t + 1)}
        onNavigate={(h) => { window.location.hash = h; }}
      />

      <PageHeader
        kicker={`Study · ${study.code}`}
        title={study.title}
        subtitle={
          [study.sponsor, study.nct, study.therapeutic_area, study.phase]
            .filter(Boolean)
            .join(" · ") || (
            <span className="text-slate-400 italic">No identifiers set yet</span>
          )
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {study.closed && <Pill tone="neutral">closed</Pill>}
            {isAdmin && (
              <SmartActionButton
                study={study}
                stages={stages.rows}
                advancing={advancing}
                savingClose={savingClose}
                onAdvance={(k) => void advanceStage(k)}
                onToggleClosed={() => void toggleClosed()}
              />
            )}
          </div>
        }
      />

      <VersionBar study={study} isAdmin={isAdmin} onNavigate={(h) => { window.location.hash = h; }} />

      <HighlightsStrip
        study={study}
        health={health}
        siteCount={studySites.rows.filter((r) => r.study_id === study.id).length}
        piCount={new Set(studySites.rows.filter((r) => r.study_id === study.id && r.pi_name && r.pi_name.trim()).map((r) => r.pi_name!.trim().toLowerCase())).size}
      />
      {!study.closed && (
        <PathBar
          stages={stages.rows}
          currentKey={study.stage_key}
          isAdmin={isAdmin}
          advancing={advancing}
          onAdvance={(k) => void advanceStage(k)}
        />
      )}

      {/* SPLIT (≥ xl): record column + docked work pane */}
      <div className="mt-2 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-5 xl:items-start">
      <div className="min-w-0">
      {/* Tabs — Tasks/Activity fold into the work pane at xl */}
      <div className="mt-4 border-b border-slate-200 flex items-center gap-1">
        {safeTabs
          .filter(({ key }) => !isXl || (key !== "tasks" && key !== "activity"))
          .map(({ key, label }) => {
          const count: number | null =
            key === "activity" ? activityCount :
            key === "tasks" ? openTaskCount :
            key === "documents" ? documentCount : null;
          return (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={
              "px-3 py-2 text-sm font-semibold transition border-b-2 -mb-px flex items-center gap-1.5 " +
              (shownTab === key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-900")
            }
          >
            {label}
            {count !== null && count > 0 && (
              <span
                className={
                  "text-[10px] font-mono px-1.5 py-0.5 rounded-full " +
                  (shownTab === key
                    ? "bg-brand-100 text-brand-700"
                    : "bg-slate-100 text-slate-500")
                }
              >
                {count}
              </span>
            )}
          </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="mt-5">
        {shownTab === "overview" && (
          <div className="space-y-5">
            <AiSummaryCard study={study} aiEnabled={aiEnabled} />
            <div className="xl:hidden">
              <NotesCard studyId={study.id} />
            </div>
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
              const filled = sectionFields.filter((f) => {
                const v = fieldValue(f);
                return !(
                  v === null ||
                  v === undefined ||
                  v === "" ||
                  (Array.isArray(v) && v.length === 0)
                );
              }).length;
              // Empty sections start collapsed — the record leads with what's known.
              const collapsed = collapsedSections[section] ?? filled === 0;
              return (
                <Card key={section}>
                  <button
                    onClick={() =>
                      setCollapsedSections((c) => ({ ...c, [section]: !collapsed }))
                    }
                    className="w-full flex items-center gap-2 text-left"
                    aria-expanded={!collapsed}
                  >
                    <span className="text-xs font-semibold text-slate-500">{section}</span>
                    <span
                      className={
                        "text-[11px] font-mono " +
                        (filled === 0 ? "text-slate-300" : filled === sectionFields.length ? "text-emerald-600" : "text-slate-400")
                      }
                    >
                      {filled} of {sectionFields.length}
                    </span>
                    <span className="flex-1" />
                    <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={13} className="text-slate-400" />
                  </button>
                  {!collapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
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
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {shownTab === "feasibility" && <FeasibilityTab study={study} />}

        {shownTab === "startup" && <StartupDocsTab study={study} />}

        {shownTab === "workstream" && <StudyWorkstreamTab study={study} stages={stages.rows} />}

        {shownTab === "sites" && (
          <div className="space-y-5">
            <StudySitesCard
              study={study}
              sites={sites.rows}
              studySites={studySites.rows.filter((r) => r.study_id === study.id)}
              isAdmin={isAdmin}
              onAdd={async (siteId) => {
                if (!orgId) return;
                try {
                  const mine = studySites.rows.filter((r) => r.study_id === study.id);
                  await supabase.from("study_sites").insert({ org_id: orgId, study_id: study.id, site_id: siteId, is_primary: mine.length === 0, site_status: "selected" } as any);
                  if (mine.length === 0) await supabase.from("studies").update({ site_id: siteId } as any).eq("id", study.id);
                  if (userId) void writeAuditEvent({ orgId, actorId: userId, actorEmail: userEmail, entityType: "study", entityId: study.id, action: "site_added", payload: { site_id: siteId, site_name: sites.rows.find((s) => s.id === siteId)?.name ?? null } });
                  toast.success(stamped("Site added"));
                } catch (e: any) { toast.error(friendlyError(e, "Couldn't add the site")); }
              }}
              onRemove={async (row) => {
                if (!(await confirmDialog({ title: "Remove site", message: `Remove ${sites.rows.find((s) => s.id === row.site_id)?.name ?? "this site"} from the study?`, confirmLabel: "Remove", danger: true }))) return;
                try { await supabase.from("study_sites").delete().eq("id", row.id); toast.success(stamped("Site removed")); }
                catch (e: any) { toast.error(friendlyError(e, "Couldn't remove the site")); }
              }}
              onStatus={async (row, statusVal) => {
                try { await supabase.from("study_sites").update({ site_status: statusVal } as any).eq("id", row.id); }
                catch (e: any) { toast.error(friendlyError(e, "Couldn't update")); }
              }}
              onSetPi={async (row, pi) => {
                try { await supabase.from("study_sites").update({ pi_name: pi || null } as any).eq("id", row.id); }
                catch (e: any) { toast.error(friendlyError(e, "Couldn't set PI")); }
              }}
              onSetPrimary={async (row) => {
                try {
                  const mine = studySites.rows.filter((r) => r.study_id === study.id);
                  await Promise.all(mine.map((r) => supabase.from("study_sites").update({ is_primary: r.id === row.id } as any).eq("id", r.id)));
                  await supabase.from("studies").update({ site_id: row.site_id } as any).eq("id", study.id);
                  toast.success(stamped("Primary site set"));
                } catch (e: any) { toast.error(friendlyError(e, "Couldn't set primary")); }
              }}
            />
          </div>
        )}

        {shownTab === "activity" && !isXl && (
          <ActivityTab studyId={study.id} study={study} stages={stages.rows} />
        )}

        {shownTab === "tasks" && !isXl && (
          <TasksTab studyId={study.id} stages={stages.rows} stageKey={study.stage_key} onNavigate={(h) => { window.location.hash = h; }} />
        )}

        {shownTab === "documents" && (
          <DocumentsTab study={study} />
        )}
      </div>

      </div>

      {/* Docked work pane (≥ xl): the day-to-day lives beside the record */}
      <StudyWorkPane
        studyId={study.id}
        study={study}
        stages={stages.rows}
        stageKey={study.stage_key}
        openTaskCount={openTaskCount}
        activityCount={activityCount}
      />
      </div>

      <PageBlocks pageKey="study-detail" region="bottom" navigate={(h) => { window.location.hash = h; }} />
    </div>
  );
}

/* ---------- Option B pieces ---------- */

/** Stage as a CONTROL, not furniture: the pill shows where the study is;
 *  admins click it to move — the full pathway appears on demand. */
function StageMenu({
  stage,
  stages,
  isAdmin,
  advancing,
  onAdvance,
}: {
  stage: PipelineStageRow | null;
  stages: PipelineStageRow[];
  isAdmin: boolean;
  advancing: boolean;
  onAdvance: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useDismissable("[data-stage-menu]", () => setOpen(false), open);
  if (!stage) return null;
  return (
    <div className="relative" data-stage-menu>
      <button
        onClick={() => isAdmin && setOpen((o) => !o)}
        disabled={advancing}
        className={
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white transition " +
          (isAdmin ? "hover:opacity-90 cursor-pointer" : "cursor-default")
        }
        style={{ backgroundColor: stage.color }}
        title={isAdmin ? "Move this study to another stage" : stage.label}
        aria-haspopup={isAdmin ? "menu" : undefined}
        aria-expanded={open}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
        {stage.label}
        {isAdmin && <Icon name="chevron-down" size={10} aria-hidden="true" />}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-50 w-60 bg-white border border-slate-200 rounded-xl shadow-xl py-1 max-h-80 overflow-y-auto"
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-100">
            Move to stage
          </div>
          {stages.map((s) => {
            const active = s.key === stage.key;
            return (
              <button
                key={s.id}
                role="menuitem"
                disabled={active || advancing}
                onClick={() => {
                  setOpen(false);
                  onAdvance(s.key);
                }}
                className={
                  "w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition " +
                  (active ? "text-slate-400 cursor-default" : "text-slate-700 hover:bg-slate-50")
                }
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                {s.label}
                {active && <span className="ml-auto text-[10px] font-mono text-slate-400">current</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The study's work pane — Tasks, Notes, Activity always beside the record. */
function StudyWorkPane({
  studyId,
  study,
  stages,
  stageKey,
  openTaskCount,
  activityCount,
}: {
  studyId: string;
  study: StudyRow;
  stages: PipelineStageRow[];
  stageKey: string | null;
  openTaskCount: number | null;
  activityCount: number | null;
}) {
  const [paneTab, setPaneTab] = useState<"tasks" | "notes" | "activity">("tasks");
  return (
    <div className="hidden xl:flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden sticky top-20 max-h-[calc(100vh-110px)] min-h-[360px]">
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-1.5">
        {([
          ["tasks", "Tasks", openTaskCount],
          ["notes", "Notes", null],
          ["activity", "Activity", activityCount],
        ] as const).map(([k, label, count]) => (
          <button
            key={k}
            onClick={() => setPaneTab(k)}
            className={
              "px-2.5 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1 " +
              (paneTab === k ? "bg-white border border-slate-200 text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-900")
            }
            aria-pressed={paneTab === k}
          >
            {label}
            {count !== null && count !== undefined && count > 0 && (
              <span className="text-[10px] font-mono text-slate-400">{count}</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {paneTab === "tasks" && (
          <TasksTab
            studyId={studyId}
            stages={stages}
            stageKey={stageKey}
            onNavigate={(h) => {
              window.location.hash = h;
            }}
          />
        )}
        {paneTab === "notes" && <NotesCard studyId={studyId} />}
        {paneTab === "activity" && <ActivityTab studyId={studyId} study={study} stages={stages} />}
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
        <div className="text-[11px] font-semibold text-slate-500 mb-1 flex items-center gap-1.5">
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
        <div className="text-[11px] font-semibold text-slate-500 mb-1">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </div>
        <button
          onClick={() => setEditing(true)}
          className="text-left w-full text-sm text-slate-900 hover:text-brand-700 transition rounded px-1.5 py-0.5 -mx-1.5 hover:bg-brand-50/50 flex items-center gap-2"
        >
          {display}
          <span className="opacity-0 group-hover:opacity-100 transition text-[11px] font-semibold text-brand-600">
            edit
          </span>
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 mb-1">
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
    case "multiselect": {
      // Stored as string[]; choices come from the field's options.values.
      const opts = (field.options as { values?: string[] } | null)?.values ?? [];
      const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (v: string) =>
        onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
      return (
        <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto py-1">
          {opts.length === 0 && (
            <span className="text-xs text-slate-400 italic">
              No choices defined — add options to this field in the Field designer.
            </span>
          )}
          {opts.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              className={
                "text-xs rounded-full border px-2.5 py-1 transition " +
                (selected.includes(v)
                  ? "border-brand-300 bg-brand-50 text-brand-800 font-semibold"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
              }
            >
              {selected.includes(v) ? "✓ " : ""}
              {v}
            </button>
          ))}
        </div>
      );
    }
    case "list": {
      // Stored as string[]; repeatable free-text rows (e.g. consent versions).
      const items: string[] = Array.isArray(value) ? (value as string[]) : [];
      const set = (i: number, v: string) => {
        const next = [...items];
        next[i] = v;
        onChange(next.filter((x) => x !== undefined));
      };
      return (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={it}
                onChange={(e) => set(i, e.target.value)}
                autoFocus={autoFocus && i === items.length - 1}
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="text-slate-300 hover:text-red-500 transition px-1"
                aria-label="Remove entry"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...items, ""])}
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            + Add entry
          </button>
        </div>
      );
    }
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
      return fmtDate(v);
    } catch {
      return String(v);
    }
  }
  if (type === "number") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-slate-400 italic">—</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {v.map((x, i) => (
          <span key={i} className="text-xs rounded-full bg-slate-100 text-slate-700 px-2 py-0.5">
            {String(x)}
          </span>
        ))}
      </span>
    );
  }
  return String(v);
}

/* ---------- Site chip (header) ---------- */

function SiteChip({
  study,
  sites,
  isAdmin,
  onAssign,
}: {
  study: StudyRow;
  sites: SiteRow[];
  isAdmin: boolean;
  onAssign: (siteId: string | null) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const site = study.site_id ? sites.find((s) => s.id === study.site_id) ?? null : null;

  if (picking && isAdmin) {
    return (
      <span className="inline-flex items-center gap-1.5 mt-1">
        <Select
          autoFocus
          value={study.site_id ?? ""}
          onChange={async (e) => {
            await onAssign(e.target.value || null);
            setPicking(false);
          }}
          className="text-xs py-1 px-2 max-w-[240px]"
          aria-label="Assign site"
        >
          <option value="">— No site —</option>
          {sites
            .filter((s) => s.status === "active" || s.id === study.site_id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </Select>
        <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 ml-2">
      <span className="text-slate-300">·</span>
      <button
        onClick={() => isAdmin && setPicking(true)}
        disabled={!isAdmin}
        className={
          "inline-flex items-center gap-1 text-sm transition " +
          (isAdmin ? "hover:text-brand-700" : "cursor-default")
        }
        title={isAdmin ? "Assign site" : undefined}
      >
        <Icon name="hospital" size={12} className="text-slate-400" />
        {site ? (
          <span className="text-slate-700">{site.name}</span>
        ) : (
          <span className="text-slate-400 italic">no site</span>
        )}
      </button>
    </span>
  );
}
