export default function WelcomeHero() {
  return (
    <section className="px-5 sm:px-8 pt-8 sm:pt-12 pb-8 sm:pb-10 border-b border-border">
      <div className="meta-mono text-muted-foreground mb-5">
        A personal field notebook and heatmap of long days spent outside
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
          Start logging big miles today
        </p>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <a
          href="/api/login?redirectTo=%2F"
          className="meta-mono inline-flex items-center rounded-full border border-foreground bg-foreground px-4 py-2 text-background hover:opacity-80 transition-opacity"
          data-testid="link-sign-in"
        >
          Sign in &rarr;
        </a>
      </div>
    </section>
  );
}
