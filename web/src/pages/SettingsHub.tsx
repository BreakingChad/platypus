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
      { href: "#/settings/org", icon: "settings", name: "Organization", what: "Make study codes, regions, and sponsor mode match how your org already talks about itself.", touch: "Once" },
      { href: "#/settings/site-setup", icon: "hospital", name: "Site setup", what: "Every site you run studies at, provisioned once — so studies, teams, and qualification all point at the same site record.", touch: "As sites onboard" },
      { href: "#/settings/therapeutic-areas", icon: "layers", name: "Therapeutic areas", what: "Decide how your portfolio slices — TAs drive who sees which studies and how analytics roll up.", touch: "Rarely" },
      { href: "#/settings/fields", icon: "file", name: "Study & site fields", what: "Decide what every study record must capture — your schema, your required fields, your sections.", touch: "Occasionally" },
      { href: "#/settings/sponsors", icon: "building", name: "Sponsors & CROs", what: "Pick sponsors from a catalog instead of retyping them — filtering and roll-ups stay clean forever.", touch: "As they sign on" },
    ],
  },
  {
    title: "People & roles",
    sub: "Who works here, how they're organized, what they can see.",
    tools: [
      { href: "#/settings/members", icon: "users", name: "Members", what: "Bring people in and decide what they can touch — invite, set tier, assign a role.", touch: "As people join" },
      { href: "#/settings/teams", icon: "users", name: "Teams & roles", what: "Work assigns to ROLES, so nothing breaks when people leave — and escalations know who's above whom.", touch: "Once, then per hire" },
      { href: "#/settings/access", icon: "shield", name: "Access roles", what: "Decide what each kind of user can see and change — one permission set covers every page.", touch: "Once, then rarely" },
    ],
  },
  {
    title: "Workstreams",
    sub: "The stages studies move through and the work that fires at each.",
    tools: [
      { href: "#/settings/stages", icon: "workflow", name: "Stage pipelines", what: "Draw the path every study walks — stages, order, parallels, target days. Health and metrics measure against THIS.", touch: "Once, then tuned" },
      { href: "#/settings/work-streams", icon: "layers", name: "Task flows", what: "Decide which work fires automatically at each stage, and which team it lands on — your playbook, executed by the engine.", touch: "Per study type" },
      { href: "#/settings/forms", icon: "mail", name: "Intake forms", what: "One link sponsors can submit studies through — your schema enforced at the front door, versions frozen at activation.", touch: "Per intake channel" },
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
