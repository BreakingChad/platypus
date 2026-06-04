import { fmtDate } from "./dates";
/** Append the date being recorded to an action message, so every success
 *  toast surfaces the stamp the audit trail is writing (design principle #2:
 *  date-stamp everything visibly). */
export function stamped(msg: string): string {
  return `${msg} · ${fmtDate(new Date())}`;
}
