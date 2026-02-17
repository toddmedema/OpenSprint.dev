import type { KanbanColumn } from "@opensprint/shared";

export const COLUMN_LABELS: Record<KanbanColumn, string> = {
  planning: "Planning",
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

const columnColors: Record<KanbanColumn, string> = {
  planning: "bg-gray-400",
  backlog: "bg-yellow-400",
  ready: "bg-blue-400",
  in_progress: "bg-purple-400",
  in_review: "bg-orange-400",
  done: "bg-green-400",
};

export interface TaskStatusBadgeProps {
  column: KanbanColumn;
  size?: "sm" | "xs";
  title?: string;
}

export function TaskStatusBadge({ column, size = "sm", title }: TaskStatusBadgeProps) {
  const dim = size === "sm" ? "w-2.5 h-2.5" : "w-2 h-2";
  const label = title ?? COLUMN_LABELS[column];

  if (column === "done") {
    return (
      <span className="inline-flex" title={label}>
        <svg
          className={`${dim} shrink-0 text-green-500`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return <span className={`${dim} rounded-full shrink-0 ${columnColors[column]}`} title={label} />;
}
