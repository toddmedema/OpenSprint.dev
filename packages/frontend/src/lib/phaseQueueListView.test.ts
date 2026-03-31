import {
  PHASE_QUEUE_LIST_SECTION_BODY_CLASSNAME,
  PHASE_QUEUE_ROW_INNER_CLASSNAME,
  PHASE_QUEUE_ROW_META_MUTED_CLASSNAME,
  PHASE_QUEUE_ROW_TITLE_CLASSNAME,
  PHASE_QUEUE_ROW_VIRTUAL_OUTER_CLASSNAME,
  phaseQueueRowPrimaryButtonClassName,
} from "./phaseQueueListView";

describe("phaseQueueListView", () => {
  it("composes section list body with list-none and divide-y", () => {
    expect(PHASE_QUEUE_LIST_SECTION_BODY_CLASSNAME).toContain("list-none");
    expect(PHASE_QUEUE_LIST_SECTION_BODY_CLASSNAME).toContain("divide-y");
  });

  it("primary button adds selection background when selected", () => {
    const unselected = phaseQueueRowPrimaryButtonClassName(false);
    const selected = phaseQueueRowPrimaryButtonClassName(true);
    expect(selected).toBe(`${unselected} bg-theme-info-bg/50`);
  });

  it("exports stable row chrome fragments", () => {
    expect(PHASE_QUEUE_ROW_INNER_CLASSNAME).toContain("py-2.5");
    expect(PHASE_QUEUE_ROW_TITLE_CLASSNAME).toContain("truncate");
    expect(PHASE_QUEUE_ROW_META_MUTED_CLASSNAME).toContain("text-theme-muted");
    expect(PHASE_QUEUE_ROW_VIRTUAL_OUTER_CLASSNAME).toContain("min-h-[52px]");
  });
});
