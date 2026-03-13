import React, { useState, useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../../store";
import {
  selectTaskById,
  selectPriorityUpdatePendingTaskId,
  updateTaskPriority,
} from "../../store/slices/executeSlice";
import { PRIORITY_LABELS } from "@opensprint/shared";
import { PriorityIcon } from "../PriorityIcon";
import { shouldRightAlignDropdown } from "../../lib/dropdownViewport";

/**
 * Isolated priority display/dropdown that reads from Redux.
 * When priority changes, only this component re-renders — not the full sidebar.
 * Prevents Execute sidebar flicker on priority change.
 */
export function TaskPriorityDropdown({
  projectId,
  taskId,
  isDoneTask,
}: {
  projectId: string;
  taskId: string;
  isDoneTask: boolean;
}) {
  const dispatch = useAppDispatch();
  const task = useAppSelector((s) => selectTaskById(s, taskId));
  const priorityUpdatePendingTaskId = useAppSelector(selectPriorityUpdatePendingTaskId);
  const priorityUpdateLoading = Boolean(taskId) && priorityUpdatePendingTaskId === taskId;

  const [priorityDropdownOpen, setPriorityDropdownOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!priorityDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (priorityDropdownRef.current && !priorityDropdownRef.current.contains(e.target as Node)) {
        setPriorityDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [priorityDropdownOpen]);

  useEffect(() => {
    if (priorityDropdownOpen && triggerRef.current) {
      setAlignRight(shouldRightAlignDropdown(triggerRef.current.getBoundingClientRect()));
    }
  }, [priorityDropdownOpen]);

  const handlePrioritySelect = (priority: number) => {
    if (!task || task.priority === priority) return;
    const previousPriority = task.priority ?? 1;
    dispatch(
      updateTaskPriority({
        projectId,
        taskId,
        priority,
        previousPriority,
      })
    );
    setPriorityDropdownOpen(false);
  };

  const displayPriority = task?.priority ?? 1;

  if (isDoneTask) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-theme-muted cursor-default"
        data-testid="priority-read-only"
        aria-label={`Priority: ${PRIORITY_LABELS[displayPriority] ?? "Medium"}`}
      >
        <PriorityIcon priority={displayPriority} size="sm" />
        {PRIORITY_LABELS[displayPriority] ?? "Medium"}
      </span>
    );
  }

  return (
    <div ref={priorityDropdownRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setPriorityDropdownOpen((o) => !o)}
        disabled={priorityUpdateLoading}
        className="dropdown-trigger inline-flex items-center gap-1.5 rounded py-1 text-xs text-theme-muted hover:bg-theme-border-subtle/50 hover:text-theme-text transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
        aria-haspopup="listbox"
        aria-expanded={priorityDropdownOpen}
        aria-busy={priorityUpdateLoading}
        aria-label={`Priority: ${PRIORITY_LABELS[displayPriority] ?? "Medium"}. Click to change`}
        data-testid="priority-dropdown-trigger"
      >
        <PriorityIcon priority={displayPriority} size="sm" />
        <span>{PRIORITY_LABELS[displayPriority] ?? "Medium"}</span>
        {priorityUpdateLoading ? (
          <span className="text-[10px] opacity-70 animate-pulse">Updating…</span>
        ) : (
          <span className="text-[10px] opacity-70">{priorityDropdownOpen ? "▲" : "▼"}</span>
        )}
      </button>
      {priorityDropdownOpen && (
        <ul
          role="listbox"
          className={`absolute top-full mt-1 z-50 min-w-[140px] rounded-lg border border-theme-border bg-theme-surface shadow-lg py-1 ${alignRight ? "right-0 left-auto" : "left-0 right-auto"}`}
          data-testid="priority-dropdown"
        >
          {([0, 1, 2, 3, 4] as const).map((p) => (
            <li key={p} role="option" aria-selected={displayPriority === p}>
              <button
                type="button"
                onClick={() => handlePrioritySelect(p)}
                className={`dropdown-item w-full flex items-center gap-2 text-left text-xs hover:bg-theme-border-subtle/50 transition-colors ${
                  displayPriority === p ? "text-brand-600 font-medium" : "text-theme-text"
                }`}
                data-testid={`priority-option-${p}`}
              >
                <PriorityIcon priority={p} size="sm" />
                {p}: {PRIORITY_LABELS[p]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
