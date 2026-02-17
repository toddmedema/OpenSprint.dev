import type { Task } from "@opensprint/shared";
import { PRIORITY_LABELS } from "@opensprint/shared";

export interface KanbanCardProps {
  task: Task;
  onClick: () => void;
}

export function KanbanCard({ task, onClick }: KanbanCardProps) {
  return (
    <div
      className="kanban-card cursor-pointer"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <p className="text-sm font-medium text-gray-900 mb-2">{task.title}</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-mono truncate" title={task.id}>
          {task.id}
        </span>
        <span className="text-xs text-gray-500">
          {PRIORITY_LABELS[task.priority] ?? "Medium"}
        </span>
      </div>
      {task.assignee && <div className="mt-2 text-xs text-brand-600">{task.assignee}</div>}
      {task.testResults && task.testResults.total > 0 && (
        <div
          className={`mt-2 text-xs font-medium ${
            task.testResults.failed > 0 ? "text-red-600" : "text-green-600"
          }`}
        >
          {task.testResults.passed} passed
          {task.testResults.failed > 0 ? `, ${task.testResults.failed} failed` : ""}
          {task.testResults.skipped > 0 ? `, ${task.testResults.skipped} skipped` : ""}
        </div>
      )}
    </div>
  );
}
