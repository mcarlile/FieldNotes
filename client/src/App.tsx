import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { CarbonNotificationContainer } from "@/components/carbon-notification";
import { ThemeProvider } from "@/contexts/theme-context";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import FieldNoteDetail from "@/pages/field-note-detail";
import Admin from "@/pages/admin";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/field-notes/:id" component={FieldNoteDetail} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/:id" component={Admin} />
      <Route path="/field-notes/:id/edit" component={Admin} />
      <Route component={NotFound} />
    </Switch>
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
