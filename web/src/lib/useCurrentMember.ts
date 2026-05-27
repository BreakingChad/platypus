import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "./OrgContext";
import type { MemberTier } from "./types";

/** Resolves the signed-in user's membership tier for the current org.
 *  isAdmin = owner OR admin. Returns null tier while loading or for non-members. */
export function useCurrentMember() {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const userId = auth.status === "signedIn" ? auth.user.id : null;

  const [tier, setTier] = useState<MemberTier | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || !orgId) {
      setTier(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("org_members")
        .select("tier")
        .eq("user_id", userId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (cancelled) return;
      setTier((data?.tier as MemberTier) ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, orgId]);

  return {
    tier,
    loading,
    isOwner: tier === "owner",
    isDeveloper: tier === "developer",
    // Developer is a superset of admin — anything that gates on isAdmin remains true.
    isAdmin: tier === "owner" || tier === "admin" || tier === "developer",
    isMember: tier !== null,
  };
}
