import { Link } from "wouter";

interface BrandWordmarkProps {
  onNavigate?: () => void;
}

export default function BrandWordmark({ onNavigate }: BrandWordmarkProps) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="inline-flex items-stretch whitespace-nowrap text-[0.95rem] leading-none transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      style={{ fontFamily: "'DM Mono', 'IBM Plex Mono', Menlo, monospace" }}
      aria-label="Big Miles home"
    >
      <span className="inline-flex min-h-11 items-center text-foreground" style={{ paddingRight: "0.55em" }}>
        Big
      </span>
      <span className="inline-flex min-h-11 items-center bg-[#FAD82D] px-[0.55em] font-medium text-[#111111]">
        Miles
      </span>
    </Link>
  );
}
