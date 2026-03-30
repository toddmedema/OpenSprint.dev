import type { Options as RehypeSanitizeSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/**
 * Strict allowlist schema for rehype-sanitize.
 *
 * Defence-in-depth: react-markdown already ignores raw HTML by default
 * (no rehype-raw), so inline `<script>` and event handlers are stripped
 * at the parser level. This schema provides a second layer that:
 *   - Allowlists only elements produced by standard remark/GFM markdown
 *   - Strips `style` attributes and all event handlers
 *   - Restricts `href` and `src` to safe protocols (no javascript:, no
 *     data: on href; src allows data: for inline images only)
 *   - Blocks `script`, `style`, `iframe`, `object`, `embed`, `form`, etc.
 *   - Omits `data-*` wildcard — only remark-generated attributes are allowed
 *   - Omits non-standard elements (`section`, `nav`, etc.) that remark/GFM
 *     never produces
 */
export const STRICT_MARKDOWN_SCHEMA: RehypeSanitizeSchema = {
  strip: ["script", "style", "textarea", "select"],
  tagNames: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "blockquote",
    "ul", "ol", "li",
    "a",
    "img",
    "strong", "em", "b", "i", "u", "s", "del", "ins",
    "code", "pre",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "sup", "sub",
    "span", "div",
    "details", "summary",
    "input",
    "dl", "dt", "dd",
  ],
  attributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    input: [["type", "checkbox"], ["disabled", true], "checked"],
    th: ["align"],
    td: ["align"],
    code: ["className"],
    span: ["className"],
    div: ["className"],
    pre: ["className"],
    li: ["className"],
    ol: ["start"],
    "*": ["id"],
  },
  protocols: {
    href: ["http", "https", "mailto"],
    src: ["http", "https", "data"],
  },
  ancestors: {
    li: ["ol", "ul"],
    thead: ["table"],
    tbody: ["table"],
    tfoot: ["table"],
    tr: ["table", "thead", "tbody", "tfoot"],
    th: ["tr"],
    td: ["tr"],
    dt: ["dl"],
    dd: ["dl"],
    summary: ["details"],
  },
  clobber: [],
  clobberPrefix: "",
  required: {
    input: { type: "checkbox", disabled: true },
  },
};

/**
 * Standard remark plugin list for safe markdown rendering.
 * All ReactMarkdown instances should use this to stay in sync.
 */
export const SAFE_REMARK_PLUGINS: PluggableList = [remarkGfm];

/**
 * Standard rehype plugin list that applies the strict sanitize schema.
 * All ReactMarkdown instances should use this to stay in sync.
 */
export const SAFE_REHYPE_PLUGINS: PluggableList = [
  [rehypeSanitize, STRICT_MARKDOWN_SCHEMA],
];
