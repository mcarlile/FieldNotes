import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { CarbonNotificationContainer } from "@/components/carbon-notification";
import { ThemeProvider } from "@/contexts/theme-context";
import { useAuth } from "@/hooks/use-auth";
import GlobalHeader from "@/components/global-header";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import FieldNoteDetail from "@/pages/field-note-detail";
import Admin from "@/pages/admin";
import TrailcamStudio from "@/pages/trailcam-studio";
import InboxPage from "@/pages/inbox";
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
    window.location.href = "/api/login";
    return null;
  }
  return <Component />;
}

function AppContent() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <GlobalHeader />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/field-notes/:id" component={FieldNoteDetail} />
        <Route path="/admin">{() => <RequireAuth component={Admin} />}</Route>
        <Route path="/admin/:id">{() => <RequireAuth component={Admin} />}</Route>
        <Route path="/field-notes/:id/edit">{() => <RequireAuth component={Admin} />}</Route>
        <Route path="/trailcam-studio">{() => <RequireAuth component={TrailcamStudio} />}</Route>
        <Route path="/inbox">{() => <RequireAuth component={InboxPage} />}</Route>
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
