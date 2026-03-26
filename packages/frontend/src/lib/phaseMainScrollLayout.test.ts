import {
  EXECUTE_MAIN_CONTENT_INSET_CLASSNAME,
  EXECUTE_SCROLL_PORT_CLASSNAME,
  EXECUTE_SECTION_HEADER_STICKY_TOP,
  EXECUTE_STICKY_TOOLBAR_CLUSTER_CLASSNAME,
  PHASE_MAIN_SCROLL_CLASSNAME,
} from "./phaseMainScrollLayout";

describe("phaseMainScrollLayout", () => {
  it("matches Plan phase main scroll inset tokens", () => {
    expect(PHASE_MAIN_SCROLL_CLASSNAME).toBe(
      "flex-1 min-h-0 overflow-auto pt-2 sm:pt-3 px-4 md:px-6 pb-4 sm:pb-6"
    );
  });

  it("uses a single Execute scrollport, sticky toolbar cluster with bottom gutter, and content inset without top padding", () => {
    expect(EXECUTE_SCROLL_PORT_CLASSNAME).toBe(
      "flex-1 min-h-0 min-w-0 overflow-auto bg-theme-surface isolate"
    );
    expect(EXECUTE_STICKY_TOOLBAR_CLUSTER_CLASSNAME).toBe(
      "sticky top-0 z-30 shrink-0 bg-theme-surface pb-2 sm:pb-3 [background-clip:padding-box]"
    );
    expect(EXECUTE_MAIN_CONTENT_INSET_CLASSNAME).toBe("px-4 md:px-6 pb-4 sm:pb-6");
  });

  it("section header sticky top clears toolbar cluster height (48px toolbar + pb padding)", () => {
    expect(EXECUTE_SECTION_HEADER_STICKY_TOP).toBe("top-[56px] sm:top-[60px]");
  });
});
