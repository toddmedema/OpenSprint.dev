/** Source of an open question (agent clarification request) */
export type NotificationSource = "plan" | "prd" | "execute" | "eval";

export interface OpenQuestionItem {
  id: string;
  text: string;
  createdAt: string;
}

/** Open question / notification (agent clarification request) */
export interface Notification {
  id: string;
  projectId: string;
  source: NotificationSource;
  sourceId: string;
  questions: OpenQuestionItem[];
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}
