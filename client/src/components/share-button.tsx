import { useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Share2, Copy, Check, Loader2, Link2Off } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ShareButtonProps {
  id: string;
  title: string;
  isPublished: boolean;
  slug: string | null;
  queryKey: unknown[];
}

/**
 * Share a trip with a view-only link. Anyone with the link can open the trip's
 * public page without signing in; stopping sharing turns the link off.
 */
export default function ShareButton({ id, title, isPublished, slug, queryKey }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const shareMutation = useMutation({
    mutationFn: () => apiRequest(`/api/field-notes/${id}/publish`, "POST"),
    onSuccess: () => {
      trackEvent("content_published", { content_type: "field_note" });
      return qc.invalidateQueries({ queryKey });
    },
    onError: () => toast({ title: "Couldn't create a link", variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest(`/api/field-notes/${id}/unpublish`, "POST"),
    onSuccess: () => {
      trackEvent("content_unpublished", { content_type: "field_note" });
      return qc.invalidateQueries({ queryKey });
    },
    onError: () => toast({ title: "Couldn't stop sharing", variant: "destructive" }),
  });

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const shareUrl = isPublished && slug ? `${window.location.origin}${basePath}/notes/${slug}` : null;
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      trackEvent("public_link_copied", { content_type: "field_note" });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function nativeShare() {
    if (!shareUrl) return;
    navigator.share({ title, url: shareUrl }).catch(() => {});
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="meta-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          data-testid="button-share"
        >
          <Share2 className="h-3 w-3" />
          {isPublished ? "Shared" : "Share"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-medium text-foreground">Share a view-only link</p>
          <p className="text-xs text-muted-foreground mt-1">
            Anyone with the link can see this trip's map, photos and videos without signing in. They can't edit anything.
          </p>
        </div>

        {shareUrl ? (
          <>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 rounded border border-border bg-muted px-2 py-1.5 text-xs font-mono text-foreground"
                data-testid="input-share-url"
              />
              <button
                onClick={copyLink}
                className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs font-mono hover:bg-muted transition-colors"
                data-testid="button-copy-share-link"
              >
                {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex items-center justify-between">
              {canNativeShare ? (
                <button
                  onClick={nativeShare}
                  className="flex items-center gap-1.5 text-xs font-mono text-foreground hover:underline underline-offset-4"
                >
                  <Share2 className="h-3 w-3" />
                  Send…
                </button>
              ) : <span />}
              <button
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-destructive transition-colors"
                data-testid="button-stop-sharing"
              >
                {stopMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />}
                Stop sharing
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={() => shareMutation.mutate()}
            disabled={shareMutation.isPending}
            className="w-full flex items-center justify-center gap-1.5 rounded bg-foreground text-background px-3 py-2 text-xs font-mono hover:opacity-85 transition-opacity"
            data-testid="button-create-share-link"
          >
            {shareMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Create link
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
