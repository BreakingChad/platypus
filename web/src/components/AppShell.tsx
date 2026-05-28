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

  const userEmail = auth.status === "signedIn" ? auth.user.email ?? "signed in" : "—";

  const { navGroups } = useResolvedConfig();

  return (
    <div className="min-h-screen bg-[#faf8f4] text-slate-900 flex">
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
            >
              <HamburgerIcon />
            </button>
            <div className="md:hidden">
              <BrandMark size={26} />
            </div>

            {/* Breadcrumb + Cmd-K hint */}
            <div className="flex-1 min-w-0 flex items-center gap-3">
              <Breadcrumb hash={currentHash} />
              <button
                onClick={() => {
                  const evt = new KeyboardEvent("keydown", { key: "k", metaKey: true });
                  window.dispatchEvent(evt);
                }}
                className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 transition px-2.5 py-1 text-[11px] font-mono text-slate-500"
                title="Open universal search"
              >
                <Icon name="search" size={11} />
                Universal search
                <kbd className="text-[10px] text-slate-400 ml-1">⌘K</kbd>
              </button>
            </div>

            {/* User menu */}
            <div className="relative" data-user-menu>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 transition"
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
        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {/* Global Cmd-K palette */}
      <CommandPalette onNavigate={onNavigate} />

      {/* Global Quick-add FAB */}
      <QuickAddFab onNavigate={onNavigate} />

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
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      <nav className="flex-1 px-2 pb-4 overflow-y-auto">
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
  "#/settings/org": { kicker: "Configure", title: "Organization" },
  "#/settings/members": { kicker: "Configure", title: "Members" },
  "#/settings/nav": { kicker: "Configure", title: "Nav designer" },
  "#/settings/pages": { kicker: "Configure", title: "Page designer" },
  "#/settings/fields": { kicker: "Configure", title: "Study fields" },
  "#/settings/stages": { kicker: "Configure", title: "Pipeline stages" },
  "#/settings/teams": { kicker: "Configure", title: "Teams & roles" },
  "#/settings/access": { kicker: "Configure", title: "Access roles" },
  "#/profile": { kicker: "You", title: "Profile" },
};

function Breadcrumb({ hash }: { hash: string }) {
  // Detail routes — match #/studies/<id> etc.
  if (hash.startsWith("#/studies/")) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
          Workspace
        </span>
        <Icon name="chevron-right" size={12} className="text-slate-300" />
        <span className="text-sm font-semibold text-slate-900">Study</span>
      </div>
    );
  }
  const meta = CRUMBS[hash] ?? CRUMBS["#/"];
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
        {meta.kicker}
      </span>
      <Icon name="chevron-right" size={12} className="text-slate-300" />
      <span className="text-sm font-semibold text-slate-900">{meta.title}</span>
    </div>
  );
}
