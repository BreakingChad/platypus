import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import type { MemberTier } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
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

  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgOwnerId, setOrgOwnerId] = useState<string | null>(null);

  const load = async () => {
    if (!orgId) return;
    setError(null);
    const { data: mems, error: e1 } = await supabase
      .from("org_members")
      .select("id, user_id, tier, created_at")
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
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const changeTier = async (m: Member, next: MemberTier) => {
    if (m.user_id === orgOwnerId) {
      toast.error("Can't change the owner's tier from here");
      return;
    }
    if (m.user_id === currentUserId && next === "member") {
      if (!window.confirm("You're about to demote yourself to member. You'll lose admin access. Continue?")) return;
    }
    try {
      const { error } = await supabase
        .from("org_members")
        .update({ tier: next })
        .eq("id", m.id);
      if (error) throw error;
      toast.success(`${m.email} is now ${next}`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't update tier");
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
    if (!window.confirm(`Remove ${m.email} from the org? They'll keep their account but lose access.`)) return;
    try {
      const { error } = await supabase.from("org_members").delete().eq("id", m.id);
      if (error) throw error;
      toast.success(`Removed ${m.email}`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't remove");
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

      {/* INVITE PANEL */}
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
              Share the URL below. When your teammate signs up at Platypus, their account is
              created. Come back here and we'll add a quick join flow next phase — for now, ask
              them to share their email, then promote them once they appear in this list.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-white border border-slate-200 rounded-md px-3 py-2 truncate">
                {inviteUrl}
              </code>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteUrl);
                  toast.success("Link copied to clipboard");
                }}
              >
                <Icon name="external" size={12} /> Copy
              </Button>
            </div>
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
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[2fr_1.5fr_120px_140px_40px] gap-3 items-center text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              <span>Member</span>
              <span>Title</span>
              <span>Joined</span>
              <span>Tier</span>
              <span />
            </div>
            {members.map((m) => {
              const isThisOwner = m.user_id === orgOwnerId;
              const isMe = m.user_id === currentUserId;
              return (
                <div
                  key={m.id}
                  className="px-4 py-3 border-b border-slate-100 last:border-b-0 grid grid-cols-[2fr_1.5fr_120px_140px_40px] gap-3 items-center"
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
                    {isThisOwner ? (
                      <Pill tone="brand">owner</Pill>
                    ) : (
                      <select
                        value={m.tier}
                        onChange={(e) => changeTier(m, e.target.value as MemberTier)}
                        className="text-xs rounded border border-slate-200 px-2 py-1 bg-white font-semibold focus:outline-none focus:border-brand-500"
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                      </select>
                    )}
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
