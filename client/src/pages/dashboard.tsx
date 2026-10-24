import { useState, useEffect, forwardRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Loading } from "@carbon/react";
import { ChevronDown, ChevronUp, CirclePlus, Upload } from "lucide-react";
import FieldNoteCard from "@/components/field-note-card";
import HeatMapView from "@/components/heat-map-view";
import ViewModeSwitcher, { type ViewMode } from "@/components/view-mode-switcher";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import type { TripListItem } from "@shared/schema";

const availableTripTypes = [
  { id: "hiking", label: "Hiking" },
  { id: "cycling", label: "Cycling" },
  { id: "running", label: "Running" },
  { id: "backpacking", label: "Backpacking" },
  { id: "paddling", label: "Paddling" },
  { id: "fishing", label: "Fishing" },
  { id: "motorcycle", label: "Motorcycle" },
  { id: "climbing", label: "Climbing" },
  { id: "skiing", label: "Skiing" },
  { id: "openwater", label: "Open Water Swimming" },
  { id: "other", label: "Other" },
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

// Trips with video used to be TrailCam Studio projects; now any trip can have clips.
const mediaOptions = [
  { id: "all", label: "All trips" },
  { id: "photos", label: "Has photos" },
  { id: "videos", label: "Contains videos" },
] as const;
type MediaFilter = (typeof mediaOptions)[number]["id"];

// /dashboard?media=videos (where old Studio links land) opens on that filter.
const mediaFilterFrom = (search: string): MediaFilter => {
  const wanted = new URLSearchParams(search).get("media");
  return mediaOptions.some((o) => o.id === wanted) ? (wanted as MediaFilter) : "all";
};

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

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [tripTypes, setTripTypes] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState("recent");
  const [viewMode, setViewMode] = useState<ViewMode>("notes");
  const [createOpen, setCreateOpen] = useState(false);
  const [distanceFilter, setDistanceFilter] = useState("any");
  const [elevationFilter, setElevationFilter] = useState("any");
  const urlSearch = useSearch();
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>(() => mediaFilterFrom(urlSearch));
  useEffect(() => {
    if (new URLSearchParams(urlSearch).has("media")) setMediaFilter(mediaFilterFrom(urlSearch));
  }, [urlSearch]);

  const { data: everyTrip = [], isLoading } = useQuery<TripListItem[]>({
    queryKey: ["/api/field-notes", { search, sortOrder }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (sortOrder) params.append("sortOrder", sortOrder);
      const response = await apiRequest(`/api/field-notes?${params}`, "GET");
      return response.json();
    },
  });
  const allFieldNotes = everyTrip.filter((note) =>
    mediaFilter === "photos" ? note.photoCount > 0 : mediaFilter === "videos" ? note.videoCount > 0 : true,
  );
  const tripTypeOptions = [
    ...availableTripTypes,
    ...Array.from(new Map(allFieldNotes.flatMap((note) => note.tripType)
      .filter((type) => !availableTripTypes.some((option) => option.id === type.toLowerCase()))
      .map((type) => [type.toLowerCase(), type] as const)).entries())
      .map(([id, label]) => ({ id, label })),
  ];

  const fieldNotes = allFieldNotes.filter((note) => {
    if (tripTypes.length > 0 && !tripTypes.some((t) => note.tripType.map((x) => x.toLowerCase()).includes(t))) return false;

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
    setMediaFilter("all");
    setSearch("");
  };

  const activeFilterCount =
    (mediaFilter !== "all" ? 1 : 0) +
    tripTypes.length +
    (distanceFilter !== "any" ? 1 : 0) +
    (elevationFilter !== "any" ? 1 : 0);

  const tripTypePillLabel =
    tripTypes.length === 0
      ? "Trip type"
      : tripTypes.length === 1
      ? tripTypeOptions.find((t) => t.id === tripTypes[0])?.label ?? tripTypes[0]
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

  const MediaPill = (
    <Popover>
      <PopoverTrigger asChild>
        <Pill
          label={mediaFilter === "all" ? "Media" : mediaOptions.find((o) => o.id === mediaFilter)!.label}
          active={mediaFilter !== "all"}
          data-testid="pill-media"
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-2 bg-popover border border-border">
        <div className="flex flex-col">
          {mediaOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setMediaFilter(opt.id)}
              className={`text-left text-sm px-2 py-1.5 rounded hover:bg-muted ${
                mediaFilter === opt.id ? "text-foreground" : "text-muted-foreground"
              }`}
              data-testid={`media-option-${opt.id}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );

  const ModeSwitcher = <ViewModeSwitcher value={viewMode} onChange={setViewMode} />;

  if (viewMode === "heatmap") {
    return (
      <div className="bg-background flex flex-col" style={{ minHeight: "calc(100vh - 2.75rem)" }}>
        <div className="px-5 sm:px-8 pt-6 pb-3 flex items-center justify-end gap-3 flex-wrap">
          {ModeSwitcher}
        </div>
        <div className="px-5 sm:px-8 py-4 flex items-center justify-between border-b border-border gap-3 flex-wrap">
          {MediaPill}
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
      {/* Section heading + mode switcher */}
      <div id="archive" className="px-5 sm:px-8 pt-6 pb-3 flex items-center justify-end gap-3 flex-wrap scroll-mt-12">
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

          {MediaPill}

          {/* Trip type popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Pill label={tripTypePillLabel} active={tripTypes.length > 0} />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-3 bg-popover border border-border">
              <div className="meta-mono text-muted-foreground mb-2">Trip type</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {tripTypeOptions.map((type) => (
                  <label key={type.id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <Checkbox
                      checked={tripTypes.includes(type.id)}
                      onCheckedChange={(c) => handleTripTypeChange(type.id, !!c)}
                    />
                    {type.label}
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

          <DropdownMenu open={createOpen} onOpenChange={setCreateOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`meta-mono inline-flex min-h-[44px] items-center justify-center gap-3 rounded-full px-6 py-3 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  createOpen
                    ? "bg-primary text-primary-foreground"
                    : "bg-[#4F5563] text-white hover:bg-[#434956]"
                }`}
                data-testid="create-menu-trigger"
              >
                Create
                {createOpen ? (
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={8} className="min-w-[16rem] p-1">
              <DropdownMenuItem asChild>
                <Link href="/admin" className="min-h-11 gap-3 text-base" data-testid="create-menu-new">
                  <CirclePlus className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                  Create new field note
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/inbox" className="min-h-11 gap-3 text-base" data-testid="create-menu-import">
                  <Upload className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                  Import
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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

      {/* Content */}
      <main className="px-5 sm:px-8 pb-12">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loading withOverlay={false} small />
          </div>
        ) : fieldNotes.length === 0 ? (
          <div className="text-center py-24">
            <p className="font-serif text-xl text-muted-foreground mb-4">
              No field notes yet.
            </p>
            <Link
              href="/admin"
              className="meta-mono inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-6 py-3 text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Add your first &rarr;
            </Link>
          </div>
        ) : viewMode === "table" ? (
          <div className="w-full overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="meta-mono text-left text-muted-foreground font-normal pb-2 pr-6">Title</th>
                  <th className="meta-mono text-left text-muted-foreground font-normal pb-2 pr-6">Type</th>
                  <th className="meta-mono text-left text-muted-foreground font-normal pb-2 pr-6">Date</th>
                  <th className="meta-mono text-right text-muted-foreground font-normal pb-2 pr-6">Distance</th>
                  <th className="meta-mono text-right text-muted-foreground font-normal pb-2">Elevation</th>
                </tr>
              </thead>
              <tbody>
                {fieldNotes.map((note) => {
                  const dateStr = new Date(note.date.toString()).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                  const typeStr = Array.isArray(note.tripType) ? note.tripType.join(", ") : note.tripType;
                  return (
                    <tr key={note.id} className="border-b border-border group/row">
                      <td className="py-2.5 pr-6">
                        <Link
                          href={`/field-notes/${note.id}`}
                          className="font-serif text-foreground hover:opacity-70 transition-opacity"
                          style={{ fontSize: "1.05rem" }}
                        >
                          {note.title}
                        </Link>
                        {note.videoCount > 0 && (
                          <span className="meta-mono text-muted-foreground ml-2 whitespace-nowrap">
                            ▶ {note.videoCount}
                          </span>
                        )}
                      </td>
                      <td className="meta-mono text-muted-foreground py-2.5 pr-6 whitespace-nowrap">
                        {typeStr}
                      </td>
                      <td className="meta-mono text-muted-foreground py-2.5 pr-6 whitespace-nowrap">
                        {dateStr}
                      </td>
                      <td className="meta-mono text-muted-foreground py-2.5 pr-6 text-right whitespace-nowrap">
                        {note.distance != null ? `${note.distance} mi` : "—"}
                      </td>
                      <td className="meta-mono text-muted-foreground py-2.5 text-right whitespace-nowrap">
                        {note.elevationGain != null ? `${note.elevationGain} ft` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-flow-row grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 items-start gap-3 sm:gap-4">
            {fieldNotes.map((note) => (
              <FieldNoteCard
                key={note.id}
                fieldNote={note}
                searchTerm={search}
                compact
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
