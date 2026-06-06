import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import type { FieldDefinitionRow, PipelineStageRow } from "../lib/types";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

export function SetupHubBlock({ ctx }: { ctx: BlockContext }) {
  const { isAdmin } = useCurrentMember();
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const studyFields = fields.rows.filter((f) => f.entity_type === "study");
  const fieldCount = studyFields.filter((f) => f.enabled).length;
  const stageCount = stages.rows.length;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900">Setup hub</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <HubCard
          icon="file"
          title="Study fields"
          description="Choose what every study captures. Toggle, require, lock, add custom fields."
          status={fieldCount > 0 ? `${fieldCount} active` : "Ready"}
          onClick={() => ctx.navigate("#/settings/fields")}
          disabled={!isAdmin}
        />
        <HubCard
          icon="workflow"
          title="Pipeline stages"
          description="Design the stages every study moves through. Reorder, rename, retarget."
          status={stageCount > 0 ? `${stageCount} stages` : "Ready"}
          onClick={() => ctx.navigate("#/settings/stages")}
          disabled={!isAdmin}
        />
        <HubCard
          icon="users"
          title="Teams & roles"
          description="Build the teams that own work. Role slots survive turnover — swap holders, not workflows."
          status="Ready"
          onClick={() => ctx.navigate("#/settings/teams")}
          disabled={!isAdmin}
        />
        <HubCard
          icon="shield"
          title="Access roles"
          description="Who can see what. Module-level permissions and portfolio scope."
          status="Ready"
          onClick={() => ctx.navigate("#/settings/access")}
          disabled={!isAdmin}
        />
      </div>
    </section>
  );
}

function HubCard({
  icon,
  title,
  description,
  status,
  onClick,
  disabled,
}: {
  icon: string;
  title: string;
  description: string;
  status: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? "Admin access required" : undefined}
      className={
        "text-left rounded-2xl border p-5 transition group " +
        (disabled
          ? "border-slate-200 bg-slate-50/40 opacity-70 cursor-not-allowed"
          : "border-slate-200 bg-white hover:border-brand-500 hover:bg-brand-50/30 hover:-translate-y-[1px] hover:shadow-sm")
      }
    >
      <div className="flex items-start justify-between mb-2.5">
        <div
          className={
            "w-10 h-10 rounded-xl flex items-center justify-center " +
            (disabled ? "bg-slate-100 text-slate-400" : "bg-brand-50 text-brand-600")
          }
        >
          <Icon name={icon} size={20} />
        </div>
        <Pill tone="brand">{status}</Pill>
      </div>
      <div className="font-display font-bold text-base text-slate-900 mb-1">{title}</div>
      <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
      {!disabled && (
        <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-700 opacity-0 group-hover:opacity-100 transition">
          Open <Icon name="chevron-right" size={12} />
        </div>
      )}
      {disabled && (
        <div className="mt-3 text-[11px] font-semibold text-slate-400">
          Admin access required
        </div>
      )}
    </button>
  );
}
