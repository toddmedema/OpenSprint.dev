import type { Request } from "express";

/**
 * Gate for `GET /__opensprint_local_session.js` (desktop bootstrap fallback).
 *
 * Browsers send `Sec-Fetch-Site` on cross-origin fetches. We reject `cross-site`
 * and `same-site` so another HTTP origin on the machine (e.g. a dev server on a
 * different port) cannot trivially read the token. Non-browser clients (Electron
 * main, Node scripts, tests) omit the header and are allowed.
 *
 * This does not protect against same-machine processes using curl or custom HTTP;
 * desktop mode assumes localhost mutual trust with OS-level access controls.
 */
export function allowDesktopLocalSessionScriptRequest(req: Request): boolean {
  const raw = req.headers["sec-fetch-site"];
  if (raw === undefined || raw === "") return true;
  const v = Array.isArray(raw) ? raw[0] : raw;
  const site = String(v).toLowerCase();
  if (site === "cross-site" || site === "same-site") return false;
  return true;
}
