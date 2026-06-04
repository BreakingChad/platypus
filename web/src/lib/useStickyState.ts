import { useEffect, useRef, useState } from "react";

/** useStickyState — a `useState` that persists its value to localStorage
 *  under a stable key, with safe JSON serialization, hydration on first
 *  mount, and a no-op fallback when localStorage is unavailable (SSR /
 *  blocked storage / private modes).
 *
 *  Designed for user filter prefs: cheap to read, fast to write, and
 *  versioned by key so renames don't collide with stale data.
 *
 *  Usage:
 *    const [stageFilter, setStageFilter] = useStickyState<string>(
 *      "studies/stageFilter", "all"
 *    );
 */
export function useStickyState<T>(key: string, initial: T): [T, (next: T) => void] {
  const fullKey = `pp:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(fullKey);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(fullKey, JSON.stringify(value));
    } catch {
      // ignore — storage unavailable
    }
  }, [fullKey, value]);

  return [value, setValue];
}

/** useStickyState seeded by a role-level default. Precedence:
 *    user's stored preference  >  role default (from the Page designer)  >  fallback.
 *  The role default arrives async (config load), so it applies only while
 *  the user has no stored value and hasn't touched the control this session.
 */
export function useStickyStateWithRoleDefault<T>(
  key: string,
  fallback: T,
  roleDefault: T | undefined
): [T, (next: T) => void] {
  const fullKey = `pp:${key}`;
  const [hadStored] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(fullKey) !== null;
    } catch {
      return false;
    }
  });
  const [value, setValueRaw] = useStickyState<T>(key, fallback);
  const touched = useRef(false);
  const applied = useRef(false);

  useEffect(() => {
    if (hadStored || touched.current || applied.current) return;
    if (roleDefault === undefined) return;
    applied.current = true;
    setValueRaw(roleDefault);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleDefault, hadStored]);

  const setValue = (next: T) => {
    touched.current = true;
    setValueRaw(next);
  };
  return [value, setValue];
}
