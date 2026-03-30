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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        min-height: 100vh;
        overflow: hidden;
        box-sizing: border-box;
        background: radial-gradient(circle at top, #1e293b 0%, #020617 60%);
        color: #e2e8f0;
      }
      body {
        display: flex;
        flex-direction: column;
      }
      *, *::before, *::after { box-sizing: inherit; }
      .boot-drag-top {
        width: 100%;
        height: ${BOOT_DRAG_TOP_HEIGHT_PX}px;
        min-height: ${BOOT_DRAG_TOP_HEIGHT_PX}px;
        flex-shrink: 0;
        -webkit-app-region: drag;
        app-region: drag;
      }
      .boot {
        flex: 1;
        min-height: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        overflow: hidden;
      }
      .boot-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        width: min(420px, 100%);
      }
      .boot-logo {
        width: 40px;
        height: 40px;
        margin-bottom: 16px;
        flex-shrink: 0;
        animation: logo-pulse-slow 3.6s ease-in-out infinite;
      }
      @keyframes logo-pulse-slow {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
      .title {
        margin: 0 0 16px;
        font-size: 20px;
        font-weight: 600;
        text-align: center;
      }
      .status {
        margin: 0;
        color: #cbd5e1;
        font-size: 14px;
        line-height: 1.4;
        text-align: center;
        word-break: break-word;
      }
      .boot-status-row {
        margin-top: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        text-align: center;
      }
      .boot-status-row .spinner {
        flex-shrink: 0;
      }
      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(148, 163, 184, 0.45);
        border-top-color: #38bdf8;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    ${isMac ? '<div class="boot-drag-top" aria-hidden="true"></div>' : ""}
    <main class="boot">
      <div class="boot-inner">
        ${BOOT_LOGO_SVG}
        <h1 class="title">${appName}</h1>
        <div class="boot-status-row" role="status" aria-live="polite">
          <div class="spinner" aria-hidden="true"></div>
          <p class="status">${escaped}</p>
        </div>
      </div>
    </main>
  </body>
</html>`;
}
