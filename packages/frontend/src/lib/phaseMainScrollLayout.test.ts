import { PHASE_MAIN_SCROLL_CLASSNAME } from "./phaseMainScrollLayout";

describe("phaseMainScrollLayout", () => {
  it("matches Execute phase main scroll inset tokens (shared with Plan)", () => {
    expect(PHASE_MAIN_SCROLL_CLASSNAME).toBe(
      "flex-1 min-h-0 overflow-auto pt-2 sm:pt-3 px-4 sm:px-6 pb-4 sm:pb-6"
    );
  });
});
