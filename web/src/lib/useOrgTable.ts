import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { uniqueChannelName } from "./uniqueChannel";
import { useCurrentOrg } from "./OrgContext";
import { friendlyError } from "./errors";

type Opts = {
  /** Postgrest select() expression. Default "*". */
  select?: string;
  /** Single column to order by. */
  orderBy?: string;
  ascending?: boolean;
  /** Subscribe to realtime changes on this org_id slice of the table. */
  realtime?: boolean;
};

/**
 * Supabase-backed table hook. Replaces the demo app's usePersisted.
 *
 * - Scopes every query to the current org (RLS does the security; the explicit
 *   .eq("org_id", orgId) makes the intent obvious).
 * - Returns rows + loading/error + insert/update/remove + refresh.
 * - Optional realtime subscription; default off.
 *
 * The Supabase client is typed against a fixed table-name union, but this
 * hook is intentionally generic. We cast at the boundary so callers get
 * fully-typed rows via the T generic while the internals stay flexible.
 *
 * Usage:
 *   const { rows, update } = useOrgTable<FieldDef>("field_definitions",
 *     { orderBy: "position", realtime: true });
 */
export function useOrgTable<T extends { id: string }>(
  table: string,
  opts: Opts = {}
) {
  const { orgId, loading: orgLoading } = useCurrentOrg();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sb: any = supabase;

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    let q = sb.from(table).select(opts.select ?? "*").eq("org_id", orgId);
    if (opts.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending ?? true });
    const { data, error } = await q;
    if (error) {
      setError(friendlyError(error, "Couldn't load this list"));
      setLoading(false);
      return;
    }
    setError(null);
    setRows((data ?? []) as unknown as T[]);
    setLoading(false);
  }, [orgId, table, opts.select, opts.orderBy, opts.ascending, sb]);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    void refresh();
  }, [orgId, orgLoading, refresh]);

  // Realtime subscription — re-fetches on any change to this org's slice.
  useEffect(() => {
    if (!orgId || !opts.realtime) return;
    const ch = sb
      .channel(uniqueChannelName(`${table}:${orgId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `org_id=eq.${orgId}` },
        () => {
          void refresh();
        }
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [orgId, table, opts.realtime, refresh, sb]);

  const insert = async (row: Partial<T>) => {
    if (!orgId) return null;
    const { data, error } = await sb
      .from(table)
      .insert({ ...row, org_id: orgId })
      .select()
      .single();
    if (error) {
      setError(friendlyError(error, "Couldn't add that"));
      return null;
    }
    await refresh();
    return data as T;
  };

  const update = async (id: string, patch: Partial<T>) => {
    const { error } = await sb.from(table).update(patch).eq("id", id);
    if (error) {
      setError(friendlyError(error, "That change didn't save"));
      return;
    }
    await refresh();
  };

  const remove = async (id: string) => {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) {
      setError(friendlyError(error, "That change didn't save"));
      return;
    }
    await refresh();
  };

  return { rows, loading, error, insert, update, remove, refresh };
}
