import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { AuthGate } from "./auth/AuthGate";
import { OrgProvider } from "./lib/OrgContext";
import { ToastProvider } from "./lib/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppShell } from "./components/AppShell";
import { ConfirmRoot } from "./lib/confirm";

// Eager — surfaces every signed-in user hits on landing.
import { Home } from "./pages/Home";
import { StudiesList } from "./pages/StudiesList";
import { PipelineView } from "./pages/PipelineView";
import { Inbox } from "./pages/Inbox";
import { Sites } from "./pages/Sites";
import { IntakeTriage } from "./pages/IntakeTriage";
import { Profile } from "./pages/Profile";
import { ComingSoon } from "./pages/ComingSoon";

// Lazy — admin-only designers + management surfaces.
const StudyDetail          = lazy(() => import("./pages/StudyDetail").then(m => ({ default: m.StudyDetail })));
const FieldsDesigner       = lazy(() => import("./pages/FieldsDesigner").then(m => ({ default: m.FieldsDesigner })));
const StageDesigner        = lazy(() => import("./pages/StageDesigner").then(m => ({ default: m.StageDesigner })));
const TeamBuilder          = lazy(() => import("./pages/TeamBuilder").then(m => ({ default: m.TeamBuilder })));
const AccessRoles          = lazy(() => import("./pages/AccessRoles").then(m => ({ default: m.AccessRoles })));
const OrgSettings          = lazy(() => import("./pages/OrgSettings").then(m => ({ default: m.OrgSettings })));
const Members              = lazy(() => import("./pages/Members").then(m => ({ default: m.Members })));
const NavDesigner          = lazy(() => import("./pages/NavDesigner").then(m => ({ default: m.NavDesigner })));
const PageLayoutDesigner   = lazy(() => import("./pages/PageLayoutDesigner").then(m => ({ default: m.PageLayoutDesigner })));
const AuditFeed            = lazy(() => import("./pages/AuditFeed").then(m => ({ default: m.AuditFeed })));
const WorkStreamBuilder    = lazy(() => import("./pages/WorkStreamBuilder").then(m => ({ default: m.WorkStreamBuilder })));
const GuidedSetup          = lazy(() => import("./pages/GuidedSetup").then(m => ({ default: m.GuidedSetup })));

/** Simple hash-based router. We'll graduate to react-router when route count
 *  and nesting demand it; for now this keeps the bundle small and the model
 *  obvious. */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (next: string) => {
    if (window.location.hash === next) return;
    window.location.hash = next;
  };
  return { hash, navigate };
}

type RouteContent = { node: ReactNode };

function renderRoute(
  hash: string,
  navigate: (h: string) => void
): RouteContent {
  // Home
  if (hash === "" || hash === "#" || hash === "#/") {
    return { node: <Home onNavigate={navigate} /> };
  }

  // Configure
  if (hash === "#/settings/fields") {
    return { node: <FieldsDesigner /> };
  }
  if (hash === "#/settings/stages") {
    return { node: <StageDesigner /> };
  }
  if (hash === "#/settings/teams") {
    return { node: <TeamBuilder /> };
  }
  if (hash === "#/settings/access") {
    return { node: <AccessRoles /> };
  }

  // Workspace stubs
  if (hash.startsWith("#/studies/")) {
    const id = hash.slice("#/studies/".length).trim();
    if (id) return { node: <StudyDetail studyId={id} onBack={() => navigate("#/studies")} /> };
  }
  if (hash === "#/studies") {
    return { node: <StudiesList onNavigate={navigate} /> };
  }
  if (hash === "#/pipeline") {
    return { node: <PipelineView onNavigate={navigate} /> };
  }
  if (hash === "#/sites") {
    return { node: <Sites onNavigate={navigate} /> };
  }
  if (hash === "#/intake") {
    return { node: <IntakeTriage onNavigate={navigate} /> };
  }
  if (hash === "#/inbox") {
    return { node: <Inbox onNavigate={navigate} /> };
  }

  // Configure: org
  if (hash === "#/settings/org") {
    return { node: <OrgSettings /> };
  }

  // Configure: members
  if (hash === "#/settings/members") {
    return { node: <Members /> };
  }

  // Audit feed (org-wide, admin-only)
  if (hash === "#/audit") {
    return { node: <AuditFeed onNavigate={navigate} /> };
  }

  // Work Stream Builder (Pattern Builder rebrand)
  if (hash === "#/settings/work-streams") {
    return { node: <WorkStreamBuilder /> };
  }

  // Configure: nav designer
  if (hash === "#/settings/nav") {
    return { node: <NavDesigner /> };
  }

  // Configure: page layout designer
  if (hash === "#/settings/pages") {
    return { node: <PageLayoutDesigner /> };
  }

  // Guided setup (admin onboarding)
  if (hash === "#/setup") {
    return { node: <GuidedSetup onNavigate={navigate} /> };
  }

  // You: profile
  if (hash === "#/profile") {
    return { node: <Profile /> };
  }

  // Unknown route — drop to home.
  return { node: <Home onNavigate={navigate} /> };
}

export function App() {
  const { hash, navigate } = useHashRoute();
  const route = renderRoute(hash, navigate);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <OrgProvider>
          <AuthGate>
            <AppShell currentHash={hash} onNavigate={navigate}>
              <Suspense fallback={<LazyFallback />}>
                {route.node}
              </Suspense>
            </AppShell>
          </AuthGate>
        </OrgProvider>
        <ConfirmRoot />
      </ToastProvider>
    </ErrorBoundary>
  );
}

function LazyFallback() {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-10 text-sm text-slate-500 flex items-center gap-2">
      <div className="w-3 h-3 rounded-full bg-brand-500 animate-pulse" />
      Loading…
    </div>
  );
}
