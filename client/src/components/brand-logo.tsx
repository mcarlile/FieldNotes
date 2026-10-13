interface BrandLogoProps {
  className?: string;
  /** Font size of the wordmark; the yellow block scales with it */
  size?: string;
  /** Color class for "Big Miles"; pages with a fixed light background pass a dark color */
  textClassName?: string;
}

// "Big Miles" + yellow "Studio" block wordmark
export default function BrandLogo({ className = "", size = "1rem", textClassName = "text-foreground" }: BrandLogoProps) {
  return (
    <span
      className={`inline-flex items-stretch leading-none whitespace-nowrap ${className}`}
      style={{ fontFamily: "'IBM Plex Mono', 'JetBrains Mono', Menlo, monospace", fontSize: size }}
      aria-label="Big Miles Studio"
      role="img"
      data-testid="brand-logo"
    >
      <span className={textClassName} style={{ padding: "0.25em 0.55em 0.25em 0" }} aria-hidden="true">
        Big Miles
      </span>
      <span
        style={{ background: "#FAD82D", color: "#111111", fontWeight: 600, padding: "0.25em 0.55em" }}
        aria-hidden="true"
      >
        Studio
      </span>
    </span>
  );
}
