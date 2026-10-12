import { useState } from "react";
import { Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { VideoClip } from "@shared/schema";

interface ClipEditPopoverProps {
  clip: VideoClip;
  color: string;
  palette: string[];
  saving: boolean;
  onSave: (updates: { title: string; color: string }) => Promise<unknown>;
}

export function ClipEditPopover({ clip, color, palette, saving, onSave }: ClipEditPopoverProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(clip.title);
  const [draftColor, setDraftColor] = useState(color);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setTitle(clip.title);
      setDraftColor(color);
    }
    setOpen(next);
  };

  const trimmed = title.trim();
  const unchanged = trimmed === clip.title && draftColor === color;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || unchanged) return;
    try {
      await onSave({ title: trimmed, color: draftColor });
      setOpen(false);
    } catch {
      // Error toast is shown by the mutation; keep the popover open to retry.
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Edit ${clip.title}`}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          data-testid={`button-edit-clip-${clip.id}`}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="meta-mono text-muted-foreground">Name</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              autoFocus
              className="h-8 px-2 rounded border border-border bg-background text-sm text-foreground"
              data-testid={`input-clip-title-${clip.id}`}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="meta-mono text-muted-foreground">Color</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {palette.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Color ${swatch}`}
                  aria-pressed={draftColor.toLowerCase() === swatch}
                  onClick={() => setDraftColor(swatch)}
                  className={`w-5 h-5 rounded-full border-2 ${
                    draftColor.toLowerCase() === swatch ? "border-foreground" : "border-transparent"
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
              <input
                type="color"
                aria-label="Custom color"
                value={draftColor}
                onChange={(e) => setDraftColor(e.target.value)}
                className="w-6 h-6 rounded border border-border bg-transparent cursor-pointer"
                data-testid={`input-clip-color-${clip.id}`}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="meta-mono text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!trimmed || unchanged || saving}
              className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70 disabled:opacity-40 disabled:no-underline"
              data-testid={`button-save-clip-${clip.id}`}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
