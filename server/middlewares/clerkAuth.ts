import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { pool } from "../db";
import { users } from "@shared/schema";

/**
 * Require a valid Clerk session and resolve the matching application user.
 *
 * Clerk's sessionClaims.userId preserves the original Replit Auth subject for
 * migrated users. That value is the bridge to the local users table; the
 * Clerk-native auth.userId is reserved for Clerk API calls.
 */
export const requireAuth: RequestHandler = async (req: any, res, next) => {
  const auth = getAuth(req);
  let userId =
    (auth.sessionClaims as { userId?: string } | undefined)?.userId ??
    auth.userId;

  // Native clients exchange a Clerk-authenticated browser session for a
  // revocable, short-lived mobile token. Web requests continue to use Clerk
  // cookies exclusively.
  if (typeof userId !== "string") {
    const authorization = req.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : undefined;

    if (token) {
      const result = await pool.query<{ user_id: string }>(
        `SELECT user_id
         FROM mobile_tokens
         WHERE token = $1 AND expires_at > now()
         LIMIT 1`,
        [token],
      );
      userId = result.rows[0]?.user_id;
    }
  }

  if (typeof userId !== "string") {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    let [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!dbUser) {
      const [inserted] = await db
        .insert(users)
        .values({ id: userId })
        .onConflictDoNothing()
        .returning();

      dbUser =
        inserted ??
        (
          await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
        )[0];
    }

    if (!dbUser) {
      return res.status(500).json({ message: "Unable to resolve application user" });
    }

    req.dbUser = dbUser;
    next();
  } catch (error) {
    console.error("Failed to resolve authenticated user:", error);
    res.status(500).json({ message: "Unable to resolve application user" });
  }
};