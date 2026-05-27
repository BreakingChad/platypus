import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../auth/useAuth";

type Ctx = { orgId: string | null; loading: boolean };
const OrgContext = createContext<Ctx>({ orgId: null, loading: true });

/** Resolves the signed-in user's "current" org (default_org_id from profile,
 *  or the first org membership). Every page that needs org-scoped data reads
 *  from here. Lives outside <AuthGate> so signed-out state is also valid. */
export function OrgProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setOrgId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("default_org_id")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (profile?.default_org_id) {
        setOrgId(profile.default_org_id);
        setLoading(false);
        return;
      }
      const { data: mems } = await supabase
        .from("org_members")
        .select("org_id")
        .eq("user_id", userId)
        .limit(1);
      if (cancelled) return;
      setOrgId(mems?.[0]?.org_id ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return <OrgContext.Provider value={{ orgId, loading }}>{children}</OrgContext.Provider>;
}

export function useCurrentOrg() {
  return useContext(OrgContext);
}
