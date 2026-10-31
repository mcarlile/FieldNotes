import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileDropZoneProps {
  label: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  onAddFiles: (files: File[]) => void;
}

// Drag-and-drop target that also opens the file picker on click or Enter/Space.
export function FileDropZone({ label, accept, multiple, disabled, className, onAddFiles }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const matchesAccept = (file: File) => {
    if (!accept) return true;
    const name = file.name.toLowerCase();
    return accept.split(",").some((raw) => {
      const rule = raw.trim().toLowerCase();
      if (!rule) return false;
      if (rule.startsWith(".")) return name.endsWith(rule);
      if (rule.endsWith("/*")) return file.type.toLowerCase().startsWith(rule.slice(0, -1));
      return file.type.toLowerCase() === rule;
    });
  };

  const handleFiles = (list: FileList | null) => {
    if (!list || disabled) return;
    let files = Array.from(list).filter(matchesAccept);
    if (!multiple) files = files.slice(0, 1);
    if (files.length > 0) onAddFiles(files);
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground transition-colors",
        "cursor-pointer hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "border-foreground/60 bg-accent text-foreground",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <Upload className="h-5 w-5" strokeWidth={1.5} />
      <span>{label}</span>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
