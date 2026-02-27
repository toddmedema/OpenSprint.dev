import { formatSectionKey } from "../../lib/formatting";
import { getOrderedSections } from "../../lib/prdUtils";
import { PrdSectionEditor } from "./PrdSectionEditor";

export interface PrdViewerProps {
  prdContent: Record<string, string>;
  savingSections: string[];
  onSectionChange: (section: string, markdown: string) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** Notification ID per section for scroll-to-question (e.g. { open_questions: "notif-xyz" }) */
  questionIdBySection?: Record<string, string>;
}

export function PrdViewer({
  prdContent,
  savingSections,
  onSectionChange,
  containerRef,
  questionIdBySection,
}: PrdViewerProps) {
  return (
    <div ref={containerRef}>
      {/* PRD Sections - always editable inline */}
      <div className="space-y-8">
        {getOrderedSections(prdContent).map((sectionKey, index, arr) => {
          const isLast = index === arr.length - 1;
          const questionId = questionIdBySection?.[sectionKey];
          return (
            <div
              key={sectionKey}
              data-prd-section={sectionKey}
              className="group relative"
              {...(questionId && { "data-question-id": questionId })}
            >
              {/* Section header */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-theme-text">
                  {formatSectionKey(sectionKey)}
                </h2>
                {savingSections.includes(sectionKey) && (
                  <span className="text-xs text-theme-muted">Saving...</span>
                )}
              </div>

              {/* Section content - inline WYSIWYG editor */}
              <PrdSectionEditor
                sectionKey={sectionKey}
                markdown={prdContent[sectionKey] ?? ""}
                onSave={onSectionChange}
                disabled={savingSections.includes(sectionKey)}
              />

              {/* Divider (omit after last section; PrdChangeLog provides the final separator) */}
              {!isLast && <div className="mt-8 border-b border-theme-border" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
