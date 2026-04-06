import { DESKTOP_TOP_BAR_HEIGHT } from "./window-options";

/** Height of the draggable top region on the loading page (matches main app top bar). */
export const BOOT_DRAG_TOP_HEIGHT_PX = DESKTOP_TOP_BAR_HEIGHT;

/** Inline SVG for the Open Sprint mark — same geometry/fills as `PhaseEmptyStateLogo` in the web app. */
const BOOT_LOGO_SVG = `<svg class="boot-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" aria-hidden="true">
      <polygon points="4,10 36,40 4,70" fill="#c7d2fe" />
      <polygon points="22,10 54,40 22,70" fill="#818cf8" />
      <polygon points="40,10 72,40 40,70" fill="#4f46e5" />
    </svg>`;

/**
 * Renders the boot/loading page HTML. On macOS (darwin), includes a top area
 * with -webkit-app-region: drag so the window can be moved while loading.
 */
export function renderBootHtml(
  statusText: string,
  appName: string,
  platform: NodeJS.Platform
): string {
  const escaped = statusText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const isMac = platform === "darwin";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${appName}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        min-height: 100vh;
        overflow: hidden;
        box-sizing: border-box;
        background: #020617;
        color: #e2e8f0;
      }
      body {
        display: flex;
        flex-direction: column;
        position: relative;
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        background:
          radial-gradient(ellipse 80% 60% at 50% 40%, rgba(79,70,229,0.12) 0%, transparent 70%),
          radial-gradient(ellipse 60% 50% at 50% 45%, rgba(129,140,248,0.06) 0%, transparent 60%),
          radial-gradient(circle at 50% 0%, #1e293b 0%, #020617 70%);
        pointer-events: none;
        z-index: 0;
      }
      *, *::before, *::after { box-sizing: inherit; }
      .boot-drag-top {
        width: 100%;
        height: ${BOOT_DRAG_TOP_HEIGHT_PX}px;
        min-height: ${BOOT_DRAG_TOP_HEIGHT_PX}px;
        flex-shrink: 0;
        -webkit-app-region: drag;
        app-region: drag;
        position: relative;
        z-index: 1;
      }
      .boot {
        flex: 1;
        min-height: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        overflow: hidden;
        position: relative;
        z-index: 1;
      }
      .boot-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        width: min(420px, 100%);
        animation: boot-fade-in 0.8s ease-out both;
      }
      @keyframes boot-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .boot-logo-wrap {
        position: relative;
        margin-bottom: 24px;
      }
      .boot-logo-glow {
        position: absolute;
        inset: -20px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%);
        filter: blur(16px);
        animation: glow-pulse 4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes glow-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.1); }
      }
      .boot-logo {
        width: 64px;
        height: 64px;
        flex-shrink: 0;
        position: relative;
        filter: drop-shadow(0 0 12px rgba(99,102,241,0.3));
        animation: logo-pulse-slow 3.6s ease-in-out infinite;
      }
      @keyframes logo-pulse-slow {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      .title {
        margin: 0 0 8px;
        font-size: 26px;
        font-weight: 700;
        letter-spacing: -0.02em;
        background: linear-gradient(180deg, #f1f5f9 0%, #94a3b8 100%);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        text-align: center;
      }
      .boot-tagline {
        margin: 0 0 32px;
        font-size: 13px;
        font-weight: 400;
        color: #64748b;
        letter-spacing: 0.04em;
      }
      .boot-status-row {
        margin-top: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        text-align: center;
        padding: 8px 20px;
        border-radius: 9999px;
        background: rgba(30,41,59,0.5);
        border: 1px solid rgba(71,85,105,0.25);
      }
      .boot-status-row .spinner {
        flex-shrink: 0;
      }
      .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(100,116,139,0.3);
        border-top-color: #818cf8;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .status {
        margin: 0;
        color: #94a3b8;
        font-size: 13px;
        line-height: 1.4;
        text-align: center;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    ${isMac ? '<div class="boot-drag-top" aria-hidden="true"></div>' : ""}
    <main class="boot">
      <div class="boot-inner">
        <div class="boot-logo-wrap">
          <div class="boot-logo-glow" aria-hidden="true"></div>
          ${BOOT_LOGO_SVG}
        </div>
        <h1 class="title">${appName}</h1>
        <p class="boot-tagline">Ship at the speed of thought</p>
        <div class="boot-status-row" role="status" aria-live="polite">
          <div class="spinner" aria-hidden="true"></div>
          <p class="status">${escaped}</p>
        </div>
      </div>
    </main>
  </body>
</html>`;
}
