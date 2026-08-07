// Hand-rolled, dependency-free stroke icons used across the UI.
// Every icon is a tiny SVG React component that accepts a `size` (px) and
// forwards `className` so callers can color/position it via CSS.
import type { CSSProperties } from "react";

export interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function FolderIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M3 6a1 1 0 0 1 1-1h4.5l2 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" />
    </svg>
  );
}

export function ImageIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 16-5.5-5.5a1 1 0 0 0-1.4 0L4 20" />
    </svg>
  );
}

export function MusicIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  );
}

export function VideoIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="m17 9.5 4-2.2v9.4l-4-2.2" />
    </svg>
  );
}

export function AppsIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M17.5 14v7M14 17.5h7" />
    </svg>
  );
}

export function DocumentIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  );
}

export function ArchiveIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  );
}

export function OtherFileIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M12 12v3" />
      <circle cx="12" cy="17.2" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SearchIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function SettingsIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.96 19a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  );
}

export function LinkAddIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M9 15 15 9" />
      <path d="M10.5 6.5 12 5a3.54 3.54 0 0 1 5 5l-1.5 1.5" />
      <path d="M13.5 17.5 12 19a3.54 3.54 0 0 1-5-5l1.5-1.5" />
    </svg>
  );
}

export function ProgressIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M4 18V9M9 18V5M14 18v-7M19 18V3" />
    </svg>
  );
}

export function PlayIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="currentColor" stroke="none">
      <path d="M7 4.5v15l13-7.5-13-7.5Z" />
    </svg>
  );
}

export function StopIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function PauseIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} fill="currentColor" stroke="none">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function ResumeIcon(props: IconProps) {
  return <PlayIcon {...props} />;
}

export function CloseIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function MinimizeIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function MaximizeIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronUpIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function SortIcon({ size = 12, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} strokeWidth={2}>
      <path d="m7 9 3-4 3 4M7 15l3 4 3-4" />
    </svg>
  );
}

export function RefreshIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function SpinnerIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg
      {...base(size)}
      className={`spin ${className ?? ""}`}
      style={style}
      strokeOpacity={0.3}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeOpacity={1} />
    </svg>
  );
}

export function TrashIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
      <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function ClipboardIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="7" y="5" width="10" height="15" rx="1.5" />
      <path d="M9.5 5V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

export function InfoIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.7" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ErrorIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GridIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}

import type { DownloadCategory } from "@shared/types";

const CATEGORY_ICONS: Record<DownloadCategory, (p: IconProps) => JSX.Element> = {
  image: ImageIcon,
  music: MusicIcon,
  video: VideoIcon,
  apps: AppsIcon,
  document: DocumentIcon,
  compressed: ArchiveIcon,
  other: OtherFileIcon,
};

export function CategoryIcon({
  category,
  ...props
}: IconProps & { category: DownloadCategory }) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon {...props} />;
}

export function LogoIcon({ size = 22, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      aria-hidden
    >
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f8cff" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill="url(#logo-grad)" />
      <path
        d="M12 6.5v8.2M8.2 11.6l3.8 3.8 3.8-3.8"
        fill="none"
        stroke="white"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
