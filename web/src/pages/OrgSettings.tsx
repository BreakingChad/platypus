import { friendlyError } from "../lib/errors";
import { stamped } from "../lib/stamp";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import type { OrgRow, SponsorMode } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { PageHeader } from "../components/ui/PageHeader";
import { Tip } from "../components/ui/Tip";
import { aiStatus } from "../lib/ai";
import { EmptyState } from "../components/ui/EmptyState";

/** OrgSettings — admin-only.
 *
 *  The handful of org-level fields that affect everything downstream:
 *  display name, sponsor mode (site vs sponsor), project ID prefix
 *  (drives study code generation), region, timezone.
 */
export function OrgSettings() {
  const { orgId } = useCurrentOrg();
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();

  const [org, setOrg] = useState<OrgRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<OrgRow>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("orgs")
        .select("*")
        .eq("id", orgId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      else if (data) {
        setOrg(data as OrgRow);
        setDraft(data as Partial<OrgRow>);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const isDirty = (() => {
    if (!org) return false;
    return (
      draft.name !== org.name ||
      draft.sponsor_mode !== org.sponsor_mode ||
      draft.project_id_prefix !== org.project_id_prefix ||
      draft.region !== org.region ||
      draft.timezone !== org.timezone ||
      draft.ai_enabled !== org.ai_enabled ||
      draft.ai_model !== org.ai_model
    );
  })();

  const onSave = async () => {
    if (!orgId || !org) return;
    setSaving(true);
    try {
      const patch: Partial<OrgRow> = {
        name: (draft.name ?? "").trim() || org.name,
        sponsor_mode: (draft.sponsor_mode as SponsorMode) || org.sponsor_mode,
        project_id_prefix:
          ((draft.project_id_prefix ?? "") as string).toUpperCase().slice(0, 8) || "STU",
        region: draft.region ?? null,
        timezone: draft.timezone ?? null,
        ai_enabled: draft.ai_enabled !== false,
        ai_model: draft.ai_model ?? "fast",
      };
      const { data, error } = await supabase
        .from("orgs")
        .update(patch as any)
        .eq("id", orgId)
        .select("*")
        .single();
      if (error) throw error;
      setOrg(data as OrgRow);
      setDraft(data as Partial<OrgRow>);
      toast.success(stamped("Saved organization settings"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  if (memberLoading || loading) {
    return <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8 text-sm text-slate-500">Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Organization" />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can change organization settings."
          />
        </Card>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <Card>
          <EmptyState
            iconName="alert"
            title="Couldn't load organization"
            sub={error ?? "Try reloading."}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Organization"
        subtitle="The org-level fields every downstream surface inherits from."
        actions={<Pill tone="brand">admin</Pill>}
      />

      <Card className="mt-6 space-y-4">
        <Field
          label="Organization name"
          hint="Shown across the app. Visible to every member."
          required
        >
          <Input
            value={(draft.name as string) ?? ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. Regional Research Network"
          />
        </Field>

        <Field
          label="Mode"
          hint="Site = we run studies. Sponsor = we sponsor studies others run. Affects which features surface."
        >
          <Select
            value={(draft.sponsor_mode as string) ?? "site"}
            onChange={(e) =>
              setDraft({ ...draft, sponsor_mode: e.target.value as SponsorMode })
            }
          >
            <option value="site">Site</option>
            <option value="sponsor">Sponsor</option>
          </Select>
        </Field>

        <Field
          label="Study code prefix (advanced)"
          hint="Auto-generated codes look like PREFIX-001. Letters and digits only, up to 8 chars."
        >
          <Input
            value={(draft.project_id_prefix as string) ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                project_id_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
              })
            }
            placeholder="STU"
          />
        </Field>

        <Field label="Region" hint="Used for date and locale defaults.">
          <Select
            value={(draft.region as string) ?? "us"}
            onChange={(e) => setDraft({ ...draft, region: e.target.value })}
          >
            <option value="us">United States</option>
            <option value="eu">Europe</option>
            <option value="apac">Asia-Pacific</option>
            <option value="latam">Latin America</option>
            <option value="row">Rest of world</option>
          </Select>
        </Field>

        <Field label="Timezone" hint="Default timezone for date displays.">
          <Select
            value={(draft.timezone as string) ?? "America/New_York"}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
          >
            <option value="America/New_York">America/New_York</option>
            <option value="America/Chicago">America/Chicago</option>
            <option value="America/Denver">America/Denver</option>
            <option value="America/Phoenix">America/Phoenix</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="America/Anchorage">America/Anchorage</option>
            <option value="Pacific/Honolulu">Pacific/Honolulu</option>
            <option value="Europe/London">Europe/London</option>
            <option value="Europe/Berlin">Europe/Berlin</option>
            <option value="Asia/Tokyo">Asia/Tokyo</option>
            <option value="UTC">UTC</option>
          </Select>
        </Field>

        <div className="pt-4 border-t border-slate-200">
          <AiSettingsSection
            enabled={draft.ai_enabled !== false}
            model={draft.ai_model ?? "fast"}
            onEnabled={(v) => setDraft({ ...draft, ai_enabled: v })}
            onModel={(v) => setDraft({ ...draft, ai_model: v })}
          />
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <div className="text-[11px] font-mono text-slate-400">
            org id: {org.id.slice(0, 8)}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setDraft(org)}
              disabled={!isDirty || saving}
            >
              Reset
            </Button>
            <Button variant="primary" onClick={onSave} disabled={!isDirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------- small Field wrapper (label + hint + children) ---------- */

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

/* ───────────────────── AI settings ───────────────────── */

function AiSettingsSection({
  enabled,
  model,
  onEnabled,
  onModel,
}: {
  enabled: boolean;
  model: string;
  onEnabled: (v: boolean) => void;
  onModel: (v: string) => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let c = false;
    aiStatus().then((s) => !c && setConfigured(s.configured));
    return () => {
      c = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-slate-900">AI</h3>
        <Tip
          side="bottom"
          label="Powers study summaries and (soon) protocol ingestion and document-congruency checks. Processing runs server-side; your API key is never exposed to the browser."
        >
          <span className="text-[9px] font-bold uppercase tracking-wider text-brand-600 bg-brand-100 rounded px-1 py-0.5 cursor-pointer">
            beta
          </span>
        </Tip>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Plain-English study summaries from structured fields, with more AI assists on the roadmap.
      </p>

      <label className="flex items-center gap-2.5 mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabled(e.target.checked)}
          className="accent-brand-500 w-4 h-4"
        />
        <span className="text-sm text-slate-700">Enable AI features for this organization</span>
      </label>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Model
          <select
            value={model}
            onChange={(e) => onModel(e.target.value)}
            disabled={!enabled}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 disabled:opacity-50"
          >
            <option value="fast">Fast (Haiku) — quick, low-cost</option>
            <option value="balanced">Balanced (Sonnet) — richer reasoning</option>
          </select>
        </label>

        <span className="inline-flex items-center gap-1.5 text-xs">
          <span
            className={
              "w-2 h-2 rounded-full " +
              (configured === null ? "bg-slate-300" : configured ? "bg-emerald-500" : "bg-amber-500")
            }
          />
          <span className="text-slate-600">
            {configured === null
              ? "Checking connection…"
              : configured
              ? "Connected — API key configured"
              : "Not connected — an API key needs to be added in the deployment settings"}
          </span>
        </span>
      </div>
    </div>
  );
}
