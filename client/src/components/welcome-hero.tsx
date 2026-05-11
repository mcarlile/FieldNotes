export default function WelcomeHero() {
  return (
    <section className="px-5 sm:px-8 pt-8 sm:pt-12 pb-8 sm:pb-10 border-b border-border">
      <div className="meta-mono text-muted-foreground mb-5">
        A quiet record of long days outside
      </div>

      <h1
        className="font-serif text-foreground break-words"
        style={{
          fontSize: "clamp(3rem, 9vw, 7.5rem)",
          lineHeight: 0.95,
          letterSpacing: "-0.025em",
        }}
        data-testid="welcome-title"
      >
        Big Miles.
      </h1>

      <div className="mt-6 max-w-xl border-t border-border pt-5">
        <p
          className="font-serif italic text-foreground"
          style={{
            fontSize: "clamp(1.05rem, 1.4vw, 1.35rem)",
            lineHeight: 1.45,
          }}
        >
          Trails, tracks, and weather. Photographs from the days they were
          taken. A small archive of where the year went.
        </p>
      </div>

      <div className="mt-7 flex flex-wrap items-baseline gap-x-6 gap-y-2">
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
        <a
          href="#archive"
          className="meta-mono text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          The archive &darr;
        </a>
      </div>
    </section>
  );
}
