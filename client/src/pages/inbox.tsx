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
import { Copy, RefreshCw, Trash2, Loader2, CheckCircle, Unlink, Activity, Route, Check, Terminal, Globe, Zap, Search } from "lucide-react";
import type { GpxInboxItem } from "@shared/schema";

const TRIP_TYPES = [
  { id: "hiking", label: "Hiking" },
  { id: "backpacking", label: "Backpacking" },
  { id: "cycling", label: "Cycling" },
  { id: "running", label: "Running" },
  { id: "paddling", label: "Paddling" },
  { id: "fishing", label: "Fishing" },
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

// Map Strava sport types to our internal trip types
function mapStravaSportToTripType(sportType: string): string {
  const s = sportType.toLowerCase();
  if (s.includes("run")) return "running";
  if (s.includes("ride") || s.includes("bike") || s.includes("cycl")) return "cycling";
  if (s.includes("hike")) return "hiking";
  if (s.includes("walk")) return "hiking";
  if (s.includes("ski")) return "skiing";
  if (s.includes("kayak") || s.includes("canoe") || s.includes("paddl") || s.includes("row")) return "paddling";
  if (s.includes("climb")) return "climbing";
  if (s.includes("motor")) return "motorcycle";
  return "other";
}

function mapStravaRouteTypeToTripType(type: number): string {
  if (type === 1) return "cycling";
  if (type === 2) return "running";
  return "other";
}

interface ImportedHint {
  item: GpxInboxItem;
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedTripType: string;
}

function StravaPanel({ onImported }: { onImported: (hint: ImportedHint) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery<{
    state: "not_configured" | "disconnected" | "connected";
    connected: boolean;
    stravaAthleteId?: number;
  }>({
    queryKey: ["/api/strava/status"],
    retry: false,
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
    mutationFn: () => apiRequest("/api/strava/disconnect", "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/routes"] });
      toast({ title: "Strava disconnected" });
    },
  });

  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  async function handleImport(
    type: "activity" | "route",
    id: number,
    meta: { name: string; sportType?: string; routeType?: number },
  ) {
    const key = `${type}-${id}`;
    setImportingId(key);
    try {
      // Use raw fetch — apiRequest throws on non-2xx, which swallows our 409 handling
      const resp = await fetch(`/api/strava/import/${type}/${id}`, {
        method: "POST",
        credentials: "include",
      });
      let item: GpxInboxItem | null = null;
      const isDuplicate = resp.status === 409;

      if (isDuplicate) {
        // Server returns { message, inboxItemId } — look up the existing item
        const data = await resp.json().catch(() => ({} as any));
        if (data?.inboxItemId) {
          const listResp = await fetch("/api/inbox", { credentials: "include" });
          if (listResp.ok) {
            const list: GpxInboxItem[] = await listResp.json();
            item = list.find(i => i.id === data.inboxItemId) ?? null;
          }
        }
      } else if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        toast({ title: "Import failed", description: (data as any).message ?? "Unknown error", variant: "destructive" });
        return;
      } else {
        item = await resp.json().catch(() => null);
      }

      setImportedIds(prev => new Set([...prev, key]));
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });

      if (!item?.id) {
        toast({ title: isDuplicate ? "Already in your inbox" : "Added to inbox", description: "Find it below to add it to your journal." });
        return;
      }

      // If it's already promoted, just notify — don't reopen the dialog
      if (item.status === "promoted") {
        toast({ title: "Already in your journal", description: "This Strava item has already been added." });
        return;
      }

      // Open the "Add to journal" dialog automatically with preloaded fields
      const suggestedTripType = type === "activity"
        ? mapStravaSportToTripType(meta.sportType ?? "")
        : mapStravaRouteTypeToTripType(meta.routeType ?? 0);
      const sourceLabel = type === "activity" ? "Strava activity" : "Strava route";
      onImported({
        item,
        suggestedTitle: meta.name,
        suggestedDescription: `Imported from ${sourceLabel} on ${new Date().toLocaleDateString()}.`,
        suggestedTripType,
      });
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    } finally {
      setImportingId(null);
    }
  }

  if (statusLoading) {
    return <div className="h-12 bg-muted animate-pulse rounded mb-12" />;
  }

  // App not configured (STRAVA_CLIENT_ID/SECRET not set in env)
  if (status?.state === "not_configured") {
    return (
      <section className="mb-12 pb-12 border-b border-border">
        <div className="meta-mono text-muted-foreground mb-1">Strava</div>
        <p className="font-serif text-base text-foreground/70">
          Strava integration is not configured yet. Check back soon.
        </p>
      </section>
    );
  }

  // Not connected — show connect button
  if (!status?.connected) {
    return (
      <section className="mb-12 pb-12 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <div className="meta-mono text-muted-foreground mb-1">Strava</div>
            <p className="font-serif text-lg text-foreground/80 leading-snug">
              Connect Strava to import activities and routes directly into your inbox.
            </p>
          </div>
          <a
            href="/api/strava/auth"
            className="meta-mono shrink-0 text-orange-500 hover:text-orange-600 underline underline-offset-4 transition-colors"
          >
            Connect Strava →
          </a>
        </div>
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
                      onClick={() => handleImport("activity", act.id, { name: act.name, sportType: act.sport_type })}
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
                      onClick={() => handleImport("route", route.id, { name: route.name, routeType: route.type })}
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
  const [promoteTripTypes, setPromoteTripTypes] = useState<string[]>(["hiking"]);

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
    mutationFn: () => apiRequest("/api/inbox/token/regenerate", "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/token"] });
      toast({ title: "Webhook URL regenerated", description: "Your old URL is no longer valid." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/inbox/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      toast({ title: "Removed from inbox" });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: ({ id, title, description, tripType }: { id: string; title: string; description: string; tripType: string[] }) =>
      apiRequest(`/api/inbox/${id}/promote`, "POST", { title, description, tripType }),
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

  function openPromote(item: GpxInboxItem, prefill?: { title?: string; description?: string; tripType?: string }) {
    setPromoteTitle(prefill?.title ?? item.filename.replace(/\.gpx$/i, "").replace(/[_-]/g, " "));
    setPromoteDescription(prefill?.description ?? "");
    setPromoteTripTypes(prefill?.tripType ? [prefill.tripType] : ["hiking"]);
    setPromoteItem(item);
  }

  // Search + filtered items
  const [searchQuery, setSearchQuery] = useState("");
  const filteredItems = items.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const stats = (item.gpxStats ?? {}) as { name?: string; description?: string };
    return (
      item.filename.toLowerCase().includes(q) ||
      (stats.name ?? "").toLowerCase().includes(q) ||
      (stats.description ?? "").toLowerCase().includes(q)
    );
  });

  // Handle the import → preloaded promote dialog flow.
  function handleStravaImported(hint: ImportedHint) {
    openPromote(hint.item, {
      title: hint.suggestedTitle,
      description: hint.suggestedDescription,
      tripType: hint.suggestedTripType,
    });
  }


  return (
    <div className="min-h-screen bg-background">
      <main className="px-5 sm:px-8 pt-6 pb-16 max-w-3xl mx-auto">
        {/* Page header */}
        <div className="mb-10">
          <div className="meta-mono text-muted-foreground mb-3 flex flex-wrap gap-x-3">
            <span>Inbox · GPX webhook</span>
          </div>
          <h1
            className="font-serif text-foreground"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05, letterSpacing: "-0.015em" }}
          >
            GPX Inbox
          </h1>
        </div>

        {/* Strava */}
        <StravaPanel onImported={handleStravaImported} />

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
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            <div className="meta-mono text-muted-foreground">
              Received files {items.length > 0 && `· ${items.length}`}
            </div>
            {items.length > 0 && (
              <div className="relative flex-1 max-w-xs min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name or description"
                  className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-background text-foreground meta-mono text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
                  data-testid="input-inbox-search"
                />
              </div>
            )}
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
          ) : filteredItems.length === 0 ? (
            <div className="border-t border-border py-12 text-center">
              <p className="meta-mono text-muted-foreground">
                No files match "{searchQuery}"
              </p>
            </div>
          ) : (
            <div className="border-t border-border divide-y divide-border">
              {filteredItems.map((item) => {
                const stats = (item.gpxStats ?? {}) as { distance?: number; elevationGain?: number };
                const isPromoted = item.status === "promoted";
                return (
                  <div
                    key={item.id}
                    className="py-4 flex items-start gap-4"
                    data-testid={`inbox-item-${item.id}`}
                  >
                    {isPromoted && (
                      <div className="shrink-0 mt-0.5 text-green-600 dark:text-green-500" aria-label="Imported">
                        <CheckCircle className="h-5 w-5" />
                      </div>
                    )}
                    <div className={`flex-1 min-w-0 space-y-1.5 ${isPromoted ? "opacity-70" : ""}`}>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-foreground text-sm truncate">{item.filename}</span>
                        {isPromoted && (
                          <span className="meta-mono inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 text-[10px] uppercase tracking-wider">
                            <Check className="h-3 w-3" /> Imported
                          </span>
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
                      {!isPromoted && (
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
                  const active = promoteTripTypes.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        setPromoteTripTypes((prev) =>
                          prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                        )
                      }
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
                  tripType: promoteTripTypes,
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
