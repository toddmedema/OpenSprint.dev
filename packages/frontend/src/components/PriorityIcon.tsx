import { useId } from "react";
import { PRIORITY_LABELS } from "@opensprint/shared";

export interface PriorityIconProps {
  priority: number;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const SIZE_CLASSES: Record<"xs" | "sm" | "md", string> = {
  xs: "w-3 h-3",
  sm: "w-4 h-4",
  md: "w-5 h-5",
};

/** Jira-style filled SVG icons. Colors are hardcoded for consistent appearance in light/dark mode. */
export function PriorityIcon({ priority, size = "sm", className = "" }: PriorityIconProps) {
  const sizeClass = SIZE_CLASSES[size];
  const safePriority = priority >= 0 && priority <= 4 ? priority : 2;
  const label = PRIORITY_LABELS[safePriority] ?? PRIORITY_LABELS[2]!;
  const gradientId = useId();

  return (
    <svg
      className={`${sizeClass} shrink-0 ${className}`.trim()}
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
    >
      {safePriority === 0 && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ff5630" />
              <stop offset="100%" stopColor="#ff8f73" />
            </linearGradient>
          </defs>
          <path
            d="M2.5 4l5-2.9c.3-.2.7-.2 1 0l5 2.9c.3.2.5.5.5.9v8.2c0 .6-.4 1-1 1-.2 0-.4 0-.5-.1L8 11.4 3.5 14c-.5.3-1.1.1-1.4-.4-.1-.1-.1-.3-.1-.5V4.9c0-.4.2-.7.5-.9z"
            fill={`url(#${gradientId})`}
          />
        </>
      )}
      {safePriority === 1 && (
        <path
          d="M3.5 9.9c-.5.3-1.1.1-1.4-.3s-.1-1.1.4-1.4l5-3c.3-.2.7-.2 1 0l5 3c.5.3.6.9.3 1.4-.3.5-.9.6-1.4.3L8 7.2 3.5 9.9z"
          fill="#ff5630"
        />
      )}
      {safePriority === 2 && (
        <path
          d="M3,4h10c0.6,0,1,0.4,1,1s-0.4,1-1,1H3C2.4,6,2,5.6,2,5S2.4,4,3,4z M3,10h10c0.6,0,1,0.4,1,1s-0.4,1-1,1H3c-0.6,0-1-0.4-1-1S2.4,10,3,10z"
          fill="#FFAB00"
        />
      )}
      {safePriority === 3 && (
        <path
          d="M12.5 6.1c.5-.3 1.1-.1 1.4.4.3.5.1 1.1-.3 1.3l-5 3c-.3.2-.7.2-1 0l-5-3c-.6-.2-.7-.9-.4-1.3.2-.5.9-.7 1.3-.4L8 8.8l4.5-2.7z"
          fill="#0065ff"
        />
      )}
      {safePriority === 4 && (
        <>
          <path
            d="M12.504883 8.14541c.5-.3 1.1-.1 1.4.4s.1 1-.4 1.3l-5 3c-.3.2-.7.2-1 0l-5-3c-.5-.3-.6-.9-.3-1.4.2-.4.8-.6 1.3-.3l4.5 2.7 4.5-2.7z"
            fill="#0065ff"
          />
          <path
            d="M12.504883 3.84541c.5-.3 1.1-.2 1.4.3s.1 1.1-.4 1.4l-5 3c-.3.2-.7.2-1 0l-5-3c-.5-.3-.6-.9-.3-1.4.3-.5.9-.6 1.4-.3l4.4 2.7 4.5-2.7z"
            fill="#2684ff"
          />
        </>
      )}
    </svg>
  );
}
