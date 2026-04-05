/**
 * Conservative redaction of credentials and tokens in user-visible strings
 * (failure comments, notifications, WebSockets, event logs).
 *
 * Multiple passes are applied; replacements use fixed literals so repeated
 * application does not grow the string.
 */

const REDACTED = "[REDACTED]";
const REDACTED_JWT = "[REDACTED_JWT]";

/** Authorization header values are almost always credentials (value may include spaces, e.g. Bearer) */
const AUTH_HEADER_VALUE = /(Authorization\s*:\s*)([^\r\n]+)/gi;

/** Anthropic API key style */
const SK_ANT = /\bsk-ant-[A-Za-z0-9_-]{8,}\b/gi;

/** OpenAI-style sk- secrets (sk-ant-* handled above) */
const SK_GENERIC = /\bsk-(?!ant-)[a-zA-Z0-9_-]{20,}\b/gi;

/** Typical HS/RS JWT (three base64url segments) */
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** ENV-style assignments for sensitive names */
const SENSITIVE_ENV_ASSIGN = new RegExp(
  String.raw`\b([A-Z][A-Z0-9_]*_(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDS?|CREDENTIALS))\s*=\s*\S+`,
  "g"
);

/** api_key=..., access_token=... in URLs or text */
const QUERY_SECRET =
  /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth|token|key))\s*=\s*[^&\s"'<>]+/gi;

/** GitHub fine-grained / classic PAT fragments */
const GITHUB_PAT = /\bghp_[A-Za-z0-9]{20,}\b/gi;
const GITHUB_FINE = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi;

/** Slack bot tokens */
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi;

function redactBearerSuffixes(s: string): string {
  return s.replace(/\bBearer\s+(\S+)/gi, (full, token: string) => {
    if (
      token.length >= 24 ||
      /^eyJ[A-Za-z0-9_-]{8,}\./.test(token) ||
      /^sk-/i.test(token) ||
      /^Basic\s+/i.test(token)
    ) {
      return `Bearer ${REDACTED}`;
    }
    return full;
  });
}

/**
 * Redact likely secrets from a string intended for UI, notifications, or persisted diagnostics.
 */
export function redactSecretsForUserDisplay(text: string): string {
  if (!text) return text;

  let s = text;

  s = redactBearerSuffixes(s);
  s = s.replace(AUTH_HEADER_VALUE, `$1${REDACTED}`);
  s = s.replace(SK_ANT, REDACTED);
  s = s.replace(SK_GENERIC, REDACTED);
  s = s.replace(JWT_LIKE, REDACTED_JWT);
  s = s.replace(SENSITIVE_ENV_ASSIGN, `$1=${REDACTED}`);
  s = s.replace(QUERY_SECRET, `$1=${REDACTED}`);
  s = s.replace(GITHUB_PAT, REDACTED);
  s = s.replace(GITHUB_FINE, REDACTED);
  s = s.replace(SLACK_TOKEN, REDACTED);

  return s;
}

export type FailureDiagnosticDetailLike = {
  command: string | null;
  reason: string | null;
  reasonTruncated?: boolean;
  outputSnippet: string | null;
  outputSnippetTruncated?: boolean;
  worktreePath: string | null;
  firstErrorLine: string | null;
};

/**
 * Redact string fields on a failure diagnostic payload before broadcast or persistence.
 */
export function redactFailureDiagnosticDetail<T extends FailureDiagnosticDetailLike | null>(
  detail: T
): T {
  if (!detail) return detail;
  const d = detail as FailureDiagnosticDetailLike;
  return {
    ...d,
    command: d.command ? redactSecretsForUserDisplay(d.command) : null,
    reason: d.reason ? redactSecretsForUserDisplay(d.reason) : null,
    outputSnippet: d.outputSnippet ? redactSecretsForUserDisplay(d.outputSnippet) : null,
    firstErrorLine: d.firstErrorLine ? redactSecretsForUserDisplay(d.firstErrorLine) : null,
  } as T;
}

/** Optional string fields on merge-gate / retry diagnostic blobs */
export type RetryQualityGateDetailRedactInput = {
  command?: string | null;
  reason?: string | null;
  outputSnippet?: string | null;
  firstErrorLine?: string | null;
  classificationReason?: string | null;
  executable?: string | null;
  cwd?: string | null;
};

export function redactRetryQualityGateDetail<T extends RetryQualityGateDetailRedactInput>(
  detail: T | null | undefined
): T | undefined {
  if (!detail) return undefined;
  return {
    ...detail,
    command:
      detail.command != null ? redactSecretsForUserDisplay(String(detail.command)) : detail.command,
    reason:
      detail.reason != null ? redactSecretsForUserDisplay(String(detail.reason)) : detail.reason,
    outputSnippet:
      detail.outputSnippet != null
        ? redactSecretsForUserDisplay(String(detail.outputSnippet))
        : detail.outputSnippet,
    firstErrorLine:
      detail.firstErrorLine != null
        ? redactSecretsForUserDisplay(String(detail.firstErrorLine))
        : detail.firstErrorLine,
    classificationReason:
      detail.classificationReason != null
        ? redactSecretsForUserDisplay(String(detail.classificationReason))
        : detail.classificationReason,
    executable:
      detail.executable != null
        ? redactSecretsForUserDisplay(String(detail.executable))
        : detail.executable,
    cwd: detail.cwd != null ? redactSecretsForUserDisplay(String(detail.cwd)) : detail.cwd,
  };
}
