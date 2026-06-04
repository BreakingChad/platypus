import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { stamped } from "../lib/stamp";
import { fmtDate } from "../lib/dates";
import type { MemberTier, OrgInviteRow, OrgMemberRow, OrgRow, ProfileRow } from "../lib/types";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { MicroField } from "../components/ui/MicroField";
import { Loader } from "../components/ui/Loader";

/** PlatformConsole — the developer surface ABOVE orgs (Wave M).
 *
 *  Lives at #/platform, outside the org-scoped app shell entirely: its own
 *  address, its own chrome. Gated by public.platform_admins (seeded in SQL).
 *  Here you see every org, create new ones (the seed trigger gives them
 *  stages/fields/roles automatically), invite owners and staff, and step
 *  into an org as a developer.
 */

type OrgSummary = {
  org: OrgRow;
  members: (OrgMemberRow & { email: string })[];
  invites: OrgInviteRow[];
};

export function PlatformConsole({ onNavigate }: { onNavigate: (h: string) => void }) {
  const auth = useAuth();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [members, setMembers] = useState<(OrgMemberRow & { email: string })[]>([]);
  const [invites, setInvites] = useState<OrgInviteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: o }, { data: m }, { data: i }, { data: p }] = await Promise.all([
      supabase.from("orgs").select("*").order("created_at", { ascending: true }),
      supabase.from("org_members").select("*"),
      supabase.from("org_invites").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, email"),
    ]);
    const emailById: Record<string, string> = {};
    ((p ?? []) as Pick<ProfileRow, "id" | "email">[]).forEach((x) => (emailById[x.id] = x.email));
    setOrgs((o ?? []) as OrgRow[]);
    setMembers(((m ?? []) as OrgMemberRow[]).map((x) => ({ ...x, email: emailById[x.user_id] ?? "(unknown)" })));
    setInvites((i ?? []) as OrgInviteRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const ok = !!data;
      setAllowed(ok);
      if (ok) void load();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const summaries: OrgSummary[] = useMemo(
    () =>
      orgs.map((org) => ({
        org,
        members: members.filter((m) => m.org_id === org.id),
        invites: invites.filter((i) => i.org_id === org.id && !i.accepted_at),
      })),
    [orgs, members, invites]
  );

  /* ---------- actions ---------- */

  const [newOrg, setNewOrg] = useState({ name: "", prefix: "" });
  const createOrg = async () => {
    if (!newOrg.name.trim() || !userId) return;
    try {
      const { error } = await supabase.from("orgs").insert({
        name: newOrg.name.trim(),
        project_id_prefix: newOrg.prefix.trim().toUpperCase() || newOrg.name.trim().slice(0, 3).toUpperCase(),
        owner_id: userId,
      } as Partial<OrgRow> as any);
      if (error) throw error;
      toast.success(stamped(`Org "${newOrg.name.trim()}" created — stages, fields, and roles seeded`));
      setNewOrg({ name: "", prefix: "" });
      void load();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't create the org"));
    }
  };

  const invite = async (org: OrgRow, email: string, tier: MemberTier) => {
    const clean = email.trim().toLowerCase();
    if (!/.+@.+\..+/.test(clean)) {
      toast.error("That doesn't look like an email address");
      return;
    }
    try {
      // Existing user? Attach right now. Otherwise leave an invite for signup.
      const { data: prof } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", clean)
        .maybeSingle();
      if (prof?.id) {
        const { error } = await supabase
          .from("org_members")
          .insert({ org_id: org.id, user_id: (prof as any).id, tier } as any);
        if (error) throw error;
        toast.success(stamped(`${clean} added to ${org.name} as ${tier}`));
      } else {
        const { error } = await supabase
          .from("org_invites")
          .insert({ org_id: org.id, email: clean, tier, invited_by: userId } as any);
        if (error) throw error;
        toast.success(stamped(`Invite saved — ${clean} joins ${org.name} as ${tier} at first sign-in`));
      }
      void load();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't invite that person"));
    }
  };

  const revokeInvite = async (inv: OrgInviteRow) => {
    try {
      const { error } = await supabase.from("org_invites").delete().eq("id", inv.id);
      if (error) throw error;
      toast.success(stamped(`Invite for ${inv.email} revoked`));
      void load();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't revoke the invite"));
    }
  };

  const issueTempPassword = async (org: OrgRow, email: string, tier: MemberTier): Promise<string | null> => {
    const clean = email.trim().toLowerCase();
    if (!/.+@.+\..+/.test(clean)) {
      toast.error("That doesn't look like an email address");
      return null;
    }
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch("/api/admin-user", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ email: clean, orgId: org.id, tier }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error ?? `Request failed (${res.status})`);
      toast.success(stamped(`Temp password issued for ${clean} — they'll set their own at first sign-in`));
      void load();
      return out.tempPassword as string;
    } catch (e: any) {
      // The endpoint writes human errors — show them verbatim.
      toast.error(e?.message || "Couldn't issue a temp password");
      return null;
    }
  };

  const openAsDeveloper = async (org: OrgSummary) => {
    if (!userId) return;
    const already = org.members.some((m) => m.user_id === userId);
    if (!already) {
      if (
        !(await confirmDialog({
          title: "Join this org",
          message: `Join "${org.org.name}" as a developer? You'll appear in their member list (it's audit-honest — no invisible access).`,
          confirmLabel: "Join as developer",
        }))
      )
        return;
      const { error } = await supabase
        .from("org_members")
        .insert({ org_id: org.org.id, user_id: userId, tier: "developer" } as any);
      if (error) {
        toast.error(friendlyError(error, "Couldn't join the org"));
        return;
      }
    }
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ default_org_id: org.org.id } as any)
      .eq("id", userId);
    if (pErr) {
      toast.error(friendlyError(pErr, "Couldn't switch org"));
      return;
    }
    // Org context resolves at load — hard reload into the app.
    window.location.hash = "#/";
    window.location.reload();
  };

  /* ---------- gates ---------- */

  if (auth.status !== "signedIn") {
    return <Shell><div className="py-20 text-center text-sm text-slate-500">Sign in first, then come back to #/platform.</div></Shell>;
  }
  if (allowed === null) {
    return <Shell><div className="py-20"><Loader label="Checking platform access…" /></div></Shell>;
  }
  if (!allowed) {
    return (
      <Shell>
        <div className="max-w-md mx-auto mt-20 bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <Icon name="lock" size={22} className="mx-auto text-slate-400" />
          <h1 className="text-lg font-display font-bold text-slate-900 mt-3">Platform admins only</h1>
          <p className="text-sm text-slate-600 mt-2">
            This console manages every organization on the platform. Access is seeded in the
            database — ask the person who runs Platypus ({userEmail ? "not " + userEmail : "not you, apparently"}).
          </p>
          <Button className="mt-5" variant="primary" onClick={() => onNavigate("#/")}>Back to the app</Button>
        </div>
      </Shell>
    );
  }

  /* ---------- console ---------- */

  return (
    <Shell>
      <div className="flex items-end justify-between gap-6 mb-8">
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">Platform console</div>
          <h1 className="text-3xl font-display font-extrabold tracking-tight text-slate-900">Organizations</h1>
          <p className="text-slate-600 mt-2 max-w-2xl">
            Every org on the platform. Create one, invite its owner, and step inside as a
            developer when they need you. New orgs are seeded with stages, fields, and roles
            automatically.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onNavigate("#/")}>
          <Icon name="arrow-right" size={12} /> Back to the app
        </Button>
      </div>

      {/* create org */}
      <div className="bg-white rounded-xl border-2 border-brand-100 p-4 mb-8">
        <div className="text-xs font-bold text-brand-700 uppercase tracking-wider mb-3">New organization</div>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3 items-end">
          <MicroField label="Organization name">
            <Input
              value={newOrg.name}
              onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && newOrg.name.trim()) void createOrg(); }}
              placeholder="e.g. Banner Health Research"
            />
          </MicroField>
          <MicroField label="Study code prefix">
            <Input
              value={newOrg.prefix}
              onChange={(e) => setNewOrg({ ...newOrg, prefix: e.target.value.toUpperCase() })}
              placeholder="e.g. BAN"
              maxLength={6}
            />
          </MicroField>
          <Button variant="primary" onClick={() => void createOrg()} disabled={!newOrg.name.trim()}>
            + Create org
          </Button>
        </div>
      </div>

      {loading && <Loader label="Loading organizations…" />}

      <div className="space-y-4">
        {summaries.map((s) => (
          <OrgCard
            key={s.org.id}
            summary={s}
            meId={userId}
            onInvite={(email, tier) => void invite(s.org, email, tier)}
            onTempPassword={(email, tier) => issueTempPassword(s.org, email, tier)}
            onRevoke={(inv) => void revokeInvite(inv)}
            onOpen={() => void openAsDeveloper(s)}
          />
        ))}
      </div>

      <p className="text-xs text-slate-500 mt-8 max-w-2xl leading-relaxed">
        Invites attach at first sign-in: send the person the app link ({window.location.origin}
        {window.location.pathname}) and they land in their org automatically with the tier you
        chose. People who already have an account are added immediately.
      </p>
    </Shell>
  );
}

