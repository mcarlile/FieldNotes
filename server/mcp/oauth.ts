/**
 * OAuth 2.1 + PKCE authorization server for the MCP connector.
 *
 * Routes mounted by registerMcpRoutes():
 *   GET  /.well-known/oauth-authorization-server  – RFC 8414 discovery
 *   POST /oauth/register                           – RFC 7591 dynamic client registration
 *   GET  /oauth/authorize                          – authorization endpoint (browser)
 *   POST /oauth/authorize                          – user confirms authorization
 *   POST /oauth/token                              – authorization-code → access token
 *   POST /oauth/revoke                             – token revocation
 *
 * Access tokens are stored in the existing `mobile_tokens` table so the
 * standard `requireAuth` middleware validates them automatically.
 */

import crypto from "node:crypto";
import type { Router, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../db";

// ── helpers ────────────────────────────────────────────────────────────────

function baseUrl(req: Request): string {
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${req.get("host")}`;
}

function generateToken(bytes = 40): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method === "S256") {
    const computed = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    return computed === challenge;
  }
  // plain — not recommended but required by spec
  return verifier === challenge;
}

// ── DB helpers ──────────────────────────────────────────────────────────────

async function ensureOAuthTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
      client_id   text PRIMARY KEY,
      client_name text,
      redirect_uris text[] NOT NULL DEFAULT '{}',
      created_at  timestamp DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_auth_codes (
      code                   text PRIMARY KEY,
      client_id              text NOT NULL,
      user_id                text NOT NULL,
      redirect_uri           text NOT NULL,
      code_challenge         text NOT NULL,
      code_challenge_method  text NOT NULL DEFAULT 'S256',
      expires_at             timestamp NOT NULL,
      used                   boolean NOT NULL DEFAULT false
    );
  `);
}

// Call once at startup (idempotent).
export { ensureOAuthTables };

// ── discovery ───────────────────────────────────────────────────────────────

