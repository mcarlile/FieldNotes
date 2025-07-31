import { Link } from "wouter";
import type { FieldNote } from "@shared/schema";

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
    <Link href={`/field-notes/${fieldNote.id}`}>
      <div className="carbon-tile bg-white p-6 cursor-pointer border border-carbon-gray-20 hover:border-carbon-blue hover:shadow-md transition-all duration-150">
        {/* Placeholder for field note image - in real implementation this would come from the first photo */}
        <div className="w-full h-32 bg-carbon-gray-20 mb-4 flex items-center justify-center text-carbon-gray-70 text-sm font-ibm">
          Field Note Image
        </div>
        
        <h3 className="text-lg font-medium mb-2 text-carbon-gray-100 font-ibm">{fieldNote.title}</h3>
        <p className="text-sm text-carbon-gray-70 mb-3 font-ibm line-clamp-2">{fieldNote.description}</p>
        
        <div className="flex justify-between text-xs text-carbon-gray-70 font-ibm">
          <span className="capitalize">{fieldNote.tripType}</span>
          <span>{formatDate(fieldNote.date.toString())}</span>
        </div>
        
        <div className="mt-2 text-xs text-carbon-gray-70 font-ibm">
          <span>
            {fieldNote.distance && `${fieldNote.distance} km`}
            {fieldNote.distance && fieldNote.elevationGain && " • "}
            {fieldNote.elevationGain && `${fieldNote.elevationGain}m elevation`}
          </span>
        </div>
      </div>
    </Link>
  );
}
