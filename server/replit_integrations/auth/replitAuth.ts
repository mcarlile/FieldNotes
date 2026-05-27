import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { randomBytes } from "crypto";
import { authStorage } from "./storage";
import { storage } from "../../storage";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  const registeredStrategies = new Set<string>();

  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  function getRedirectCookie(req: any): string | undefined {
    if (!req.headers.cookie) return undefined;
    const match = req.headers.cookie.match(/(?:^|;\s*)auth_redirect=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  }

  app.get("/api/login", (req, res, next) => {
    const redirectTo = typeof req.query.redirectTo === "string" ? req.query.redirectTo : "/";
    res.setHeader(
      "Set-Cookie",
      `auth_redirect=${encodeURIComponent(redirectTo)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`
    );
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(
      `replitauth:${req.hostname}`,
      { failureRedirect: "/api/login" },
      (err: any, user: Express.User) => {
        if (err) return next(err);
        if (!user) return res.redirect("/api/login");
        req.logIn(user, async (err) => {
          if (err) return next(err);
          const returnTo = getRedirectCookie(req) || "/";
          res.setHeader("Set-Cookie", "auth_redirect=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");

          // Mobile deep-link auth: issue a long-lived token and redirect to app scheme
          if (returnTo === "mobile") {
            try {
              const userId = (user as any).claims?.sub;
              if (!userId) return res.redirect("/");
              const token = randomBytes(32).toString("hex");
              const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
              await storage.createMobileToken(userId, token, expiresAt);
              return res.redirect(`bigmiles://auth?token=${token}`);
            } catch (e) {
              return res.redirect("bigmiles://auth?error=token_failed");
            }
          }

          res.redirect(returnTo);
        });
      }
    )(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Mobile clients send Bearer tokens
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const mobileToken = await storage.getMobileToken(token);
      if (mobileToken && mobileToken.expiresAt > new Date()) {
        // Inject a synthetic user object compatible with existing session-based route handlers
        (req as any).user = {
          claims: { sub: mobileToken.userId },
          expires_at: Math.floor(mobileToken.expiresAt.getTime() / 1000),
        };
        return next();
      }
    } catch {
      // fall through to session check
    }
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Web session auth
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
