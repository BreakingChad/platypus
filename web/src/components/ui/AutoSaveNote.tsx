import { Icon } from "./Icon";

/** AutoSaveNote — one-line signpost for pages where edits write instantly.
 *  Audit v3 finding #5: three save models exist (instant / blur-commit /
 *  dirty-bar); this makes the instant one announce itself. */
export function AutoSaveNote({ what = "Changes" }: { what?: string }) {
  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
      <Icon name="check" size={12} className="text-emerald-500" />
      {what} save automatically as you work — no save button needed.
    </p>
  );
}
