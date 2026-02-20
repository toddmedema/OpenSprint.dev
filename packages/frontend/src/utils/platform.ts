/**
 * Detects if the user is on macOS for keyboard shortcut display.
 * Uses navigator.platform, navigator.userAgent, and navigator.userAgentData when available.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform?.toLowerCase() ?? "";
  const ua = navigator.userAgent?.toLowerCase() ?? "";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const uaDataPlatform = uaData?.platform?.toLowerCase() ?? "";
  return (
    platform.includes("mac") ||
    ua.includes("mac") ||
    uaDataPlatform === "macos"
  );
}

/**
 * Returns the keyboard shortcut label for submitting feedback.
 * - macOS: "Cmd + Enter to submit"
 * - Windows/Linux/other: "Ctrl + Enter to submit"
 */
export function getSubmitShortcutLabel(): string {
  return isMac() ? "Cmd + Enter to submit" : "Ctrl + Enter to submit";
}
