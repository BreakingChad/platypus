import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useResolvedConfig } from "../lib/useResolvedConfig";
import { BrandMark } from "./ui/BrandMark";
import { Icon } from "./ui/Icon";
import { Pill } from "./ui/Pill";
import { CommandPalette } from "./CommandPalette";
import { QuickAddFab } from "./QuickAddFab";
import { HelpOverlay } from "./HelpOverlay";

/** App shell — persistent left rail + header + content slot.
 *
 *  - On md+ the sidebar is permanently visible.
 *  - On <md a hamburger button in the header opens the same nav in a
 *    slide-in drawer. The drawer auto-closes on navigation and on Esc.
 *  - Mounts the Cmd-K palette globally.
 */

/** Resolved nav shape — what SidebarBody actually renders. */
type ResolvedNavItem = {
  key: string;
  label: string;
  icon: string;
  hash: string;
};

type ResolvedNavGroup = {
  group: string;
  items: ResolvedNavItem[];
};

export function AppShell({
  currentHash,
  onNavigate,
  children,
}: {
  currentHash: string;
  onNavigate: (hash: string) => void;
  children: ReactNode;
}) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin, tier } = useCurrentMember();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [fromSetup, setFromSetup] = useState(false);

  // Look up org name once we know the orgId.
  useEffect(() => {
    if (!orgId) {
      setOrgName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("orgs")
        .select("name")
        .eq("id", orgId)
        .maybeSingle();
      if (!cancelled) setOrgName(data?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Close user menu on outside-click / Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.("[data-user-menu]")) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Close mobile drawer on Esc.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  // Auto-close mobile drawer on route change.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [currentHash]);

  // "Back to guided setup" banner — shown when a designer was opened from the
  // wizard; clears when the user returns to the setup page.
  useEffect(() => {
    try {
      if (currentHash === "#/setup") {
        sessionStorage.removeItem("platypus/from-setup");
        setFromSetup(false);
      } else {
        setFromSetup(sessionStorage.getItem("platypus/from-setup") === "1");
      }
    } catch {
      /* non-fatal */
    }
  }, [currentHash]);

  // Gentle first-run redirect: a fresh admin org (no stages, not dismissed)
  // lands in Guided setup, at most once per session; always skippable.
  useEffect(() => {
    if (!isAdmin || !orgId) return;
    const atHome = currentHash === "" || currentHash === "#" || currentHash === "#/";
    if (!atHome) return;
    try {
      if (localStorage.getItem("platypus/setup-dismissed") === "1") return;
      if (sessionStorage.getItem("platypus/setup-redirected") === "1") return;
    } catch {
      return;
    }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("pipeline_stages")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId);
      if (cancelled) return;
      if ((count ?? 0) === 0) {
        try {
          sessionStorage.setItem("platypus/setup-redirected", "1");
        } catch {
          /* non-fatal */
        }
        onNavigate("#/setup");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, orgId, currentHash, onNavigate]);

  const userEmail = auth.status === "signedIn" ? auth.user.email ?? "signed in" : "—";

  const { navGroups } = useResolvedConfig();

  return (
    <div className="min-h-screen bg-[#faf8f4] text-slate-900 flex">
      {/* Skip link for keyboard / screen-reader users */}
      <a
        href="#platypus-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-brand-700 focus:text-white focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* DESKTOP SIDEBAR */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <SidebarBody
          groups={navGroups}
          currentHash={currentHash}
          onNavigate={onNavigate}
          orgName={orgName}
          tier={tier}
          isAdmin={isAdmin}
        />
      </aside>

      {/* MOBILE DRAWER */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-2xl flex flex-col animate-[slideIn_180ms_ease-out]">
            <SidebarBody
              groups={navGroups}
              currentHash={currentHash}
              onNavigate={onNavigate}
              orgName={orgName}
              tier={tier}
              isAdmin={isAdmin}
              onCloseMobile={() => setMobileNavOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* MAIN COLUMN */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* HEADER */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
          <div className="h-14 px-4 md:px-6 flex items-center gap-3">
            {/* Mobile: hamburger + brand mark */}
            <button
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden -ml-1 p-1.5 rounded-md text-slate-700 hover:bg-slate-100 transition"
              title="Open menu"
              aria-label="Open navigation menu"
            >
              <HamburgerIcon />
            </button>
            <div className="md:hidden">
              <BrandMark size={26} />
            </div>

            {/* Breadcrumb + Cmd-K hint */}
            <div className="flex-1 min-w-0 flex items-center gap-3">
              <Breadcrumb hash={currentHash} groups={navGroups} onNavigate={onNavigate} />
              <button
                onClick={() => {
                  const evt = new KeyboardEvent("keydown", { key: "k", metaKey: true });
                  window.dispatchEvent(evt);
                }}
                className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 transition px-2.5 py-1 text-[11px] font-mono text-slate-500"
                title="Open universal search"
                aria-label="Open universal search (Cmd K)"
              >
                <Icon name="search" size={11} aria-hidden="true" />
                Universal search
                <kbd className="text-[10px] text-slate-400 ml-1">⌘K</kbd>
              </button>
            </div>

            {/* User menu */}
            <div className="relative" data-user-menu>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 transition"
                aria-label="Open user menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <Avatar email={userEmail} />
                <span className="hidden sm:inline text-sm font-medium text-slate-700 max-w-[160px] truncate">
                  {userEmail}
                </span>
                <Icon name="chevron-down" size={14} className="text-slate-400" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-60 rounded-xl border border-slate-200 bg-white shadow-lg py-1.5 z-30">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Signed in
                    </div>
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {userEmail}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate("#/profile");
                    }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Icon name="users" size={14} className="text-slate-400" />
                    Profile
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      void supabase.auth.signOut();
                    }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Icon name="log-out" size={14} className="text-slate-400" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* CONTENT */}
        {fromSetup && currentHash !== "#/setup" && (
          <div className="bg-brand-50 border-b border-brand-100 px-4 md:px-6 py-2 flex items-center gap-3 text-sm">
            <Icon name="check" size={14} className="text-brand-600 flex-shrink-0" />
            <span className="text-brand-800 flex-1 min-w-0 truncate">Configuring from Guided setup.</span>
            <button
              onClick={() => onNavigate("#/setup")}
              className="font-semibold text-brand-700 hover:underline whitespace-nowrap"
            >
              Back to guided setup
            </button>
            <button
              onClick={() => {
                try {
                  sessionStorage.removeItem("platypus/from-setup");
                } catch {
                  /* non-fatal */
                }
                setFromSetup(false);
              }}
              aria-label="Dismiss"
              className="text-slate-400 hover:text-slate-700 flex-shrink-0"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        )}
        <main id="platypus-main" role="main" tabIndex={-1} className="flex-1 min-w-0">{children}</main>
      </div>

      {/* Global Cmd-K palette */}
      <CommandPalette onNavigate={onNavigate} />

      {/* Global Quick-add FAB */}
      <QuickAddFab onNavigate={onNavigate} />

      {/* Global help overlay (press ?) */}
      <HelpOverlay />

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

/* ---------- shared sidebar body (desktop + mobile drawer) ---------- */

function SidebarBody({
  groups,
  currentHash,
  onNavigate,
  orgName,
  tier,
  isAdmin,
  onCloseMobile,
}: {
  groups: ResolvedNavGroup[];
  currentHash: string;
  onNavigate: (hash: string) => void;
  orgName: string | null;
  tier: string | null;
  isAdmin: boolean;
  onCloseMobile?: () => void;
}) {
  return (
    <>
      <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
        <BrandMark size={36} />
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-display font-extrabold tracking-tight text-slate-900">
            Platypus
          </span>
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            clinical ops
          </span>
        </div>
        {onCloseMobile && (
          <button
            onClick={onCloseMobile}
            className="ml-auto p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            title="Close menu"
            aria-label="Close navigation menu"
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      <nav className="flex-1 px-2 pb-4 overflow-y-auto" aria-label="Primary navigation">
        {groups.map((group) => (
          <div key={group.group} className="mb-5">
            <div className="px-3 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {group.group}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  currentHash === item.hash ||
                  (item.hash === "#/" && (currentHash === "" || currentHash === "#"));
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => onNavigate(item.hash)}
                      className={
                        "w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition " +
                        (active
                          ? "bg-brand-50 text-brand-700"
                          : "text-slate-700 hover:bg-slate-50 hover:text-slate-900")
                      }
                    >
                      <Icon
                        name={item.icon}
                        size={16}
                        className={active ? "text-brand-600" : "text-slate-400"}
                      />
                      <span className="flex-1">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-0.5">
            Organization
          </div>
          <div className="text-sm font-semibold text-slate-900 truncate">
            {orgName ?? "Loading…"}
          </div>
          {tier && (
            <div className="mt-1.5">
              <Pill tone={tier === "developer" ? "dev" : isAdmin ? "brand" : "neutral"}>
                {tier}
              </Pill>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- small bits ---------- */

function Avatar({ email }: { email: string }) {
  const ch = (email[0] ?? "?").toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full bg-brand-gradient text-white flex items-center justify-center text-xs font-bold">
      {ch}
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M3 6h18 M3 12h18 M3 18h18" />
    </svg>
  );
}

const CRUMBS: Record<string, { kicker: string; title: string }> = {
  "#/": { kicker: "Workspace", title: "Home" },
  "": { kicker: "Workspace", title: "Home" },
  "#": { kicker: "Workspace", title: "Home" },
  "#/studies": { kicker: "Workspace", title: "Studies" },
  "#/pipeline": { kicker: "Workspace", title: "Pipeline" },
  "#/inbox": { kicker: "Workspace", title: "Inbox" },
  "#/sites": { kicker: "Workspace", title: "Sites" },
  "#/intake": { kicker: "Workspace", title: "Intake" },
  "#/settings/org": { kicker: "Configure", title: "Organization" },
  "#/settings/members": { kicker: "Configure", title: "Members" },
  "#/settings/nav": { kicker: "Configure", title: "Nav designer" },
  "#/settings/pages": { kicker: "Configure", title: "Page designer" },
  "#/settings/fields": { kicker: "Configure", title: "Study fields" },
  "#/settings/stages": { kicker: "Configure", title: "Pipeline stages" },
  "#/settings/teams": { kicker: "Configure", title: "Teams & roles" },
  "#/settings/access": { kicker: "Configure", title: "Access roles" },
  "#/audit": { kicker: "Audit", title: "Audit feed" },
  "#/settings/work-streams": { kicker: "Configure", title: "Work Stream Builder" },
  "#/setup": { kicker: "Get started", title: "Guided setup" },
  "#/profile": { kicker: "You", title: "Profile" },
};

function Breadcrumb({
  hash,
  groups,
  onNavigate,
}: {
  hash: string;
  groups: ResolvedNavGroup[];
  onNavigate: (h: string) => void;
}) {
  // Study detail — no sidebar entry; link the kicker back to the list.
  if (hash.startsWith("#/studies/")) {
    return (
      <nav aria-label="Breadcrumb" className="flex items-baseline gap-2">
        <button
          onClick={() => onNavigate("#/studies")}
          className="text-[10px] font-mono text-slate-400 uppercase tracking-wider hover:text-brand-700 transition"
        >
          Studies
        </button>
        <Icon name="chevron-right" size={12} className="text-slate-300" />
        <span className="text-sm font-semibold text-slate-900">Study record</span>
      </nav>
    );
  }

  // Prefer the resolved (admin-configurable) nav so renamed items stay in sync.
  let kicker = "";
  let title = "";
  let groupHash = "#/";
  for (const g of groups) {
    const item = g.items.find(
      (it) => it.hash === hash || (it.hash === "#/" && (hash === "" || hash === "#"))
    );
    if (item) {
      kicker = g.group;
      title = item.label;
      groupHash = g.items[0]?.hash ?? item.hash;
      break;
    }
  }
  // Fall back to the static map for routes outside the sidebar (e.g. Profile).
  if (!title) {
    const meta = CRUMBS[hash] ?? CRUMBS["#/"];
    kicker = meta.kicker;
    title = meta.title;
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-baseline gap-2">
      <button
        onClick={() => onNavigate(groupHash)}
        className="text-[10px] font-mono text-slate-400 uppercase tracking-wider hover:text-brand-700 transition"
      >
        {kicker}
      </button>
      <Icon name="chevron-right" size={12} className="text-slate-300" />
      <span className="text-sm font-semibold text-slate-900">{title}</span>
    </nav>
  );
}
