import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Copy,
  RefreshCw,
  Trash2,
  ArrowUpRight,
  Inbox,
  CheckCircle,
  Clock,
  Link as LinkIcon,
  MapPin,
  Mountain,
  Calendar,
} from "lucide-react";
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
  return `${Math.round(m * 3.28084)} ft gain`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export default function InboxPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [promoteItem, setPromoteItem] = useState<GpxInboxItem | null>(null);
  const [promoteTitle, setPromoteTitle] = useState("");
  const [promoteDescription, setPromoteDescription] = useState("");
  const [promoteTripType, setPromoteTripType] = useState("hiking");

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
      toast({ title: "Added to Big Miles!", description: "Your trip is now in your journal." });
      if (data?.fieldNote?.id) {
        setLocation(`/admin/${data.fieldNote.id}`);
      }
    },
    onError: () => {
      toast({ title: "Failed to promote", variant: "destructive" });
    },
  });

  function copyUrl() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    toast({ title: "Copied to clipboard" });
  }

  function openPromote(item: GpxInboxItem) {
    const stats = item.gpxStats as any;
    setPromoteTitle(item.filename.replace(/\.gpx$/i, "").replace(/[_-]/g, " "));
    setPromoteDescription("");
    setPromoteTripType("hiking");
    setPromoteItem(item);
  }

  const pendingCount = items.filter(i => i.status === "pending").length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Inbox className="h-6 w-6 text-green-600 dark:text-green-400" />
          <h1 className="text-2xl font-bold text-foreground">GPX Inbox</h1>
          {pendingCount > 0 && (
            <Badge className="bg-green-600 text-white">{pendingCount} new</Badge>
          )}
        </div>

        {/* Webhook URL card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Your webhook URL</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Send GPX files to this URL from any app, device, or automation tool. It accepts multipart
            file uploads (field name <code className="bg-muted px-1 rounded text-xs">file</code>),
            raw GPX body, or JSON <code className="bg-muted px-1 rounded text-xs">{"{ gpx, filename }"}</code>.
          </p>

          {tokenLoading ? (
            <div className="h-10 bg-muted animate-pulse rounded-md" />
          ) : webhookUrl ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted border border-border rounded-md px-3 py-2 text-foreground overflow-x-auto whitespace-nowrap">
                {webhookUrl}
              </code>
              <Button variant="outline" size="sm" onClick={copyUrl} className="gap-1 shrink-0">
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
          ) : null}

          <div className="pt-1 border-t border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Regenerating creates a new URL and invalidates the old one.</p>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground hover:text-destructive"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
              Regenerate
            </Button>
          </div>

          {/* Example curl command */}
          {webhookUrl && (
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground mb-1 font-medium">Example — send from terminal:</p>
              <code className="text-xs text-foreground break-all">
                curl -X POST "{webhookUrl}" \<br />
                {"  "}-F "file=@mytrack.gpx"
              </code>
            </div>
          )}
        </div>

        {/* Inbox items */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Received files
          </h2>

          {itemsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-foreground font-medium">No GPX files yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Send a GPX file to your webhook URL and it will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(item => {
                const stats = item.gpxStats as any;
                const isPending = item.status === "pending";
                const isPromoted = item.status === "promoted";
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border bg-card p-4 flex items-start gap-4 transition-opacity ${!isPending ? "opacity-60" : ""}`}
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground text-sm truncate">{item.filename}</span>
                        {isPending && (
                          <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-300">
                            <Clock className="h-3 w-3" /> Pending
                          </Badge>
                        )}
                        {isPromoted && (
                          <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-300">
                            <CheckCircle className="h-3 w-3" /> Added
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(item.receivedAt as unknown as string)}
                        </span>
                        {formatDistance(stats?.distance) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {formatDistance(stats.distance)}
                          </span>
                        )}
                        {formatElevation(stats?.elevationGain) && (
                          <span className="flex items-center gap-1">
                            <Mountain className="h-3 w-3" />
                            {formatElevation(stats.elevationGain)}
                          </span>
                        )}
                        {item.sourceIp && (
                          <span className="text-muted-foreground/60">from {item.sourceIp}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isPending && (
                        <Button
                          size="sm"
                          variant="default"
                          className="gap-1 bg-green-600 hover:bg-green-700 text-white text-xs"
                          onClick={() => openPromote(item)}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          Add to journal
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Promote dialog */}
      <Dialog open={!!promoteItem} onOpenChange={open => !open && setPromoteItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to journal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="promote-title">Title</Label>
              <Input
                id="promote-title"
                value={promoteTitle}
                onChange={e => setPromoteTitle(e.target.value)}
                placeholder="Trip name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="promote-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="promote-desc"
                value={promoteDescription}
                onChange={e => setPromoteDescription(e.target.value)}
                placeholder="A quick note about this trip..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Trip type</Label>
              <Select value={promoteTripType} onValueChange={setPromoteTripType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIP_TYPES.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteItem(null)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
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
            >
              {promoteMutation.isPending ? "Adding..." : "Add to journal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
