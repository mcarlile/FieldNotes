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
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Sign in required",
        description: "Redirecting you to sign in...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <Component />;
}

function Router() {
  return (
    <>
      <GlobalHeader />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/field-notes/:id" component={FieldNoteDetail} />
        <Route path="/admin">
          {() => <ProtectedRoute component={Admin} />}
        </Route>
        <Route path="/admin/:id">
          {() => <ProtectedRoute component={Admin} />}
        </Route>
        <Route path="/field-notes/:id/edit">
          {() => <ProtectedRoute component={Admin} />}
        </Route>
        <Route path="/trailcam-studio">
          {() => <ProtectedRoute component={TrailcamStudio} />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router />
        <CarbonNotificationContainer />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
