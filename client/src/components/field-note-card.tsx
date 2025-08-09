import { ClickableTile, Tag } from "@carbon/react";
import type { FieldNote } from "@shared/schema";
import MapboxRoutePreview from "./mapbox-route-preview";

interface FieldNoteCardProps {
  fieldNote: FieldNote;
}

export default function FieldNoteCard({ fieldNote }: FieldNoteCardProps) {
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
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-medium text-gray-900">{fieldNote.title}</h3>
          <Tag type="blue" size="sm">
            {fieldNote.tripType}
          </Tag>
        </div>
        
        <p className="text-sm text-gray-600 mb-3 line-clamp-2">{fieldNote.description}</p>
        
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>{formatDate(fieldNote.date.toString())}</span>
          <div>
            {fieldNote.distance && `${fieldNote.distance} miles`}
            {fieldNote.distance && fieldNote.elevationGain && " • "}
            {fieldNote.elevationGain && `${fieldNote.elevationGain} ft`}
          </div>
        </div>
      </div>
    </ClickableTile>
  );
}
