export default function Welcome() {
  return (
    <div className="min-h-screen flex flex-col bg-background overflow-hidden">
      {/* Top meta strip */}
      <div className="px-6 sm:px-10 pt-6 sm:pt-8 flex items-center justify-between">
        <div className="meta-mono text-muted-foreground">
          Big Miles &nbsp;·&nbsp; Field Journal
        </div>
        <div className="meta-mono text-muted-foreground hidden sm:block">
          Est. 2025
        </div>
      </div>

      {/* Hero block */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-10 max-w-5xl">
        <div className="meta-mono text-muted-foreground mb-6">
          A quiet record of long days outside
        </div>

        <h1
          className="font-serif text-foreground break-words"
          style={{
            fontSize: "clamp(3.5rem, 11vw, 9rem)",
            lineHeight: 0.95,
            letterSpacing: "-0.025em",
          }}
          data-testid="welcome-title"
        >
          Big Miles.
        </h1>

        <div className="mt-8 max-w-xl border-t border-border pt-6">
          <p
            className="font-serif italic text-foreground"
            style={{ fontSize: "clamp(1.125rem, 1.6vw, 1.5rem)", lineHeight: 1.45 }}
          >
            Trails, tracks, and weather. Photographs from the days they were
            taken. A small archive of where the year went.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <a
            href="/api/login"
            className="meta-mono text-foreground border-b border-foreground pb-0.5 hover:opacity-70 transition-opacity"
            data-testid="link-sign-in"
          >
            Sign in &rarr;
          </a>
          <span className="meta-mono text-muted-foreground">
            via Replit, Google, Apple, or email
          </span>
        </div>
      </div>

      {/* Bottom colophon */}
      <div className="px-6 sm:px-10 pb-6 sm:pb-8 flex flex-wrap items-center justify-between gap-y-2 border-t border-border pt-4">
        <div className="meta-mono text-muted-foreground">
          GPX &nbsp;·&nbsp; Photos &nbsp;·&nbsp; Maps
        </div>
        <div className="meta-mono text-muted-foreground">
          Instrument Serif / Inter / JetBrains Mono
        </div>
      </div>
    </div>
  );
}
