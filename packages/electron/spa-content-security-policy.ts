/**
 * Mirrors `buildSpaContentSecurityPolicyProduction` in `@opensprint/shared`
 * (`packages/shared/src/spa-content-security-policy.ts`). The Electron main process
 * compiles to CommonJS; `@opensprint/shared` is ESM-only, so we duplicate here to
 * avoid `require`/`import` interop errors.
 */
const SPA_INDEX_BOOT_INLINE_STYLE_SHA256 = "sha256-sIR4dCZFn3Uc0Xk0i4N73H1XXrjByqtiWZmZywW0T4k=";

export function buildSpaContentSecurityPolicyProduction(): string {
  const directives: string[] = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    `style-src 'self' '${SPA_INDEX_BOOT_INLINE_STYLE_SHA256}' https://fonts.googleapis.com`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "form-action 'self'",
  ];
  return directives.join("; ");
}
