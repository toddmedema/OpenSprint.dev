import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentsMdPreviewProps {
  content: string;
}

export function AgentsMdPreview({ content }: AgentsMdPreviewProps) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
