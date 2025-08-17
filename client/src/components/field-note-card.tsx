import { ClickableTile, Tag } from "@carbon/react";
import type { FieldNote } from "@shared/schema";
import MapboxRoutePreview from "./mapbox-route-preview";

interface FieldNoteCardProps {
  fieldNote: FieldNote;
  searchTerm?: string;
}

// Utility function to highlight search terms
const highlightText = (text: string, searchTerm?: string): React.ReactNode => {
  if (!searchTerm || !text) return text;
  
  const regex = new RegExp(`(${searchTerm})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, index) => 
    regex.test(part) ? (
      <span key={index} style={{backgroundColor: 'var(--support-warning)', opacity: 0.3}} className="px-0.5 rounded">
        {part}
      </span>
    ) : part
  );
};

export default function FieldNoteCard({ fieldNote, searchTerm }: FieldNoteCardProps) {
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <ClickableTile 
      className="!p-0 !border-0 hover:shadow-lg transition-shadow"
      onClick={() => window.location.href = `/field-notes/${fieldNote.id}`}
    >
      {/* Mapbox Route Preview */}
      <div className="w-full">
        <MapboxRoutePreview 
          fieldNote={fieldNote} 
          className="w-full h-32 rounded-t-sm overflow-hidden"
        />
      </div>
      
      <div className="p-4">
        <div className="flex justify-between items-start gap-2 mb-2">
          <h3 className="text-lg font-medium text-foreground break-words min-w-0 flex-1">
            {highlightText(fieldNote.title, searchTerm)}
          </h3>
          <Tag type="blue" size="sm" className="flex-shrink-0">
            {highlightText(fieldNote.tripType.charAt(0).toUpperCase() + fieldNote.tripType.slice(1), searchTerm)}
          </Tag>
        </div>
        
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2 break-words">
          {highlightText(fieldNote.description || "", searchTerm)}
        </p>
        
        <div className="flex justify-between items-center text-xs text-muted-foreground">
          <span className="flex-shrink-0">{formatDate(fieldNote.date.toString())}</span>
          <div className="text-right break-words">
            {fieldNote.distance && `${fieldNote.distance} miles`}
            {fieldNote.distance && fieldNote.elevationGain && " • "}
            {fieldNote.elevationGain && `${fieldNote.elevationGain} ft`}
          </div>
        </div>
      </div>
    </ClickableTile>
  );
}
