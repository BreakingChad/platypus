import { friendlyError } from "../lib/errors";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import type { ProfileRow, OrgMemberRow } from "../lib/types";
import { useCurrentOrg } from "../lib/OrgContext";
import { writeAuditEvent } from "../lib/auditLog";
import { stamped } from "../lib/stamp";
import { Select } from "../components/ui/Select";
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
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const { orgId } = useCurrentOrg();

  // ---- Out-of-office (org_members row) ----
  const [member, setMember] = useState<OrgMemberRow | null>(null);
  const [teammates, setTeammates] = useState<{ user_id: string; label: string }[]>([]);
  const [oooUntil, setOooUntil] = useState<string>("");
  const [oooDelegate, setOooDelegate] = useState<string>("");
  const [oooSaving, setOooSaving] = useState(false);
  const [oooSupported, setOooSupported] = useState(true);

  useEffect(() => {
    if (!userId || !orgId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("org_members")
        .select("id, org_id, user_id, tier, created_at, access_role_id, ooo_until, ooo_delegate_user_id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setOooSupported(false);
        return;
      }
      const m = data as unknown as OrgMemberRow;
      setMember(m);
      setOooUntil(m?.ooo_until ? m.ooo_until.slice(0, 10) : "");
      setOooDelegate(m?.ooo_delegate_user_id ?? "");

      const { data: mems } = await supabase
        .from("org_members")
        .select("user_id")
        .eq("org_id", orgId)
        .neq("user_id", userId);
      const ids = (mems ?? []).map((x: any) => x.user_id as string);
      let profs: any[] = [];
      if (ids.length > 0) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", ids);
        profs = ps ?? [];
      }
      if (!cancelled) {
        setTeammates(
          ids.map((id) => {
            const p = profs.find((x) => x.id === id);
            return { user_id: id, label: p?.full_name || p?.email || "(teammate)" };
          })
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, orgId]);

  const saveOoo = async (clear: boolean) => {
    if (!member || !orgId || !userId) return;
    setOooSaving(true);
    try {
      const patch = clear
        ? { ooo_until: null, ooo_delegate_user_id: null }
        : {
            ooo_until: oooUntil ? new Date(oooUntil + "T23:59:59").toISOString() : null,
            ooo_delegate_user_id: oooDelegate || null,
          };
      const { error } = await supabase.from("org_members").update(patch as any).eq("id", member.id);
      if (error) throw error;
      void writeAuditEvent({
        orgId, actorId: userId, actorEmail: userEmail,
        entityType: "member", entityId: member.id,
        action: clear ? "ooo_cleared" : "ooo_set",
        payload: clear ? {} : { until: patch.ooo_until, delegate: oooDelegate || null },
      });
      setMember({ ...member, ...(patch as any) });
      if (clear) {
        setOooUntil("");
        setOooDelegate("");
      }
      toast.success(stamped(clear ? "Out-of-office cleared" : "Out-of-office set"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't update. Has migration 0013 been applied?"));
    } finally {
      setOooSaving(false);
    }
  };

  const oooActive = Boolean(member?.ooo_until && new Date(member.ooo_until).getTime() > Date.now());

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
      toast.success(stamped("Profile saved"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="max-w-2xl mx-auto px-4 md:px-6 py-8 text-sm text-slate-500">Loading…</div>;
  }

  if (!profile) {
    return <div className="max-w-2xl mx-auto px-4 md:px-6 py-8 text-sm text-slate-500">No profile.</div>;
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

      {oooSupported && (
        <Card className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-700">
                Out of office
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                While you're out, newly spawned tasks that would auto-assign to you route to your
                delegate instead — with the coverage noted on the task.
              </p>
            </div>
            {oooActive && <Pill tone="warning">OOO active</Pill>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Out until">
              <Input type="date" value={oooUntil} onChange={(e) => setOooUntil(e.target.value)} />
            </Field>
            <Field label="Delegate (covers for you)">
              <Select value={oooDelegate} onChange={(e) => setOooDelegate(e.target.value)}>
                <option value="">— No delegate (tasks queue on the role) —</option>
                {teammates.map((t) => (
                  <option key={t.user_id} value={t.user_id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {oooActive && (
              <Button variant="ghost" onClick={() => saveOoo(true)} disabled={oooSaving}>
                I'm back — clear OOO
              </Button>
            )}
            <Button variant="primary" onClick={() => saveOoo(false)} disabled={oooSaving || !oooUntil}>
              {oooSaving ? "Saving…" : "Set out of office"}
            </Button>
          </div>
        </Card>
      )}
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
      <label className="block text-xs font-semibold text-slate-700 mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
