import { friendlyError } from "../lib/errors";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import type { OrgInviteRow } from "../lib/types";
import { Select } from "../components/ui/Select";
import { fmtDate } from "../lib/dates";
import { confirmDialog } from "../lib/confirm";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";
import type { MemberTier } from "../lib/types";
import { Card } from "../components/ui/Card";
import { AutoSaveNote } from "../components/ui/AutoSaveNote";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Input } from "../components/ui/Input";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** Members — admin-only.
 *
 *  Lists every signed-up member of the current org with their tier and
 *  profile info. Admins can promote / demote (member ↔ admin) — the org
 *  owner is immutable from here. Admins can also remove members (other
 *  than the owner or themselves).
 *
 *  Invitation flow: since we don't have service_role server-side yet, we
 *  surface a shareable URL: anyone who signs up at the app gets their own
 *  default org. To join *this* org, an admin still needs to add them after
 *  they sign up (manual link below the list).
 */

type Member = {
  id: string;            // org_members.id
  user_id: string;
  tier: MemberTier;
  access_role_id: string | null;
  site_ids: string[];
  therapeutic_areas: string[];
  created_at: string;
  email: string;
  full_name: string | null;
  title: string | null;
};

export function Members() {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin, isOwner, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const currentUserId = auth.status === "signedIn" ? auth.user.id : null;
  const currentUserEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgOwnerId, setOrgOwnerId] = useState<string | null>(null);
  const [accessRoles, setAccessRoles] = useState<{ id: string; name: string }[]>([]);
  const [orgSites, setOrgSites] = useState<{ id: string; name: string }[]>([]);
  const [taSuggestions, setTaSuggestions] = useState<string[]>([]);
  const [scopeOpenId, setScopeOpenId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTier, setInviteTier] = useState<"member" | "admin">("member");
  const [pendingInvites, setPendingInvites] = useState<OrgInviteRow[]>([]);
  const loadInvites = async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("org_invites")
      .select("*")
      .eq("org_id", orgId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    setPendingInvites((data ?? []) as OrgInviteRow[]);
  };
  useEffect(() => {
    void loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [sendingFor, setSendingFor] = useState<string | null>(null);

  const load = async () => {
    if (!orgId) return;
    setError(null);
    const { data: mems, error: e1 } = await supabase
      .from("org_members")
      .select("id, user_id, tier, access_role_id, site_ids, therapeutic_areas, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });
    if (e1) {
      setError(e1.message);
      return;
    }
    const ids = (mems ?? []).map((m: any) => m.user_id);
    let profs: any[] = [];
    if (ids.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, full_name, title")
        .in("id", ids);
      profs = data ?? [];
    }
    const byId: Record<string, any> = {};
    profs.forEach((p) => (byId[p.id] = p));
    const enriched: Member[] = (mems ?? []).map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      tier: m.tier,
      access_role_id: m.access_role_id ?? null,
      site_ids: (m.site_ids ?? []) as string[],
      therapeutic_areas: (m.therapeutic_areas ?? []) as string[],
      created_at: m.created_at,
      email: byId[m.user_id]?.email ?? "(unknown)",
      full_name: byId[m.user_id]?.full_name ?? null,
      title: byId[m.user_id]?.title ?? null,
    }));
    setMembers(enriched);

    // owner_id
    const { data: orgRow } = await supabase
      .from("orgs")
      .select("owner_id")
      .eq("id", orgId)
      .maybeSingle();
    setOrgOwnerId((orgRow as any)?.owner_id ?? null);

    // access_roles for the assignment dropdown
    const { data: roles } = await supabase
      .from("access_roles")
      .select("id, name")
      .eq("org_id", orgId)
      .order("name", { ascending: true });
    setAccessRoles((roles ?? []) as any);

    // sites + distinct therapeutic areas for the per-member scope editor
    const { data: siteRows } = await supabase
      .from("sites")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("status", "active")
      .order("name", { ascending: true });
    setOrgSites((siteRows ?? []) as any);
    const { data: taRows } = await supabase
      .from("studies")
      .select("therapeutic_area")
      .eq("org_id", orgId);
    const tas = Array.from(
      new Set((taRows ?? []).map((r: any) => (r.therapeutic_area ?? "").trim()).filter(Boolean))
    ).sort();
    setTaSuggestions(tas as string[]);
  };

  const saveScope = async (m: Member, patch: { site_ids?: string[]; therapeutic_areas?: string[] }) => {
    try {
      const { error } = await supabase.from("org_members").update(patch as any).eq("id", m.id);
      if (error) throw error;
      if (orgId && currentUserId) {
        void writeAuditEvent({
          orgId, actorId: currentUserId, actorEmail: currentUserEmail,
          entityType: "member", entityId: m.id, action: "scope_changed",
          payload: { target_email: m.email, ...patch },
        });
      }
      toast.success(stamped(`${m.email}: scope updated`));
      load();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't update scope"));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const changeAccessRole = async (m: Member, next: string | null) => {
    try {
      const { error } = await supabase
        .from("org_members")
        .update({ access_role_id: next })
        .eq("id", m.id);
      if (error) throw error;
      const roleName = accessRoles.find((r) => r.id === next)?.name || "(none)";
      if (orgId && currentUserId) {
        void writeAuditEvent({
          orgId, actorId: currentUserId, actorEmail: currentUserEmail,
          entityType: "member", entityId: m.id,
          action: "access_role_changed",
          payload: {
            target_email: m.email,
            from: m.access_role_id,
            to: next,
            to_label: roleName,
          },
        });
      }
      toast.success(stamped(`${m.email}: access role → ${roleName}`));
      load();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't change access role"));
    }
  };

  /** Send a magic-link to the given email. If the email is new it creates
   *  an auth.user on first click; the handle_new_user trigger then joins
   *  them to the shared org as 'member'. If the email already exists, this
   *  acts as a sign-in / "magic link reset" — same flow, different effect. */
  const sendMagicLink = async (email: string, kind: "invite" | "signin"): Promise<boolean> => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/.+@.+\..+/.test(trimmed)) {
      toast.error("Enter a valid email");
      return false;
    }
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
        },
      });
      if (error) throw error;
      toast.success(
        kind === "invite"
          ? `Invite link sent to ${trimmed}`
          : `Sign-in link sent to ${trimmed}`
      );
      return true;
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't send magic link"));
      return false;
    }
  };

  const sendInvite = async () => {
    setSendingInvite(true);
    const ok = await sendMagicLink(inviteEmail, "invite");
    if (ok && orgId) {
      // Record the invite: gives it visible status here, and routes the
      // signup into THIS org at the chosen tier (0023 trigger).
      const { error } = await supabase.from("org_invites").upsert(
        {
          org_id: orgId,
          email: inviteEmail.trim().toLowerCase(),
          tier: inviteTier,
        } as any,
        { onConflict: "org_id,email" }
      );
      if (!error) void loadInvites();
    }
    setSendingInvite(false);
    if (ok) setInviteEmail("");
  };

  const sendSignInLink = async (m: Member) => {
    setSendingFor(m.id);
    await sendMagicLink(m.email, "signin");
    setSendingFor(null);
  };

  const changeTier = async (m: Member, next: MemberTier) => {
    if (m.user_id === orgOwnerId) {
      toast.error("Can't change the owner's tier from here");
      return;
    }
    if (m.user_id === currentUserId && next === "member") {
      if (!(await confirmDialog({ title: "Demote yourself?", message: "You're about to demote yourself to member. You'll lose admin access.", confirmLabel: "Demote", danger: true }))) return;
    }
    if (m.user_id === currentUserId && m.tier === "developer" && next !== "developer") {
      if (!(await confirmDialog({ title: "Drop developer tier?", message: "You're about to drop your developer tier. You'll lose dev-level access.", confirmLabel: "Continue", danger: true }))) return;
    }
    try {
      const { error } = await supabase
        .from("org_members")
        .update({ tier: next })
        .eq("id", m.id);
      if (error) throw error;
      if (orgId && currentUserId) {
        void writeAuditEvent({
          orgId, actorId: currentUserId, actorEmail: currentUserEmail,
          entityType: "member", entityId: m.id,
          action: "tier_changed",
          payload: { target_email: m.email, from: m.tier, to: next },
        });
      }
      toast.success(stamped(`${m.email} is now ${next}`));
      load();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't update tier"));
    }
  };

  const removeMember = async (m: Member) => {
    if (m.user_id === orgOwnerId) {
      toast.error("Can't remove the org owner");
      return;
    }
    if (m.user_id === currentUserId) {
      toast.error("Use sign-out instead of removing yourself");
      return;
    }
    if (!(await confirmDialog({ title: "Remove member", message: `Remove ${m.email} from the org? They'll keep their account but lose access.`, confirmLabel: "Remove", danger: true }))) return;
    try {
      const { error } = await supabase.from("org_members").delete().eq("id", m.id);
      if (error) throw error;
      if (orgId && currentUserId) {
        void writeAuditEvent({
          orgId, actorId: currentUserId, actorEmail: currentUserEmail,
          entityType: "member", entityId: m.id,
          action: "member_removed",
          payload: { target_email: m.email, target_user_id: m.user_id },
        });
      }
      toast.success(stamped(`Removed ${m.email}`));
      load();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't remove"));
    }
  };

  const inviteUrl = window.location.origin + window.location.pathname;

  if (memberLoading) {
    return <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8 text-sm text-slate-500"><Loader label="Checking permissions…" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Members" />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can manage members."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Members"
        subtitle="Everyone in your organization with access to Platypus. Promote members to admin, or remove access when teammates leave."
        actions={<Pill tone="brand">admin</Pill>}
      />
      <AutoSaveNote />

      {/* INVITE PANEL — two-action: send by email OR share link */}
      <Card primary className="mt-6">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
            <Icon name="plus" size={16} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-display font-bold text-slate-900">
              Invite teammates
            </div>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              Send a magic-link invite straight to their inbox. They click it, sign in, and they
              automatically join this organization as a member — you can promote them right
              here once they appear.
            </p>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-center">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && inviteEmail.trim()) void sendInvite();
                }}
                placeholder="teammate@example.com"
                autoComplete="off"
              />
              <Select
                value={inviteTier}
                onChange={(e) => setInviteTier(e.target.value as "member" | "admin")}
                className="w-32"
                aria-label="Tier for the invitee"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
              <Button
                variant="primary"
                onClick={() => void sendInvite()}
                disabled={!inviteEmail.trim() || sendingInvite}
              >
                {sendingInvite ? "Sending…" : "Send invite"}
              </Button>
            </div>

            {/* Fallback: shareable link for environments where email isn't set up */}
            <details className="mt-3 group">
              <summary className="text-[11px] font-semibold text-slate-500 cursor-pointer hover:text-slate-900 inline-flex items-center gap-1">
                Prefer a shareable link?
                <Icon name="chevron-down" size={11} className="group-open:rotate-180 transition" />
              </summary>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-white border border-slate-200 rounded-md px-3 py-2 truncate">
                  {inviteUrl}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteUrl);
                    toast.success("Link copied to clipboard");
                  }}
                >
                  <Icon name="external" size={11} /> Copy
                </Button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                Share this with anyone — when they sign up at Platypus their account is created
                automatically and they're attached to this organization as a member.
              </p>
            </details>
          </div>
        </div>
      </Card>

      {/* LIST */}
      <div className="mt-6">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
            <strong>Error:</strong> {error}
          </div>
        )}

        {members === null && (
          <div className="text-sm text-slate-500">Loading members…</div>
        )}

        {members && members.length === 0 && (
          <Card>
            <EmptyState
              iconName="users"
              title="No members"
              sub="That shouldn't happen — every org has at least its owner."
            />
          </Card>
        )}

        {members && members.length > 0 && (
          <Card flush>
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[2fr_1.3fr_100px_160px_140px_70px_40px] gap-3 items-center text-[11px] uppercase tracking-wider text-slate-500 font-bold">
              <span>Member</span>
              <span>Title</span>
              <span>Joined</span>
              <span>Access role</span>
              <span>Tier</span>
              <span>Action</span>
              <span />
            </div>
            {members.map((m) => {
              const isThisOwner = m.user_id === orgOwnerId;
              const isMe = m.user_id === currentUserId;
              return (
                <div key={m.id} className="border-b border-slate-100 last:border-b-0">
                  <div className="px-4 py-3 grid grid-cols-[2fr_1.3fr_100px_160px_140px_70px_40px] gap-3 items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-brand-gradient text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                        {(m.full_name || m.email)[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {m.full_name || m.email}
                          {isMe && (
                            <span className="ml-1 text-[10px] font-mono text-slate-400 uppercase">
                              you
                            </span>
                          )}
                        </div>
                        {m.full_name && (
                          <div className="text-[11px] text-slate-500 truncate">
                            {m.email}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setScopeOpenId(scopeOpenId === m.id ? null : m.id)}
                      className="mt-1.5 ml-9 text-[11px] text-slate-500 hover:text-brand-700 inline-flex items-center gap-1"
                      title="Set which sites and therapeutic areas this member is scoped to"
                    >
                      <Icon name={scopeOpenId === m.id ? "chevron-down" : "chevron-right"} size={11} />
                      Scope: {(m.site_ids.length === 0 && m.therapeutic_areas.length === 0)
                        ? "all sites · all areas"
                        : `${m.site_ids.length || "all"} site${m.site_ids.length === 1 ? "" : "s"} · ${m.therapeutic_areas.length || "all"} area${m.therapeutic_areas.length === 1 ? "" : "s"}`}
                    </button>
                  </div>
                  <div className="text-xs text-slate-700 truncate">
                    {m.title || <span className="italic text-slate-400">—</span>}
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    {fmtDate(m.created_at)}
                  </div>
                  <div>
                    <select
                      value={m.access_role_id ?? ""}
                      onChange={(e) => changeAccessRole(m, e.target.value || null)}
                      className="text-xs rounded border border-slate-200 px-2 py-1 bg-white font-semibold focus:outline-none focus:border-brand-500 w-full"
                    >
                      <option value="">— Unassigned —</option>
                      {accessRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 items-start">
                    {isThisOwner && <Pill tone="brand">owner</Pill>}
                    {m.tier === "developer" ? (
                      <select
                        value={m.tier}
                        onChange={(e) => changeTier(m, e.target.value as MemberTier)}
                        className="text-xs rounded border border-violet-200 px-2 py-1 bg-gradient-to-r from-fuchsia-50 to-violet-50 text-violet-700 font-semibold focus:outline-none focus:border-violet-500"
                        title="Developer is a superset of admin"
                      >
                        <option value="developer">developer</option>
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                      </select>
                    ) : (
                      <select
                        value={m.tier}
                        onChange={(e) => changeTier(m, e.target.value as MemberTier)}
                        className="text-xs rounded border border-slate-200 px-2 py-1 bg-white font-semibold focus:outline-none focus:border-brand-500"
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="developer">developer</option>
                      </select>
                    )}
                  </div>
                  <div className="text-center">
                    <button
                      onClick={() => void sendSignInLink(m)}
                      disabled={sendingFor === m.id}
                      title={`Send a magic sign-in link to ${m.email}`}
                      className="text-[11px] font-semibold px-1.5 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sendingFor === m.id ? "…" : "Send link"}
                    </button>
                  </div>
                  <div className="text-center">
                    {isThisOwner || isMe ? (
                      <span
                        title={
                          isThisOwner ? "Owner can't be removed" : "Use sign-out instead"
                        }
                        className="text-slate-300 inline-flex"
                      >
                        <Icon name="lock" size={12} />
                      </span>
                    ) : (
                      <button
                        onClick={() => removeMember(m)}
                        className="text-slate-400 hover:text-red-600 transition text-lg leading-none"
                        title="Remove member"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  </div>
                  {scopeOpenId === m.id && (
                    <MemberScopePanel
                      m={m}
                      sites={orgSites}
                      taSuggestions={taSuggestions}
                      onSaveSites={(ids) => void saveScope(m, { site_ids: ids })}
                      onSaveTAs={(tas) => void saveScope(m, { therapeutic_areas: tas })}
                    />
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </div>

      {pendingInvites.length > 0 && (
        <Card flush className="mt-4 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">Pending invites</span>
            <Pill tone="warning">{pendingInvites.length} awaiting first sign-in</Pill>
          </div>
          {pendingInvites.map((inv) => (
            <div
              key={inv.id}
              className="px-4 py-2.5 border-b border-slate-100 last:border-b-0 grid grid-cols-[1fr_110px_160px_90px] gap-3 items-center"
            >
              <span className="text-sm text-slate-900 truncate">{inv.email}</span>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{inv.tier}</span>
              <span className="text-[11px] font-mono text-slate-500">invited {fmtDate(inv.created_at)}</span>
              <button
                onClick={async () => {
                  const { error } = await supabase.from("org_invites").delete().eq("id", inv.id);
                  if (error) toast.error(friendlyError(error, "Couldn't revoke the invite"));
                  else {
                    toast.success(stamped(`Invite for ${inv.email} revoked`));
                    void loadInvites();
                  }
                }}
                className="justify-self-end text-xs font-semibold text-slate-400 hover:text-red-600 transition"
              >
                Revoke
              </button>
            </div>
          ))}
        </Card>
      )}

      <p className="text-xs text-slate-500 mt-6 leading-relaxed max-w-3xl">
        <strong>Owners</strong> are the org's ultimate authority — exactly one per org, set at
        signup. <strong>Admins</strong> can change settings, manage members, configure
        workflows, and edit any study. <strong>Members</strong> have access scoped by their
        access role (see Access roles).
        {!isOwner && (
          <span className="block mt-2 italic">
            You're signed in as an admin. Only the owner can promote others to owner.
          </span>
        )}
      </p>
    </div>
  );
}

/* ---------- per-member scope editor (sites + therapeutic areas) ---------- */
function MemberScopePanel({
  m, sites, taSuggestions, onSaveSites, onSaveTAs,
}: {
  m: Member;
  sites: { id: string; name: string }[];
  taSuggestions: string[];
  onSaveSites: (ids: string[]) => void;
  onSaveTAs: (tas: string[]) => void;
}) {
  const [taInput, setTaInput] = useState("");
  const toggleSite = (id: string) =>
    onSaveSites(m.site_ids.includes(id) ? m.site_ids.filter((x) => x !== id) : [...m.site_ids, id]);
  const addTA = (t: string) => {
    const v = t.trim();
    if (!v || m.therapeutic_areas.includes(v)) return;
    onSaveTAs([...m.therapeutic_areas, v]);
    setTaInput("");
  };
  const removeTA = (t: string) => onSaveTAs(m.therapeutic_areas.filter((x) => x !== t));
  const remaining = taSuggestions.filter((t) => !m.therapeutic_areas.includes(t));
  return (
    <div className="px-4 pb-4 pt-1 bg-slate-50/60 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100">
      <div>
        <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
          Sites <span className="font-normal text-slate-400">— none selected = all sites</span>
        </div>
        {sites.length === 0 ? (
          <p className="text-[11px] text-slate-400 italic">No sites yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {sites.map((s) => {
              const on = m.site_ids.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleSite(s.id)}
                  className={"text-[11px] rounded-full border px-2.5 py-1 transition " + (on ? "border-brand-400 bg-brand-50 text-brand-800 font-semibold" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}
                >
                  {on ? "✓ " : ""}{s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
          Therapeutic areas <span className="font-normal text-slate-400">— none = all areas</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {m.therapeutic_areas.length === 0 && <span className="text-[11px] text-slate-400 italic">All areas</span>}
          {m.therapeutic_areas.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-200 text-brand-800 text-[11px] px-2 py-0.5">
              {t}
              <button onClick={() => removeTA(t)} className="hover:text-red-600" aria-label={`Remove ${t}`}>×</button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            list={`ta-${m.id}`}
            value={taInput}
            onChange={(e) => setTaInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addTA(taInput); }}
            placeholder="Add area…"
            className="text-xs border border-slate-200 rounded px-2 py-1 w-44 outline-none focus:border-brand-300"
          />
          <datalist id={`ta-${m.id}`}>
            {remaining.map((t) => <option key={t} value={t} />)}
          </datalist>
          <button onClick={() => addTA(taInput)} disabled={!taInput.trim()} className="text-[11px] font-semibold text-brand-700 disabled:text-slate-300">add</button>
        </div>
      </div>
    </div>
  );
}
