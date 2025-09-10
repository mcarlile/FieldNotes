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
import { parseGpxData, type GpxStats } from "@shared/gpx-utils";

interface GPXUploadState {
  file: File;
  status: 'processing' | 'complete' | 'error';
  progress: number;
  errorMessage?: string;
  gpxData?: GpxStats & {
    filename: string;
  };
}

interface GPXFileUploaderProps {
  maxFileSize?: number;
  onComplete?: (gpxData: GpxStats & { filename: string }) => void;
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

  const processGPXFile = async (gpxFile: File): Promise<GpxStats> => {
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
          resolve(parsedData);
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
      
      const gpxDataWithFilename = {
        ...gpxData,
        filename: gpxFile.name,
      };
      
      setFile({
        file: gpxFile,
        status: 'complete',
        progress: 100,
        gpxData: gpxDataWithFilename,
      });

      // Call completion callback
      if (onComplete) {
        onComplete(gpxDataWithFilename);
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
              onAddFiles={(_, { addedFiles }) => {
                if (addedFiles.length > 0) {
                  const mockEvent = {
                    target: { files: addedFiles } as any
                  } as React.ChangeEvent<HTMLInputElement>;
                  handleFileAdd(mockEvent);
                }
              }}
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
                    label="Processing GPX data"
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
                  subtitle={`Distance: ${file.gpxData.distance} miles, Elevation Gain: ${file.gpxData.elevationGain} ft, ${file.gpxData.coordinates.length} track points`}
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