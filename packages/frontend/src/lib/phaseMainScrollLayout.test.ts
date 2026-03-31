import {
  EXECUTE_MAIN_SCROLL_CLASSNAME,
  PHASE_MAIN_SCROLL_CLASSNAME,
} from "./phaseMainScrollLayout";

describe("phaseMainScrollLayout", () => {
  it("matches Plan phase main scroll inset tokens", () => {
    expect(PHASE_MAIN_SCROLL_CLASSNAME).toBe(
      "flex-1 min-h-0 overflow-auto pt-2 sm:pt-3 px-4 md:px-6 pb-4 sm:pb-6"
    );
  });

  it("extends Plan scroll tokens for Execute (min-width, isolate only — no extra surface bg)", () => {
    expect(EXECUTE_MAIN_SCROLL_CLASSNAME).toBe(
      "flex-1 min-h-0 overflow-auto pt-2 sm:pt-3 px-4 md:px-6 pb-4 sm:pb-6 min-w-0 isolate"
    );
  });
});
