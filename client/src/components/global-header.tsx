import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MapPin, Menu, X, Sun, Moon, LogIn, LogOut, User, Inbox } from "lucide-react";
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

  const navLink = (href: string, label: string, icon?: React.ReactNode) => (
    <Link
      href={href}
      onClick={() => setMobileOpen(false)}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        location === href
          ? "bg-accent text-foreground"
          : "text-foreground hover:bg-accent"
      }`}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <header className="bg-card border-b border-border sticky top-0 z-50">
      <div className="px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity">
          <MapPin className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
          <span className="font-semibold text-base">Big Miles</span>
        </Link>

        {/* Desktop right side */}
        <div className="hidden sm:flex items-center gap-1">
          {user && (
            <Link href="/inbox">
              <Button variant="ghost" size="sm" className="gap-1.5 relative">
                <Inbox className="h-4 w-4" />
                Inbox
                {pendingCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white">
                    {pendingCount > 9 ? "9+" : pendingCount}
                  </span>
                )}
              </Button>
            </Link>
          )}

          <button
            onClick={toggleTheme}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  {user.profileImageUrl ? (
                    <img src={user.profileImageUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                  <span className="max-w-[120px] truncate">{displayName}</span>
                </Button>
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
            <a href="/api/login">
              <Button variant="ghost" size="sm" className="gap-2">
                <LogIn className="h-4 w-4" />
                Sign in
              </Button>
            </a>
          )}
        </div>

        {/* Mobile hamburger */}
        <div className="sm:hidden flex items-center gap-2">
          {user && pendingCount > 0 && (
            <Link href="/inbox">
              <Button variant="ghost" size="sm" className="relative p-2">
                <Inbox className="h-5 w-5" />
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              </Button>
            </Link>
          )}
          <button
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-border bg-card px-4 py-3 flex flex-col gap-1">
          {navLink("/", "Home")}
          {navLink("/inbox", "GPX Inbox", <Inbox className="h-4 w-4" />)}
          {navLink("/admin", "Add Trip")}
          {navLink("/trailcam-studio", "TrailCam Studio")}

          <div className="border-t border-border mt-1 pt-2 flex flex-col gap-1">
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-foreground hover:bg-accent transition-colors w-full text-left"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>

            {user ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  {user.profileImageUrl ? (
                    <img src={user.profileImageUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                  <span>Signed in as <strong>{displayName}</strong></span>
                </div>
                <button
                  onClick={() => { logout(); setMobileOpen(false); }}
                  disabled={isLoggingOut}
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-destructive hover:bg-accent transition-colors w-full text-left"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </>
            ) : (
              <a
                href="/api/login"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                <LogIn className="h-4 w-4" />
                Sign in
              </a>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
