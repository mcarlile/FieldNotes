import * as crypto from "crypto";
import { pool } from "./db";

// Personal API tokens let integrations such as Claude act for a user without a
// browser session. Tokens are shown once at creation; only their hash is kept.
export const API_TOKEN_PREFIX = "bm_";

export function generateApiToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `${API_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashApiToken(token), tokenPrefix: token.slice(0, 10) };
}

export function hashApiToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Resolves a personal API token to its user id and records when it was used. */
export async function resolveApiToken(token: string): Promise<string | null> {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;
  const result = await pool.query<{ user_id: string }>(
    `UPDATE api_tokens SET last_used_at = now()
     WHERE token_hash = $1
     RETURNING user_id`,
    [hashApiToken(token)],
  );
  return result.rows[0]?.user_id ?? null;
}
