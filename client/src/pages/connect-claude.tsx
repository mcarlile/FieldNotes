import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const pillButtonClass =
  "meta-mono px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors";

export default function ConnectClaude() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("Claude");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mcpUrl = `${window.location.origin}/mcp`;

  const { data: tokens = [], isLoading } = useQuery<ApiToken[]>({
    queryKey: ["/api/api-tokens"],
    queryFn: async () => (await apiRequest("/api/api-tokens", "GET")).json(),
  });

  const createToken = useMutation({
    mutationFn: async () => (await apiRequest("/api/api-tokens", "POST", { name })).json(),
    onSuccess: (created: ApiToken & { token: string }) => {
      setNewToken(created.token);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ["/api/api-tokens"] });
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message || "Failed to create token", variant: "destructive" }),
  });

  const revokeToken = useMutation({
    mutationFn: async (id: string) => apiRequest(`/api/api-tokens/${id}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/api-tokens"] }),
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message || "Failed to revoke token", variant: "destructive" }),
  });

  const copyToken = async () => {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
  };

  return (
    <main className="px-5 sm:px-8 pt-6 pb-16 max-w-3xl mx-auto">
      <div className="meta-mono text-muted-foreground mb-3">Settings · integrations</div>
      <h1
        className="font-serif text-foreground"
        style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05, letterSpacing: "-0.015em" }}
      >
        Connect Claude
      </h1>
      <p className="font-serif text-lg text-foreground/70 mt-3 leading-relaxed">
        A token lets Claude create TrailCam Studio projects and upload videos and GPX files for you,
        through the Big Miles MCP server at <code className="text-foreground">{mcpUrl}</code>.
        A token can do anything your account can, so revoke any you no longer use.
      </p>

      <section className="mt-10 border-t border-border pt-6">
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            createToken.mutate();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Token name"
            maxLength={80}
            className="bg-transparent border border-border rounded-md px-3 py-1.5 text-foreground"
            data-testid="input-token-name"
          />
          <button
            type="submit"
            className={pillButtonClass}
            disabled={!name.trim() || createToken.isPending}
            data-testid="button-create-token"
          >
            + New token
          </button>
        </form>

        {newToken && (
          <div className="mt-6 rounded-md border border-border p-4">
            <div className="meta-mono text-muted-foreground mb-2">
              Copy this token now. It won't be shown again.
            </div>
            <div className="flex items-center gap-3">
              <code className="break-all text-foreground" data-testid="text-new-token">{newToken}</code>
              <button type="button" onClick={copyToken} className={pillButtonClass} aria-label="Copy token">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
            <div className="meta-mono text-muted-foreground mt-4 mb-2">Claude Code setup</div>
            <pre className="whitespace-pre-wrap break-all text-sm text-foreground/80">
              {`claude mcp add --transport http big-miles ${mcpUrl} --header "Authorization: Bearer ${newToken}"`}
            </pre>
          </div>
        )}
      </section>

      <section className="mt-10">
        <div className="meta-mono text-muted-foreground mb-3">Tokens · {tokens.length}</div>
        {isLoading ? (
          <div className="meta-mono text-muted-foreground">Loading…</div>
        ) : tokens.length === 0 ? (
          <p className="font-serif text-muted-foreground">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {tokens.map((token) => (
              <li key={token.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="text-foreground">{token.name}</div>
                  <div className="meta-mono text-muted-foreground">
                    {token.tokenPrefix}… · created {new Date(token.createdAt).toLocaleDateString()} ·{" "}
                    {token.lastUsedAt ? `last used ${new Date(token.lastUsedAt).toLocaleString()}` : "never used"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revokeToken.mutate(token.id)}
                  className={pillButtonClass}
                  disabled={revokeToken.isPending}
                  data-testid={`button-revoke-token-${token.id}`}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
