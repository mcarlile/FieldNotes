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
import Welcome from "@/pages/welcome";
import InboxPage from "@/pages/inbox";
import { Loader2 } from "lucide-react";

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Welcome />;
  }

  return (
    <>
      <GlobalHeader />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/field-notes/:id" component={FieldNoteDetail} />
        <Route path="/admin" component={Admin} />
        <Route path="/admin/:id" component={Admin} />
        <Route path="/field-notes/:id/edit" component={Admin} />
        <Route path="/trailcam-studio" component={TrailcamStudio} />
        <Route path="/inbox" component={InboxPage} />
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
