export function buildAgentApiFailureMessages(
  agentType: "claude" | "openai",
  kind: "rate_limit" | "auth",
  options?: { allKeysExhausted?: boolean }
): { userMessage: string; notificationMessage: string } {
  const label = agentType === "claude" ? "Claude" : "OpenAI";
  if (kind === "rate_limit") {
    if (options?.allKeysExhausted) {
      return {
        userMessage: `All ${label} API keys have hit rate limits. Add another key in Settings or retry after the limit resets.`,
        notificationMessage: `${label} hit a rate limit. Add another API key in Settings or retry after the limit resets.`,
      };
    }
    return {
      userMessage: `${label} hit a rate limit. Add another key in Settings or retry after the limit resets.`,
      notificationMessage: `${label} hit a rate limit. Add another API key in Settings or retry after the limit resets.`,
    };
  }

  return {
    userMessage: `${label} is not configured correctly. Add a valid API key in Settings and try again.`,
    notificationMessage: `${label} needs a valid API key in Settings before work can continue.`,
  };
}
