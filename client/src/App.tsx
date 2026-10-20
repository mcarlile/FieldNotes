import { useEffect, useRef, type ComponentType } from "react";
import {
  ClerkProvider,
  Show,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Switch, Route, Link, useLocation, Redirect, Router as WouterRouter } from "wouter";
import { Loader2 } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { CarbonNotificationContainer } from "@/components/carbon-notification";
import { ThemeProvider } from "@/contexts/theme-context";
import GlobalHeader from "@/components/global-header";
import { useDesignPreview } from "@/hooks/use-design-preview";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import FieldNoteDetail from "@/pages/field-note-detail";
import Admin from "@/pages/admin";
import TrailcamStudio from "@/pages/trailcam-studio";
import ConnectClaude from "@/pages/connect-claude";
import InboxPage from "@/pages/inbox";
import Expeditions from "@/pages/expeditions";
import ExpeditionAdmin from "@/pages/expedition-admin";
import PublicExpeditionPage from "@/pages/public-expedition";
import PublicFieldNotePage from "@/pages/public-field-note";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "bottom" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "hsl(30 12% 12%)",
    colorForeground: "hsl(30 12% 12%)",
    colorMutedForeground: "hsl(32 8% 42%)",
    colorDanger: "hsl(8 55% 42%)",
    colorBackground: "hsl(38 25% 94%)",
    colorInput: "hsl(38 28% 96%)",
    colorInputForeground: "hsl(30 12% 12%)",
    colorNeutral: "hsl(36 16% 84%)",
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-background rounded-2xl w-[440px] max-w-full overflow-hidden border border-border",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground",
    formFieldLabel: "text-foreground",
    footerActionLink: "text-foreground",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-foreground",
    formFieldSuccessText: "text-foreground",
    alertText: "text-foreground",
    logoBox: "mb-4",
    logoImage: "h-10 w-10",
    socialButtonsBlockButton: "border-border bg-card hover:bg-muted",
    formButtonPrimary: "bg-foreground text-background hover:opacity-85",
    formFieldInput: "bg-card text-foreground border-border",
    footerAction: "bg-muted",
    dividerLine: "bg-border",
    alert: "bg-muted border-border",
    otpCodeFieldInput: "bg-card text-foreground border-border",
    formFieldRow: "gap-2",
    main: "gap-4",
  },
};

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function RequireAuth({ component: Component }: { component: ComponentType }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <Component />;
}

function RootRoute() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClientForListener = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClientForListener.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClientForListener]);

  return null;
}

function AppContent() {
  const [location] = useLocation();
  const { data: readOnlyPreview = false, isPending: previewLoading } = useDesignPreview();
  const previewLocked = import.meta.env.DEV && previewLoading;
  const isTripWorkspace =
    location === "/admin" ||
    /^\/admin\/[^/]+\/?$/.test(location) ||
    /^\/field-notes\/[^/]+\/edit\/?$/.test(location);
  const showHeader =
    location !== "/" &&
    !location.startsWith("/sign-in") &&
    !location.startsWith("/sign-up") &&
    !isTripWorkspace;

  if (previewLocked) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const readOnlyPage = (
    <main className="mx-auto max-w-xl px-6 py-20">
      <h1 className="font-serif text-3xl">Read-only production preview</h1>
      <p className="mt-4 text-muted-foreground">Changes are disabled while viewing live production data in development.</p>
      <Link href="/dashboard" className="mt-6 inline-block underline underline-offset-4">View field notes</Link>
    </main>
  );

  return (
    <>
      {showHeader && <GlobalHeader />}
      {readOnlyPreview && location !== "/" && !location.startsWith("/sign-") && (
        <div className="border-b border-border bg-muted px-5 py-2 text-center text-xs text-foreground">
          Live production data · Read-only preview
        </div>
      )}
      <Switch>
        <Route path="/" component={RootRoute} />
        <Route path="/dashboard">{() => <RequireAuth component={Dashboard} />}</Route>
        <Route path="/field-notes/:id">{() => <RequireAuth component={FieldNoteDetail} />}</Route>
        <Route path="/admin">{() => readOnlyPreview ? readOnlyPage : <RequireAuth component={Admin} />}</Route>
        <Route path="/admin/:id">{() => readOnlyPreview ? readOnlyPage : <RequireAuth component={Admin} />}</Route>
        <Route path="/field-notes/:id/edit">{() => readOnlyPreview ? readOnlyPage : <RequireAuth component={Admin} />}</Route>
        <Route path="/trailcam-studio">{() => <RequireAuth component={TrailcamStudio} />}</Route>
        <Route path="/connect-claude">{() => readOnlyPreview ? readOnlyPage : <RequireAuth component={ConnectClaude} />}</Route>
        <Route path="/inbox">{() => <RequireAuth component={InboxPage} />}</Route>
        <Route path="/expeditions">{() => <RequireAuth component={Expeditions} />}</Route>
        <Route path="/expeditions/new">{() => readOnlyPreview ? readOnlyPage : <RequireAuth component={ExpeditionAdmin} />}</Route>
        <Route path="/expeditions/:id/edit">{() => readOnlyPreview ? readOnlyPage : <RequireAuth component={ExpeditionAdmin} />}</Route>
        {/* Public routes — no auth required */}
        <Route path="/trips/:slug" component={PublicExpeditionPage} />
        <Route path="/notes/:slug" component={PublicFieldNotePage} />
        <Route component={NotFound} />
      </Switch>
      <CarbonNotificationContainer />
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    document.title = /^\/trailcam-studio(?:\/|$)/.test(location)
      ? "Big Miles Studio"
      : "Big Miles Map";
    for (const name of ["application-name", "apple-mobile-web-app-title"]) {
      let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = name;
        document.head.appendChild(meta);
      }
      meta.content = "Big Miles Map";
    }
  }, [location]);

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to continue documenting your adventures",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Start documenting your adventures",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ClerkQueryClientCacheInvalidator />
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={AppContent} />
          </Switch>
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;