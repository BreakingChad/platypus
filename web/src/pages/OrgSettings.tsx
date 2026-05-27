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
      draft.timezone !== org.timezone
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
      toast.success("Saved org settings");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (memberLoading || loading) {
    return <div className="max-w-3xl mx-auto px-6 py-8 text-sm text-slate-500">Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
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
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
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
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
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
          label="Study code prefix"
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
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
