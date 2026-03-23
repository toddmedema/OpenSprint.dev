export function shouldApplyRuntimeDockIcon(
  platform: NodeJS.Platform,
  isPackaged: boolean
): boolean {
  // Packaged macOS builds should keep the bundle icon so the system can apply
  // the light/dark/tinted appearance variants from the Icon Composer asset.
  return platform === "darwin" && !isPackaged;
}
