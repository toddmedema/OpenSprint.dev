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

const strokeProps = {
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none" as const,
};

export function PriorityIcon({ priority, size = "sm", className = "" }: PriorityIconProps) {
  const sizeClass = SIZE_CLASSES[size];
  const label = PRIORITY_LABELS[priority] ?? PRIORITY_LABELS[2]!;
  const safePriority = priority >= 0 && priority <= 4 ? priority : 2;

  return (
    <svg
      className={`${sizeClass} shrink-0 ${className}`.trim()}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
    >
      {safePriority === 0 && (
        <>
          <path d="M6 10l6-4 6 4" {...strokeProps} />
          <path d="M6 18l6-4 6 4" {...strokeProps} />
        </>
      )}
      {safePriority === 1 && <path d="M6 16l6-8 6 8" {...strokeProps} />}
      {safePriority === 2 && <path d="M6 12h12" {...strokeProps} />}
      {safePriority === 3 && <path d="M6 8l6 8 6-8" {...strokeProps} />}
      {safePriority === 4 && (
        <>
          <path d="M6 6l6 4 6-4" {...strokeProps} />
          <path d="M6 14l6 4 6-4" {...strokeProps} />
        </>
      )}
    </svg>
  );
}
