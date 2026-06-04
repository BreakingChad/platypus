/** Inbox due-date buckets (Wave L3) — the Outlook-familiar grouping.
 *  Pure, unit-tested. */

export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

export const BUCKET_ORDER: DueBucket[] = ["overdue", "today", "week", "later", "none"];

export const BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
  later: "Later",
  none: "No due date",
};

export function dueBucket(dueAt: string | null | undefined, now: Date = new Date()): DueBucket {
  if (!dueAt) return "none";
  const due = new Date(dueAt);
  if (isNaN(due.getTime())) return "none";

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 86400000);
  const endOfWeek = new Date(startOfToday.getTime() + 7 * 86400000);

  if (due.getTime() < startOfToday.getTime()) return "overdue";
  if (due.getTime() < endOfToday.getTime()) return "today";
  if (due.getTime() < endOfWeek.getTime()) return "week";
  return "later";
}
