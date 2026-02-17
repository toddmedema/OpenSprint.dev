import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatSectionKey } from "../../lib/formatting";
import { getOrderedSections } from "../../lib/prdUtils";

export interface PrdViewerProps {
  prdContent: Record<string, string>;
  editingSection: string | null;
  editDraft: string;
  savingSection: string | null;
  onStartEdit: (section: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditDraftChange: (value: string) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export function PrdViewer({
  prdContent,
  editingSection,
  editDraft,
  savingSection,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditDraftChange,
  containerRef,
}: PrdViewerProps) {
  return (
    <div ref={containerRef}>
      {/* PRD Sections */}
      <div className="space-y-8">
        {getOrderedSections(prdContent).map((sectionKey) => (
          <div
            key={sectionKey}
            data-prd-section={sectionKey}
            className="group relative"
          >
            {/* Section header */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-800">
                {formatSectionKey(sectionKey)}
              </h2>
              {editingSection !== sectionKey && (
                <button
                  type="button"
                  onClick={() => onStartEdit(sectionKey)}
                  className="opacity-0 group-hover:opacity-100 text-xs text-brand-600 hover:text-brand-700 font-medium transition-opacity"
                >
                  Edit
                </button>
              )}
            </div>

            {/* Section content */}
            {editingSection === sectionKey ? (
              <div className="space-y-3">
                <textarea
                  value={editDraft}
                  onChange={(e) => onEditDraftChange(e.target.value)}
                  className="w-full min-h-[160px] p-4 text-sm border border-gray-300 rounded-lg font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="Markdown content..."
                  disabled={!!savingSection}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onSaveEdit}
                    disabled={
                      savingSection === sectionKey ||
                      editDraft === (prdContent[sectionKey] ?? "")
                    }
                    className="btn-primary text-sm py-1.5 px-3 disabled:opacity-50"
                  >
                    {savingSection === sectionKey ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelEdit}
                    disabled={!!savingSection}
                    className="btn-secondary text-sm py-1.5 px-3"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="prose prose-gray max-w-none prose-headings:text-gray-800 prose-p:text-gray-700 prose-li:text-gray-700 prose-td:text-gray-700 prose-th:text-gray-700 prose-a:text-brand-600 selection:bg-brand-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {prdContent[sectionKey] || "_No content yet_"}
                </ReactMarkdown>
              </div>
            )}

            {/* Divider */}
            <div className="mt-8 border-b border-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
