import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { pool } from "./db";

const app = express();
// Increase body size limit to handle large GPX files (50MB limit)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

async function runStartupMigrations() {
  const client = await pool.connect();
  try {
    // Ensure core auth tables exist before anything else runs
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id varchar PRIMARY KEY,
        email varchar UNIQUE,
        first_name varchar,
        last_name varchar,
        profile_image_url varchar,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        sid varchar PRIMARY KEY,
        sess jsonb NOT NULL,
        expire timestamp NOT NULL
      );
      CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions (expire);
    `);

    // Drop legacy columns left over from the old username/password auth system
    await client.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS old_username,
        DROP COLUMN IF EXISTS old_password_hash;
    `);
    // Create GPX inbox tables if they don't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_tokens (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL UNIQUE,
        token text NOT NULL UNIQUE,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gpx_inbox (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
        filename text NOT NULL,
        raw_gpx text NOT NULL,
        gpx_stats jsonb,
        status text NOT NULL DEFAULT 'pending',
        source_ip text,
        received_at timestamp DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS gpx_inbox_user_id_idx ON gpx_inbox (user_id);
      CREATE INDEX IF NOT EXISTS gpx_inbox_status_idx ON gpx_inbox (status);
    `);
    // Add new columns to gpx_inbox if missing (idempotent)
    await client.query(`
      ALTER TABLE gpx_inbox ADD COLUMN IF NOT EXISTS source text;
      ALTER TABLE gpx_inbox ADD COLUMN IF NOT EXISTS strava_id text;
    `);
    // Strava OAuth connections table
    await client.query(`
      CREATE TABLE IF NOT EXISTS strava_connections (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL UNIQUE,
        strava_client_id text,
        strava_client_secret text,
        strava_athlete_id integer,
        access_token text,
        refresh_token text,
        expires_at integer,
        scope text,
        connected_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      );
    `);
    // Add new columns if missing (idempotent)
    await client.query(`
      ALTER TABLE strava_connections
        ADD COLUMN IF NOT EXISTS strava_client_id text,
        ADD COLUMN IF NOT EXISTS strava_client_secret text;
    `);
    // Make previously-required columns nullable so users can store credentials before connecting
    await client.query(`
      ALTER TABLE strava_connections
        ALTER COLUMN strava_athlete_id DROP NOT NULL,
        ALTER COLUMN access_token DROP NOT NULL,
        ALTER COLUMN refresh_token DROP NOT NULL,
        ALTER COLUMN expires_at DROP NOT NULL;
    `);
    // Migrate trip_type column from text to text[] (idempotent)
    await client.query(`
      DO $$ BEGIN
        IF (SELECT data_type FROM information_schema.columns
            WHERE table_name = 'field_notes' AND column_name = 'trip_type') = 'text' THEN
          ALTER TABLE field_notes
            ALTER COLUMN trip_type TYPE text[] USING ARRAY[trip_type];
        END IF;
      END $$;
    `);
    // Mobile API tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS mobile_tokens (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
        token text NOT NULL UNIQUE,
        created_at timestamp DEFAULT now() NOT NULL,
        expires_at timestamp NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mobile_tokens_token_idx ON mobile_tokens (token);
    `);
    log("Startup migrations complete");
  } catch (err) {
    log(`Startup migration warning: ${(err as Error).message}`);
  } finally {
    client.release();
  }
}

(async () => {
  await runStartupMigrations();
  await setupAuth(app);
  registerAuthRoutes(app);

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }

        log(logLine);
      }
    });

    next();
  });

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    let message = err.message || "Internal Server Error";

    if (err.type === 'entity.too.large') {
      message = "GPX file too large. Please try a file smaller than 50MB or compress your GPX data.";
    }

    res.status(status).json({ message });
    throw err;
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
