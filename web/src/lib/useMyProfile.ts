import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../auth/useAuth";
import type { ProfileRow } from "./types";

/** Event name fired (window-level) whenever the signed-in user edits their
 *  own profile (name, photo). Subscribers — e.g. the AppShell header —
 *  refetch so the avatar/name update without a reload. */
export const PROFILE_UPDATED_EVENT = "platypus:profile-updated";

export function notifyProfileUpdated() {
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
}

/** The signed-in user's own profiles row. Refreshes on PROFILE_UPDATED_EVENT. */
export function useMyProfile(): ProfileRow | null {
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled) setProfile((data as ProfileRow) ?? null);
    };
    void load();
    const onUpdated = () => void load();
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdated);
    };
  }, [userId]);

  return profile;
}