/* ---------- pieces ---------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#faf8f4]">
      <header className="border-b border-slate-200 bg-white">
        <div className="px-4 md:px-8 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white font-display font-extrabold">
            P
          </div>
          <div>
            <div className="font-display font-extrabold text-slate-900 leading-tight">Platypus</div>
            <div className="text-[11px] text-slate-500 leading-tight">platform console</div>
          </div>
          <Pill tone="dev">developer</Pill>
        </div>
      </header>
      <main className="px-4 md:px-8 2xl:px-12 py-8">{children}</main>
    </div>
  );
}

function OrgCard({
  summary,
  meId,
  onInvite,
  onTempPassword,
  onRevoke,
  onOpen,
}: {
  summary: OrgSummary;
  meId: string | null;
  onInvite: (email: string, tier: MemberTier) => void;
  onTempPassword: (email: string, tier: MemberTier) => Promise<string | null>;
  onRevoke: (inv: OrgInviteRow) => void;
  onOpen: () => void;
}) {
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const { org, members, invites } = summary;
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<MemberTier>("owner");
  const amMember = members.some((m) => m.user_id === meId);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-slate-400 hover:text-slate-900"
          aria-label={expanded ? "Collapse org" : "Expand org"}
        >
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
        </button>
        <Icon name="building" size={16} className="text-slate-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 truncate">{org.name}</span>
            {org.project_id_prefix && (
              <span className="text-[11px] font-mono text-slate-400">{org.project_id_prefix}-•••</span>
            )}
            <Pill tone={org.sponsor_mode === "sponsor" ? "info" : "neutral"}>{org.sponsor_mode ?? "site"}</Pill>
          </div>
          <div className="text-[11px] text-slate-500">
            {members.length} member{members.length === 1 ? "" : "s"}
            {invites.length > 0 ? ` · ${invites.length} pending invite${invites.length === 1 ? "" : "s"}` : ""}
            {" · created "}{fmtDate(org.created_at)}
          </div>
        </div>
        <Button size="sm" variant={amMember ? "primary" : "secondary"} onClick={onOpen}>
          {amMember ? "Open" : "Join as developer"}
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          {/* members */}
          <div>
            <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Members</div>
            <div className="flex flex-wrap gap-1.5">
              {members.length === 0 && <span className="text-xs text-slate-400 italic">Nobody yet — invite the owner below.</span>}
              {members.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                  {m.email}
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{m.tier}</span>
                </span>
              ))}
            </div>
          </div>

          {/* pending invites */}
          {invites.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Pending invites</div>
              <div className="flex flex-wrap gap-1.5">
                {invites.map((inv) => (
                  <span key={inv.id} className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800">
                    {inv.email}
                    <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500">{inv.tier}</span>
                    <button
                      onClick={() => onRevoke(inv)}
                      className="text-amber-400 hover:text-red-600 leading-none"
                      aria-label={`Revoke invite for ${inv.email}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* invite */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <MicroField label="Invite by email">
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && email.trim()) {
                      onInvite(email, tier);
                      setEmail("");
                    }
                  }}
                  placeholder="owner@theirsite.org"
                />
              </MicroField>
            </div>
            <Select value={tier} onChange={(e) => setTier(e.target.value as MemberTier)} className="w-36" aria-label="Tier for the invitee">
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="developer">Developer</option>
            </Select>
            <Button
              size="sm"
              onClick={() => {
                if (email.trim()) {
                  onInvite(email, tier);
                  setEmail("");
                }
              }}
              disabled={!email.trim()}
            >
              Invite
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Email down or rate-limited? Create the account directly with a temporary password — they're forced to set their own and confirm their details at first sign-in."
              onClick={async () => {
                if (!email.trim()) return;
                const pw = await onTempPassword(email, tier);
                if (pw) {
                  setIssued({ email: email.trim().toLowerCase(), password: pw });
                  setEmail("");
                }
              }}
              disabled={!email.trim()}
            >
              Temp password
            </Button>
          </div>

          {issued && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1 text-xs text-amber-900">
                <strong>{issued.email}</strong> can sign in with{" "}
                <code className="font-mono bg-white border border-amber-200 rounded px-1.5 py-0.5">{issued.password}</code>
                {" "}— shown once, send it over a secure channel. First sign-in forces a reset + identity confirmation.
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issued.password);
                  } catch { /* clipboard unavailable */ }
                }}
              >
                Copy
              </Button>
              <button
                onClick={() => setIssued(null)}
                className="text-amber-400 hover:text-red-600 leading-none text-lg"
                aria-label="Dismiss temp password"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
