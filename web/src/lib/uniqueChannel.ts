/** Generate a short random suffix to append to a channel name so each mount
 *  gets its own dedicated channel. Without this, supabase-js's behavior of
 *  returning the SAME channel instance for the same name can race with the
 *  effect cleanup, leaving the prior channel in `subscribed` state — at which
 *  point the next mount's `.on('postgres_changes', ...)` throws with:
 *
 *    cannot add `postgres_changes` callbacks for realtime:<name> after `subscribe()`
 *
 *  Usage:
 *    const channel = supabase
 *      .channel(uniqueChannelName(`study-${studyId}`))
 *      .on('postgres_changes', { ... }, handler)
 *      .subscribe();
 *
 *  Cleanup remains the same — supabase.removeChannel(channel).
 */
export function uniqueChannelName(base: string): string {
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
