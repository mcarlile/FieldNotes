import { useState } from "react";
import { 
  Button as CarbonButton,
  Modal,
  FileUploaderDropContainer,
  FileUploaderItem,
  ProgressBar
} from "@carbon/react";
import { Upload } from "@carbon/icons-react";
import type { UploadResult } from "@uppy/core";
import { type PhotoExifData } from "@/lib/exif-extractor";

interface CarbonPhotoUploaderProps {
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
  status: 'pending' | 'uploading' | 'complete' | 'error';
  progress: number;
  uploadUrl?: string;
  errorMessage?: string;
  exifData?: PhotoExifData;
}

export function CarbonPhotoUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB default
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: CarbonPhotoUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [files, setFiles] = useState<FileUploadState[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const extractExifFromFile = async (file: File): Promise<PhotoExifData | null> => {
    try {
      const formData = new FormData();
      formData.append('photo', file);
      
      const exifResponse = await fetch('/api/photos/extract-exif', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      
      if (!exifResponse.ok) {
        console.error('EXIF extraction failed:', exifResponse.statusText);
        return null;
      }
      
      const exifData = await exifResponse.json();
      return exifData;
    } catch (error) {
      console.error('Failed to extract EXIF data:', error);
      return null;
    }
  };

  const handleFileAdd = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    
    // Check file limits
    if (files.length + selectedFiles.length > maxNumberOfFiles) {
      alert(`Maximum ${maxNumberOfFiles} files allowed`);
      return;
    }

    // Check file sizes and types
    const validFiles = selectedFiles.filter(file => {
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

    const newFileStates: FileUploadState[] = validFiles.map(file => ({
      file,
      status: 'pending',
      progress: 0
    }));

    setFiles(prev => [...prev, ...newFileStates]);
    
    // Extract EXIF data from each new file using server-side extraction
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const exifData = await extractExifFromFile(file);
      if (exifData) {
        setFiles(prev => prev.map((f, idx) => 
          idx === prev.length - validFiles.length + i 
            ? { ...f, exifData }
            : f
        ));
      }
    }
  };

  const handleFilesFromDropContainer = async (newFiles: File[]) => {
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

    const newFileStates: FileUploadState[] = validFiles.map(file => ({
      file,
      status: 'pending',
      progress: 0
    }));

    setFiles(prev => [...prev, ...newFileStates]);
    
    // Extract EXIF data from each new file using server-side extraction
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const exifData = await extractExifFromFile(file);
      if (exifData) {
        setFiles(prev => prev.map((f, idx) => 
          idx === prev.length - validFiles.length + i 
            ? { ...f, exifData }
            : f
        ));
      }
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async () => {
    setIsUploading(true);
    const uploadResults: any[] = [];

    // Upload files in parallel for better performance
    const uploadPromises = files.map(async (fileState, i) => {
      if (fileState.status !== 'pending') return null;

      try {
        // Update status to uploading
        setFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'uploading' as const, progress: 10 } : f
        ));

        // Get upload parameters with timeout
        const uploadParams = await Promise.race([
          onGetUploadParameters(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Upload URL request timed out')), 10000)
          )
        ]);
        
        setFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, progress: 30, uploadUrl: uploadParams.url } : f
        ));

        // Upload file with progress tracking
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

        // Update progress
        setFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'complete' as const, progress: 100 } : f
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
          idx === i ? { 
            ...f, 
            status: 'error' as const, 
            errorMessage: error instanceof Error ? error.message : 'Upload failed' 
          } : f
        ));
        return null;
      }
    });

    // Wait for all uploads to complete
    const results = await Promise.all(uploadPromises);
    uploadResults.push(...results.filter(Boolean));

    setIsUploading(false);

    // Call completion handler if all uploads were successful
    if (uploadResults.length > 0 && onComplete) {
      // Combine all results
      const combinedResult = {
        successful: uploadResults.flatMap(r => r.successful),
        failed: [],
      };
      const exifDataArray = files.map(f => f.exifData).filter(Boolean);
      onComplete(combinedResult as any, exifDataArray);
    }
  };

  const resetUploader = () => {
    setFiles([]);
    setIsUploading(false);
  };

  const allFilesComplete = files.length > 0 && files.every(f => f.status === 'complete');
  const anyErrors = files.some(f => f.status === 'error');

  return (
    <div>
      <CarbonButton 
        onClick={() => setShowModal(true)} 
        className={buttonClassName}
        renderIcon={Upload}
      >
        {children}
      </CarbonButton>

      <Modal
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        modalHeading="Upload Photos"
        primaryButtonText={allFilesComplete ? "Done" : isUploading ? "Uploading..." : "Upload"}
        secondaryButtonText="Cancel"
        onRequestSubmit={allFilesComplete ? () => setShowModal(false) : uploadFiles}
        onSecondarySubmit={() => setShowModal(false)}
        primaryButtonDisabled={files.length === 0 || isUploading}
        size="lg"
      >
        <div className="space-y-4">
          {/* File Drop Area */}
          <FileUploaderDropContainer
            accept={['image/*']}
            multiple={maxNumberOfFiles > 1}
            onAddFiles={(_, { addedFiles }) => {
              handleFilesFromDropContainer(addedFiles);
            }}
          >
            <div className="p-8 text-center">
              <Upload size={32} className="mx-auto mb-4 text-gray-400" />
              <p className="mb-2">Drag and drop images here or click to browse</p>
              <p className="text-sm text-gray-500">
                Maximum {maxNumberOfFiles} files, {Math.round(maxFileSize / 1024 / 1024)}MB each
              </p>
            </div>
          </FileUploaderDropContainer>

          {/* Alternative file input */}
          <div className="text-center">
            <input
              type="file"
              accept="image/*"
              multiple={maxNumberOfFiles > 1}
              onChange={handleFileAdd}
              className="hidden"
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className="cursor-pointer text-blue-600 hover:text-blue-800 text-sm"
            >
              Or click here to select files
            </label>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium">Selected Files</h4>
              {files.map((fileState, i) => (
                <FileUploaderItem
                  key={i}
                  name={fileState.file.name}
                  size={fileState.file.size}
                  status={fileState.status === 'error' ? 'edit' : fileState.status === 'complete' ? 'complete' : 'uploading'}
                  onDelete={() => removeFile(i)}
                >
                  {fileState.status === 'uploading' && (
                    <ProgressBar 
                      value={fileState.progress} 
                      label={`${fileState.progress}%`}
                      size="sm"
                    />
                  )}
                  {fileState.status === 'error' && (
                    <div className="text-red-600 text-sm mt-1">
                      {fileState.errorMessage}
                    </div>
                  )}
                  {fileState.exifData && (
                    <div className="text-xs text-gray-600 mt-1">
                      {fileState.exifData.camera && (
                        <span>📷 {fileState.exifData.camera}</span>
                      )}
                      {fileState.exifData.latitude && fileState.exifData.longitude && (
                        <span className="ml-2">📍 GPS: {fileState.exifData.latitude.toFixed(4)}, {fileState.exifData.longitude.toFixed(4)}</span>
                      )}
                    </div>
                  )}
                </FileUploaderItem>
              ))}
            </div>
          )}

          {/* Status Messages */}
          {anyErrors && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-red-800 text-sm">
                Some files failed to upload. Please try again.
              </p>
            </div>
          )}

          {allFilesComplete && (
            <div className="bg-green-50 border border-green-200 rounded p-3">
              <p className="text-green-800 text-sm">
                All files uploaded successfully!
              </p>
              <button
                onClick={resetUploader}
                className="text-green-600 hover:text-green-800 text-sm mt-1"
              >
                Upload more files
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}