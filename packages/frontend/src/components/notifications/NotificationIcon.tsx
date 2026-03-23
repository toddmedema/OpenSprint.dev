import type { NotificationSeverity } from "./notificationStyles";

interface NotificationIconProps {
  severity: NotificationSeverity;
  size?: number;
  className?: string;
}

export function NotificationIcon({ severity, size = 18, className = "" }: NotificationIconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className: `shrink-0 ${className}`.trim(),
  };

  switch (severity) {
    case "error":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </svg>
      );
    case "warning":
      return (
        <svg {...props}>
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "info":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      );
    case "success":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
  }
}
