import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import type { ProfileRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { PageHeader } from "../components/ui/PageHeader";

/** Profile — the signed-in user's own record. Everyone has a profiles row
 *  created at signup; this surface lets them fill in display name, title,
 *  phone, and shows their organizational membership.
 */
export function Profile() {
  const auth = useAuth();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<ProfileRow>>({});

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setProfile(data as ProfileRow);
        setDraft(data as Partial<ProfileRow>);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const dirty = (() => {
    if (!profile) return false;
    return (
      (draft.full_name ?? "") !== (profile.full_name ?? "") ||
      (draft.title ?? "") !== (profile.title ?? "") ||
      (draft.phone ?? "") !== (profile.phone ?? "")
    );
  })();

  const onSave = async () => {
    if (!userId || !profile) return;
    setSaving(true);
    try {
      const patch: Partial<ProfileRow> = {
        full_name: (draft.full_name ?? "").toString().trim() || null,
        title: (draft.title ?? "").toString().trim() || null,
        phone: (draft.phone ?? "").toString().trim() || null,
      };
      const { data, error } = await supabase
        .from("profiles")
        .update(patch as any)
        .eq("id", userId)
        .select("*")
        .single();
      if (error) throw error;
      setProfile(data as ProfileRow);
      setDraft(data as Partial<ProfileRow>);
      toast.success("Profile saved");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="max-w-2xl mx-auto px-6 py-8 text-sm text-slate-500">Loading…</div>;
  }

  if (!profile) {
    return <div className="max-w-2xl mx-auto px-6 py-8 text-sm text-slate-500">No profile.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="You"
        title="Profile"
        subtitle="Your display name, title, and contact details. Shown alongside your work in tasks and audit trails."
        actions={<Pill tone="neutral">{profile.email}</Pill>}
      />

      <Card className="mt-6 space-y-4">
        <Field label="Full name" hint="Shown next to your avatar and in role assignments.">
          <Input
            value={(draft.full_name as string) ?? ""}
            onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
            placeholder="e.g. Avery Chen"
          />
        </Field>

        <Field label="Title" hint="e.g. Startup Coordinator, Director of Operations.">
          <Input
            value={(draft.title as string) ?? ""}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="e.g. Startup Coordinator"
          />
        </Field>

        <Field label="Phone" hint="Used for OOO contact info and escalation.">
          <Input
            type="tel"
            value={(draft.phone as string) ?? ""}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="+1 (555) 555-5555"
          />
        </Field>

        <Field label="Email" hint="Used for sign-in. Can't be changed from here.">
          <Input value={profile.email} disabled />
        </Field>

        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <div className="text-[11px] font-mono text-slate-400">
            user id: {profile.id.slice(0, 8)}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setDraft(profile)}
              disabled={!dirty || saving}
            >
              Reset
            </Button>
            <Button variant="primary" onClick={onSave} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
