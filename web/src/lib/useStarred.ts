import { useStickyState } from "./useStickyState";

/** Per-user starred study ids, persisted to localStorage. Scoped by user
 *  email so multiple sign-ins on the same machine don't collide. */
export function useStarredStudies(userEmail: string | null) {
  const key = userEmail ? `starred/${userEmail}` : "starred/anon";
  const [ids, setIds] = useStickyState<string[]>(key, []);
  const set = new Set(ids);
  return {
    isStarred: (id: string) => set.has(id),
    toggle: (id: string) => {
      const next = set.has(id) ? ids.filter((x) => x !== id) : [...ids, id];
      setIds(next);
    },
    all: ids,
  };
}
