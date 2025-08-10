import { useState } from "react";
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
} from "@carbon/react";
import { Add, Search, Filter, Map } from "@carbon/icons-react";
import FieldNoteCard from "@/components/field-note-card";
import HeatMapView from "@/components/heat-map-view";
import type { FieldNote } from "@shared/schema";

export default function Home() {
  const [search, setSearch] = useState("");
  const [tripType, setTripType] = useState("all");
  const [sortOrder, setSortOrder] = useState("recent");
  const [showHeatMap, setShowHeatMap] = useState(false);

  const { data: fieldNotes = [], isLoading } = useQuery<FieldNote[]>({
    queryKey: ["/api/field-notes", { search, tripType, sortOrder }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (tripType && tripType !== "all") params.append("tripType", tripType);
      if (sortOrder) params.append("sortOrder", sortOrder);
      
      const response = await fetch(`/api/field-notes?${params}`);
      if (!response.ok) throw new Error("Failed to fetch field notes");
      return response.json();
    },
  });

  const tripTypeItems = [
    { id: "all", text: "All trip types" },
    { id: "Hiking", text: "Hiking" },
    { id: "Cycling", text: "Cycling" },
    { id: "Running", text: "Running" },
    { id: "Backpacking", text: "Backpacking" },
    { id: "Motorcycle", text: "Motorcycle" },
    { id: "Climbing", text: "Climbing" },
    { id: "Skiing", text: "Skiing" },
    { id: "Other", text: "Other" },
  ];

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
                <h1 className="text-2xl font-semibold text-gray-900">Field Notes - Heat Map</h1>
                <div className="flex items-center gap-4">
                  <Toggle
                    id="heat-map-toggle"
                    labelText=""
                    aria-label="Toggle heat map view"
                    toggled={showHeatMap}
                    onToggle={setShowHeatMap}
                    data-testid="toggle-heat-map"
                  />
                  <label htmlFor="heat-map-toggle" className="text-sm text-gray-600 cursor-pointer">
                    Heat Map
                  </label>
                  <div className="text-sm text-gray-600">Route Aggregation View</div>
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
          <HeatMapView fieldNotes={fieldNotes} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <Grid fullWidth>
          <Column sm={4} md={8} lg={16}>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 py-6">
              <h1 className="text-2xl font-semibold text-gray-900">Field Notes</h1>
              <div className="flex items-center gap-4">
                <Toggle
                  id="heat-map-toggle"
                  labelText=""
                  aria-label="Toggle heat map view"
                  toggled={showHeatMap}
                  onToggle={setShowHeatMap}
                  data-testid="toggle-heat-map"
                />
                <label htmlFor="heat-map-toggle" className="text-sm text-gray-600 cursor-pointer">
                  Heat Map
                </label>
                <div className="text-sm text-gray-600">GPX Track Showcase</div>
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

      {/* Search and Filters */}
      <div className="py-6">
        <Grid fullWidth>
          <Column sm={4} md={6} lg={10} className="mb-4 sm:mb-0">
            <CarbonSearch
              size="lg"
              placeholder="Search field notes..."
              labelText="Search field notes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </Column>
          
          <Column sm={2} md={1} lg={3} className="mb-4 sm:mb-0">
            <Dropdown
              id="trip-type-filter"
              titleText="Trip Type"
              label={tripTypeItems.find(item => item.id === tripType)?.text || "All trip types"}
              items={tripTypeItems}
              itemToString={(item) => item ? item.text : ""}
              selectedItem={tripTypeItems.find(item => item.id === tripType)}
              onChange={({ selectedItem }) => setTripType(selectedItem?.id || "all")}
              data-testid="select-trip-type"
            />
          </Column>
          
          <Column sm={2} md={1} lg={3}>
            <Dropdown
              id="sort-order"
              titleText="Sort By"  
              label={sortOrderItems.find(item => item.id === sortOrder)?.text || "Most Recent"}
              items={sortOrderItems}
              itemToString={(item) => item ? item.text : ""}
              selectedItem={sortOrderItems.find(item => item.id === sortOrder)}
              onChange={({ selectedItem }) => setSortOrder(selectedItem?.id || "recent")}
              data-testid="select-sort-order"
            />
          </Column>
        </Grid>
      </div>

      {/* Field Notes Grid */}
      <div className="pb-6">
        <Grid fullWidth>
          <Column sm={4} md={8} lg={16}>
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
                  {search || tripType !== "all" 
                    ? "Try adjusting your search or filters" 
                    : "Get started by adding your first field note"}
                </p>
                <Link href="/admin">
                  <CarbonButton renderIcon={Add}>
                    Add Your First Field Note
                  </CarbonButton>
                </Link>
              </Tile>
            )}
          </Column>
        </Grid>
      </div>
    </div>
  );
}