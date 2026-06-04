import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";
import { stamped } from "../lib/stamp";
import { seedDemoStudies, seedDemoWorkStreams, seedDemoSites, seedDemoStory } from "../lib/demoSeed";
import type {
  FieldDefinitionRow,
  PipelineStageRow,
  StudyRow,
  TeamRow,
  AccessRoleRow,
  SponsorMode,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Icon } from "../components/ui/Icon";
import { Loader } from "../components/ui/Loader";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

export const SETUP_DISMISS_KEY = "platypus/setup-dismissed";
const SETUP_STEP_KEY = "platypus/setup-step";
const FROM_SETUP_KEY = "platypus/from-setup";

/** Recommended startup pipeline — the "no blank page" express seed. */
const DEFAULT_STAGES: {
  key: string;
  label: string;
  color: string;
  icon_key: string;
  target_days: number;
  terminal: boolean;
  is_core: boolean;
}[] = [
  { key: "intake",             label: "Intake",             color: "#6366F1", icon_key: "inbox",  target_days: 7,  terminal: false, is_core: true },
  { key: "feasibility",        label: "Feasibility",        color: "#8B5CF6", icon_key: "file",   target_days: 14, terminal: false, is_core: false },
  { key: "site_selection",     label: "Site selection",     color: "#3B82F6", icon_key: "users",  target_days: 10, terminal: false, is_core: false },
  { key: "site_qualification", label: "Site qualification", color: "#06B6D4", icon_key: "check",  target_days: 14, terminal: false, is_core: false },
  { key: "budget_contract",    label: "Budget & contract",  color: "#F59E0B", icon_key: "file",   target_days: 30, terminal: false, is_core: false },
  { key: "regulatory",         label: "Regulatory",         color: "#10B981", icon_key: "shield", target_days: 30, terminal: false, is_core: false },
  { key: "activation",         label: "Activation",         color: "#EC4899", icon_key: "check",  target_days: 21, terminal: false, is_core: false },
  { key: "closeout",           label: "Closeout",           color: "#64748B", icon_key: "folder", target_days: 0,  terminal: true,  is_core: false },
];

type StepKey = "org" | "stages" | "fields" | "teams" | "access" | "studies";

const PHASES: { phase: string; steps: { key: StepKey; label: string }[] }[] = [
  { phase: "Your organization", steps: [{ key: "org", label: "Organization" }] },
  {
    phase: "Operating model",
    steps: [
      { key: "stages", label: "Pipeline stages" },
      { key: "fields", label: "Study fields" },
      { key: "teams", label: "Teams & roles" },
      { key: "access", label: "Access roles" },
    ],
  },
  { phase: "Go live", steps: [{ key: "studies", label: "First study" }] },
];
const STEP_ORDER: StepKey[] = ["org", "stages", "fields", "teams", "access", "studies"];

