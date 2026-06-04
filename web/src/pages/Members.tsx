import { friendlyError } from "../lib/errors";
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
  const [inviteEmail, setInviteEmail] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);
  const [sendingFor, setSendingFor] = useState<string | null>(null);

  const load = async () => {
    if (!orgId) return;
    setError(null);
    const { data: mems, error: e1 } = await supabase
      .from("org_members")
      .select("id, user_id, tier, access_role_id, created_at")
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
      toast.success(`${m.email}: access role → ${roleName}`);
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
      toast.success(`${m.email} is now ${next}`);
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
      toast.success(`Removed ${m.email}`);
      load();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't remove"));
    }
  };

  const inviteUrl = window.location.origin + window.location.pathname;

  if (memberLoading) {
    return <div className="max-w-4xl mx-auto px-6 py-8 text-sm text-slate-500">Checking permissions…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
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
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Configure"
        title="Members"
        subtitle="Everyone in your organization with access to Platypus. Promote members to admin, or remove access when teammates leave."
        actions={<Pill tone="brand">admin</Pill>}
      />

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

            <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
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
                <div
                  key={m.id}
                  className="px-4 py-3 border-b border-slate-100 last:border-b-0 grid grid-cols-[2fr_1.3fr_100px_160px_140px_70px_40px] gap-3 items-center"
                >
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
                  </div>
                  <div className="text-xs text-slate-700 truncate">
                    {m.title || <span className="italic text-slate-400">—</span>}
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    {new Date(m.created_at).toLocaleDateString()}
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
              );
            })}
          </Card>
        )}
      </div>

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
