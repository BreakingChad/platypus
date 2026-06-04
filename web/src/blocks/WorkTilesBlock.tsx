import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

export function WorkTilesBlock({ ctx }: { ctx: BlockContext }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900">Work surfaces</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <WorkTile icon="folder" label="Studies" onClick={() => ctx.navigate("#/studies")} />
        <WorkTile icon="layers" label="Pipeline" onClick={() => ctx.navigate("#/pipeline")} />
        <WorkTile icon="inbox" label="Inbox" onClick={() => ctx.navigate("#/inbox")} />
        <WorkTile icon="users" label="Members" onClick={() => ctx.navigate("#/settings/members")} />
      </div>
    </section>
  );
}

function WorkTile({
  icon,
  label,
  onClick,
  dimmed,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  dimmed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-xl border px-4 py-3 transition flex items-center gap-3 text-left " +
        (dimmed
          ? "border-slate-200 bg-slate-50/40 opacity-70"
          : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30")
      }
    >
      <div
        className={
          "w-8 h-8 rounded-lg flex items-center justify-center " +
          (dimmed ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-slate-500")
        }
      >
        <Icon name={icon} size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        {dimmed && (
          <div className="text-[11px] font-semibold text-slate-400">
            coming next
          </div>
        )}
      </div>
      <Icon name="chevron-right" size={14} className="text-slate-300" />
    </button>
  );
}
