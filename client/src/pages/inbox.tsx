import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, RefreshCw, Trash2, Loader2, CheckCircle, Unlink, Activity, Route, Check, Terminal, Globe, Zap, ExternalLink, KeyRound } from "lucide-react";
import type { GpxInboxItem } from "@shared/schema";

const TRIP_TYPES = [
  { id: "hiking", label: "Hiking" },
  { id: "backpacking", label: "Backpacking" },
  { id: "cycling", label: "Cycling" },
  { id: "running", label: "Running" },
  { id: "paddling", label: "Paddling" },
  { id: "motorcycle", label: "Motorcycle" },
  { id: "climbing", label: "Climbing" },
  { id: "skiing", label: "Skiing" },
  { id: "other", label: "Other" },
];

function formatDistance(km: number | null | undefined) {
  if (!km) return null;
  return `${(km * 0.621371).toFixed(1)} mi`;
}

function formatElevation(m: number | null | undefined) {
  if (!m) return null;
  return `${Math.round(m * 3.28084)} ft`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function formatStravaDistance(meters: number | undefined) {
  if (!meters) return null;
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

function formatStravaElevation(meters: number | undefined) {
  if (!meters) return null;
  return `${Math.round(meters * 3.28084)} ft`;
}

function SourceBadge({ source }: { source: string | null | undefined }) {
  if (source === "strava-activity") {
    return (
      <span className="meta-mono text-orange-500 dark:text-orange-400 flex items-center gap-1">
        <Activity className="h-3 w-3" /> Strava Activity
      </span>
    );
  }
  if (source === "strava-route") {
    return (
      <span className="meta-mono text-orange-500 dark:text-orange-400 flex items-center gap-1">
        <Route className="h-3 w-3" /> Strava Route
      </span>
    );
  }
  return null;
}

// ── Strava panel ─────────────────────────────────────────────────────────────

interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  total_elevation_gain: number;
}

interface StravaRoute {
  id: number;
  name: string;
  type: number;
  distance: number;
  elevation_gain: number;
}

function StravaPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery<{
    state: "no_credentials" | "has_credentials" | "connected";
    connected: boolean;
    hasCredentials: boolean;
    stravaAthleteId?: number;
    redirectUri?: string;
  }>({
    queryKey: ["/api/strava/status"],
    retry: false,
  });

  const redirectUri =
    status?.redirectUri ?? (typeof window !== "undefined" ? `${window.location.origin}/api/strava/callback` : "");

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const saveCredentialsMutation = useMutation({
    mutationFn: (vars: { clientId: string; clientSecret: string }) =>
      apiRequest("POST", "/api/strava/credentials", vars),
    onSuccess: async (resp) => {
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        toast({
          title: "Couldn't save credentials",
          description: (data as any).message ?? "Please check your inputs.",
          variant: "destructive",
        });
        return;
      }
      setClientId("");
      setClientSecret("");
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      toast({ title: "Credentials saved", description: "Now click Connect Strava to authorize." });
    },
  });

  const { data: activities, isLoading: activitiesLoading } = useQuery<StravaActivity[]>({
    queryKey: ["/api/strava/activities"],
    enabled: status?.connected === true,
    retry: false,
  });

  const { data: routes, isLoading: routesLoading } = useQuery<StravaRoute[]>({
    queryKey: ["/api/strava/routes"],
    enabled: status?.connected === true,
    retry: false,
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/strava/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/routes"] });
      toast({ title: "Strava disconnected" });
    },
  });

  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  async function handleImport(type: "activity" | "route", id: number) {
    const key = `${type}-${id}`;
    setImportingId(key);
    try {
      const resp = await apiRequest("POST", `/api/strava/import/${type}/${id}`);
      if (resp.status === 409) {
        toast({ title: "Already in your inbox", description: "This item was imported before." });
        setImportedIds(prev => new Set([...prev, key]));
        return;
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        toast({ title: "Import failed", description: (data as any).message ?? "Unknown error", variant: "destructive" });
        return;
      }
      setImportedIds(prev => new Set([...prev, key]));
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      toast({ title: "Added to inbox", description: "Click 'Add to journal' to import it." });
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    } finally {
      setImportingId(null);
    }
  }

  if (statusLoading) {
    return <div className="h-12 bg-muted animate-pulse rounded mb-12" />;
  }

  // State 1: No credentials yet — show setup form
  if (status?.state === "no_credentials") {
    return (
      <section className="mb-12 pb-12 border-b border-border">
        <div className="meta-mono text-muted-foreground mb-1">Strava</div>
        <h3 className="font-serif text-2xl text-foreground mb-2">Connect your Strava account</h3>
        <p className="font-serif text-base text-foreground/70 leading-relaxed mb-6 max-w-2xl">
          Strava requires every app to use its own API credentials. The setup is free
          and takes about three minutes — follow the steps below, then paste your
          Client ID and Secret into the form.
        </p>

        <ol className="space-y-5 mb-8 max-w-2xl">
          <li className="flex gap-3">
            <span className="meta-mono text-orange-500 shrink-0 pt-0.5">01</span>
            <div className="text-sm text-foreground/80 leading-relaxed">
              <div className="font-semibold text-foreground mb-1">Sign in to Strava and open the API page</div>
              <p>
                Go to{" "}
                <a
                  href="https://www.strava.com/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-500 hover:text-orange-600 underline underline-offset-4 inline-flex items-center gap-1"
                >
                  strava.com/settings/api
                  <ExternalLink className="h-3 w-3" />
                </a>
                . If you've never used the Strava API before, you'll see a short form titled
                "My API Application." If you already have an app, you can reuse it — skip to step 3.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="meta-mono text-orange-500 shrink-0 pt-0.5">02</span>
            <div className="text-sm text-foreground/80 leading-relaxed w-full">
              <div className="font-semibold text-foreground mb-1">Fill out the application form</div>
              <p className="mb-3">
                Use any values you like for the descriptive fields. The only field that
                <em> must </em> match exactly is the callback domain at the bottom.
              </p>
              <div className="space-y-2 p-3 rounded bg-muted/40 border border-border">
                <div className="flex gap-3">
                  <span className="meta-mono text-muted-foreground shrink-0 w-44">Application Name</span>
                  <span className="text-foreground/80">Anything, e.g. <code className="meta-mono">Big Miles</code></span>
                </div>
                <div className="flex gap-3">
                  <span className="meta-mono text-muted-foreground shrink-0 w-44">Category</span>
                  <span className="text-foreground/80"><code className="meta-mono">Visualizer</code> works well</span>
                </div>
                <div className="flex gap-3">
                  <span className="meta-mono text-muted-foreground shrink-0 w-44">Club</span>
                  <span className="text-foreground/80">Leave blank</span>
                </div>
                <div className="flex gap-3">
                  <span className="meta-mono text-muted-foreground shrink-0 w-44">Website</span>
                  <span className="text-foreground/80 break-all">
                    {redirectUri.replace(/\/api\/strava\/callback$/, "")}
                  </span>
                </div>
                <div className="flex gap-3">
                  <span className="meta-mono text-muted-foreground shrink-0 w-44">Application Description</span>
                  <span className="text-foreground/80">Anything (e.g. "Personal trip journal")</span>
                </div>
                <div className="flex flex-col gap-1 pt-2 border-t border-border">
                  <div className="flex gap-3 items-start">
                    <span className="meta-mono text-foreground shrink-0 w-44 font-semibold">
                      Authorization Callback Domain
                    </span>
                    <span className="text-foreground/80">Must be exactly:</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 p-2 rounded bg-background border border-orange-300/60 dark:border-orange-700/60">
                    <code className="meta-mono text-sm flex-1 break-all text-orange-600 dark:text-orange-400">
                      {redirectUri.replace(/^https?:\/\//, "").replace(/\/api\/strava\/callback$/, "")}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        const domain = redirectUri.replace(/^https?:\/\//, "").replace(/\/api\/strava\/callback$/, "");
                        navigator.clipboard.writeText(domain);
                        setCopiedRedirect(true);
                        setTimeout(() => setCopiedRedirect(false), 1500);
                      }}
                      className="meta-mono text-xs text-orange-500 hover:text-orange-600 flex items-center gap-1 shrink-0"
                    >
                      {copiedRedirect ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Just the domain — no <code className="meta-mono">https://</code>, no path, no trailing slash.
                  </p>
                </div>
              </div>
              <p className="mt-3">
                You'll also need to upload a small icon (any square image works — Strava
                requires one to create the app). Then accept the API agreement and click
                <strong> Create</strong>.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="meta-mono text-orange-500 shrink-0 pt-0.5">03</span>
            <div className="text-sm text-foreground/80 leading-relaxed">
              <div className="font-semibold text-foreground mb-1">Copy your Client ID and Client Secret</div>
              <p className="mb-2">
                After creating the app, Strava reloads <a
                  href="https://www.strava.com/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-500 hover:text-orange-600 underline underline-offset-4 inline-flex items-center gap-1"
                >
                  the same page
                  <ExternalLink className="h-3 w-3" />
                </a> and shows your app's details near the top:
              </p>
              <ul className="space-y-1.5 pl-4 list-disc marker:text-orange-500">
                <li>
                  <strong>Client ID</strong> — a short number (5–6 digits), shown in plain text.
                </li>
                <li>
                  <strong>Client Secret</strong> — a long string. Click
                  <span className="meta-mono"> Show </span> next to it to reveal the value, then copy it.
                </li>
              </ul>
              <p className="mt-2">
                Paste both into the form below and click <strong>Save credentials</strong>.
                Your secret is stored only for your account — nobody else can see it.
              </p>
            </div>
          </li>
        </ol>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!clientId.trim() || !clientSecret.trim()) {
              toast({ title: "Both fields are required", variant: "destructive" });
              return;
            }
            saveCredentialsMutation.mutate({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
          }}
          className="max-w-xl space-y-4 p-5 rounded-lg border border-border bg-card"
        >
          <div className="flex items-center gap-2 meta-mono text-muted-foreground mb-1">
            <KeyRound className="h-3 w-3" /> Your Strava app credentials
          </div>
          <div>
            <label htmlFor="strava-client-id" className="meta-mono text-foreground/80 block mb-1.5">
              Client ID
            </label>
            <input
              id="strava-client-id"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456"
              className="w-full px-3 py-2 rounded border border-border bg-background text-foreground meta-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="strava-client-secret" className="meta-mono text-foreground/80 block mb-1.5">
              Client Secret
            </label>
            <input
              id="strava-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="••••••••••••••••••••••••••"
              className="w-full px-3 py-2 rounded border border-border bg-background text-foreground meta-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            disabled={saveCredentialsMutation.isPending}
            className="meta-mono px-4 py-2 rounded-full bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {saveCredentialsMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Save credentials
          </button>
        </form>
      </section>
    );
  }

  // State 2: Credentials saved but not yet authorized
  if (status?.state === "has_credentials") {
    return (
      <section className="mb-12 pb-12 border-b border-border">
        <div className="flex items-start justify-between gap-6 mb-4">
          <div>
            <div className="meta-mono text-muted-foreground mb-1">Strava</div>
            <p className="font-serif text-lg text-foreground/80 leading-snug">
              Credentials saved. Authorize Strava to start importing activities and routes.
            </p>
          </div>
          <a
            href="/api/strava/auth"
            className="meta-mono shrink-0 px-4 py-2 rounded-full bg-orange-500 text-white hover:bg-orange-600 transition-colors"
          >
            Connect Strava →
          </a>
        </div>
        <button
          type="button"
          onClick={() => disconnectMutation.mutate()}
          className="meta-mono text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          Reset credentials
        </button>
      </section>
    );
  }

  const routeTypeLabel = (type: number) => type === 1 ? "Ride" : type === 2 ? "Run" : "Route";

  return (
    <section className="mb-12 pb-12 border-b border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="meta-mono text-muted-foreground flex items-center gap-2">
          <CheckCircle className="h-3 w-3 text-orange-500" />
          Strava connected · #{status.stravaAthleteId}
        </div>
        <button
          type="button"
          onClick={() => disconnectMutation.mutate()}
          disabled={disconnectMutation.isPending}
          className="meta-mono text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
        >
          <Unlink className="h-3 w-3" />
          Disconnect
        </button>
      </div>

      <Tabs defaultValue="activities">
        <TabsList className="mb-4">
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="routes">Routes</TabsTrigger>
        </TabsList>

        <TabsContent value="activities" className="mt-0">
          {activitiesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : !activities?.length ? (
            <p className="meta-mono text-muted-foreground py-4">No recent activities found.</p>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {activities.map(act => {
                const key = `activity-${act.id}`;
                const isImported = importedIds.has(key);
                const isLoading = importingId === key;
                return (
                  <div key={act.id} className="py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <span className="text-foreground text-sm truncate block">{act.name}</span>
                      <div className="meta-mono text-muted-foreground flex flex-wrap gap-x-2 mt-0.5">
                        <span>{act.sport_type}</span>
                        {formatStravaDistance(act.distance) && <><span>·</span><span>{formatStravaDistance(act.distance)}</span></>}
                        {formatStravaElevation(act.total_elevation_gain) && <><span>·</span><span>{formatStravaElevation(act.total_elevation_gain)} gain</span></>}
                        <span>·</span><span>{formatDate(act.start_date)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isImported || isLoading}
                      onClick={() => handleImport("activity", act.id)}
                      className={`meta-mono shrink-0 flex items-center gap-1 transition-colors ${
                        isImported
                          ? "text-muted-foreground"
                          : "text-orange-500 hover:text-orange-600 underline underline-offset-4"
                      }`}
                    >
                      {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : isImported ? "Imported" : "Import →"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="routes" className="mt-0">
          {routesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : !routes?.length ? (
            <p className="meta-mono text-muted-foreground py-4">No saved routes found.</p>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {routes.map(route => {
                const key = `route-${route.id}`;
                const isImported = importedIds.has(key);
                const isLoading = importingId === key;
                return (
                  <div key={route.id} className="py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <span className="text-foreground text-sm truncate block">{route.name}</span>
                      <div className="meta-mono text-muted-foreground flex flex-wrap gap-x-2 mt-0.5">
                        <span>{routeTypeLabel(route.type)}</span>
                        {formatStravaDistance(route.distance) && <><span>·</span><span>{formatStravaDistance(route.distance)}</span></>}
                        {formatStravaElevation(route.elevation_gain) && <><span>·</span><span>{formatStravaElevation(route.elevation_gain)} gain</span></>}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isImported || isLoading}
                      onClick={() => handleImport("route", route.id)}
                      className={`meta-mono shrink-0 flex items-center gap-1 transition-colors ${
                        isImported
                          ? "text-muted-foreground"
                          : "text-orange-500 hover:text-orange-600 underline underline-offset-4"
                      }`}
                    >
                      {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : isImported ? "Imported" : "Import →"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [promoteItem, setPromoteItem] = useState<GpxInboxItem | null>(null);
  const [promoteTitle, setPromoteTitle] = useState("");
  const [promoteDescription, setPromoteDescription] = useState("");
  const [promoteTripType, setPromoteTripType] = useState("hiking");

  // Handle Strava OAuth redirect result (runs once per query-param change, never during render)
  useEffect(() => {
    const stravaParam = new URLSearchParams(search).get("strava");
    if (!stravaParam) return;
    if (stravaParam === "connected") {
      toast({ title: "Strava connected", description: "You can now import activities and routes." });
    } else if (stravaParam === "error") {
      toast({ title: "Strava connection failed", variant: "destructive" });
    } else if (stravaParam === "denied") {
      toast({ title: "Strava connection cancelled" });
    } else if (stravaParam === "needs_credentials") {
      toast({ title: "Add your Strava credentials first", description: "Enter your Client ID and Secret below to continue." });
    }
    history.replaceState(null, "", "/inbox");
    queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { data: tokenData, isLoading: tokenLoading } = useQuery<{ token: string }>({
    queryKey: ["/api/inbox/token"],
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery<GpxInboxItem[]>({
    queryKey: ["/api/inbox"],
  });

  const webhookUrl = tokenData
    ? `${window.location.origin}/api/webhook/gpx/${tokenData.token}`
    : null;

  const regenerateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/inbox/token/regenerate"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/token"] });
      toast({ title: "Webhook URL regenerated", description: "Your old URL is no longer valid." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/inbox/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      toast({ title: "Removed from inbox" });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: ({ id, title, description, tripType }: { id: string; title: string; description: string; tripType: string }) =>
      apiRequest("POST", `/api/inbox/${id}/promote`, { title, description, tripType }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      setPromoteItem(null);
      toast({ title: "Added to Big Miles", description: "Your trip is now in your journal." });
      if (data?.fieldNote?.id) {
        setLocation(`/admin/${data.fieldNote.id}`);
      }
    },
    onError: () => {
      toast({ title: "Failed to promote", variant: "destructive" });
    },
  });

  const [copied, setCopied] = useState(false);
  function copyUrl() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied to clipboard" });
  }

  function openPromote(item: GpxInboxItem) {
    setPromoteTitle(item.filename.replace(/\.gpx$/i, "").replace(/[_-]/g, " "));
    setPromoteDescription("");
    setPromoteTripType("hiking");
    setPromoteItem(item);
  }

  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <div className="min-h-screen bg-background">
      <main className="px-5 sm:px-8 pt-6 pb-16 max-w-3xl mx-auto">
        {/* Page header */}
        <div className="mb-10">
          <div className="meta-mono text-muted-foreground mb-3 flex flex-wrap gap-x-3">
            <span>Inbox · GPX webhook</span>
            {pendingCount > 0 && (
              <>
                <span>·</span>
                <span className="text-foreground">{pendingCount} pending</span>
              </>
            )}
          </div>
          <h1
            className="font-serif text-foreground"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05, letterSpacing: "-0.015em" }}
          >
            GPX Inbox
          </h1>
        </div>

        {/* Strava */}
        <StravaPanel />

        {/* Webhook URL */}
        <section className="mb-12">
          <div className="meta-mono text-muted-foreground mb-3 flex items-center gap-2">
            <Globe className="h-3 w-3" />
            Your webhook URL
          </div>
          <p className="font-serif text-lg text-foreground/80 leading-relaxed mb-4 max-w-2xl">
            Send GPX files to this URL from any app, device, or automation tool. It accepts a
            multipart file upload (field <span className="font-mono text-sm">file</span>),
            raw GPX body, or JSON <span className="font-mono text-sm">{"{ gpx, filename }"}</span>.
          </p>

          {tokenLoading ? (
            <div className="h-10 bg-muted animate-pulse rounded-md" />
          ) : webhookUrl ? (
            <>
              <div className="flex items-center gap-0 border border-border rounded-md bg-muted/40 overflow-hidden">
                <code className="flex-1 font-mono text-xs px-3 py-2.5 text-foreground overflow-x-auto whitespace-nowrap">
                  {webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={copyUrl}
                  className={`meta-mono px-3 py-2.5 transition-colors flex items-center gap-1.5 border-l border-border shrink-0 ${copied ? "text-green-600 bg-green-50 dark:bg-green-950/20" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid="button-copy-url"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              <div className="flex items-center justify-between mt-3">
                <p className="meta-mono text-muted-foreground">
                  Regenerating creates a new URL and invalidates the old one
                </p>
                <button
                  type="button"
                  onClick={() => regenerateMutation.mutate()}
                  disabled={regenerateMutation.isPending}
                  className="meta-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  data-testid="button-regenerate"
                >
                  <RefreshCw className={`h-3 w-3 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
                  Regenerate
                </button>
              </div>

              <div className="mt-5 pt-5 border-t border-border space-y-3">
                <div className="meta-mono text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Terminal className="h-3 w-3" />
                  Quick examples
                </div>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Zap className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="meta-mono text-xs text-foreground/70 block">cURL file upload</span>
                      <code className="block font-mono text-xs text-foreground/80 break-all mt-0.5">
                        curl -X POST "{webhookUrl}" -F "file=@mytrack.gpx"
                      </code>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Zap className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="meta-mono text-xs text-foreground/70 block">Raw GPX body</span>
                      <code className="block font-mono text-xs text-foreground/80 break-all mt-0.5">
                        curl -X POST "{webhookUrl}" -H "Content-Type: application/gpx+xml" --data-binary @track.gpx
                      </code>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Zap className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="meta-mono text-xs text-foreground/70 block">JSON payload</span>
                      <code className="block font-mono text-xs text-foreground/80 break-all mt-0.5">
                        {`curl -X POST "${webhookUrl}" -H "Content-Type: application/json" -d '{"gpx":"<gpx...>","filename":"track.gpx"}'`}
                      </code>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </section>

        {/* Items */}
        <section>
          <div className="meta-mono text-muted-foreground mb-4">
            Received files {items.length > 0 && `· ${items.length}`}
          </div>

          {itemsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="border-t border-border py-16 text-center">
              <p className="font-serif text-xl text-muted-foreground">
                No GPX files yet.
              </p>
              <p className="meta-mono text-muted-foreground mt-3">
                Import from Strava above, or send one to your webhook URL
              </p>
            </div>
          ) : (
            <div className="border-t border-border divide-y divide-border">
              {items.map((item) => {
                const stats = (item.gpxStats ?? {}) as { distance?: number; elevationGain?: number };
                const isPending = item.status === "pending";
                const isPromoted = item.status === "promoted";
                return (
                  <div
                    key={item.id}
                    className={`py-4 flex items-start gap-4 transition-opacity ${!isPending ? "opacity-60" : ""}`}
                    data-testid={`inbox-item-${item.id}`}
                  >
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-foreground text-sm truncate">{item.filename}</span>
                        {isPending && (
                          <span className="meta-mono text-foreground">Pending</span>
                        )}
                        {isPromoted && (
                          <span className="meta-mono text-muted-foreground">Added</span>
                        )}
                        <SourceBadge source={item.source} />
                      </div>

                      <div className="meta-mono text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                        <span>{formatDate(item.receivedAt as unknown as string)}</span>
                        {formatDistance(stats?.distance) && (
                          <>
                            <span>·</span>
                            <span>{formatDistance(stats.distance)}</span>
                          </>
                        )}
                        {formatElevation(stats?.elevationGain) && (
                          <>
                            <span>·</span>
                            <span>{formatElevation(stats.elevationGain)} gain</span>
                          </>
                        )}
                        {item.sourceIp && (
                          <>
                            <span>·</span>
                            <span>from {item.sourceIp}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      {isPending && (
                        <button
                          type="button"
                          onClick={() => openPromote(item)}
                          className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70 transition-opacity"
                          data-testid={`button-promote-${item.id}`}
                        >
                          Add to journal →
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                        className="meta-mono text-muted-foreground hover:text-destructive transition-colors"
                        data-testid={`button-delete-${item.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Promote dialog */}
      <Dialog open={!!promoteItem} onOpenChange={(open) => !open && setPromoteItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-normal">Add to journal</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div>
              <label htmlFor="promote-title" className="meta-mono text-muted-foreground block mb-2">
                Title
              </label>
              <input
                id="promote-title"
                type="text"
                value={promoteTitle}
                onChange={(e) => setPromoteTitle(e.target.value)}
                placeholder="Trip name"
                className="w-full bg-transparent border-b border-border focus:border-foreground outline-none py-2 font-serif text-lg text-foreground placeholder:text-muted-foreground/60 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="promote-desc" className="meta-mono text-muted-foreground block mb-2">
                Description <span className="normal-case">(optional)</span>
              </label>
              <input
                id="promote-desc"
                type="text"
                value={promoteDescription}
                onChange={(e) => setPromoteDescription(e.target.value)}
                placeholder="A quick note about this trip…"
                className="w-full bg-transparent border-b border-border focus:border-foreground outline-none py-2 font-serif text-base text-foreground placeholder:text-muted-foreground/60 transition-colors"
              />
            </div>
            <div>
              <div className="meta-mono text-muted-foreground mb-2">Trip type</div>
              <div className="flex flex-wrap gap-2">
                {TRIP_TYPES.map((t) => {
                  const active = promoteTripType === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setPromoteTripType(t.id)}
                      className={`meta-mono px-3 py-1.5 rounded-full border transition-colors ${
                        active
                          ? "border-foreground text-foreground bg-muted"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-3 sm:gap-6">
            <button
              type="button"
              onClick={() => setPromoteItem(null)}
              className="meta-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!promoteTitle.trim() || promoteMutation.isPending}
              onClick={() => {
                if (!promoteItem) return;
                promoteMutation.mutate({
                  id: promoteItem.id,
                  title: promoteTitle.trim(),
                  description: promoteDescription.trim(),
                  tripType: promoteTripType,
                });
              }}
              className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {promoteMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Add to journal →
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
