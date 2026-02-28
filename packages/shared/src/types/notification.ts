/** Source of an open question (agent clarification request) */
export type NotificationSource = "plan" | "prd" | "execute" | "eval";

/** Kind of notification — open_question = agent clarification; api_blocked = API/auth failure; hil_approval = HIL approval (Approve/Reject) */
export type NotificationKind = "open_question" | "api_blocked" | "hil_approval";

/** Error code for api_blocked notifications (rate_limit, auth, out_of_credit) */
export type ApiBlockedErrorCode = "rate_limit" | "auth" | "out_of_credit";

export interface OpenQuestionItem {
  id: string;
  text: string;
  createdAt: string;
}

/** Open question / notification (agent clarification request or API-blocked human notification) */
export interface Notification {
  id: string;
  projectId: string;
  source: NotificationSource;
  sourceId: string;
  questions: OpenQuestionItem[];
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  /** open_question = agent clarification; api_blocked = API/auth failure requiring user action */
  kind?: NotificationKind;
  /** For api_blocked: rate_limit | auth | out_of_credit — distinguishes failure type */
  errorCode?: ApiBlockedErrorCode;
}
