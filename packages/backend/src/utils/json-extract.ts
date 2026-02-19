/**
 * Extract and parse a JSON object from AI agent response content.
 * Uses regex to find a JSON object (optionally containing a required key).
 * @param content - Raw agent response string (may include markdown, code blocks, etc.)
 * @param requiredKey - If provided, only match JSON objects containing this key
 * @returns Parsed result or null on parse failure / no match
 */
export function extractJsonFromAgentResponse<T>(
  content: string,
  requiredKey?: string
): T | null {
  const pattern = requiredKey
    ? new RegExp(`\\{[\\s\\S]*"${requiredKey}"[\\s\\S]*\\}`)
    : /\{[\s\S]*\}/;
  const jsonMatch = content.match(pattern);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}
