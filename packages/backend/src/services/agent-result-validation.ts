import type { CodingAgentResult, ReviewAgentResult } from "@opensprint/shared";
import { normalizeCodingStatus, normalizeReviewStatus } from "./result-normalizers.js";

export interface MergerAgentResult {
  status: "success" | "failed";
  summary: string;
  notes?: string;
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseOpenQuestions(
  value: unknown
): CodingAgentResult["open_questions"] | CodingAgentResult["openQuestions"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const questions = value
    .filter(
      (item): item is { id?: unknown; text: string } =>
        item != null && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
    )
    .map((item, index) => ({
      id:
        typeof item.id === "string" && item.id.trim() !== "" ? item.id.trim() : `q${index + 1}`,
      text: item.text.trim(),
    }))
    .filter((item) => item.text.length > 0);
  return questions.length > 0 ? questions : undefined;
}

export function parseCodingAgentResult(raw: string | null | undefined): CodingAgentResult | null {
  if (!raw || raw.trim() === "") return null;
  const record = parseJsonRecord(raw);
  if (!record || typeof record.status !== "string") return null;

  const candidate: CodingAgentResult = {
    status: "failed",
    summary: typeof record.summary === "string" ? record.summary : "",
    filesChanged: Array.isArray(record.filesChanged)
      ? record.filesChanged.filter((item): item is string => typeof item === "string")
      : [],
    testsWritten: typeof record.testsWritten === "number" ? record.testsWritten : 0,
    testsPassed: typeof record.testsPassed === "number" ? record.testsPassed : 0,
    notes: typeof record.notes === "string" ? record.notes : "",
    ...(parseOpenQuestions(record.open_questions) && {
      open_questions: parseOpenQuestions(record.open_questions),
    }),
    ...(parseOpenQuestions(record.openQuestions) && {
      openQuestions: parseOpenQuestions(record.openQuestions),
    }),
  };

  (candidate as { status: string }).status = record.status;

  normalizeCodingStatus(candidate);

  if (candidate.status !== "success" && candidate.status !== "failed") {
    return null;
  }

  if (!candidate.summary.trim()) {
    const openQuestions = candidate.open_questions ?? candidate.openQuestions;
    if (!openQuestions || openQuestions.length === 0) {
      return null;
    }
    candidate.summary = "Needs clarification before proceeding.";
  }

  return candidate;
}

export function parseReviewAgentResult(raw: string | null | undefined): ReviewAgentResult | null {
  if (!raw || raw.trim() === "") return null;
  const record = parseJsonRecord(raw);
  if (!record || typeof record.status !== "string") return null;

  const candidate: ReviewAgentResult = {
    status: "rejected",
    summary: typeof record.summary === "string" ? record.summary : "",
    ...(Array.isArray(record.issues) && {
      issues: record.issues.filter((item): item is string => typeof item === "string"),
    }),
    notes: typeof record.notes === "string" ? record.notes : "",
  };

  (candidate as { status: string }).status = record.status;

  normalizeReviewStatus(candidate);

  if (candidate.status !== "approved" && candidate.status !== "rejected") {
    return null;
  }

  return candidate.summary.trim() ? candidate : null;
}

export function parseMergerAgentResult(raw: string | null | undefined): MergerAgentResult | null {
  if (!raw || raw.trim() === "") return null;
  const record = parseJsonRecord(raw);
  if (!record || typeof record.status !== "string") return null;

  const status = record.status.toLowerCase().trim();
  if (status !== "success" && status !== "failed") {
    return null;
  }

  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!summary) {
    return null;
  }

  return {
    status,
    summary,
    ...(typeof record.notes === "string" && record.notes.trim() !== ""
      ? { notes: record.notes.trim() }
      : {}),
  };
}

export function describeStructuredOutputProblem(params: {
  fileLabel: string;
  rawContent: string | null | undefined;
  expectedShape: string;
}): string {
  const raw = params.rawContent;
  if (raw == null) {
    return `${params.fileLabel} was missing. Expected ${params.expectedShape}.`;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return `${params.fileLabel} was empty. Expected ${params.expectedShape}.`;
  }

  const preview = trimmed.slice(0, 1200);
  let reason = `${params.fileLabel} did not match the expected structure (${params.expectedShape}).`;
  if (preview) {
    reason += `\n\nPrevious content:\n\`\`\`\n${preview}\n\`\`\``;
  }
  return reason;
}
