export const DESIGN_TOKEN_CONTRACT = {
  surface: ["page", "raised", "muted", "code"] as const,
  text: ["primary", "secondary", "inverse", "placeholder", "code"] as const,
  stroke: ["soft", "strong", "focus", "subtle"] as const,
  accent: ["primary", "strong", "tint"] as const,
  status: ["info", "success", "warning", "error"] as const,
  overlay: ["default"] as const,
  scrollbar: ["track", "thumb", "thumb-hover"] as const,
} as const;

export type DesignTokenGroup = keyof typeof DESIGN_TOKEN_CONTRACT;

export type DesignTokenName<G extends DesignTokenGroup> = (typeof DESIGN_TOKEN_CONTRACT)[G][number];

export function getDesignTokenVar<G extends DesignTokenGroup>(
  group: G,
  name: DesignTokenName<G>
): string {
  return `--ui-${group}-${name}`;
}
