import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { BrandMark } from "./ui/BrandMark";
import { Icon } from "./ui/Icon";
import { Pill } from "./ui/Pill";
import { CommandPalette } from "./CommandPalette";

/** App shell — persistent left rail + header + content slot.
 *  Owns navigation, current-user/org affordances, and sign-out. Routes are
 *  hash-based; the shell highlights based on `currentHash`. */

type NavItem = {
  label: string;
  hash: string;
  icon: string;
  badge?: string;
  adminOnly?: boolean;
};

type NavGroup = {
  group: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    group: "Workspace",
    items: [
      { label: "Home", hash: "#/", icon: "home" },
      { label: "Studies", hash: "#/studies", icon: "folder" },
      { label: "Pipeline", hash: "#/pipeline", icon: "layers" },
      { label: "Inbox", hash: "#/inbox", icon: "inbox", badge: "soon" },
    ],
  },
  {
    group: "Configure",
    items: [
      { label: "Organization", hash: "#/settings/org", icon: "settings", adminOnly: true },
      { label: "Members", hash: "#/settings/members", icon: "users", adminOnly: true },
      { label: "Study fields", hash: "#/settings/fields", icon: "file", adminOnly: true },
      {
        label: "Pipeline stages",
        hash: "#/settings/stages",
        icon: "workflow",
        adminOnly: true,
      },
      {
        label: "Teams & roles",
        hash: "#/settings/teams",
        icon: "users",
        adminOnly: true,
      },
      {
        label: "Access roles",
        hash: "#/settings/access",
        icon: "shield",
        adminOnly: true,
      },
    ],
  },
];

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

  // Close the user menu on outside-click / Esc.
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

  const userEmail =
    auth.status === "signedIn" ? auth.user.email ?? "signed in" : "—";

  const visibleGroups = useMemo(() => {
    return NAV.map((g) => ({
      ...g,
      items: g.items.filter((it) => !it.adminOnly || isAdmin),
    })).filter((g) => g.items.length > 0);
  }, [isAdmin]);

  return (
    <div className="min-h-screen bg-[#faf8f4] text-slate-900 flex">
      {/* LEFT RAIL */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
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
        </div>

        <nav className="flex-1 px-2 pb-4 overflow-y-auto">
          {visibleGroups.map((group) => (
            <div key={group.group} className="mb-5">
              <div className="px-3 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {group.group}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    currentHash === item.hash ||
                    (item.hash === "#/" && (currentHash === "" || currentHash === "#"));
                  const isComingSoon = item.badge === "soon";
                  return (
                    <li key={item.hash}>
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
                        {isComingSoon && (
                          <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
                            soon
                          </span>
                        )}
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
                <Pill tone={isAdmin ? "brand" : "neutral"}>{tier}</Pill>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* HEADER */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
          <div className="h-14 px-4 md:px-6 flex items-center gap-3">
            {/* Mobile brand mark — visible only when rail is hidden. */}
            <div className="md:hidden">
              <BrandMark size={28} />
            </div>

            {/* Breadcrumb / current section */}
            <div className="flex-1 min-w-0 flex items-center gap-3">
              <Breadcrumb hash={currentHash} />
              <button
                onClick={() => {
                  // Simulate ⌘K to open palette
                  const evt = new KeyboardEvent("keydown", { key: "k", metaKey: true });
                  window.dispatchEvent(evt);
                }}
                className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 transition px-2 py-1 text-[11px] font-mono text-slate-500"
                title="Open command palette"
              >
                <Icon name="search" size={11} />
                Search
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
    </div>
  );
}

/* ---------- helpers ---------- */

function Avatar({ email }: { email: string }) {
  const ch = (email[0] ?? "?").toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full bg-brand-gradient text-white flex items-center justify-center text-xs font-bold">
      {ch}
    </div>
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
  "#/settings/fields": { kicker: "Configure", title: "Study fields" },
  "#/profile": { kicker: "You", title: "Profile" },
  "#/settings/stages": { kicker: "Configure", title: "Pipeline stages" },
  "#/settings/teams": { kicker: "Configure", title: "Teams & roles" },
  "#/settings/access": { kicker: "Configure", title: "Access roles" },
};

function Breadcrumb({ hash }: { hash: string }) {
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
