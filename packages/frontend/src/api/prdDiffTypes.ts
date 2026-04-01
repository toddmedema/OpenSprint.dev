/**
 * PRD diff API response types. Match @opensprint/shared (PrdProposedDiffResponse, PrdVersionDiffResponse).
 * Import here so the client type-checks when workspace resolves shared from another tree.
 */

export interface PrdDiffLine {
  type: "add" | "remove" | "context";
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface PrdDiffPagination {
  totalLines: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface PrdDiffResult {
  lines: PrdDiffLine[];
  summary?: { additions: number; deletions: number };
  pagination?: PrdDiffPagination;
}

export interface PrdProposedDiffResponse {
  requestId: string;
  /** Omitted when includeContent=false or payload exceeds size limits */
  fromContent?: string;
  /** Omitted when includeContent=false or payload exceeds size limits */
  toContent?: string;
  contentOmittedDueToSize?: boolean;
  diff: PrdDiffResult;
}

export interface PrdVersionDiffResponse {
  fromVersion: string;
  toVersion: string;
  /** Omitted when includeContent=false or payload exceeds size limits */
  fromContent?: string;
  /** Omitted when includeContent=false or payload exceeds size limits */
  toContent?: string;
  contentOmittedDueToSize?: boolean;
  diff: PrdDiffResult;
}
