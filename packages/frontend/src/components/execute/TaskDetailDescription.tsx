import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CollapsibleSection } from "./CollapsibleSection";

/** Execute sidebar: no horizontal rules (task feedback x5cqqc) */
const MARKDOWN_NO_HR = { hr: () => null };

const DescriptionMarkdown = React.memo(({ content }: { content: string }) => (
  <div
    className="prose-task-description prose-execute-task"
    data-testid="task-description-markdown"
  >
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_NO_HR}>
      {content}
    </ReactMarkdown>
  </div>
));
DescriptionMarkdown.displayName = "DescriptionMarkdown";

export interface TaskDetailDescriptionProps {
  content: string;
  expanded: boolean;
  onToggle: () => void;
}

export function TaskDetailDescription({
  content,
  expanded,
  onToggle,
}: TaskDetailDescriptionProps) {
  return (
    <div className="-mb-2">
      <CollapsibleSection
        title="Description"
        expanded={expanded}
        onToggle={onToggle}
        expandAriaLabel="Expand Description"
        collapseAriaLabel="Collapse Description"
        contentId="description-content"
        headerId="description-header"
        contentClassName="px-4 pt-0 pb-0"
      >
        <DescriptionMarkdown content={content} />
      </CollapsibleSection>
    </div>
  );
}
