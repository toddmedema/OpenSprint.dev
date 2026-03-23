/**
 * Markdown ↔ HTML conversion for WYSIWYG PRD section editing.
 * Contenteditable uses HTML; API stores markdown.
 */

import { Marked } from "marked";
import TurndownService from "turndown";
import { encodeMermaidSourceForAttr, decodeMermaidSourceFromAttr } from "./mermaidDiagram";

export type DiagramsMode = "none" | "mermaid";

export const OS_MERMAID_CLASS = "os-mermaid";
export const OS_MERMAID_SVG_CLASS = "os-mermaid-svg";
export const OS_MERMAID_ATTR = "data-mermaid-source";

const markedPlain = new Marked();

const markedMermaid = new Marked();
markedMermaid.use({
  renderer: {
    code({ text, lang }) {
      const l = (lang ?? "").trim().toLowerCase();
      if (l === "mermaid") {
        const b64 = encodeMermaidSourceForAttr(text);
        return `<div class="${OS_MERMAID_CLASS} max-w-full overflow-x-auto my-2" contenteditable="false" ${OS_MERMAID_ATTR}="${b64}"><span class="os-mermaid-zw" aria-hidden="true">&#8203;</span><div class="${OS_MERMAID_SVG_CLASS} [&>svg]:max-w-full"></div></div>`;
      }
      return false;
    },
  },
});

const baseTurndownOpts = {
  headingStyle: "atx" as const,
  codeBlockStyle: "fenced" as const,
};

const turndownPlain = new TurndownService(baseTurndownOpts);

/** Default import typing omits addRule in some TS+bundler setups; it exists at runtime. */
type TurndownWithRules = InstanceType<typeof TurndownService> & {
  addRule(
    key: string,
    rule: {
      filter(node: HTMLElement): boolean;
      replacement(content: string, node: HTMLElement): string;
    }
  ): void;
};

const turndownMermaid = new TurndownService(baseTurndownOpts) as TurndownWithRules;
turndownMermaid.addRule("openSprintMermaid", {
  filter(node: HTMLElement) {
    return node.nodeName === "DIV" && node.classList.contains(OS_MERMAID_CLASS);
  },
  replacement(_content: string, node: HTMLElement) {
    const b64 = node.getAttribute(OS_MERMAID_ATTR);
    if (!b64) return "";
    try {
      const src = decodeMermaidSourceFromAttr(b64);
      return "\n\n```mermaid\n" + src + "\n```\n\n";
    } catch {
      return "";
    }
  },
});

export interface MarkdownConversionOptions {
  diagrams?: DiagramsMode;
}

/**
 * Converts markdown to HTML for display in contenteditable.
 * Marked v15+ returns Promise; we support both sync (legacy) and async.
 */
export async function markdownToHtml(
  md: string,
  options?: MarkdownConversionOptions
): Promise<string> {
  if (!md?.trim()) return "";
  const mode = options?.diagrams ?? "none";
  const parser = mode === "mermaid" ? markedMermaid : markedPlain;
  const result = await parser.parse(md.trim());
  const html = typeof result === "string" ? result : "";
  return html.trim();
}

/**
 * Converts HTML from contenteditable to markdown for API save.
 */
export function htmlToMarkdown(html: string, options?: MarkdownConversionOptions): string {
  if (!html?.trim()) return "";
  const mode = options?.diagrams ?? "none";
  const td = mode === "mermaid" ? turndownMermaid : turndownPlain;
  return td.turndown(html.trim());
}
