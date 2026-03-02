import type React from "react";

export interface ViewToggleProps<T extends string> {
  options: { value: T; icon: React.ReactNode; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function ViewToggle<T extends string>({ options, value, onChange }: ViewToggleProps<T>) {
  const currentIndex = options.findIndex((o) => o.value === value);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const nextIndex = safeIndex === 0 ? options.length - 1 : safeIndex - 1;
      onChange(options[nextIndex].value);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextIndex = safeIndex === options.length - 1 ? 0 : safeIndex + 1;
      onChange(options[nextIndex].value);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      data-testid="view-toggle"
      tabIndex={0}
      className="inline-flex rounded-lg border border-theme-border bg-theme-surface-muted p-0.5 mt-1.5"
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={option.label}
            data-testid={`view-toggle-${option.value}`}
            onClick={() => onChange(option.value)}
            className={`p-1.5 min-h-[44px] min-w-[44px] transition-colors rounded-md inline-flex items-center justify-center ${
              isActive
                ? "bg-theme-surface shadow-sm ring-1 ring-theme-border text-theme-text"
                : "text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle/50"
            }`}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
