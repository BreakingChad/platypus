import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "./OrgContext";
import { useCurrentMember } from "./useCurrentMember";
import {
  DEFAULT_NAV,
  resolveNav,
  resolvePageLayout,
  type NavGroupConfig,
  type PageBlockConfig,
  type PageLayoutsConfig,
} from "./navConfig";

/** Hook that loads the current user's effective nav + page-layout config.
 *
 *  Lookup chain:
 *    1. org_members row for (this org, this user) → access_role_id
 *    2. access_roles row for that id → nav (jsonb), page_layouts (jsonb)
 *    3. Empty config falls back to the system DEFAULT_NAV / per-page defaults
 *
 *  Subscribes to realtime updates on both rows so any admin edit applied in
 *  the designer is reflected immediately in the live UI of every signed-in
 *  user.
 */
export function useResolvedConfig() {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin } = useCurrentMember();
  const userId = auth.status === "signedIn" ? auth.user.id : null;

  const [memberRow, setMemberRow] = useState<{
    access_role_id: string | null;
  } | null>(null);
  const [navConfig, setNavConfig] = useState<NavGroupConfig[] | null>(null);
  const [pageLayouts, setPageLayouts] = useState<PageLayoutsConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // STEP 1: load org_member.access_role_id for the current user.
  useEffect(() => {
    if (!userId || !orgId) {
      setMemberRow(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("org_members")
        .select("access_role_id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!cancelled) setMemberRow((data as any) ?? { access_role_id: null });
    })();

    // Subscribe to changes on this member row (admin reassigning my role).
    const channel = supabase
      .channel(`member-config-${userId}-${orgId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "org_members",
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          if (!cancelled && payload.new?.org_id === orgId) {
            setMemberRow({
              access_role_id: payload.new.access_role_id ?? null,
            });
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId, orgId]);

  // STEP 2: when we know the access_role_id, load that row's nav + layouts.
  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const accessRoleId = memberRow?.access_role_id ?? null;

    let cancelled = false;
    (async () => {
      if (!accessRoleId) {
        // No assigned role — use defaults everywhere.
        if (!cancelled) {
          setNavConfig(null);
          setPageLayouts(null);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase
        .from("access_roles")
        .select("nav, page_layouts")
        .eq("id", accessRoleId)
        .maybeSingle();
      if (cancelled) return;
      setNavConfig((data as any)?.nav ?? null);
      setPageLayouts((data as any)?.page_layouts ?? null);
      setLoading(false);
    })();

    if (!accessRoleId) return;

    // Subscribe to changes on this access role (admin edits the designer).
    const channel = supabase
      .channel(`access-role-${accessRoleId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "access_roles",
          filter: `id=eq.${accessRoleId}`,
        },
        (payload: any) => {
          if (!cancelled) {
            setNavConfig(payload.new?.nav ?? null);
            setPageLayouts(payload.new?.page_layouts ?? null);
          }
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [orgId, memberRow?.access_role_id]);

  // Resolve into the final shapes used by the UI.
  const navGroups = useMemo(
    () => resolveNav(navConfig, { isAdmin }),
    [navConfig, isAdmin]
  );

  const layoutFor = (pageKey: string): PageBlockConfig[] =>
    resolvePageLayout(pageKey, pageLayouts as PageLayoutsConfig);

  return {
    loading,
    accessRoleId: memberRow?.access_role_id ?? null,
    navGroups,                   // resolved & permission-gated nav
    rawNavConfig: navConfig,     // raw value (or null if default)
    pageLayouts,                 // raw page layouts (or null)
    layoutFor,                   // resolves per-page layout w/ default fallback
  };
}

// Re-export for convenience
export { DEFAULT_NAV };
