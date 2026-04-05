/** Available PRD sections */
export type PrdSectionKey =
  | "executive_summary"
  | "problem_statement"
  | "user_personas"
  | "goals_and_metrics"
  | "assumptions_and_constraints"
  | "feature_list"
  | "technical_architecture"
  | "data_model"
  | "api_contracts"
  | "non_functional_requirements"
  | "open_questions";

/** A single section of the PRD */
export interface PrdSection {
  content: string;
  version: number;
  updatedAt: string;
}

/** Change log entry for PRD modifications */
export interface PrdChangeLogEntry {
  section: string; // PrdSectionKey | dynamic section (e.g. competitive_landscape)
  version: number;
  source: "sketch" | "plan" | "execute" | "eval" | "deliver";
  timestamp: string;
  diff: string;
  /** Document version after this change; optional for legacy entries */
  documentVersion?: number;
}

/** PRD section update response */
export interface PrdSectionUpdateResult {
  section: PrdSection;
  previousVersion: number;
  newVersion: number;
}

/** PRD upload response */
export interface PrdUploadResult {
  text: string;
  filename: string;
}

/** Full PRD document stored as SPEC.md at repo root (flat markdown) with metadata in .opensprint/spec-metadata.json */
export interface Prd {
  version: number;
  /** Sections keyed by identifier. Sketch agent may add dynamic sections (e.g. competitive_landscape). */
  sections: Record<string, PrdSection>;
  changeLog: PrdChangeLogEntry[];
}

// ─── PRD diff (proposed-diff and version diff API responses) ───

/** Single line in a PRD diff result */
export interface PrdDiffLine {
  type: "add" | "remove" | "context";
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/** Pagination for PRD/SPEC line diff responses (`lineOffset` / `lineLimit` query params). */
export interface PrdDiffPagination {
  totalLines: number;
  offset: number;
  /** Number of lines returned in this response (may be less than requested limit at end of diff). */
  limit: number;
  hasMore: boolean;
}

/** Result of diffing two text contents (shared format for API responses) */
export interface PrdDiffResult {
  lines: PrdDiffLine[];
  summary?: { additions: number; deletions: number };
  /** Present on proposed-diff and version-diff endpoints (bounded line windows). */
  pagination?: PrdDiffPagination;
}

/** Response for GET /projects/:id/prd/proposed-diff?requestId= */
export interface PrdProposedDiffResponse {
  requestId: string;
  /** Omitted when includeContent=false or payload would exceed size limits */
  fromContent?: string;
  /** Omitted when includeContent=false or payload would exceed size limits */
  toContent?: string;
  /**
   * When true, `fromContent`/`toContent` were skipped because combined UTF-8 size exceeded the API cap
   * (diff lines and summary are still returned).
   */
  contentOmittedDueToSize?: boolean;
  /**
   * When the Harmonizer registered a base SPEC hash and the current SPEC.md no longer matches
   * (user edited the PRD after the proposal was created).
   */
  staleBase?: boolean;
  diff: PrdDiffResult;
}

/** Response for GET /projects/:id/prd/diff?fromVersion=&toVersion= */
export interface PrdVersionDiffResponse {
  fromVersion: string;
  toVersion: string;
  /** Omitted when includeContent=false or payload would exceed size limits */
  fromContent?: string;
  /** Omitted when includeContent=false or payload would exceed size limits */
  toContent?: string;
  contentOmittedDueToSize?: boolean;
  diff: PrdDiffResult;
}
