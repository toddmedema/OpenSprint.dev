import ReactMarkdown from "react-markdown";
import { SAFE_REMARK_PLUGINS, SAFE_REHYPE_PLUGINS } from "../lib/markdownSanitize";

export interface MarkdownChatBubbleProps {
  content: string;
}

/**
 * Renders markdown content inside agent chat reply bubbles with GFM support
 * and XSS sanitization. Wraps ReactMarkdown so all chat panels share one
 * config for rendering + sanitization.
 */
export function MarkdownChatBubble({ content }: MarkdownChatBubbleProps) {
  return (
    <div className="prose-chat-bubble">
      <ReactMarkdown remarkPlugins={SAFE_REMARK_PLUGINS} rehypePlugins={SAFE_REHYPE_PLUGINS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
