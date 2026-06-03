import { useState } from "react";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import type { PipelineStageRow, StudyRow } from "../lib/types";
import { seedDemoStudies, seedDemoWorkStreams, seedDemoSites } from "../lib/demoSeed";
import { useToast } from "../lib/Toast";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

export function QuickStartBlock({ ctx: _ctx }: { ctx: BlockContext }) {
  const { orgId } = useCurrentOrg();
  const { isAdmin } = useCurrentMember();
  const toast = useToast();
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const [seeding, setSeeding] = useState(false);

  const total = studies.rows.length;
  const stageCount = stages.rows.length;

  // Visibility rule: admin + <3 studies + at least one stage. Block returns
  // null otherwise so the layout collapses cleanly.
  if (!(isAdmin && total < 3 && stageCount > 0 && !studies.loading)) return null;

  return (
    <div className="rounded-2xl border-2 border-brand-100 bg-gradient-to-br from-brand-50/60 to-white p-5 flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-brand-gradient text-white flex items-center justify-center flex-shrink-0">
        <Icon name="layers" size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold uppercase tracking-wider text-brand-700 mb-0.5">
          Quick start
        </div>
        <div className="font-display font-bold text-base text-slate-900">
          {total === 0 ? "Your portfolio is empty." : "Want to see Platypus in motion?"}
        </div>
        <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
          Load 8 demo studies across every stage of your pipeline. You can edit, advance,
          or delete them anytime. Existing studies are untouched.
        </p>
      </div>
      <Button
        variant="primary"
        onClick={async () => {
          if (!orgId) return;
          setSeeding(true);
          try {
            const res = await seedDemoStudies(orgId, stages.rows);
            // Also seed example work-stream modules + task templates so
            // stage advances spawn tasks immediately. Idempotent — skips
            // when any modules already exist.
            const ws = await seedDemoWorkStreams(orgId);
            let siteRes = { sites: 0, linked: 0 };
            try {
              siteRes = await seedDemoSites(orgId);
            } catch {
              /* pre-0012 — skip site seeding */
            }
            const parts: string[] = [];
            if (res.inserted > 0) parts.push(`${res.inserted} demo stud${res.inserted === 1 ? "y" : "ies"}`);
            if (ws.modules > 0) parts.push(`${ws.modules} work-stream module${ws.modules === 1 ? "" : "s"}`);
            if (ws.templates > 0) parts.push(`${ws.templates} task template${ws.templates === 1 ? "" : "s"}`);
            if (siteRes.sites > 0) parts.push(`${siteRes.sites} demo site${siteRes.sites === 1 ? "" : "s"}`);
            if (parts.length === 0) {
              toast.info("Demo content already loaded");
            } else {
              toast.success(`Added ${parts.join(" + ")}`);
            }
          } catch (e: any) {
            toast.error(e?.message || "Couldn't load demo content");
          } finally {
            setSeeding(false);
          }
        }}
        disabled={seeding}
      >
        {seeding ? "Loading…" : "Load demo studies"}
      </Button>
    </div>
  );
}
