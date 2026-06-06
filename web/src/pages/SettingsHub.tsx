import { useCurrentMember } from "../lib/useCurrentMember";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";

/** Settings hub — every configuration tool in one place, explained in plain
 *  language. The sidebar shows ONE "Settings" entry; this page is the menu.
 *  (Contextual shortcuts also surface per-page via the header gear.)
 */

type Tool = {
  href: string;
  icon: string;
  name: string;
  what: string;   // plain-language: what you control here
  touch: string;  // how often you'll realistically touch it
};

const GROUPS: { title: string; sub: string; tools: Tool[] }[] = [
  {
    title: "Foundation",
    sub: "Set up once at onboarding — rarely changes after.",
    tools: [
      { href: "#/settings/org", icon: "settings", name: "Organization", what: "Name, sponsor mode, study-code prefix, region.", touch: "Once" },
      { href: "#/settings/fields", icon: "file", name: "Study & site fields", what: "Every field on the study record and site profiles — sections, order, what's required.", touch: "Occasionally" },
    ],
  },
  {
    title: "People & roles",
    sub: "Who works here, how they're organized, what they can see.",
    tools: [
      { href: "#/settings/members", icon: "users", name: "Members", what: "The roster — invite people, set admin tier, assign access roles.", touch: "As people join" },
      { href: "#/settings/teams", icon: "users", name: "Teams & roles", what: "Teams own work; role slots survive turnover. Hierarchy decides who escalations reach.", touch: "Once, then per hire" },
      { href: "#/settings/access", icon: "shield", name: "Access roles", what: "Permission sets — what each role can read or change, and which layouts they get.", touch: "Once, then rarely" },
    ],
  },
  {
    title: "Pipeline & work",
    sub: "The stages studies move through and what fires at each.",
    tools: [
      { href: "#/settings/stages", icon: "workflow", name: "Pipeline stages", what: "The lifecycle studies move through — names, colors, target days. Reorder by drag; or shape them in the flow next door.", touch: "Once, then tuned" },
      { href: "#/settings/work-streams", icon: "workflow", name: "Pipeline & work streams", what: "The visual flow — stages left-to-right (sequential or parallel) with the modules that spawn tasks at each. Edit stages and modules in one place.", touch: "Per study type" },
      { href: "#/settings/forms", icon: "mail", name: "Intake forms", what: "External study-intake forms — build from your field schema, activate, share one link. Versions freeze at activation.", touch: "Per intake channel" },
    ],
  },
  {
    title: "Presentation",
    sub: "What each role sees, page by page.",
    tools: [
      { href: "#/settings/nav", icon: "layers", name: "Nav designer", what: "The sidebar, per access role — groups, order, what's visible.", touch: "Rarely" },
      { href: "#/settings/pages", icon: "workflow", name: "Page designer", what: "Every page per role: blocks above/below content, the study record's tabs, default filters and views. Preview as any role.", touch: "When workflows change" },
    ],
  },
  {
    title: "Governance",
    sub: "The defensible record.",
    tools: [
      { href: "#/audit", icon: "shield", name: "Audit feed", what: "Org-wide, hash-chained record of every action — who, when, where. Filter, export, verify.", touch: "Inspections & spot checks" },
    ],
  },
];

export function SettingsHub({ onNavigate }: { onNavigate: (h: string) => void }) {
  const { isAdmin, loading } = useCurrentMember();

  if (!loading && !isAdmin) {
    return (
      <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Settings" />
        <Card className="mt-6">
          <div className="text-sm text-slate-600">
            Settings are managed by your org's admins. If something here needs
            changing — a field, a stage, a layout — ask an admin or your
            operations director.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Settings"
        subtitle="Everything an admin shapes lives here. The pattern: set the foundation once, define how work flows, then teams just execute."
        actions={
          <button
            onClick={() => onNavigate("#/setup")}
            className="text-xs font-semibold text-brand-700 hover:underline whitespace-nowrap"
          >
            Guided setup →
          </button>
        }
      />

      <div className="mt-6 space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <div className="mb-3">
              <h2 className="text-sm font-display font-bold text-slate-900">{g.title}</h2>
              <p className="text-xs text-slate-500">{g.sub}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {g.tools.map((t) => (
                <button
                  key={t.href}
                  onClick={() => onNavigate(t.href)}
                  className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm transition group"
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 group-hover:bg-brand-50 group-hover:text-brand-600 flex items-center justify-center transition">
                      <Icon name={t.icon} size={15} />
                    </span>
                    <span className="text-sm font-semibold text-slate-900 flex-1">{t.name}</span>
                    <Icon name="chevron-right" size={13} className="text-slate-300 group-hover:text-brand-400 transition" />
                  </div>
                  <p className="text-xs text-slate-600 leading-snug mb-2">{t.what}</p>
                  <Pill tone="neutral">{t.touch}</Pill>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
