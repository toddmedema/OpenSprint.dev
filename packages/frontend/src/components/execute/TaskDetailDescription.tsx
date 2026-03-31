import React from "react";
import ReactMarkdown from "react-markdown";
import { SAFE_REMARK_PLUGINS, SAFE_REHYPE_PLUGINS } from "../../lib/markdownSanitize";
import { CollapsibleSection } from "./CollapsibleSection";

/** Execute sidebar: no horizontal rules (task feedback x5cqqc) */
const MARKDOWN_NO_HR = { hr: () => null };

const DescriptionMarkdown = React.memo(({ content }: { content: string }) => (
  <div
    className="prose-task-description prose-execute-task"
    data-testid="task-description-markdown"
  >
    <ReactMarkdown
      remarkPlugins={SAFE_REMARK_PLUGINS}
      rehypePlugins={SAFE_REHYPE_PLUGINS}
      components={MARKDOWN_NO_HR}
    >
      {content}
    </ReactMarkdown>
  </div>
));
DescriptionMarkdown.displayName = "DescriptionMarkdown";

export interface TaskDetailDescriptionProps {
  content: string;
  expanded: boolean;
  onToggle: () => void;
  sectionNavId?: string;
  sectionNavTitle?: string;
}

export function TaskDetailDescription({
  content,
  expanded,
  onToggle,
  sectionNavId,
  sectionNavTitle,
}: TaskDetailDescriptionProps) {
  return (
    <CollapsibleSection
      title="Description"
      expanded={expanded}
      onToggle={onToggle}
      expandAriaLabel="Expand Description"
      collapseAriaLabel="Collapse Description"
      contentId="description-content"
      headerId="description-header"
      contentClassName="px-4 pt-0 pb-0"
      sectionNavId={sectionNavId}
      sectionNavTitle={sectionNavTitle}
    >
      <DescriptionMarkdown content={content} />
    </CollapsibleSection>
  );
}
