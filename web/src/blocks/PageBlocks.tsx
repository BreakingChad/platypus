import { useResolvedConfig } from "../lib/useResolvedConfig";
import { BLOCK_REGISTRY } from "./registry";
import type { PageBlockConfig } from "../lib/navConfig";

/** PageBlocks — renders the admin-configured block region for a page.
 *
 *  Every workspace page renders two of these around its core content:
 *    <PageBlocks pageKey="studies" region="top" … />   above
 *    <PageBlocks pageKey="studies" region="bottom" … /> below
 *  Layouts come from the viewer's access role (Page designer); blocks with
 *  no region default to "top". Renders nothing when the region is empty, so
 *  pages look exactly as before until an admin places blocks.
 */
export function PageBlocks({
  pageKey,
  region,
  navigate,
}: {
  pageKey: string;
  region: "top" | "bottom";
  navigate: (hash: string) => void;
}) {
  const { layoutFor } = useResolvedConfig();
  const blocks: PageBlockConfig[] = layoutFor(pageKey).filter(
    (b) => !b.hidden && (b.region ?? "top") === region
  );
  if (blocks.length === 0) return null;
  return (
    <div className={"space-y-6 " + (region === "top" ? "mb-6" : "mt-6")}>
      {blocks.map((b) => {
        const entry = BLOCK_REGISTRY[b.block];
        if (!entry) return null;
        const C = entry.component;
        return (
          <C
            key={b.id}
            ctx={{
              settings: { ...(entry.defaultSettings ?? {}), ...(b.settings ?? {}) },
              navigate,
            }}
          />
        );
      })}
    </div>
  );
}
