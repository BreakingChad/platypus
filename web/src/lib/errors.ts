/** friendlyError — translate raw Supabase/Postgres failures into sentences a
 *  coordinator can act on. The raw message goes to the console for debugging;
 *  users never see engine text like "violates row-level security policy".
 */
export function friendlyError(e: unknown, fallback: string): string {
  const raw = String((e as any)?.message ?? (e as any)?.error_description ?? e ?? "");
  if (raw) console.warn("[platypus]", raw);
  const m = raw.toLowerCase();

  if (m.includes("row-level security") || m.includes("permission denied") || m.includes("not authorized"))
    return "You don't have permission to do that — ask an org admin.";
  if (m.includes("duplicate key") || m.includes("already exists") || m.includes("unique constraint"))
    return "That name or code is already in use — pick something unique.";
  if (m.includes("jwt") || m.includes("token") || m.includes("expired") || m.includes("refresh"))
    return "Your session expired — sign in again and retry.";
  if (m.includes("violates foreign key"))
    return "Something this depends on was removed — refresh and try again.";
  if (m.includes("violates not-null") || m.includes("null value in column"))
    return "A required field is missing — fill everything marked required.";
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("load failed") || m.includes("timeout"))
    return "Couldn't reach the server — check your connection and retry.";
  if (m.includes("payload too large") || m.includes("exceeded the maximum allowed size"))
    return "That file is too large to upload.";
  if (m.includes("invalid input syntax"))
    return "One of the values isn't in the right format — check dates and numbers.";
  if (m.includes("storage") && m.includes("not found"))
    return "That file couldn't be found — it may have been removed.";

  return fallback;
}
