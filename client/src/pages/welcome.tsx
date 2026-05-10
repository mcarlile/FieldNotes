export default function Welcome() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      <div className="max-w-md w-full text-center space-y-10">
        <h1
          className="font-serif text-foreground"
          style={{ fontSize: "3.5rem", letterSpacing: "-0.02em", lineHeight: 1 }}
        >
          Big Miles
        </h1>

        <p className="font-serif italic text-muted-foreground text-xl leading-relaxed">
          A field journal for long days outside.
        </p>

        <div className="pt-4">
          <a
            href="/api/login"
            className="text-sm text-foreground underline underline-offset-4 decoration-muted-foreground hover:decoration-foreground transition-colors"
          >
            Sign in &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
