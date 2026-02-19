/**
 * Wizard step 1: Project name.
 * Validation: non-empty name required.
 */
export interface ProjectMetadataState {
  name: string;
}

export interface ProjectMetadataStepProps {
  value: ProjectMetadataState;
  onChange: (value: ProjectMetadataState) => void;
  /** Validation error when name is empty (e.g. after failed submit) */
  error?: string | null;
}

export function ProjectMetadataStep({ value, onChange, error }: ProjectMetadataStepProps) {
  return (
    <div className="space-y-4" data-testid="project-metadata-step">
      <div>
        <label htmlFor="project-name" className="block text-sm font-medium text-theme-text mb-1">
          Project Name
        </label>
        <input
          id="project-name"
          type="text"
          className="input"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="My Awesome App"
          aria-invalid={!!error}
          aria-describedby={error ? "name-error" : undefined}
        />
        {error && (
          <p id="name-error" className="mt-1 text-sm text-theme-error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Returns true if metadata is valid (non-empty name) */
export function isValidProjectMetadata(state: ProjectMetadataState): boolean {
  return state.name.trim().length > 0;
}
