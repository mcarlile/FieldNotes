import { MapPin, Map, Camera, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Welcome() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 py-16">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-green-600/10 dark:bg-green-500/10">
            <MapPin className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Field Notes</h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            Your personal outdoor trip journal. Document GPX tracks, photos, and trail footage from every adventure.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground">
          <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-card border border-border">
            <Map className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span>GPX Tracks</span>
          </div>
          <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-card border border-border">
            <Camera className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span>Trail Photos</span>
          </div>
          <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-card border border-border">
            <FileText className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span>Trip Notes</span>
          </div>
        </div>

        <a href="/api/login" className="block">
          <Button size="lg" className="w-full bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white font-semibold">
            Sign in to get started
          </Button>
        </a>

        <p className="text-xs text-muted-foreground">
          Sign in with your Replit account — no separate registration needed.
        </p>
      </div>
    </div>
  );
}
