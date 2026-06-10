/** Recently-visited studies (Tier-1 UX) — coordinators bounce between the
 *  same handful of studies all day; the Cmd-K palette surfaces these first. */

const KEY = "pp:recentStudyIds";
const MAX = 5;

export function pushRecentStudy(id: string): void {
  try {
    const cur: string[] = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    const next = [id, ...cur.filter((x) => x !== id)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function getRecentStudyIds(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
