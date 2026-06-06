import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Lock, Copy, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PublishButtonProps {
  id: string;
  isPublished: boolean;
  slug: string | null;
  publishPath: string;   // e.g. "/notes" or "/trips"
  apiPath: string;       // e.g. "/api/field-notes" or "/api/expeditions"
  queryKey: unknown[];
}

export default function PublishButton({
  id,
  isPublished,
  slug,
  publishPath,
  apiPath,
  queryKey,
}: PublishButtonProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const publishMutation = useMutation({
    mutationFn: () => apiRequest(`${apiPath}/${id}/publish`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: () => toast({ title: "Publish failed", variant: "destructive" }),
  });

  const unpublishMutation = useMutation({
    mutationFn: () => apiRequest(`${apiPath}/${id}/unpublish`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: () => toast({ title: "Unpublish failed", variant: "destructive" }),
  });

  const isPending = publishMutation.isPending || unpublishMutation.isPending;
  const publicUrl = slug ? `${window.location.origin}${publishPath}/${slug}` : null;

  function copyLink() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {isPublished && publicUrl && (
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600 transition-colors"
          title="Copy public link"
        >
          {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy link"}
        </button>
      )}

      <button
        onClick={() => isPublished ? unpublishMutation.mutate() : publishMutation.mutate()}
        disabled={isPending}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
          isPublished
            ? "border-green-200 bg-green-50 text-green-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700"
            : "border-stone-200 bg-stone-50 text-stone-600 hover:bg-green-50 hover:border-green-200 hover:text-green-700"
        }`}
      >
        {isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : isPublished ? (
          <Globe size={12} />
        ) : (
          <Lock size={12} />
        )}
        {isPublished ? "Published" : "Publish"}
      </button>
    </div>
  );
}
