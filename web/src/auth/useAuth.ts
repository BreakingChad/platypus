import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export type AuthState =
  | { status: "loading"; user: null; session: null }
  | { status: "signedOut"; user: null; session: null }
  | { status: "signedIn"; user: User; session: Session };

/** Subscribes to Supabase auth state and exposes a clean status union. */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null, session: null });

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        setState({ status: "signedIn", session: data.session, user: data.session.user });
      } else {
        setState({ status: "signedOut", session: null, user: null });
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!mounted) return;
      if (session) setState({ status: "signedIn", session, user: session.user });
      else setState({ status: "signedOut", session: null, user: null });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
