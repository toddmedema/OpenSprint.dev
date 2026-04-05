/**
 * SHA-256 hash (CSP source token) of the inline `<style>...</style>` body in
 * `packages/frontend/index.html` (theme boot styles). If that block changes,
 * update this constant — tests read the HTML file and fail when the hash drifts.
 */
export const SPA_INDEX_BOOT_INLINE_STYLE_SHA256 = "sha256-lcr+XcSCkIpPhhTJTzZ0zy4W3hnIOJgGGuqmcedRVls=";
/**
 * Strict baseline CSP for the Open Sprint SPA (desktop backend + Electron).
 *
 * Aligns with `markdownSanitize.ts` (`protocols.src` / `protocols.href`): `img-src` allows
 * `data:` plus `https:` / `http:` for remote images in sanitized markdown; scripts stay
 * same-origin only; `object-src` blocked; `frame-ancestors` denied.
 *
 * Production uses a hash for the single inline style block so `style-src` avoids
 * full `unsafe-inline`. Scripts are same-origin modules + `/theme-init.js` +
 * `/__opensprint_local_session.js` (desktop).
 */
export function buildSpaContentSecurityPolicyProduction() {
    const directives = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "script-src 'self'",
        `style-src 'self' '${SPA_INDEX_BOOT_INLINE_STYLE_SHA256}' https://fonts.googleapis.com`,
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https: http:",
        "connect-src 'self' ws: wss:",
        "worker-src 'self' blob:",
        "form-action 'self'",
    ];
    return directives.join("; ");
}
/**
 * Relaxed CSP for Vite dev (HMR needs `unsafe-eval`; `style-src` uses `unsafe-inline` for
 * index.html boot styles). `connect-src` includes the proxied API/WebSocket backend on 3100.
 */
export function buildSpaContentSecurityPolicyViteDevelopment() {
    const directives = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "script-src 'self' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https: http:",
        "connect-src 'self' ws: wss: http://127.0.0.1:3100 http://localhost:3100 ws://127.0.0.1:3100 ws://localhost:3100",
        "worker-src 'self' blob:",
        "form-action 'self'",
    ];
    return directives.join("; ");
}
