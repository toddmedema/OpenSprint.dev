/**
 * @deprecated Use specSlice — dream phase renamed to spec per SPEED phase names.
 * This file re-exports from specSlice for backward compatibility.
 */
export {
  fetchSpecChat as fetchDreamChat,
  fetchPrd,
  fetchPrdHistory,
  sendSpecMessage as sendDreamMessage,
  savePrdSection,
  uploadPrdFile,
  addUserMessage,
  setSpecError as setDreamError,
  setPrdContent,
  setPrdHistory,
  resetSpec as resetDream,
} from "./specSlice";
export type { SpecState as DreamState } from "./specSlice";
export { default } from "./specSlice";
