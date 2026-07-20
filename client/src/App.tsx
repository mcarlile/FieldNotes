import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { CarbonNotificationContainer } from "@/components/carbon-notification";
import { ThemeProvider } from "@/contexts/theme-context";
import { useAuth } from "@/hooks/use-auth";
import GlobalHeader from "@/components/global-header";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import FieldNoteDetail from "@/pages/field-note-detail";
import Admin from "@/pages/admin";
import TrailcamStudio from "@/pages/trailcam-studio";
import InboxPage from "@/pages/inbox";
import Expeditions from "@/pages/expeditions";
import ExpeditionAdmin from "@/pages/expedition-admin";
import PublicExpeditionPage from "@/pages/public-expedition";
import PublicFieldNotePage from "@/pages/public-field-note";
import { Loader2 } from "lucide-react";
import type { ComponentType } from "react";

function RequireAuth({ component: Component }: { component: ComponentType<any> }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-2.75rem)] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/login?redirectTo=${returnTo}`;
    return null;
  }
  return <Component />;
}

function AppContent() {
  const { isLoading, isAuthenticated } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {location !== "/" && <GlobalHeader />}
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/dashboard">{() => <RequireAuth component={Dashboard} />}</Route>
        <Route path="/field-notes/:id" component={FieldNoteDetail} />
        <Route path="/admin">{() => <RequireAuth component={Admin} />}</Route>
        <Route path="/admin/:id">{() => <RequireAuth component={Admin} />}</Route>
        <Route path="/field-notes/:id/edit">{() => <RequireAuth component={Admin} />}</Route>
        <Route path="/trailcam-studio">{() => <RequireAuth component={TrailcamStudio} />}</Route>
        <Route path="/inbox">{() => <RequireAuth component={InboxPage} />}</Route>
        <Route path="/expeditions">{() => <RequireAuth component={Expeditions} />}</Route>
        <Route path="/expeditions/new">{() => <RequireAuth component={ExpeditionAdmin} />}</Route>
        <Route path="/expeditions/:id/edit">{() => <RequireAuth component={ExpeditionAdmin} />}</Route>
        {/* Public routes — no auth required */}
        <Route path="/trips/:slug" component={PublicExpeditionPage} />
        <Route path="/notes/:slug" component={PublicFieldNotePage} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppContent />
        <CarbonNotificationContainer />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