export function GuidedSetup({ onNavigate }: { onNavigate: (h: string) => void }) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position", realtime: true });
  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position", realtime: true });
  const accessRoles = useOrgTable<AccessRoleRow>("access_roles", { realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });

  const [active, setActive] = useState<StepKey>(() => {
    try {
      const v = localStorage.getItem(SETUP_STEP_KEY) as StepKey | null;
      return v && STEP_ORDER.includes(v) ? v : "org";
    } catch {
      return "org";
    }
  });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SETUP_STEP_KEY, active);
    } catch {
      /* non-fatal */
    }
  }, [active]);

  // Org form state
  const [orgName, setOrgName] = useState("");
  const [sponsorMode, setSponsorMode] = useState<SponsorMode>("site");
  const [prefix, setPrefix] = useState("");
  const [region, setRegion] = useState("");
  const [timezone, setTimezone] = useState("");

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("orgs")
        .select("name, sponsor_mode, project_id_prefix, region, timezone")
        .eq("id", orgId)
        .maybeSingle();
      if (cancelled || !data) return;
      setOrgName((data as any).name ?? "");
      setSponsorMode(((data as any).sponsor_mode as SponsorMode) ?? "site");
      setPrefix((data as any).project_id_prefix ?? "");
      setRegion((data as any).region ?? "");
      setTimezone((data as any).timezone ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Live completion — mirrors SetupChecklistBlock.
  const orgNamed = Boolean(orgName) && orgName !== "My Organization" && orgName !== "Platypus";
  const hasStages = stages.rows.length > 0;
  const enabledStudyFields = fields.rows.filter((f) => f.entity_type === "study" && f.enabled).length;
  const hasFields = enabledStudyFields > 0;
  const hasTeams = teams.rows.length > 0;
  const hasAccessRoles = accessRoles.rows.length > 0;
  const hasStudies = studies.rows.length > 0;

  const doneMap: Record<StepKey, boolean> = {
    org: orgNamed,
    stages: hasStages,
    fields: hasFields,
    teams: hasTeams,
    access: hasAccessRoles,
    studies: hasStudies,
  };
  const completed = STEP_ORDER.filter((k) => doneMap[k]).length;
  const total = STEP_ORDER.length;
  const pct = Math.round((completed / total) * 100);
  const allDone = completed === total;

  const idx = STEP_ORDER.indexOf(active);
  const goNext = () => setActive(STEP_ORDER[Math.min(idx + 1, total - 1)]);
  const goPrev = () => setActive(STEP_ORDER[Math.max(idx - 1, 0)]);

  const saveOrg = async () => {
    if (!orgId) return;
    if (!orgName.trim()) {
      toast.error("Give your organization a name.");
      return;
    }
    setBusy("org");
    try {
      const { error } = await supabase
        .from("orgs")
        .update({
          name: orgName.trim(),
          sponsor_mode: sponsorMode,
          project_id_prefix: prefix.trim() || null,
          region: region.trim() || null,
          timezone: timezone.trim() || null,
        } as any)
        .eq("id", orgId);
      if (error) throw error;
      if (userId)
        void writeAuditEvent({
          orgId,
          actorId: userId,
          actorEmail: userEmail,
          entityType: "org",
          entityId: orgId,
          action: "org_updated",
          payload: { name: orgName.trim(), sponsor_mode: sponsorMode },
        });
      toast.success(stamped("Saved organization"));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save organization");
    } finally {
      setBusy(null);
    }
  };

  const seedStages = async () => {
    if (!orgId) return;
    setBusy("stages");
    try {
      const rows = DEFAULT_STAGES.map((s, i) => ({ ...s, org_id: orgId, position: (i + 1) * 10 }));
      const { error } = await supabase.from("pipeline_stages").insert(rows as any);
      if (error) throw error;
      toast.success(stamped(`Added ${rows.length} recommended stages`));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't add stages");
    } finally {
      setBusy(null);
    }
  };

  const loadDemo = async () => {
    if (!orgId) return;
    if (!hasStages) {
      toast.error("Add pipeline stages first.");
      setActive("stages");
      return;
    }
    setBusy("studies");
    try {
      const res = await seedDemoStudies(orgId, stages.rows);
      const ws = await seedDemoWorkStreams(orgId);
      try {
        await seedDemoSites(orgId);
      } catch {
        /* pre-0012 */
      }
      try {
        await seedDemoStory(orgId); // notes + escalation + handoffs + vacation coverage
      } catch {
        /* pre-0013 — story beats need notes/ooo tables */
      }
      const parts: string[] = [];
      if (res.inserted) parts.push(`${res.inserted} stud${res.inserted === 1 ? "y" : "ies"}`);
      if (ws.modules) parts.push(`${ws.modules} work-stream module${ws.modules === 1 ? "" : "s"}`);
      toast.success(stamped(parts.length ? `Loaded ${parts.join(" + ")}` : "Demo content already loaded"));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't load demo content");
    } finally {
      setBusy(null);
    }
  };

  const finish = () => {
    try {
      localStorage.setItem(SETUP_DISMISS_KEY, "1");
    } catch {
      /* non-fatal */
    }
    toast.success("Setup complete — welcome to Platypus");
    onNavigate("#/");
  };

  const gotoDesigner = (h: string) => {
    try {
      sessionStorage.setItem(FROM_SETUP_KEY, "1");
    } catch {
      /* non-fatal */
    }
    onNavigate(h);
  };

  if (memberLoading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Loader label="Checking permissions…" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        <Card>
          <EmptyState
            iconName="lock"
            title="Admin access required"
            sub="Guided setup configures the workspace for your whole org. Ask an admin to run it."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Get started"
        title="Guided setup"
        subtitle="Stand up your workspace in a few minutes. Take the recommended defaults to move fast, or jump into any designer to make it yours — every step writes live and you can change it later."
        actions={
          <Button variant={allDone ? "primary" : "ghost"} onClick={finish}>
            {allDone ? "Finish — go live" : "Skip for now"}
          </Button>
        }
      />

      {/* Progress */}
      <div className="mt-6 mb-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {completed} of {total} complete
          </span>
          <span className="text-[10px] font-mono text-slate-400">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-brand-gradient transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        {/* Rail */}
        <div className="space-y-5">
          {PHASES.map((p) => (
            <div key={p.phase}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 px-1">
                {p.phase}
              </div>
              <ul className="space-y-0.5">
                {p.steps.map((s) => {
                  const done = doneMap[s.key];
                  const isActive = active === s.key;
                  return (
                    <li key={s.key}>
                      <button
                        onClick={() => setActive(s.key)}
                        className={
                          "w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition " +
                          (isActive
                            ? "bg-brand-50 text-brand-700 font-semibold"
                            : "text-slate-700 hover:bg-slate-50")
                        }
                      >
                        <span
                          className={
                            "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 " +
                            (done
                              ? "bg-emerald-100 text-emerald-700"
                              : isActive
                              ? "bg-brand-100 text-brand-700"
                              : "bg-slate-100 text-slate-400")
                          }
                        >
                          {done ? <Icon name="check" size={11} /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                        </span>
                        <span className="flex-1 truncate">{s.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* Panel */}
        <div>
          <Card>
            <StepHeader done={doneMap[active]} title={PHASES.flatMap((p) => p.steps).find((s) => s.key === active)!.label} />

            {active === "org" && (
              <div className="mt-4 space-y-4">
                <Why>This names your workspace and sets your binder model. Sponsoring studies uses a TMF; a research site uses an ISF.</Why>
                <FieldRow label="Organization name">
                  <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Banner Research Institute" />
                </FieldRow>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    Do you sponsor studies?
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ModeCard
                      active={sponsorMode === "site"}
                      onClick={() => setSponsorMode("site")}
                      title="We're a site"
                      sub="Run studies for sponsors. Binder = ISF."
                      icon="hospital"
                    />
                    <ModeCard
                      active={sponsorMode === "sponsor"}
                      onClick={() => setSponsorMode("sponsor")}
                      title="We sponsor studies"
                      sub="Own the protocol. Binder = TMF."
                      icon="shield"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <FieldRow label="Project ID prefix">
                    <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="STU" />
                  </FieldRow>
                  <FieldRow label="Region (optional)">
                    <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="US" />
                  </FieldRow>
                  <FieldRow label="Timezone (optional)">
                    <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Phoenix" />
                  </FieldRow>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="primary" onClick={saveOrg} disabled={busy === "org"}>
                    {busy === "org" ? "Saving…" : "Save organization"}
                  </Button>
                  <Button variant="ghost" onClick={() => gotoDesigner("#/settings/org")}>
                    More org settings
                  </Button>
                </div>
              </div>
            )}

            {active === "stages" && (
              <div className="mt-4 space-y-4">
                <Why>Every study flows through these stages. Health is measured against each stage&rsquo;s target — so the sequence and targets define your operating tempo.</Why>
                {hasStages ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {stages.rows.map((s) => (
                        <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: s.color }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                          {s.label}
                        </span>
                      ))}
                    </div>
                    <Button variant="ghost" onClick={() => gotoDesigner("#/settings/stages")}>
                      <Icon name="workflow" size={12} /> Customize in Stage Designer
                    </Button>
                  </>
                ) : (
                  <ExpressRow
                    expressLabel={busy === "stages" ? "Adding…" : "Use recommended pipeline"}
                    onExpress={seedStages}
                    busy={busy === "stages"}
                    note="8 standard startup stages — Intake through Closeout — with sensible target days. Edit any of them after."
                    customizeLabel="Build my own"
                    onCustomize={() => gotoDesigner("#/settings/stages")}
                  />
                )}
              </div>
            )}

            {active === "fields" && (
              <div className="mt-4 space-y-4">
                <Why>Defines what every study record captures and who can edit it — including lock-after-commit for regulated fields.</Why>
                <div className="text-sm text-slate-600">
                  {hasFields ? `${enabledStudyFields} study field${enabledStudyFields === 1 ? "" : "s"} enabled.` : "No study fields enabled yet."}
                </div>
                <Button variant={hasFields ? "ghost" : "primary"} onClick={() => gotoDesigner("#/settings/fields")}>
                  <Icon name="file" size={12} /> {hasFields ? "Review in Field Designer" : "Open Field Designer"}
                </Button>
              </div>
            )}

            {active === "teams" && (
              <div className="mt-4 space-y-4">
                <Why>Teams own the work; role slots survive turnover — you swap who holds a role, not the workflow.</Why>
                <div className="text-sm text-slate-600">
                  {hasTeams ? `${teams.rows.length} team${teams.rows.length === 1 ? "" : "s"} configured.` : "No teams yet."}
                </div>
                <Button variant={hasTeams ? "ghost" : "primary"} onClick={() => gotoDesigner("#/settings/teams")}>
                  <Icon name="users" size={12} /> {hasTeams ? "Review in Team Builder" : "Open Team Builder"}
                </Button>
              </div>
            )}

            {active === "access" && (
              <div className="mt-4 space-y-4">
                <Why>Who can see and do what. Most teams accept the recommended roles — this is a confirm step, not a build step.</Why>
                <div className="text-sm text-slate-600">
                  {hasAccessRoles ? `${accessRoles.rows.length} access role${accessRoles.rows.length === 1 ? "" : "s"} defined.` : "No access roles yet."}
                </div>
                <Button variant={hasAccessRoles ? "ghost" : "primary"} onClick={() => gotoDesigner("#/settings/access")}>
                  <Icon name="shield" size={12} /> {hasAccessRoles ? "Review access roles" : "Set up access roles"}
                </Button>
              </div>
            )}

            {active === "studies" && (
              <div className="mt-4 space-y-4">
                <Why>See Platypus in motion with demo studies across every stage, or add your real first study now.</Why>
                <div className="text-sm text-slate-600">
                  {hasStudies ? `${studies.rows.length} stud${studies.rows.length === 1 ? "y" : "ies"} in your portfolio.` : "Your portfolio is empty."}
                </div>
                <ExpressRow
                  expressLabel={busy === "studies" ? "Loading…" : "Load 8 demo studies"}
                  onExpress={loadDemo}
                  busy={busy === "studies"}
                  note="Demo studies + work-stream modules across your stages. Existing studies are untouched."
                  customizeLabel="Create a real study"
                  onCustomize={() => gotoDesigner("#/studies")}
                />
              </div>
            )}

            {/* Step nav */}
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
              <Button variant="ghost" onClick={goPrev} disabled={idx === 0}>
                <Icon name="chevron-right" size={12} className="rotate-180" /> Back
              </Button>
              {idx < total - 1 ? (
                <Button variant="primary" onClick={goNext}>
                  Next <Icon name="chevron-right" size={12} />
                </Button>
              ) : (
                <Button variant="primary" onClick={finish}>
                  {allDone ? "Finish — go live" : "Finish anyway"}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StepHeader({ title, done }: { title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-xl font-display font-bold text-slate-900">{title}</h2>
      {done && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
          <Icon name="check" size={10} /> Done
        </span>
      )}
    </div>
  );
}

function Why({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm text-slate-600 leading-relaxed flex items-start gap-2">
      <Icon name="info" size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">{label}</span>
      {children}
    </label>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  sub,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "text-left rounded-xl border p-3 transition flex items-start gap-2.5 " +
        (active ? "border-brand-500 bg-brand-50/50 ring-2 ring-brand-200" : "border-slate-200 bg-white hover:border-slate-300")
      }
    >
      <div className={"w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 " + (active ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500")}>
        <Icon name={icon} size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-[11px] text-slate-500 leading-snug">{sub}</div>
      </div>
    </button>
  );
}

function ExpressRow({
  expressLabel,
  onExpress,
  busy,
  note,
  customizeLabel,
  onCustomize,
}: {
  expressLabel: string;
  onExpress: () => void;
  busy: boolean;
  note: string;
  customizeLabel: string;
  onCustomize: () => void;
}) {
  return (
    <div className="rounded-xl border-2 border-brand-100 bg-brand-50/40 p-4">
      <p className="text-xs text-slate-600 leading-relaxed mb-3">{note}</p>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={onExpress} disabled={busy}>
          <Icon name="check" size={12} /> {expressLabel}
        </Button>
        <Button variant="ghost" onClick={onCustomize} disabled={busy}>
          {customizeLabel}
        </Button>
      </div>
    </div>
  );
}
