import {
  PHASE_QUEUE_LIST_SECTION_BODY_CLASSNAME,
  PHASE_QUEUE_ROW_INNER_CLASSNAME,
  PHASE_QUEUE_ROW_META_MUTED_CLASSNAME,
  PHASE_QUEUE_ROW_TITLE_CLASSNAME,
  PHASE_QUEUE_ROW_VIRTUAL_OUTER_CLASSNAME,
  phaseQueueRowPrimaryButtonClassName,
  phaseQueueRowSurfaceClassName,
} from "./phaseQueueListView";

describe("phaseQueueListView", () => {
  it("composes section list body with list-none and divide-y", () => {
    expect(PHASE_QUEUE_LIST_SECTION_BODY_CLASSNAME).toContain("list-none");
    expect(PHASE_QUEUE_LIST_SECTION_BODY_CLASSNAME).toContain("divide-y");
  });

  it("row surface uses distinct selected styling vs unselected hover", () => {
    const unselected = phaseQueueRowSurfaceClassName(false);
    const selected = phaseQueueRowSurfaceClassName(true);
    expect(unselected).toContain("hover:bg-theme-surface-muted");
    expect(selected).toContain("bg-theme-info-bg");
    expect(selected).not.toContain("hover:bg-theme-info-bg/");
    expect(selected).not.toContain("ring-inset");
  });

  it("primary button remains layout-only (hover handled by row surface)", () => {
    const unselected = phaseQueueRowPrimaryButtonClassName(false);
    const selected = phaseQueueRowPrimaryButtonClassName(true);
    expect(unselected).toContain("text-left");
    expect(selected).toContain("text-left");
    expect(unselected).toContain("focus:outline-none");
    expect(selected).toContain("focus-visible:outline-none");
    expect(unselected).not.toContain("hover:bg-theme-surface-muted");
    expect(selected).not.toContain("bg-theme-info-bg/");
  });

  it("exports stable row chrome fragments", () => {
    expect(PHASE_QUEUE_ROW_INNER_CLASSNAME).toContain("py-2.5");
    expect(PHASE_QUEUE_ROW_TITLE_CLASSNAME).toContain("truncate");
    expect(PHASE_QUEUE_ROW_META_MUTED_CLASSNAME).toContain("text-theme-muted");
    expect(PHASE_QUEUE_ROW_VIRTUAL_OUTER_CLASSNAME).toContain("min-h-[52px]");
  });
});