export function registerOAuthRoutes(router: Router): void {
  // RFC 8414 – authorization server metadata
  router.get("/.well-known/oauth-authorization-server", (req, res) => {
    const base = baseUrl(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["fieldnotes"],
    });
  });

  // ── dynamic client registration (RFC 7591) ─────────────────────────────
  router.post("/oauth/register", async (req, res) => {
    try {
      const { client_name, redirect_uris } = req.body as {
        client_name?: string;
        redirect_uris?: string[];
      };

      if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
        return res
          .status(400)
          .json({ error: "invalid_client_metadata", error_description: "redirect_uris required" });
      }

      const clientId = generateToken(16);

      await pool.query(
        `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
         VALUES ($1, $2, $3)
         ON CONFLICT (client_id) DO NOTHING`,
        [clientId, client_name ?? "Unknown", redirect_uris],
      );

      res.status(201).json({
        client_id: clientId,
        client_name: client_name ?? "Unknown",
        redirect_uris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });
    } catch (e: any) {
      console.error("OAuth register error:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  // ── authorization endpoint ─────────────────────────────────────────────
  router.get("/oauth/authorize", async (req, res) => {
    const {
      client_id,
      redirect_uri,
      response_type,
      state,
      code_challenge,
      code_challenge_method = "S256",
      scope,
    } = req.query as Record<string, string>;

    // Basic param validation
    if (response_type !== "code") {
      return res.status(400).send(renderError("unsupported_response_type"));
    }
    if (!client_id || !redirect_uri || !code_challenge) {
      return res.status(400).send(renderError("invalid_request", "Missing required parameters"));
    }

    // Verify client exists and redirect_uri is registered
    const clientRow = await pool.query(
      `SELECT redirect_uris FROM mcp_oauth_clients WHERE client_id = $1`,
      [client_id],
    );
    if (clientRow.rows.length === 0) {
      return res.status(400).send(renderError("invalid_client", "Unknown client_id"));
    }
    const allowedUris: string[] = clientRow.rows[0].redirect_uri ?? clientRow.rows[0].redirect_uris ?? [];
    if (!allowedUris.includes(redirect_uri)) {
      return res.status(400).send(renderError("invalid_request", "redirect_uri not registered"));
    }

    // Check Clerk session
    const auth = getAuth(req);
    const clerkUserId =
      (auth.sessionClaims as { userId?: string } | undefined)?.userId ?? auth.userId;

    if (!clerkUserId) {
      // Prompt user to sign in — for a personal app a simple message suffices
      return res.status(401).send(renderSignInRequired(req.url));
    }

    // Render consent page
    res.send(
      renderConsentPage({ client_id, redirect_uri, state, code_challenge, code_challenge_method }),
    );
  });

  // User clicks "Authorize" — issue the code
  router.post("/oauth/authorize", async (req, res) => {
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method = "S256",
    } = req.body as Record<string, string>;

    const auth = getAuth(req);
    const clerkUserId =
      (auth.sessionClaims as { userId?: string } | undefined)?.userId ?? auth.userId;

    // Also accept Bearer mobile_token (for headless testing)
    let userId = clerkUserId;
    if (!userId) {
      const bearer = req.get("authorization");
      const token = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : undefined;
      if (token) {
        const row = await pool.query<{ user_id: string }>(
          `SELECT user_id FROM mobile_tokens WHERE token = $1 AND expires_at > now() LIMIT 1`,
          [token],
        );
        userId = row.rows[0]?.user_id;
      }
    }

    if (!userId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    if (!client_id || !redirect_uri || !code_challenge) {
      return res.status(400).json({ error: "invalid_request" });
    }

    try {
      const code = generateToken(32);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      await pool.query(
        `INSERT INTO mcp_auth_codes
           (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [code, client_id, userId, redirect_uri, code_challenge, code_challenge_method, expiresAt],
      );

      const dest = new URL(redirect_uri);
      dest.searchParams.set("code", code);
      if (state) dest.searchParams.set("state", state);
      res.redirect(302, dest.toString());
    } catch (e: any) {
      console.error("OAuth authorize error:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  // ── token endpoint ──────────────────────────────────────────────────────
  router.post("/oauth/token", async (req, res) => {
    res.set("Cache-Control", "no-store");

    const { grant_type, code, redirect_uri, client_id, code_verifier } =
      req.body as Record<string, string>;

    if (grant_type !== "authorization_code") {
      return res
        .status(400)
        .json({ error: "unsupported_grant_type" });
    }

    if (!code || !redirect_uri || !client_id || !code_verifier) {
      return res.status(400).json({ error: "invalid_request", error_description: "Missing required parameters" });
    }

    try {
      // Look up and validate the code
      const codeRow = await pool.query(
        `SELECT user_id, code_challenge, code_challenge_method, expires_at, used
         FROM mcp_auth_codes
         WHERE code = $1 AND client_id = $2 AND redirect_uri = $3`,
        [code, client_id, redirect_uri],
      );

      if (codeRow.rows.length === 0) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Code not found" });
      }

      const row = codeRow.rows[0];

      if (row.used) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Code already used" });
      }
      if (new Date(row.expires_at) < new Date()) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Code expired" });
      }
      if (!verifyPkce(code_verifier, row.code_challenge, row.code_challenge_method)) {
        return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      }

      // Mark code used
      await pool.query(`UPDATE mcp_auth_codes SET used = true WHERE code = $1`, [code]);

      // Issue a long-lived access token stored in mobile_tokens
      const accessToken = generateToken(40);
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

      await pool.query(
        `INSERT INTO mobile_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [row.user_id, accessToken, expiresAt],
      );

      res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 365 * 24 * 60 * 60,
        scope: "fieldnotes",
      });
    } catch (e: any) {
      console.error("OAuth token error:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  // ── revocation endpoint (RFC 7009) ──────────────────────────────────────
  router.post("/oauth/revoke", async (req, res) => {
    const { token } = req.body as { token?: string };
    if (token) {
      await pool.query(`DELETE FROM mobile_tokens WHERE token = $1`, [token]).catch(() => {});
    }
    // RFC 7009: always return 200 regardless
    res.status(200).json({});
  });
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function renderError(error: string, description?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Authorization Error</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:4rem auto;padding:0 1rem;color:#1a1815}
h1{font-size:1.4rem;margin-bottom:.5rem}p{color:#6b6560}</style></head>
<body><h1>Authorization Error</h1>
<p><code>${error}</code>${description ? ` — ${description}` : ""}</p></body></html>`;
}

function renderSignInRequired(returnUrl: string): string {
  const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(returnUrl)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Sign in required — FieldNotes</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:4rem auto;padding:0 1rem;color:#1a1815}
h1{font-size:1.4rem;margin-bottom:.5rem}p{color:#6b6560}
a{color:#1a1815}
.btn{display:inline-block;margin-top:1rem;padding:.6rem 1.2rem;background:#1a1815;color:#f4f1ec;
     text-decoration:none;border-radius:4px;font-size:.875rem}</style></head>
<body>
<h1>Sign in to FieldNotes</h1>
<p>You need to be signed in to authorize Claude.ai to access your field notes.</p>
<a class="btn" href="${signInUrl}">Sign in →</a>
</body></html>`;
}

function renderConsentPage(params: {
  client_id: string;
  redirect_uri: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
}): string {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = params;
  const field = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escHtml(value)}">`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize — FieldNotes</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;max-width:480px;margin:4rem auto;padding:0 1.25rem;color:#1a1815;background:#f4f1ec}
.card{background:#fff;border:1px solid #e2ddd6;border-radius:8px;padding:2rem}
h1{font-size:1.3rem;margin:0 0 .25rem}
.sub{color:#6b6560;font-size:.875rem;margin:0 0 1.5rem}
.perms{margin:1.25rem 0;padding:0;list-style:none}
.perms li{display:flex;align-items:flex-start;gap:.5rem;margin-bottom:.5rem;font-size:.875rem}
.perms li::before{content:"✓";color:#2d6a4f;flex-shrink:0;margin-top:.05rem}
.actions{display:flex;gap:.75rem;margin-top:1.5rem}
.btn{flex:1;padding:.6rem;border:none;border-radius:4px;font-size:.9rem;cursor:pointer;text-align:center}
.btn-allow{background:#1a1815;color:#f4f1ec}
.btn-deny{background:#e8e4de;color:#1a1815;text-decoration:none;display:flex;align-items:center;justify-content:center}
</style></head>
<body><div class="card">
<h1>Authorize Claude.ai</h1>
<p class="sub">Claude.ai wants access to your FieldNotes account.</p>
<ul class="perms">
  <li>Read your field notes</li>
  <li>Create new field notes</li>
  <li>Update existing field notes</li>
  <li>Attach GPS tracks to field notes</li>
</ul>
<form method="POST" action="/oauth/authorize" class="actions">
  ${field("client_id", client_id)}
  ${field("redirect_uri", redirect_uri)}
  ${state ? field("state", state) : ""}
  ${field("code_challenge", code_challenge)}
  ${field("code_challenge_method", code_challenge_method)}
  <a class="btn btn-deny" href="/">Deny</a>
  <button class="btn btn-allow" type="submit">Authorize</button>
</form>
</div></body></html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
