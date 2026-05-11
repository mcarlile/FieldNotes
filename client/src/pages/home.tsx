import { useState, forwardRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loading } from "@carbon/react";
import { LayoutGrid, Flame } from "lucide-react";
import FieldNoteCard from "@/components/field-note-card";
import HeatMapView from "@/components/heat-map-view";
import WelcomeHero from "@/components/welcome-hero";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import type { FieldNote } from "@shared/schema";

const availableTripTypes = [
  "Hiking",
  "Cycling",
  "Running",
  "Backpacking",
  "Paddling",
  "Motorcycle",
  "Climbing",
  "Skiing",
  "Other",
];

const distanceOptions = [
  { id: "any", label: "Any" },
  { id: "0-5", label: "0–5 mi" },
  { id: "5-15", label: "5–15 mi" },
  { id: "15-30", label: "15–30 mi" },
  { id: "30+", label: "30+ mi" },
];

const elevationOptions = [
  { id: "any", label: "Any" },
  { id: "0-500", label: "0–500 ft" },
  { id: "500-1500", label: "500–1,500 ft" },
  { id: "1500-3000", label: "1,500–3,000 ft" },
  { id: "3000+", label: "3,000+ ft" },
];

const sortOptions = [
  { id: "recent", label: "Most recent" },
  { id: "oldest", label: "Oldest first" },
  { id: "name", label: "By name" },
];

interface PillProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

