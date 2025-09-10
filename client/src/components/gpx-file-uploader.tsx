import { useState, useEffect } from "react";
import { 
  Button as CarbonButton,
  Modal,
  FileUploaderDropContainer,
  FileUploaderItem,
  ProgressBar,
  InlineNotification
} from "@carbon/react";
import { Upload } from "@carbon/icons-react";
import { parseGpxData } from "@shared/gpx-utils";

interface GPXUploadState {
  file: File;
  status: 'processing' | 'complete' | 'error';
  progress: number;
  errorMessage?: string;
  gpxData?: {
    distance: number;
    elevationGain: number;
    date: Date | null;
    coordinates: [number, number][];
    parsedData: any;
  };
}

interface GPXFileUploaderProps {
  maxFileSize?: number;
  onComplete?: (gpxData: {
    distance: number;
    elevationGain: number;
    date: Date | null;
    coordinates: [number, number][];
    parsedData: any;
    filename: string;
  }) => void;
  buttonClassName?: string;
  children: React.ReactNode;
}

export function GPXFileUploader({
  maxFileSize = 10485760, // 10MB default
  onComplete,
  buttonClassName,
  children,
}: GPXFileUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [file, setFile] = useState<GPXUploadState | null>(null);

  const processGPXFile = async (gpxFile: File): Promise<{
    distance: number;
    elevationGain: number;
    date: Date | null;
    coordinates: [number, number][];
    parsedData: any;
  }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          if (!content) {
            reject(new Error('Failed to read GPX file'));
            return;
          }

          // Parse GPX data using the existing utility
          const parsedData = parseGpxData(content);
          if (!parsedData) {
            reject(new Error('Invalid GPX file format'));
            return;
          }

          // Extract coordinates and calculate stats
          const coordinates = parsedData.coordinates || [];
          let distance = 0;
          let elevationGain = 0;
          let minElevation = Infinity;
          let maxElevation = -Infinity;

          // Calculate distance and elevation gain
          for (let i = 1; i < coordinates.length; i++) {
            const [lng1, lat1, ele1] = coordinates[i - 1];
            const [lng2, lat2, ele2] = coordinates[i];

            // Calculate distance using Haversine formula
            const R = 6371; // Earth's radius in kilometers
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distance += R * c;

            // Track elevation
            if (ele1 !== undefined) {
              minElevation = Math.min(minElevation, ele1);
              maxElevation = Math.max(maxElevation, ele1);
            }
            if (ele2 !== undefined) {
              minElevation = Math.min(minElevation, ele2);
              maxElevation = Math.max(maxElevation, ele2);
            }
          }

          // Calculate elevation gain (simplified - actual gain would need more sophisticated calculation)
          if (minElevation !== Infinity && maxElevation !== -Infinity) {
            elevationGain = maxElevation - minElevation;
          }

          // Try to extract date from GPX metadata
          let date: Date | null = null;
          if (parsedData.metadata?.time) {
            date = new Date(parsedData.metadata.time);
          }

          resolve({
            distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
            elevationGain: Math.round(elevationGain),
            date,
            coordinates: coordinates.map(([lng, lat]) => [lng, lat] as [number, number]),
            parsedData,
          });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(gpxFile);
    });
  };

  const handleFileAdd = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const gpxFile = files[0];
    
    // Validate file type
    if (!gpxFile.name.toLowerCase().endsWith('.gpx')) {
      setFile({
        file: gpxFile,
        status: 'error',
        progress: 0,
        errorMessage: 'Please select a GPX file (.gpx extension required)',
      });
      return;
    }

    // Validate file size
    if (gpxFile.size > maxFileSize) {
      setFile({
        file: gpxFile,
        status: 'error',
        progress: 0,
        errorMessage: `File size exceeds ${Math.round(maxFileSize / 1024 / 1024)}MB limit`,
      });
      return;
    }

    // Start processing
    setFile({
      file: gpxFile,
      status: 'processing',
      progress: 50,
    });

    try {
      // Process GPX file
      const gpxData = await processGPXFile(gpxFile);
      
      setFile({
        file: gpxFile,
        status: 'complete',
        progress: 100,
        gpxData,
      });

      // Call completion callback
      if (onComplete) {
        onComplete({
          ...gpxData,
          filename: gpxFile.name,
        });
      }
    } catch (error) {
      setFile({
        file: gpxFile,
        status: 'error',
        progress: 0,
        errorMessage: error instanceof Error ? error.message : 'Failed to process GPX file',
      });
    }
  };

  const handleFileRemove = () => {
    setFile(null);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      const input = document.createElement('input');
      input.type = 'file';
      input.files = files;
      handleFileAdd({ target: input } as React.ChangeEvent<HTMLInputElement>);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const resetAndClose = () => {
    setFile(null);
    setShowModal(false);
  };

  return (
    <div>
      <CarbonButton 
        onClick={() => setShowModal(true)} 
        className={buttonClassName}
        data-testid="button-upload-gpx"
      >
        {children}
      </CarbonButton>

      <Modal
        open={showModal}
        onRequestClose={resetAndClose}
        modalHeading="Upload GPX File"
        primaryButtonText={file?.status === 'complete' ? "Done" : "Cancel"}
        secondaryButtonText={file?.status === 'complete' ? "Upload Another" : undefined}
        onRequestSubmit={resetAndClose}
        onSecondarySubmit={file?.status === 'complete' ? () => setFile(null) : undefined}
        size="md"
        data-testid="modal-gpx-upload"
      >
        <div className="space-y-4">
          {!file && (
            <FileUploaderDropContainer
              accept={['.gpx']}
              labelText="Drag and drop your GPX file here or click to browse"
              onAddFiles={handleFileAdd}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              data-testid="drop-container-gpx"
            />
          )}

          {file && (
            <div className="space-y-4">
              <FileUploaderItem
                name={file.file.name}
                status={file.status === 'error' ? 'edit' : 'complete'}
                onDelete={file.status !== 'processing' ? handleFileRemove : undefined}
                data-testid={`file-item-${file.file.name}`}
              />

              {file.status === 'processing' && (
                <div className="space-y-2">
                  <div className="text-sm text-gray-600">Processing GPX file...</div>
                  <ProgressBar 
                    value={file.progress} 
                    max={100}
                    labelText="Processing GPX data"
                    data-testid="progress-gpx-processing"
                  />
                </div>
              )}

              {file.status === 'error' && file.errorMessage && (
                <InlineNotification
                  kind="error"
                  title="Upload Error"
                  subtitle={file.errorMessage}
                  hideCloseButton
                  data-testid="notification-gpx-error"
                />
              )}

              {file.status === 'complete' && file.gpxData && (
                <InlineNotification
                  kind="success"
                  title="GPX File Processed Successfully"
                  subtitle={`Distance: ${file.gpxData.distance} km, Elevation Gain: ${file.gpxData.elevationGain} m, ${file.gpxData.coordinates.length} track points`}
                  hideCloseButton
                  data-testid="notification-gpx-success"
                />
              )}
            </div>
          )}

          {!file && (
            <div className="text-sm text-gray-600">
              <p>Supported format: GPX files (.gpx)</p>
              <p>Maximum file size: {Math.round(maxFileSize / 1024 / 1024)}MB</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}