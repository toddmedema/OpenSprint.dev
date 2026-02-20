/**
 * Shared prompt fragments for planning agents that output JSON.
 * Use to enforce consistent output format and reduce parse failures.
 */
export const JSON_OUTPUT_PREAMBLE =
  "Respond with ONLY valid JSON. No markdown code fence, no preamble, no explanation after the JSON. The first character of your response must be {.";
