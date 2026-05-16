import WelcomeHero from "@/components/welcome-hero";

export default function Home() {
  return (
    <div className="min-h-[calc(100vh-2.75rem)] bg-background overflow-hidden flex flex-col">
      <div className="flex-1">
        <WelcomeHero />
      </div>

      <div className="px-5 sm:px-8 pb-6 sm:pb-8 flex flex-wrap items-center justify-between gap-y-2 border-t border-border pt-4">
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
