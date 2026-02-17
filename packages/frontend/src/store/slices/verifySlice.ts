/**
 * @deprecated Use ensureSlice. Re-exported for backward compatibility.
 */
export {
  type EnsureState as VerifyState,
  fetchFeedback,
  submitFeedback,
  recategorizeFeedback,
  setFeedback,
  setEnsureError as setVerifyError,
  resetEnsure as resetVerify,
} from "./ensureSlice";
export { default } from "./ensureSlice";
