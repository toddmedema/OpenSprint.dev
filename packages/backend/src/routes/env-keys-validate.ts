/**
 * Indirection for POST /env/keys/validate → models.validateApiKey.
 * Env route imports from this module only; tests mock it so `models.ts` (SDK init / network)
 * is never evaluated in the env-route suite.
 */
export { validateApiKey } from "./models.js";
