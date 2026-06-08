import { useAuth } from "../auth/useAuth";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useResolvedConfig } from "../lib/useResolvedConfig";
import { PageHeader } from "../components/ui/PageHeader";
import { Pill } from "../components/ui/Pill";
import { BLOCK_REGISTRY } from "../blocks/registry";
import type { PageBlockConfig } from "../lib/navConfig";

/** Home — landing page.
 *
 *  Reads the resolved layout for the 'home' pageKey from the user's access
 *  role (falls back to PAGE_REGISTRY.home.defaultLayout), then renders the
 *  block list in order. Hidden blocks skip. Each block fetches its own data;
 *  Home is purely a layout shell.
 */
export function Home({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const auth = useAuth();
  const { isAdmin, tier, isDeveloper } = useCurrentMember();
  const { layoutFor } = useResolvedConfig();

  if (auth.status !== "signedIn") return null;

  const blocks: PageBlockConfig[] = layoutFor("home");

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Workspace"
        title="Welcome back."
        subtitle={
          isAdmin
            ? "Configure how your organization runs studies. Every change takes effect immediately and shapes what your team sees."
            : "Here's how your team has configured Platypus. Admins can change the operating model from the Configure section."
        }
        actions={
          tier ? (
            <Pill tone={isDeveloper ? "dev" : isAdmin ? "brand" : "neutral"}>
              {isDeveloper ? "Developer access" : isAdmin ? "Admin access" : `Tier: ${tier}`}
            </Pill>
          ) : null
        }
      />

      <div className="mt-8 space-y-8">
        {blocks
          .filter((b) => !b.hidden)
          .map((b) => {
            const entry = BLOCK_REGISTRY[b.block];
            if (!entry) {
              // Unknown block in config — render a friendly placeholder.
              return (
                <div
                  key={b.id}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                >
                  Unknown block <code className="font-mono">{b.block}</code> in this layout. An
                  admin can remove it from <code className="font-mono">/settings/pages</code>.
                </div>
              );
            }
            const C = entry.component;
            return (
              <C
                key={b.id}
                ctx={{
                  settings: { ...(entry.defaultSettings ?? {}), ...(b.settings ?? {}) },
                  navigate: onNavigate,
                }}
              />
            );
          })}
      </div>
    </div>
  );
}
