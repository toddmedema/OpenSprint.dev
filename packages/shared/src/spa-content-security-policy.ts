/**
 * SHA-256 hash (CSP source token) of the inline `<style>...</style>` body in
 * `packages/frontend/index.html` (theme boot styles). If that block changes,
 * update this constant — tests read the HTML file and fail when the hash drifts.
 */
export const SPA_INDEX_BOOT_INLINE_STYLE_SHA256 =
  "sha256-sIR4dCZFn3Uc0Xk0i4N73H1XXrjByqtiWZmZywW0T4k=";

export type BuildSpaContentSecurityPolicyProductionOptions = {
  /**
   * Per-response nonce for the inline desktop local-session bootstrap script
   * (injected into `index.html` when `OPENSPRINT_DESKTOP=1`). When set, `script-src`
   * allows same-origin bundles plus that single inline script.
   */
  desktopSessionScriptNonce?: string;
};

/**
 * Strict baseline CSP for the Open Sprint SPA (desktop backend + Electron).
 *
 * Aligns with `markdownSanitize.ts`: `img-src` allows `data:` for inline images;
 * no broad `https:` script sources; `object-src` blocked; `frame-ancestors` denied.
 *
 * Production uses a hash for the single inline style block so `style-src` avoids
 * full `unsafe-inline`. Scripts are same-origin modules (and, in desktop mode with
 * `desktopSessionScriptNonce`, one nonce-guarded inline session bootstrap).
 */
export function buildSpaContentSecurityPolicyProduction(
  options?: BuildSpaContentSecurityPolicyProductionOptions
): string {
  const nonce = options?.desktopSessionScriptNonce?.trim();
  const scriptSrc =
    nonce && nonce.length > 0 ? `'self' 'nonce-${nonce}'` : "'self'";
  const directives: string[] = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src ${scriptSrc}`,
    `style-src 'self' '${SPA_INDEX_BOOT_INLINE_STYLE_SHA256}' https://fonts.googleapis.com`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "form-action 'self'",
  ];
  return directives.join("; ");
}

/**
 * Relaxed CSP for Vite dev (HMR needs `unsafe-eval`; inline style in index.html).
 * `connect-src` includes the proxied API/WebSocket backend on 3100.
 */
export function buildSpaContentSecurityPolicyViteDevelopment(): string {
  const directives: string[] = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss: http://127.0.0.1:3100 http://localhost:3100 ws://127.0.0.1:3100 ws://localhost:3100",
    "worker-src 'self' blob:",
    "form-action 'self'",
  ];
  return directives.join("; ");
}
