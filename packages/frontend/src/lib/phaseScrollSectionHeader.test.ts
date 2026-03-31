import {
  EXECUTE_TIMELINE_SCROLL_SECTION_HEADER_CLASSNAME,
  EXECUTE_TIMELINE_VIRTUAL_SECTION_HEADER_CLASSNAME,
  PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME,
  PLAN_SCROLL_SECTION_HEADER_CLASSNAME,
} from "./phaseScrollSectionHeader";

describe("phaseScrollSectionHeader", () => {
  it("uses glass background tokens on Plan and Execute composed classes", () => {
    expect(PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME).toContain("bg-theme-bg/95");
    expect(PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME).toContain("backdrop-blur-sm");
    expect(PLAN_SCROLL_SECTION_HEADER_CLASSNAME).toContain(
      PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME
    );
    expect(EXECUTE_TIMELINE_SCROLL_SECTION_HEADER_CLASSNAME).toContain(
      PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME
    );
    expect(EXECUTE_TIMELINE_VIRTUAL_SECTION_HEADER_CLASSNAME).toContain(
      PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME
    );
  });

  it("keeps Plan sticky offset and Execute timeline stick-to-top", () => {
    expect(PLAN_SCROLL_SECTION_HEADER_CLASSNAME).toContain("top-[-0.5rem]");
    expect(EXECUTE_TIMELINE_SCROLL_SECTION_HEADER_CLASSNAME).toContain("sticky");
    expect(EXECUTE_TIMELINE_SCROLL_SECTION_HEADER_CLASSNAME).toContain("top-0");
    expect(EXECUTE_TIMELINE_SCROLL_SECTION_HEADER_CLASSNAME).toContain("z-[12]");
    expect(EXECUTE_TIMELINE_VIRTUAL_SECTION_HEADER_CLASSNAME).not.toContain("sticky");
  });
});
