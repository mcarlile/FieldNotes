import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import FieldNoteCard from "@/components/field-note-card";
import type { FieldNote } from "@shared/schema";

export default function Home() {
  const [search, setSearch] = useState("");
  const [tripType, setTripType] = useState("all");
  const [sortOrder, setSortOrder] = useState("recent");

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

  return (
    <div className="min-h-screen bg-carbon-gray-10">
      {/* Header */}
      <header className="bg-white border-b border-carbon-gray-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <h1 className="text-2xl font-semibold text-carbon-gray-100 font-ibm">Field Notes</h1>
            <div className="text-sm text-carbon-gray-70 font-ibm">GPX Track Showcase</div>
          </div>
        </div>
      </header>

      {/* Search and Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Input
                type="text"
                placeholder="Search field notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pr-10 border-carbon-gray-20 focus:border-carbon-blue rounded-none font-ibm"
              />
              <Search className="absolute right-3 top-3 w-4 h-4 text-carbon-gray-70" />
            </div>
          </div>

          {/* Trip Type Filter */}
          <div className="w-full sm:w-48">
            <Select value={tripType} onValueChange={setTripType}>
              <SelectTrigger className="h-10 border-carbon-gray-20 focus:border-carbon-blue rounded-none font-ibm">
                <SelectValue placeholder="All trip types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All trip types</SelectItem>
                <SelectItem value="hiking">Hiking</SelectItem>
                <SelectItem value="cycling">Cycling</SelectItem>
                <SelectItem value="photography">Photography</SelectItem>
                <SelectItem value="running">Running</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort Options */}
          <div className="w-full sm:w-48">
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger className="h-10 border-carbon-gray-20 focus:border-carbon-blue rounded-none font-ibm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Most recent</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="name">Name A-Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Field Notes Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white p-6 border border-carbon-gray-20 animate-pulse">
                <div className="w-full h-32 bg-carbon-gray-20 mb-4"></div>
                <div className="h-6 bg-carbon-gray-20 mb-2"></div>
                <div className="h-4 bg-carbon-gray-20 mb-3"></div>
                <div className="flex justify-between">
                  <div className="h-3 w-16 bg-carbon-gray-20"></div>
                  <div className="h-3 w-20 bg-carbon-gray-20"></div>
                </div>
              </div>
            ))}
          </div>
        ) : fieldNotes.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-carbon-gray-70 font-ibm">
              {search || tripType ? "No field notes found matching your criteria." : "No field notes available."}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {fieldNotes.map((fieldNote) => (
              <FieldNoteCard key={fieldNote.id} fieldNote={fieldNote} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
