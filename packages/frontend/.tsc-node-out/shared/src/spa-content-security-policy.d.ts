/**
 * SHA-256 hash (CSP source token) of the inline `<style>...</style>` body in
 * `packages/frontend/index.html` (theme boot styles). If that block changes,
 * update this constant — tests read the HTML file and fail when the hash drifts.
 */
export declare const SPA_INDEX_BOOT_INLINE_STYLE_SHA256 = "sha256-lcr+XcSCkIpPhhTJTzZ0zy4W3hnIOJgGGuqmcedRVls=";
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
export declare function buildSpaContentSecurityPolicyProduction(): string;
/**
 * Relaxed CSP for Vite dev (HMR needs `unsafe-eval`; `style-src` uses `unsafe-inline` for
 * index.html boot styles). `connect-src` includes the proxied API/WebSocket backend on 3100.
 */
export declare function buildSpaContentSecurityPolicyViteDevelopment(): string;
