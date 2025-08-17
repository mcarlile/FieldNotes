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
import type { UploadResult } from "@uppy/core";
import { type PhotoExifData } from "@/lib/exif-extractor";

interface AutoPhotoUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (result: UploadResult<Record<string, unknown>, Record<string, unknown>>, exifData?: PhotoExifData[]) => void;
  buttonClassName?: string;
  children: React.ReactNode;
}

interface FileUploadState {
  file: File;
  status: 'processing' | 'uploading' | 'complete' | 'error';
  progress: number;
  uploadUrl?: string;
  errorMessage?: string;
  exifData?: PhotoExifData;
  statusMessage: string;
}

export function AutoPhotoUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB default
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: AutoPhotoUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [files, setFiles] = useState<FileUploadState[]>([]);

  const extractExifFromFile = async (file: File): Promise<PhotoExifData | null> => {
    try {
      const formData = new FormData();
      formData.append('photo', file);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const exifResponse = await fetch('/api/photos/extract-exif', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!exifResponse.ok) {
        console.error('EXIF extraction failed:', exifResponse.statusText);
        return null;
      }
      
      const exifData = await exifResponse.json();
      return exifData;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.warn('EXIF extraction timed out for file:', file.name);
      } else {
        console.error('Failed to extract EXIF data:', error);
      }
      return null;
    }
  };

  const uploadSingleFile = async (fileState: FileUploadState, index: number): Promise<any> => {
    try {
      // Step 1: Extract EXIF data
      setFiles(prev => prev.map((f, idx) => 
        idx === index ? { ...f, statusMessage: 'Processing image data...', progress: 20 } : f
      ));

      const exifData = await extractExifFromFile(fileState.file);
      
      // Step 2: Get upload URL
      setFiles(prev => prev.map((f, idx) => 
        idx === index ? { 
          ...f, 
          statusMessage: 'Getting upload URL...', 
          progress: 40,
          exifData: exifData || undefined 
        } : f
      ));

      const uploadParams = await Promise.race([
        onGetUploadParameters(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Upload URL request timed out')), 10000)
        )
      ]);
      
      // Step 3: Upload file
      setFiles(prev => prev.map((f, idx) => 
        idx === index ? { 
          ...f, 
          status: 'uploading', 
          statusMessage: 'Uploading...', 
          progress: 60, 
          uploadUrl: uploadParams.url 
        } : f
      ));

      const response = await fetch(uploadParams.url, {
        method: uploadParams.method,
        body: fileState.file,
        headers: {
          'Content-Type': fileState.file.type,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Step 4: Complete
      setFiles(prev => prev.map((f, idx) => 
        idx === index ? { 
          ...f, 
          status: 'complete', 
          statusMessage: 'Upload complete!', 
          progress: 100 
        } : f
      ));

      return {
        successful: [{
          name: fileState.file.name,
          size: fileState.file.size,
          type: fileState.file.type,
          uploadURL: uploadParams.url,
        }]
      };

    } catch (error) {
      console.error('Upload error:', error);
      setFiles(prev => prev.map((f, idx) => 
        idx === index ? { 
          ...f, 
          status: 'error', 
          statusMessage: `Error: ${(error as Error).message}`,
          progress: 0 
        } : f
      ));
      return null;
    }
  };

  const processNewFiles = async (newFiles: File[]) => {
    // Check file limits
    if (files.length + newFiles.length > maxNumberOfFiles) {
      alert(`Maximum ${maxNumberOfFiles} files allowed`);
      return;
    }

    // Check file sizes and types
    const validFiles = newFiles.filter(file => {
      if (file.size > maxFileSize) {
        alert(`File ${file.name} is too large. Maximum size is ${Math.round(maxFileSize / 1024 / 1024)}MB`);
        return false;
      }
      if (!file.type.startsWith('image/')) {
        alert(`File ${file.name} is not an image`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    // Add files to state with initial processing status
    const newFileStates: FileUploadState[] = validFiles.map(file => ({
      file,
      status: 'processing',
      progress: 0,
      statusMessage: 'Starting upload...'
    }));

    const startIndex = files.length;
    setFiles(prev => [...prev, ...newFileStates]);

    // Start uploading each file immediately
    const uploadPromises = validFiles.map((file, i) => 
      uploadSingleFile(newFileStates[i], startIndex + i)
    );

    // Wait for all uploads to complete
    const results = await Promise.all(uploadPromises);
    const successfulResults = results.filter(result => result !== null);

    // Get all EXIF data for successful uploads
    const allExifData = files
      .concat(newFileStates)
      .map(f => f.exifData)
      .filter((exif): exif is PhotoExifData => exif !== undefined);

    if (successfulResults.length > 0 && onComplete) {
      const combinedResult = {
        successful: successfulResults.flatMap(r => r.successful),
        failed: []
      };
      onComplete(combinedResult as any, allExifData);
    }
  };

  const handleFileAdd = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    await processNewFiles(selectedFiles);
  };

  const handleFilesFromDropContainer = async (newFiles: File[]) => {
    await processNewFiles(newFiles);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const hasFailedUploads = files.some(f => f.status === 'error');
  const hasCompletedUploads = files.some(f => f.status === 'complete');
  const allUploadsComplete = files.length > 0 && files.every(f => f.status === 'complete');

  return (
    <>
      <CarbonButton
        className={buttonClassName}
        onClick={() => setShowModal(true)}
        renderIcon={Upload}
      >
        {children}
      </CarbonButton>

      <Modal
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        modalHeading="Upload Photos"
        primaryButtonText={allUploadsComplete ? "Done" : "Close"}
        secondaryButtonText=""
        onRequestSubmit={() => setShowModal(false)}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 mb-4">
            Photos will upload automatically when selected. You can add up to {maxNumberOfFiles} photos.
          </p>

          <FileUploaderDropContainer
            labelText="Drag photos here or click to browse"
            multiple={maxNumberOfFiles > 1}
            accept={["image/*"]}
            onAddFiles={(evt, { addedFiles }) => {
              handleFilesFromDropContainer(addedFiles);
            }}
          />

          <input
            type="file"
            accept="image/*"
            multiple={maxNumberOfFiles > 1}
            onChange={handleFileAdd}
            style={{ display: 'none' }}
            id="file-input"
          />

          {files.length > 0 && (
            <div className="space-y-3 mt-6">
              <h4 className="text-sm font-semibold">Upload Status</h4>
              
              {hasFailedUploads && (
                <InlineNotification
                  kind="error"
                  title="Some uploads failed"
                  subtitle="Check individual file status below"
                  hideCloseButton
                />
              )}

              {allUploadsComplete && (
                <InlineNotification
                  kind="success"
                  title="All photos uploaded successfully!"
                  hideCloseButton
                />
              )}

              {files.map((fileState, index) => (
                <div key={index} className="border border-gray-200 rounded p-3">
                  <FileUploaderItem
                    name={fileState.file.name}
                    status={fileState.status === 'complete' ? 'complete' : 
                           fileState.status === 'error' ? 'edit' : 'uploading'}
                    onDelete={() => removeFile(index)}
                    size="md"
                  />
                  
                  <div className="mt-2">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-gray-600">{fileState.statusMessage}</span>
                      <span className="text-xs text-gray-600">{fileState.progress}%</span>
                    </div>
                    
                    <ProgressBar
                      value={fileState.progress}
                      max={100}
                      size="small"
                      hideLabel
                    />
                  </div>

                  {fileState.status === 'error' && fileState.errorMessage && (
                    <div className="mt-2 text-xs text-red-600">
                      {fileState.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}