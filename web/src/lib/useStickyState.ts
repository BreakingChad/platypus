import { useEffect, useState } from "react";

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
