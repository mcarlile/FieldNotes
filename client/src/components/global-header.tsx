import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/contexts/theme-context";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, X, Sun, Moon, LogIn, LogOut, User, Inbox } from "lucide-react";
import type { GpxInboxItem } from "@shared/schema";

export default function GlobalHeader() {
  const { user, logout, isLoggingOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}`
    : user?.email ?? "Account";

  const { data: inboxItems = [] } = useQuery<GpxInboxItem[]>({
    queryKey: ["/api/inbox"],
    enabled: !!user,
    refetchInterval: 60000,
  });
  const pendingCount = inboxItems.filter((i: GpxInboxItem) => i.status === "pending").length;


  if (location === "/") {
    return null;
  }

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      onClick={() => setMobileOpen(false)}
      className={`text-sm transition-opacity hover:opacity-100 ${
        location === href ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="bg-background sticky top-0 z-50 backdrop-blur-sm bg-opacity-90">
      <div className="px-5 sm:px-8 h-11 flex items-center justify-between">
        {/* Brand wordmark */}
        <Link
          href="/"
          className="font-serif text-foreground hover:opacity-70 transition-opacity"
          style={{ fontSize: "1.25rem", letterSpacing: "-0.01em" }}
        >
          Big Miles
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          {user && (
            <>
              <Link
                href="/"
                className={`text-sm transition-colors hover:text-foreground hover:underline underline-offset-4 ${
                  location === "/" ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                Home
              </Link>
              <Link
                href="/admin"
                className={`text-sm transition-colors hover:text-foreground hover:underline underline-offset-4 ${
                  location === "/admin" ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                Add Trip
              </Link>
              <Link
                href="/trailcam-studio"
                className={`text-sm transition-colors hover:text-foreground hover:underline underline-offset-4 ${
                  location === "/trailcam-studio" ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                TrailCam
              </Link>
              <Link
                href="/inbox"
                className={`relative text-sm transition-colors hover:text-foreground hover:underline underline-offset-4 flex items-center gap-1.5 ${
                  location === "/inbox" ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <Inbox className="h-3.5 w-3.5" />
                Inbox
                {pendingCount > 0 && (
                  <span className="ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background">
                    {pendingCount > 9 ? "9+" : pendingCount}
                  </span>
                )}
              </Link>
            </>
          )}

          <button
            onClick={toggleTheme}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {user.profileImageUrl ? (
                    <img src={user.profileImageUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                  <span className="max-w-[120px] truncate">{displayName}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  Signed in as {displayName}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => logout()}
                  disabled={isLoggingOut}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <a
              href="/api/login?redirectTo=%2Fadmin"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign in
            </a>
          )}
        </nav>

        {/* Mobile hamburger */}
        <div className="sm:hidden flex items-center gap-3">
          {user && pendingCount > 0 && (
            <Link href="/inbox" className="relative text-muted-foreground">
              <Inbox className="h-4 w-4" />
              <span className="absolute -top-1 -right-1.5 inline-flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-medium text-background">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            </Link>
          )}
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-border px-5 py-4 flex flex-col gap-3">
          {navLink("/", "Home")}
          {navLink("/inbox", "GPX Inbox")}
          {navLink("/admin", "Add Trip")}
          {navLink("/trailcam-studio", "TrailCam Studio")}

          <div className="border-t border-border pt-3 flex flex-col gap-3">
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>

            {user ? (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {user.profileImageUrl ? (
                    <img src={user.profileImageUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                  <span>Signed in as <span className="text-foreground">{displayName}</span></span>
                </div>
                <button
                  onClick={() => { logout(); setMobileOpen(false); }}
                  disabled={isLoggingOut}
                  className="flex items-center gap-2 text-sm text-destructive hover:opacity-80 transition-opacity text-left"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </>
            ) : (
              <a
                href="/api/login?redirectTo=%2Fadmin"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign in
              </a>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
