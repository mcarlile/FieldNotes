export default function Welcome() {
  return (
    <div className="min-h-[calc(100vh-2.75rem)] flex flex-col bg-background overflow-hidden">
      {/* Hero block */}
      <div className="flex-1 flex flex-col justify-center px-5 sm:px-8 max-w-5xl pt-10 sm:pt-16">
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
      <div className="px-5 sm:px-8 pb-6 sm:pb-8 mt-16 flex flex-wrap items-center justify-between gap-y-2 border-t border-border pt-4">
        <div className="meta-mono text-muted-foreground">
          GPX &nbsp;·&nbsp; Photos &nbsp;·&nbsp; Maps &nbsp;·&nbsp; Est. 2025
        </div>
        <div className="meta-mono text-muted-foreground">
          Fraunces / Inter / JetBrains Mono
        </div>
      </div>
    </div>
  );
}
