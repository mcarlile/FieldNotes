import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Grid,
  Column,
  Search as CarbonSearch,
  Dropdown,
  Button as CarbonButton,
  Loading,
  Tile,
  ClickableTile,
  Tag,
  SkeletonText,
  SkeletonPlaceholder,
  Toggle,
  Checkbox,
  RadioButton,
  RadioButtonGroup,
  Accordion,
  AccordionItem,
  SideNav,
  SideNavItems,
  SideNavLink,
} from "@carbon/react";
import { Add, Search, Filter, Map, Close } from "@carbon/icons-react";
import FieldNoteCard from "@/components/field-note-card";
import HeatMapView from "@/components/heat-map-view";
import type { FieldNote } from "@shared/schema";

export default function Home() {
  const [search, setSearch] = useState("");
  const [tripTypes, setTripTypes] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState("recent");
  const [showHeatMap, setShowHeatMap] = useState(false);
  const [distanceFilter, setDistanceFilter] = useState("any");
  const [elevationFilter, setElevationFilter] = useState("any");
  const [showFilters, setShowFilters] = useState(false); // Start hidden on mobile

  // Enable responsive logic for mobile-first design
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 1024; // lg breakpoint
      if (isMobile) {
        setShowFilters(false); // Hide on mobile by default
      } else {
        setShowFilters(true); // Show on desktop
      }
    };

    // Set initial state
    handleResize();
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // Apply client-side filters for multiple selections
  const fieldNotes = allFieldNotes.filter(note => {
    // Trip type filter - allow multiple selections
    if (tripTypes.length > 0 && !tripTypes.includes(note.tripType)) {
      return false;
    }

    // Distance filter
    if (distanceFilter !== "any") {
      const distance = note.distance || 0;
      switch (distanceFilter) {
        case "0-5":
          if (distance > 5) return false;
          break;
        case "5-15":
          if (distance <= 5 || distance > 15) return false;
          break;
        case "15-30":
          if (distance <= 15 || distance > 30) return false;
          break;
        case "30+":
          if (distance <= 30) return false;
          break;
      }
    }

    // Elevation filter
    if (elevationFilter !== "any") {
      const elevation = note.elevationGain || 0;
      switch (elevationFilter) {
        case "0-500":
          if (elevation > 500) return false;
          break;
        case "500-1500":
          if (elevation <= 500 || elevation > 1500) return false;
          break;
        case "1500-3000":
          if (elevation <= 1500 || elevation > 3000) return false;
          break;
        case "3000+":
          if (elevation <= 3000) return false;
          break;
      }
    }

    return true;
  });

  const availableTripTypes = [
    "Hiking",
    "Cycling", 
    "Running",
    "Backpacking",
    "Motorcycle",
    "Climbing",
    "Skiing",
    "Other",
  ];

  const handleTripTypeChange = (tripType: string, checked: boolean) => {
    if (checked) {
      setTripTypes(prev => [...prev, tripType]);
    } else {
      setTripTypes(prev => prev.filter(t => t !== tripType));
    }
  };

  const resetFilters = () => {
    setTripTypes([]);
    setDistanceFilter("any");
    setElevationFilter("any");
    setSearch("");
  };

  const activeFilterCount = tripTypes.length + 
    (distanceFilter !== "any" ? 1 : 0) + 
    (elevationFilter !== "any" ? 1 : 0);

  const sortOrderItems = [
    { id: "recent", text: "Most Recent" },
    { id: "oldest", text: "Oldest First" },
    { id: "name", text: "By Name" },
  ];

  // If heat map is enabled, show full-screen heat map
  if (showHeatMap) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 flex-shrink-0">
          <Grid fullWidth>
            <Column sm={4} md={8} lg={16}>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 py-6">
                <h1 className="text-2xl font-semibold text-gray-900">Field Notes</h1>
                <div className="flex items-center gap-4">
                  <label htmlFor="heat-map-toggle" className="text-sm text-gray-600 cursor-pointer">
                    Heat Map
                  </label>
                  <Toggle
                    id="heat-map-toggle"
                    labelText=""
                    hideLabel
                    aria-label="Toggle heat map view"
                    toggled={showHeatMap}
                    onToggle={setShowHeatMap}
                    data-testid="toggle-heat-map"
                  />

                  <Link href="/admin">
                    <CarbonButton size="sm" data-testid="link-admin" renderIcon={Add}>
                      Add New
                    </CarbonButton>
                  </Link>
                </div>
              </div>
            </Column>
          </Grid>
        </div>
        
        {/* Full-screen Heat Map */}
        <div className="flex-1">
          <HeatMapView fieldNotes={allFieldNotes} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" data-layout="sidebar-layout">
      {/* App Header */}
      <div className="bg-white border-b border-gray-200 flex-shrink-0">
        <div className="px-6 py-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <h1 className="text-2xl font-semibold text-gray-900">Field Notes</h1>
            <div className="flex items-center gap-4">
              <label htmlFor="heat-map-toggle" className="text-sm text-gray-600 cursor-pointer">
                Heat Map
              </label>
              <Toggle
                id="heat-map-toggle"
                labelText=""
                hideLabel
                aria-label="Toggle heat map view"
                toggled={showHeatMap}
                onToggle={setShowHeatMap}
                data-testid="toggle-heat-map"
              />

              <Link href="/admin">
                <CarbonButton size="sm" data-testid="link-admin" renderIcon={Add}>
                  Add New
                </CarbonButton>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area with Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar Filter Panel */}
        <div className={`
          w-[280px] sm:w-[320px] lg:w-[280px]
          bg-white 
          border-r 
          border-gray-200 
          flex-shrink-0
          overflow-y-auto
          ${showFilters ? 'block' : 'hidden lg:block'}
          ${showFilters ? 'absolute lg:relative z-10 h-full lg:h-auto' : 'relative'}
        `}>
          <div className="p-4 sm:p-6 lg:p-4 min-h-0">
            {/* Filter Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Filter size={18} />
                <h2 className="text-base font-semibold text-gray-900">Filters</h2>
                {activeFilterCount > 0 && (
                  <Tag type="blue" size="sm" className="ml-1">
                    {activeFilterCount}
                  </Tag>
                )}
              </div>
              {/* Close button only on mobile */}
              <CarbonButton
                kind="ghost"
                size="sm"
                onClick={() => setShowFilters(false)}
                renderIcon={Close}
                iconDescription="Close filters"
                className="lg:hidden p-1"
              />
            </div>

          {/* Reset Filters */}
          {activeFilterCount > 0 && (
            <div className="mb-4">
              <CarbonButton
                kind="tertiary"
                size="sm"
                onClick={resetFilters}
                className="text-xs"
              >
                Reset All
              </CarbonButton>
            </div>
          )}

          {/* Trip Type Filter */}
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Trip Type</h3>
            {tripTypes.length > 0 && (
              <div className="mb-2 flex items-center gap-1">
                <Tag type="blue" size="sm">
                  {tripTypes.length}
                </Tag>
                <span className="text-xs text-gray-500">selected</span>
              </div>
            )}
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {availableTripTypes.map(type => (
                <Checkbox
                  key={type}
                  id={`trip-type-${type}`}
                  labelText={type}
                  checked={tripTypes.includes(type)}
                  onChange={(_, { checked }) => handleTripTypeChange(type, checked)}
                />
              ))}
            </div>
          </div>

          {/* Distance Filter */}
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Distance (miles)</h3>
            <div className="space-y-1">
              <RadioButtonGroup
                name="distance-filter"
                valueSelected={distanceFilter}
                onChange={(value) => setDistanceFilter(String(value) || "any")}
                orientation="vertical"
              >
                <RadioButton labelText="Any" value="any" id="distance-any" />
                <RadioButton labelText="0-5" value="0-5" id="distance-0-5" />
                <RadioButton labelText="5-15" value="5-15" id="distance-5-15" />
                <RadioButton labelText="15-30" value="15-30" id="distance-15-30" />
                <RadioButton labelText="30+" value="30+" id="distance-30-plus" />
              </RadioButtonGroup>
            </div>
          </div>

          {/* Elevation Filter */}
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Elevation Gain (ft)</h3>
            <div className="space-y-1">
              <RadioButtonGroup
                name="elevation-filter"
                valueSelected={elevationFilter}
                onChange={(value) => setElevationFilter(String(value) || "any")}
                orientation="vertical"
              >
                <RadioButton labelText="Any" value="any" id="elevation-any" />
                <RadioButton labelText="0-500" value="0-500" id="elevation-0-500" />
                <RadioButton labelText="500-1,500" value="500-1500" id="elevation-500-1500" />
                <RadioButton labelText="1,500-3,000" value="1500-3000" id="elevation-1500-3000" />
                <RadioButton labelText="3,000+" value="3000+" id="elevation-3000-plus" />
              </RadioButtonGroup>
            </div>
          </div>
        </div>
      </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col">
          {/* Search and Controls */}
          <div className="bg-white border-b border-gray-200">
            <div className="px-6 py-4">
              <div className="flex items-center gap-4 mb-4">
                {/* Show Filters button only on mobile when filters are hidden */}
                {!showFilters && (
                  <CarbonButton
                    kind="ghost"
                    size="sm"
                    onClick={() => setShowFilters(true)}
                    renderIcon={Filter}
                    className="lg:hidden"
                  >
                    Filters
                    {activeFilterCount > 0 && (
                      <Tag type="blue" size="sm" className="ml-2">
                        {activeFilterCount}
                      </Tag>
                    )}
                  </CarbonButton>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex-1">
                  <CarbonSearch
                    size="lg"
                    placeholder="Search field notes..."
                    labelText="Search field notes"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="input-search"
                  />
                </div>
                <div className="w-48">
                  <Dropdown
                    id="sort-order"
                    titleText=""
                    label={sortOrderItems.find(item => item.id === sortOrder)?.text || "Most Recent"}
                    items={sortOrderItems}
                    itemToString={(item) => item ? item.text : ""}
                    selectedItem={sortOrderItems.find(item => item.id === sortOrder)}
                    onChange={({ selectedItem }) => setSortOrder(selectedItem?.id || "recent")}
                    data-testid="select-sort-order"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Results Count */}
          {!isLoading && (
            <div className="bg-gray-50 px-6 py-2">
              <span className="text-sm text-gray-600">
                {fieldNotes.length} {fieldNotes.length === 1 ? 'result' : 'results'}
              </span>
            </div>
          )}

          {/* Field Notes Grid */}
          <div className="flex-1 p-6 bg-gray-50 overflow-auto">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Tile key={i}>
                    <SkeletonPlaceholder className="w-full h-32 mb-4" />
                    <SkeletonText heading />
                    <SkeletonText />
                    <SkeletonText width="60%" />
                  </Tile>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {fieldNotes.map((note) => (
                  <FieldNoteCard key={note.id} fieldNote={note} searchTerm={search} />
                ))}
              </div>
            )}
            
            {!isLoading && fieldNotes.length === 0 && (
              <Tile className="text-center py-12">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No field notes found</h3>
                <p className="text-gray-600 mb-4">
                  {search || activeFilterCount > 0
                    ? "Try adjusting your search or filters" 
                    : "Get started by adding your first field note"}
                </p>
                {activeFilterCount > 0 && (
                  <CarbonButton
                    kind="tertiary"
                    size="sm"
                    onClick={resetFilters}
                    className="mr-3"
                  >
                    Clear Filters
                  </CarbonButton>
                )}
                <Link href="/admin">
                  <CarbonButton renderIcon={Add}>
                    Add Your First Field Note
                  </CarbonButton>
                </Link>
              </Tile>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}