const Pill = forwardRef<HTMLButtonElement, PillProps & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ label, active, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={`meta-mono px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? "border-foreground text-foreground bg-muted"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
      } ${className ?? ""}`}
      {...props}
    >
      {label}
    </button>
  ),
);
Pill.displayName = "Pill";

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");
  const [tripTypes, setTripTypes] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState("recent");
  const [viewMode, setViewMode] = useState<"notes" | "heatmap">("notes");
  const [distanceFilter, setDistanceFilter] = useState("any");
  const [elevationFilter, setElevationFilter] = useState("any");

  const { data: allFieldNotes = [], isLoading } = useQuery<FieldNote[]>({
    queryKey: ["/api/field-notes", { search, sortOrder }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (sortOrder) params.append("sortOrder", sortOrder);
      const response = await fetch(`/api/field-notes?${params}`);
      if (!response.ok) throw new Error("Failed to fetch field notes");
      return response.json();
    },
  });

  const fieldNotes = allFieldNotes.filter((note) => {
    if (tripTypes.length > 0 && !tripTypes.includes(note.tripType)) return false;

    if (distanceFilter !== "any") {
      const d = note.distance || 0;
      if (distanceFilter === "0-5" && d > 5) return false;
      if (distanceFilter === "5-15" && (d <= 5 || d > 15)) return false;
      if (distanceFilter === "15-30" && (d <= 15 || d > 30)) return false;
      if (distanceFilter === "30+" && d <= 30) return false;
    }

    if (elevationFilter !== "any") {
      const e = note.elevationGain || 0;
      if (elevationFilter === "0-500" && e > 500) return false;
      if (elevationFilter === "500-1500" && (e <= 500 || e > 1500)) return false;
      if (elevationFilter === "1500-3000" && (e <= 1500 || e > 3000)) return false;
      if (elevationFilter === "3000+" && e <= 3000) return false;
    }

    return true;
  });

  const handleTripTypeChange = (tripType: string, checked: boolean) => {
    setTripTypes((prev) => (checked ? [...prev, tripType] : prev.filter((t) => t !== tripType)));
  };

  const resetFilters = () => {
    setTripTypes([]);
    setDistanceFilter("any");
    setElevationFilter("any");
    setSearch("");
  };

  const activeFilterCount =
    tripTypes.length +
    (distanceFilter !== "any" ? 1 : 0) +
    (elevationFilter !== "any" ? 1 : 0);

  const tripTypePillLabel =
    tripTypes.length === 0
      ? "Trip type"
      : tripTypes.length === 1
      ? tripTypes[0]
      : `${tripTypes.length} types`;

  const distancePillLabel =
    distanceFilter === "any"
      ? "Distance"
      : distanceOptions.find((o) => o.id === distanceFilter)?.label || "Distance";

  const elevationPillLabel =
    elevationFilter === "any"
      ? "Elevation"
      : elevationOptions.find((o) => o.id === elevationFilter)?.label || "Elevation";

  const sortPillLabel = sortOptions.find((o) => o.id === sortOrder)?.label || "Sort";

  // Prominent segmented mode switcher (Notes vs Heat map) — visible in both modes
  const ModeSwitcher = (
    <div
      role="tablist"
      aria-label="View mode"
      className="inline-flex items-center rounded-full border border-border bg-muted/60 p-0.5"
      data-testid="view-mode-switcher"
    >
      <button
        role="tab"
        aria-selected={viewMode === "notes"}
        onClick={() => setViewMode("notes")}
        className={`meta-mono flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
          viewMode === "notes"
            ? "bg-background text-foreground shadow-[0_1px_2px_rgba(26,24,21,0.08)]"
            : "text-muted-foreground hover:text-foreground"
        }`}
        data-testid="mode-notes"
      >
        <LayoutGrid className="h-3 w-3" />
        Field notes
      </button>
      <button
        role="tab"
        aria-selected={viewMode === "heatmap"}
        onClick={() => setViewMode("heatmap")}
        className={`meta-mono flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
          viewMode === "heatmap"
            ? "bg-background text-foreground shadow-[0_1px_2px_rgba(26,24,21,0.08)]"
            : "text-muted-foreground hover:text-foreground"
        }`}
        data-testid="mode-heatmap"
      >
        <Flame className="h-3 w-3" />
        Heat map
      </button>
    </div>
  );

  if (viewMode === "heatmap") {
    return (
      <div className="bg-background flex flex-col" style={{ minHeight: "calc(100vh - 2.75rem)" }}>
        {!isAuthenticated && <WelcomeHero />}
        <div className="px-5 sm:px-8 py-4 flex items-center justify-between border-b border-border gap-3 flex-wrap">
          {ModeSwitcher}
          <span className="meta-mono text-muted-foreground">
            {allFieldNotes.length} {allFieldNotes.length === 1 ? "trip" : "trips"} on the map
          </span>
        </div>
        <div className="h-[calc(100vh-2.75rem-3.5rem)] min-h-[60vh]">
          <HeatMapView fieldNotes={allFieldNotes} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {!isAuthenticated && <WelcomeHero />}

      {/* Section heading + mode switcher */}
      <div id="archive" className="px-5 sm:px-8 pt-6 pb-3 flex items-center justify-between gap-3 flex-wrap scroll-mt-12">
        <div>
          <div className="meta-mono text-muted-foreground">
            {isAuthenticated ? "Your field notes" : "Field notes"}
          </div>
        </div>
        {ModeSwitcher}
      </div>

      {/* Filter pill row */}
      <div className="px-5 sm:px-8 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search field notes…"
            className="meta-mono bg-transparent border-b border-border focus:border-foreground outline-none px-1 py-1.5 text-foreground placeholder:text-muted-foreground transition-colors min-w-0 w-44"
            data-testid="input-search"
          />

          {/* Trip type popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Pill label={tripTypePillLabel} active={tripTypes.length > 0} />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-3 bg-popover border border-border">
              <div className="meta-mono text-muted-foreground mb-2">Trip type</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {availableTripTypes.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <Checkbox
                      checked={tripTypes.includes(type)}
                      onCheckedChange={(c) => handleTripTypeChange(type, !!c)}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Distance popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Pill label={distancePillLabel} active={distanceFilter !== "any"} />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-2 bg-popover border border-border">
              <div className="flex flex-col">
                {distanceOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setDistanceFilter(opt.id)}
                    className={`text-left text-sm px-2 py-1.5 rounded hover:bg-muted ${
                      distanceFilter === opt.id ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Elevation popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Pill label={elevationPillLabel} active={elevationFilter !== "any"} />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-48 p-2 bg-popover border border-border">
              <div className="flex flex-col">
                {elevationOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setElevationFilter(opt.id)}
                    className={`text-left text-sm px-2 py-1.5 rounded hover:bg-muted ${
                      elevationFilter === opt.id ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Sort popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Pill label={sortPillLabel} />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-2 bg-popover border border-border">
              <div className="flex flex-col">
                {sortOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setSortOrder(opt.id)}
                    className={`text-left text-sm px-2 py-1.5 rounded hover:bg-muted ${
                      sortOrder === opt.id ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {isAuthenticated && (
            <Link
              href="/admin"
              className="meta-mono px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            >
              + Add
            </Link>
          )}

          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="meta-mono text-muted-foreground hover:text-foreground underline underline-offset-4 ml-2"
            >
              Reset
            </button>
          )}

          <span className="meta-mono text-muted-foreground ml-auto">
            {fieldNotes.length} {fieldNotes.length === 1 ? "field note" : "field notes"}
          </span>
        </div>
      </div>

      {/* Masonry grid */}
      <main className="px-5 sm:px-8 pb-12">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loading withOverlay={false} small />
          </div>
        ) : fieldNotes.length === 0 ? (
          <div className="text-center py-24">
            <p className="font-serif text-xl text-muted-foreground mb-4">
              {isAuthenticated ? "No field notes yet." : "No field notes match those filters."}
            </p>
            {isAuthenticated && (
              <Link
                href="/admin"
                className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70"
              >
                Add your first &rarr;
              </Link>
            )}
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-3 sm:gap-4">
            {fieldNotes.map((note) => (
              <FieldNoteCard
                key={note.id}
                fieldNote={note}
                searchTerm={search}
                alwaysShowCaption={!isAuthenticated}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
