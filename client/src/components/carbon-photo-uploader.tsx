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
import { extractExifFromFile, type PhotoExifData } from "@/lib/exif-extractor";

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
    
    // Extract EXIF data from each new file
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const exifData = await extractExifFromFile(file);
      setFiles(prev => prev.map((f, idx) => 
        idx === prev.length - validFiles.length + i 
          ? { ...f, exifData }
          : f
      ));
    }
  };

  const handleFilesFromDropContainer = (newFiles: File[]) => {
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

  const handleClose = () => {
    setShowModal(false);
    setFiles([]);
  };

  const getStatusText = (file: FileUploadState) => {
    switch (file.status) {
      case 'pending':
        return 'Ready to upload';
      case 'uploading':
        return `Uploading... ${file.progress}%`;
      case 'complete':
        return 'Upload complete';
      case 'error':
        return file.errorMessage || 'Upload failed';
      default:
        return '';
    }
  };

  const allFilesComplete = files.length > 0 && files.every(f => f.status === 'complete');
  const hasErrors = files.some(f => f.status === 'error');

  return (
    <>
      <CarbonButton 
        onClick={() => setShowModal(true)} 
        className={buttonClassName}
        renderIcon={Upload}
      >
        {children}
      </CarbonButton>

      <Modal
        open={showModal}
        onRequestClose={handleClose}
        modalHeading="Upload Photos"
        primaryButtonText={allFilesComplete ? "Done" : "Upload"}
        primaryButtonDisabled={files.length === 0 || isUploading}
        secondaryButtonText="Cancel"
        onRequestSubmit={allFilesComplete ? handleClose : uploadFiles}
        size="md"
      >
        <div className="space-y-6">
          {/* Upload Progress Summary */}
          {files.length > 0 && (
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-sm font-medium text-gray-700 mb-2">
                Upload Progress: {files.filter(f => f.status === 'complete').length} of {files.length} complete
              </div>
              {isUploading && (
                <div className="text-xs text-gray-600">
                  Uploading files in parallel for faster processing...
                </div>
              )}
            </div>
          )}

          {/* File Drop Zone */}
          <FileUploaderDropContainer
            accept={["image/*"]}
            labelText="Drag and drop images here or click to browse"
            multiple={maxNumberOfFiles > 1}
            onAddFiles={(event, { addedFiles }) => {
              handleFilesFromDropContainer(addedFiles);
            }}
            disabled={files.length >= maxNumberOfFiles || isUploading}
          />

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-productive-heading-02">
                Selected Files ({files.length}/{maxNumberOfFiles})
              </h4>
              
              {files.map((fileState, index) => (
                <FileUploaderItem
                  key={index}
                  name={fileState.file.name}
                  size="md"
                  status={fileState.status === 'complete' ? 'complete' : 
                           fileState.status === 'error' ? 'edit' :
                           fileState.status === 'uploading' ? 'uploading' : 'edit'}
                  onDelete={() => !isUploading && removeFile(index)}
                  iconDescription="Remove file"
                  invalid={fileState.status === 'error'}
                  errorBody={fileState.errorMessage}
                >
                  <div className="space-y-2">
                    <div className="text-sm text-gray-600">
                      {getStatusText(fileState)} ({Math.round(fileState.file.size / 1024)}KB)
                    </div>
                    
                    {fileState.status === 'uploading' && (
                      <ProgressBar
                        value={fileState.progress}
                        max={100}
                        size="small"
                        label={`Uploading ${fileState.progress}%`}
                        hideLabel={true}
                      />
                    )}
                  </div>
                </FileUploaderItem>
              ))}
            </div>
          )}

          {/* Upload Status */}
          {isUploading && (
            <div className="p-4 bg-blue-10 border border-blue-40 rounded">
              <p className="text-sm text-blue-70">
                Uploading files... Please don't close this window.
              </p>
            </div>
          )}

          {hasErrors && (
            <div className="p-4 bg-red-10 border border-red-40 rounded">
              <p className="text-sm text-red-70">
                Some files failed to upload. Please try again or remove the failed files.
              </p>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}