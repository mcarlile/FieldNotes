import { LayoutGrid, Flame, List } from "lucide-react";

export type ViewMode = "notes" | "table" | "heatmap";

const modes = [
  { id: "notes", label: "Cards", icon: LayoutGrid },
  { id: "table", label: "Table", icon: List },
  { id: "heatmap", label: "Heat map", icon: Flame },
] as const;

interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export default function ViewModeSwitcher({ value, onChange }: ViewModeSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="inline-flex items-center rounded-full border border-border bg-muted/60 p-0.5"
      data-testid="view-mode-switcher"
    >
      {modes.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`meta-mono flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
            value === id
              ? "bg-background text-foreground shadow-[0_1px_2px_rgba(26,24,21,0.08)]"
              : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid={`mode-${id}`}
        >
          <Icon className="h-3 w-3" />
          {label}
        </button>
      ))}
    </div>
  );
}
