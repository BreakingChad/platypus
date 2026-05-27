import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import type { FieldDefinitionRow, PipelineStageRow } from "../lib/types";
import { seedDemoStudies } from "../lib/demoSeed";
import { useToast } from "../lib/Toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";

type Org = {
  id: string;
  name: string;
  sponsor_mode: "site" | "sponsor";
  created_at: string;
};

/** Home — the landing page after sign-in. Sets the operating tone: a Setup
 *  Hub of admin-editable surfaces, plus a quick org snapshot to prove the
 *  Supabase wiring end-to-end. Non-admins see the Hub in read-only form so
 *  they understand how the org was configured. */
export function Home({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin, tier } = useCurrentMember();

  // Lightweight counts to make the Hub feel alive even before features ship.
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const studyFields = fields.rows.filter((f) => f.entity_type === "study");
  const fieldCount = studyFields.filter((f) => f.enabled).length;
  const stageCount = stages.rows.length;

  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [studyCount, setStudyCount] = useState<number | null>(null);
  const [seeding, setSeeding] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (auth.status !== "signedIn") return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("orgs")
        .select("id, name, sponsor_mode, created_at")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) setLoadError(error.message);
      else setOrgs((data ?? []) as Org[]);
      if (orgId) {
        const { count } = await supabase
          .from("studies")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgId);
        if (!cancelled) setStudyCount(count ?? 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

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
            <Pill tone={isAdmin ? "brand" : "neutral"}>
              {isAdmin ? "Admin access" : `Tier: ${tier}`}
            </Pill>
          ) : null
        }
      />

      {/* QUICK START — only when admin + few studies */}
      {isAdmin && studyCount !== null && studyCount < 3 && stages.rows.length > 0 && (
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
                {studyCount === 0 ? "Your portfolio is empty." : "Want to see Platypus in motion?"}
              </div>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Load 8 demo studies across every stage of your pipeline. You can edit, advance, or
                delete them anytime. Existing studies are untouched.
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
                    toast.success(`Added ${res.inserted} demo stud${res.inserted === 1 ? "y" : "ies"}`);
                  } else {
                    toast.info("Demo studies already loaded");
                  }
                  setStudyCount((c) => (c ?? 0) + res.inserted);
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

      {/* SETUP HUB */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-display font-bold text-slate-900">
            Setup hub
          </h2>
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
            status={stageCount > 0 ? `${stageCount} stages` : "Coming soon"}
            statusTone={stageCount > 0 ? "neutral" : "warning"}
            onClick={() => onNavigate("#/settings/stages")}
            disabled
            disabledReason="Coming in the next build"
          />
          <HubCard
            icon="users"
            title="Teams & roles"
            description="Build the teams that own the work. Role slots survive turnover — swap holders, not workflows."
            status="Coming soon"
            statusTone="warning"
            onClick={() => onNavigate("#/settings/teams")}
            disabled
            disabledReason="Coming in the next build"
          />
          <HubCard
            icon="shield"
            title="Access roles"
            description="Who can see what. Module-level permissions and portfolio scope."
            status="Coming soon"
            statusTone="warning"
            onClick={() => onNavigate("#/settings/access")}
            disabled
            disabledReason="Coming in the next build"
          />
        </div>
      </section>

      {/* QUICK LINKS — execution surfaces that will land next phase. */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-display font-bold text-slate-900">
            Work surfaces
          </h2>
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            queued
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <WorkTile icon="folder" label="Studies" onClick={() => onNavigate("#/studies")} />
          <WorkTile icon="layers" label="Pipeline" onClick={() => onNavigate("#/pipeline")} />
          <WorkTile icon="inbox" label="Inbox" onClick={() => onNavigate("#/inbox")} />
          <WorkTile icon="alert" label="Expirations" onClick={() => onNavigate("#/inbox")} />
        </div>
      </section>

      {/* SUPABASE PROOF — keep this until org-pickers are real. */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-display font-bold text-slate-900">
            Your organizations
          </h2>
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            live from supabase
          </span>
        </div>

        <Card>
          {loadError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <strong>Couldn't load orgs:</strong> {loadError}
            </div>
          )}

          {!loadError && orgs === null && (
            <div className="text-sm text-slate-500">Loading…</div>
          )}

          {orgs && orgs.length === 0 && (
            <div className="text-sm text-slate-500">
              No orgs yet. The signup trigger should have created one automatically.
            </div>
          )}

          {orgs && orgs.length > 0 && (
            <ul className="divide-y divide-slate-100 -my-1">
              {orgs.map((o) => (
                <li key={o.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900 flex items-center gap-2">
                      {o.name}
                      {orgId === o.id && <Pill tone="brand">active</Pill>}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">
                      {o.sponsor_mode === "sponsor" ? "Sponsor mode" : "Site mode"} · created{" "}
                      {new Date(o.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <code className="text-xs text-slate-400 font-mono">
                    {o.id.slice(0, 8)}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

/* ---------- pieces ---------- */

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
      <div className="font-display font-bold text-base text-slate-900 mb-1">
        {title}
      </div>
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
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-brand-300 hover:bg-brand-50/30 transition flex items-center gap-3 text-left"
    >
      <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
        <Icon name={icon} size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
          coming next
        </div>
      </div>
      <Icon name="chevron-right" size={14} className="text-slate-300" />
    </button>
  );
}
