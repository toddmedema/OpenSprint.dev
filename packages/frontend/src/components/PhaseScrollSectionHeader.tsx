import type { ComponentPropsWithoutRef } from "react";
import {
  PLAN_SCROLL_SECTION_HEADER_CLASSNAME,
  EXECUTE_TIMELINE_SCROLL_SECTION_HEADER_CLASSNAME,
  EXECUTE_TIMELINE_VIRTUAL_SECTION_HEADER_CLASSNAME,
  PHASE_SCROLL_SECTION_HEADER_TITLE_CLASSNAME,
} from "../lib/phaseScrollSectionHeader";

const VARIANT_BAR_CLASS = {
  "plan-list": PLAN_SCROLL_SECTION_HEADER_CLASSNAME,
  "execute-timeline-sticky": EXECUTE_TIMELINE_SCROLL_SECTION_HEADER_CLASSNAME,
  "execute-timeline-virtual": EXECUTE_TIMELINE_VIRTUAL_SECTION_HEADER_CLASSNAME,
} as const;

export type PhaseScrollSectionHeaderVariant = keyof typeof VARIANT_BAR_CLASS;

export type PhaseScrollSectionHeaderProps = ComponentPropsWithoutRef<"div"> & {
  variant: PhaseScrollSectionHeaderVariant;
  title: string;
};

/**
 * Sticky (or static virtual) section title bar shared by Plan list view and Execute timeline.
 */
export function PhaseScrollSectionHeader({
  variant,
  title,
  className,
  ...props
}: PhaseScrollSectionHeaderProps) {
  const bar = VARIANT_BAR_CLASS[variant];
  return (
    <div className={className ? `${bar} ${className}` : bar} {...props}>
      <h3 className={PHASE_SCROLL_SECTION_HEADER_TITLE_CLASSNAME}>{title}</h3>
    </div>
  );
}
