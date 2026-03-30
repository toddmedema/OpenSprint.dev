import ReactMarkdown from "react-markdown";
import { SAFE_REMARK_PLUGINS, SAFE_REHYPE_PLUGINS } from "../lib/markdownSanitize";

interface AgentsMdPreviewProps {
  content: string;
}

export function AgentsMdPreview({ content }: AgentsMdPreviewProps) {
  return (
    <ReactMarkdown
      remarkPlugins={SAFE_REMARK_PLUGINS}
      rehypePlugins={SAFE_REHYPE_PLUGINS}
    >
      {content}
    </ReactMarkdown>
  );
}
