import { Link, useLocation } from "wouter";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppSwitcherProps {
  onNavigate?: () => void;
}

export default function AppSwitcher({ onNavigate }: AppSwitcherProps) {
  const [location] = useLocation();
  const isStudio = /^\/trailcam-studio(?:\/|$)/.test(location);
  const currentApp = isStudio ? "Studio" : "Map";

  return (
    <div
      className="inline-flex items-stretch whitespace-nowrap text-[0.95rem] leading-none"
      style={{ fontFamily: "'IBM Plex Mono', 'JetBrains Mono', Menlo, monospace" }}
    >
      <Link
        href="/"
        onClick={onNavigate}
        className="inline-flex min-h-11 items-center text-foreground transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        style={{ paddingRight: "0.55em" }}
        aria-label="Big Miles home"
      >
        Big Miles
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1.5 bg-[#FAD82D] px-[0.55em] font-semibold text-[#111111] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={`Big Miles ${currentApp}, switch app`}
            data-testid="app-switcher-trigger"
          >
            {currentApp}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} aria-label="Big Miles apps">
          <DropdownMenuItem asChild>
            <Link
              href="/dashboard"
              onClick={onNavigate}
              aria-current={!isStudio ? "page" : undefined}
              className="min-h-11 gap-4"
            >
              Big Miles Map
              {!isStudio && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              href="/trailcam-studio"
              onClick={onNavigate}
              aria-current={isStudio ? "page" : undefined}
              className="min-h-11 gap-4"
            >
              Big Miles Studio
              {isStudio && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
