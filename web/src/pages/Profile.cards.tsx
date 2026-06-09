import { friendlyError } from "../lib/errors";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { writeAuditEvent } from "../lib/auditLog";
import { notifyProfileUpdated } from "../lib/useMyProfile";
import { displayName } from "../lib/types";
import {
  CREDENTIAL_KINDS,
  credentialStatus,
  daysUntilExpiry,
  sortCredentials,
} from "../lib/credentials";
import type {
  AccessRoleRow,
  ProfileRow,
  StaffCredentialRow,
  TeamRoleRow,
  TeamRoleHolderRow,
  TeamRow,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";

/** Profile.cards — the B-series profile buildout, kept out of Profile.tsx:
 *  1. My roles & studies (read-only — what the org thinks I am)
 *  2. Credentials & training (expiry-dated; feeds Expirations)
 *  3. E-signature (prefills the Part 11 attestation modal)
 *  4. Timezone & working hours (workforce pillar input)
 */
export function ProfileExtraCards({
  profile,
  onProfileChange,
}: {
  profile: ProfileRow;
  onProfileChange: (p: ProfileRow) => void;
}) {
  return (
    <>
      <MyRolesCard />
      <CredentialsCard />
      <SignatureCard profile={profile} onProfileChange={onProfileChange} />
      <PreferencesCard profile={profile} onProfileChange={onProfileChange} />
    </>
  );
}

/* ---------- 1. My roles & studies ---------- */

function MyRolesCard() {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const userId = auth.status === "signedIn" ? auth.user.id : null;

  const accessRoles = useOrgTable<AccessRoleRow>("access_roles");
  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position" });
  const teamRoles = useOrgTable<TeamRoleRow>("team_roles", { orderBy: "position" });
  const holders = useOrgTable<TeamRoleHolderRow>("team_role_holders", { realtime: true });

  const [accessRoleId, setAccessRoleId] = useState<string | null>(null);
  const [piStudies, setPiStudies] = useState<{ id: string; code: string; title: string }[]>([]);
  const [openTasks, setOpenTasks] = useState<number | null>(null);

  useEffect(() => {
    if (!userId || !orgId) return;
    let cancelled = false;
    (async () => {
      const { data: m } = await supabase
        .from("org_members")
        .select("access_role_id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!cancelled) setAccessRoleId((m as any)?.access_role_id ?? null);

      const { data: st } = await supabase
        .from("studies")
        .select("id, code, title")
        .eq("org_id", orgId)
        .eq("pi_user_id", userId)
        .eq("closed", false)
        .limit(6);
      if (!cancelled) setPiStudies(((st ?? []) as any[]).map((s) => ({ id: s.id, code: s.code, title: s.title })));

      const { count } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("assigned_to_user_id", userId)
        .in("status", ["open", "in_progress"]);
      if (!cancelled) setOpenTasks(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, orgId]);

  const accessRole = accessRoles.rows.find((r) => r.id === accessRoleId) ?? null;

  const myTeamRoles = useMemo(() => {
    if (!userId) return [];
    const mine = new Set(
      holders.rows.filter((h) => h.user_id === userId).map((h) => h.team_role_id)
    );
    return teamRoles.rows
      .filter((r) => mine.has(r.id))
      .map((r) => ({
        role: r,
        team: teams.rows.find((t) => t.id === r.team_id) ?? null,
      }));
  }, [holders.rows, teamRoles.rows, teams.rows, userId]);

  return (
    <Card className="mt-5 space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-700">My roles &amp; studies</div>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
          What the org has you down as — set by admins in Members and Team Builder.
          Role assignment drives which tasks auto-route to you.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] font-semibold text-slate-500 mb-1">Access role</div>
          {accessRole ? (
            <Pill tone="brand">{accessRole.name}</Pill>
          ) : (
            <span className="text-sm text-slate-400">None assigned</span>
          )}
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-500 mb-1">Open tasks assigned to me</div>
          <span className="text-sm font-semibold text-slate-800">{openTasks ?? "—"}</span>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-slate-500 mb-1">Team roles I hold</div>
        {myTeamRoles.length === 0 && (
          <span className="text-sm text-slate-400">No team roles yet.</span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {myTeamRoles.map(({ role, team }) => (
            <span
              key={role.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
            >
              {team && (
                <span className="w-2 h-2 rounded-full" style={{ background: team.color }} />
              )}
              {team ? `${team.name} · ` : ""}{role.title}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-slate-500 mb-1">Studies where I&rsquo;m PI</div>
        {piStudies.length === 0 && <span className="text-sm text-slate-400">None linked.</span>}
        <div className="flex flex-wrap gap-1.5">
          {piStudies.map((s) => (
            <a
              key={s.id}
              href={`#/studies/${s.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 hover:border-brand-300 transition"
              title={s.title}
            >
              <span className="font-mono">{s.code}</span>
            </a>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ---------- 2. Credentials & training ---------- */

const EMPTY_CRED = {
  kind: "training" as StaffCredentialRow["kind"],
  label: "",
  issuer: "",
  identifier: "",
  issued_on: "",
  expires_on: "",
};

function CredentialsCard() {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const creds = useOrgTable<StaffCredentialRow>("staff_credentials", { realtime: true });
  const mine = useMemo(
    () => sortCredentials(creds.rows.filter((c) => c.user_id === userId)),
    [creds.rows, userId]
  );

  const [form, setForm] = useState<typeof EMPTY_CRED>(EMPTY_CRED);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const startEdit = (c: StaffCredentialRow) => {
    setEditingId(c.id);
    setOpen(true);
    setForm({
      kind: c.kind,
      label: c.label,
      issuer: c.issuer ?? "",
      identifier: c.identifier ?? "",
      issued_on: c.issued_on ?? "",
      expires_on: c.expires_on ?? "",
    });
  };

  const reset = () => {
    setForm(EMPTY_CRED);
    setEditingId(null);
    setOpen(false);
  };

  const save = async () => {
    if (!userId || !orgId) return;
    if (!form.label.trim()) {
      toast.error("Give the credential a name — e.g. “GCP Training (CITI)”.");
      return;
    }
    setBusy(true);
    try {
      const patch = {
        kind: form.kind,
        label: form.label.trim(),
        issuer: form.issuer.trim() || null,
        identifier: form.identifier.trim() || null,
        issued_on: form.issued_on || null,
        expires_on: form.expires_on || null,
      };
      if (editingId) {
        const { error } = await supabase
          .from("staff_credentials")
          .update(patch as any)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("staff_credentials")
          .insert({ ...patch, org_id: orgId, user_id: userId } as any);
        if (error) throw error;
      }
      void writeAuditEvent({
        orgId,
        actorId: userId,
        actorEmail: userEmail,
        entityType: "member",
        entityId: userId,
        action: editingId ? "credential_updated" : "credential_added",
        payload: { label: patch.label, kind: patch.kind, expires_on: patch.expires_on },
      });
      void creds.refresh();
      toast.success(stamped(editingId ? "Credential updated" : "Credential added"));
      reset();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't save — has migration 0043 been applied?"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: StaffCredentialRow) => {
    if (!orgId || !userId) return;
    const ok = await confirmDialog({
      title: "Remove credential?",
      message: `“${c.label}” will be removed from your profile. The removal is recorded in the audit trail.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from("staff_credentials").delete().eq("id", c.id);
      if (error) throw error;
      void writeAuditEvent({
        orgId,
        actorId: userId,
        actorEmail: userEmail,
        entityType: "member",
        entityId: userId,
        action: "credential_removed",
        payload: { label: c.label, kind: c.kind },
      });
      void creds.refresh();
      toast.success(stamped("Credential removed"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't remove"));
    }
  };

  return (
    <Card className="mt-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-700">Credentials &amp; training</div>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            GCP training, licenses, certifications — with expiry dates. Expiring items
            surface before they become findings.
          </p>
        </div>
        {!open && (
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
            Add credential
          </Button>
        )}
      </div>

      {open && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <L label="Type">
              <Select
                value={form.kind}
                onChange={(e) =>
                  setForm({ ...form, kind: e.target.value as StaffCredentialRow["kind"] })
                }
              >
                {CREDENTIAL_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </L>
            <L label="Name">
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="GCP Training (CITI)"
              />
            </L>
            <L label="Issuer (optional)">
              <Input
                value={form.issuer}
                onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                placeholder="CITI Program"
              />
            </L>
            <L label="ID / number (optional)">
              <Input
                value={form.identifier}
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                placeholder="e.g. 4411-2098"
              />
            </L>
            <L label="Issued on">
              <Input
                type="date"
                value={form.issued_on}
                onChange={(e) => setForm({ ...form, issued_on: e.target.value })}
              />
            </L>
            <L label="Expires on">
              <Input
                type="date"
                value={form.expires_on}
                onChange={(e) => setForm({ ...form, expires_on: e.target.value })}
              />
            </L>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Add credential"}
            </Button>
          </div>
        </div>
      )}

      {mine.length === 0 && !open && (
        <div className="text-sm text-slate-500">
          Nothing on file yet. Sites get asked for these constantly — GCP training first.
        </div>
      )}

      {mine.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {mine.map((c) => {
            const status = credentialStatus(c.expires_on);
            const days = daysUntilExpiry(c.expires_on);
            return (
              <li key={c.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{c.label}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {[
                      CREDENTIAL_KINDS.find((k) => k.key === c.kind)?.label,
                      c.issuer,
                      c.identifier,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {status === "expired" && (
                  <Pill tone="danger">expired {days != null ? `${Math.abs(days)}d ago` : ""}</Pill>
                )}
                {status === "expiring" && <Pill tone="warning">expires in {days}d</Pill>}
                {status === "ok" && c.expires_on && (
                  <Pill tone="success">valid · {c.expires_on}</Pill>
                )}
                {status === "none" && <Pill tone="neutral">no expiry</Pill>}
                <Button size="sm" variant="ghost" onClick={() => startEdit(c)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(c)}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ---------- 3. E-signature ---------- */

function SignatureCard({
  profile,
  onProfileChange,
}: {
  profile: ProfileRow;
  onProfileChange: (p: ProfileRow) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(profile.signature_name ?? "");
  const [busy, setBusy] = useState(false);

  const effective = name.trim() || displayName(profile);
  const dirty = (name.trim() || null) !== (profile.signature_name ?? null);

  const save = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .update({ signature_name: name.trim() || null } as any)
        .eq("id", profile.id)
        .select("*")
        .single();
      if (error) throw error;
      onProfileChange(data as ProfileRow);
      notifyProfileUpdated();
      toast.success(stamped("Signature saved"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't save — has migration 0043 been applied?"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-5 space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-700">E-signature</div>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
          Your full legal name, exactly as it should appear on Part 11 signatures.
          It prefills the attestation dialog — you still confirm every signature.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <L label="Legal name for signing">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={displayName(profile) || "Your legal name"}
          />
        </L>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
            Signature preview
          </div>
          <div className="font-serif italic text-lg text-slate-800 truncate">
            {effective || "—"}
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save signature"}
        </Button>
      </div>
    </Card>
  );
}

/* ---------- 4. Timezone & working hours ---------- */

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // 1..7

function PreferencesCard({
  profile,
  onProfileChange,
}: {
  profile: ProfileRow;
  onProfileChange: (p: ProfileRow) => void;
}) {
  const toast = useToast();
  const guess = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  })();
  const zones: string[] = (() => {
    try {
      return (Intl as any).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      return [];
    }
  })();

  const wh = profile.working_hours ?? null;
  const [tz, setTz] = useState(profile.timezone ?? "");
  const [start, setStart] = useState(wh?.start ?? "09:00");
  const [end, setEnd] = useState(wh?.end ?? "17:00");
  const [days, setDays] = useState<number[]>(wh?.days ?? [1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false);

  const dirty =
    (tz || null) !== (profile.timezone ?? null) ||
    start !== (wh?.start ?? "09:00") ||
    end !== (wh?.end ?? "17:00") ||
    days.join(",") !== (wh?.days ?? [1, 2, 3, 4, 5]).join(",");

  const toggleDay = (d: number) =>
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );

  const save = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .update({
          timezone: tz || null,
          working_hours: { start, end, days },
        } as any)
        .eq("id", profile.id)
        .select("*")
        .single();
      if (error) throw error;
      onProfileChange(data as ProfileRow);
      notifyProfileUpdated();
      toast.success(stamped("Preferences saved"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't save — has migration 0043 been applied?"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-5 space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-700">Timezone &amp; working hours</div>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
          Feeds workload and coverage views — so a 5pm-your-time task isn&rsquo;t
          assigned to someone who clocked out two hours ago.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <L label="Timezone">
          {zones.length > 0 ? (
            <Select value={tz} onChange={(e) => setTz(e.target.value)}>
              <option value="">— Not set {guess ? `(browser: ${guess})` : ""} —</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          ) : (
            <Input value={tz} onChange={(e) => setTz(e.target.value)} placeholder={guess || "America/Phoenix"} />
          )}
        </L>
        <L label="Day starts">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </L>
        <L label="Day ends">
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </L>
      </div>
      <div>
        <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Working days</div>
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((label, i) => {
            const d = i + 1;
            const on = days.includes(d);
            return (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                className={
                  "rounded-full px-3 py-1 text-xs font-semibold border transition " +
                  (on
                    ? "bg-brand-gradient text-white border-transparent shadow-sm"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </Card>
  );
}

/* ---------- shared label ---------- */

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
