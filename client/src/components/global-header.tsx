import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MapPin, Menu, X, Sun, Moon, LogIn, LogOut, User } from "lucide-react";

export default function GlobalHeader() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    setMobileOpen(false);
    navigate("/login");
  };

  return (
    <header className="bg-card border-b border-border sticky top-0 z-50">
      <div className="px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity">
          <MapPin className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
          <span className="font-semibold text-base">Field Notes</span>
        </Link>

        {/* Desktop right side */}
        <div className="hidden sm:flex items-center gap-3">
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
                  <User className="h-4 w-4" />
                  <span>{user.username}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  Signed in as {user.username}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="gap-2 text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link href="/login">
              <Button variant="ghost" size="sm" className="gap-2">
                <LogIn className="h-4 w-4" />
                Sign in
              </Button>
            </Link>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-border bg-card px-4 py-3 flex flex-col gap-1">
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            Home
          </Link>
          <Link
            href="/admin"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            Add Field Note
          </Link>
          <Link
            href="/trailcam-studio"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            TrailCam Studio
          </Link>

          <div className="border-t border-border mt-1 pt-2 flex flex-col gap-1">
            <button
              onClick={() => { toggleTheme(); }}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-foreground hover:bg-accent transition-colors w-full text-left"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>

            {user ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>Signed in as <strong>{user.username}</strong></span>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-destructive hover:bg-accent transition-colors w-full text-left"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                <LogIn className="h-4 w-4" />
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
