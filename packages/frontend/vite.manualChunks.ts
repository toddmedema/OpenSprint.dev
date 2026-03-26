/**
 * Rollup `manualChunks` split logic (shared with Vite config and unit tests).
 */
function isNodeModule(id: string, packageName: string): boolean {
  return id.includes(`/node_modules/${packageName}/`);
}

/** Resolve manual chunk name for a Rollup module id, or undefined for default placement. */
export function getManualChunkForModuleId(id: string): string | undefined {
  const normalizedId = id.replaceAll("\\", "/");

  if (!normalizedId.includes("/node_modules/")) {
    return;
  }

  if (
    isNodeModule(normalizedId, "react") ||
    isNodeModule(normalizedId, "react-dom") ||
    isNodeModule(normalizedId, "scheduler")
  ) {
    return "vendor-react";
  }

  if (
    isNodeModule(normalizedId, "react-router") ||
    isNodeModule(normalizedId, "react-router-dom")
  ) {
    return "vendor-router";
  }

  if (
    isNodeModule(normalizedId, "@reduxjs/toolkit") ||
    isNodeModule(normalizedId, "react-redux") ||
    isNodeModule(normalizedId, "redux") ||
    isNodeModule(normalizedId, "reselect") ||
    isNodeModule(normalizedId, "immer")
  ) {
    return "vendor-state";
  }

  if (
    isNodeModule(normalizedId, "@tanstack/react-query") ||
    isNodeModule(normalizedId, "@tanstack/query-core") ||
    isNodeModule(normalizedId, "@tanstack/react-virtual") ||
    isNodeModule(normalizedId, "@tanstack/virtual-core")
  ) {
    return "vendor-tanstack";
  }

  if (
    isNodeModule(normalizedId, "react-markdown") ||
    isNodeModule(normalizedId, "remark-gfm") ||
    isNodeModule(normalizedId, "remark-parse") ||
    isNodeModule(normalizedId, "remark-rehype") ||
    isNodeModule(normalizedId, "unified") ||
    isNodeModule(normalizedId, "marked") ||
    isNodeModule(normalizedId, "turndown") ||
    normalizedId.includes("/node_modules/remark-") ||
    normalizedId.includes("/node_modules/rehype-") ||
    normalizedId.includes("/node_modules/micromark") ||
    normalizedId.includes("/node_modules/mdast-") ||
    normalizedId.includes("/node_modules/hast-") ||
    normalizedId.includes("/node_modules/unist-") ||
    normalizedId.includes("/node_modules/vfile") ||
    normalizedId.includes("/node_modules/property-information/") ||
    normalizedId.includes("/node_modules/space-separated-tokens/") ||
    normalizedId.includes("/node_modules/comma-separated-tokens/") ||
    normalizedId.includes("/node_modules/decode-named-character-reference/") ||
    normalizedId.includes("/node_modules/character-entities") ||
    normalizedId.includes("/node_modules/markdown-table/") ||
    normalizedId.includes("/node_modules/trim-lines/") ||
    normalizedId.includes("/node_modules/ccount/") ||
    normalizedId.includes("/node_modules/devlop/")
  ) {
    return "vendor-markdown";
  }

  // Lazy-loaded Mermaid stack (dynamic `import("mermaid")` + heavy diagram deps)
  if (
    isNodeModule(normalizedId, "mermaid") ||
    isNodeModule(normalizedId, "@mermaid-js/parser") ||
    isNodeModule(normalizedId, "cytoscape") ||
    isNodeModule(normalizedId, "cytoscape-cose-bilkent") ||
    isNodeModule(normalizedId, "cytoscape-fcose") ||
    isNodeModule(normalizedId, "dagre-d3-es") ||
    isNodeModule(normalizedId, "d3-sankey") ||
    isNodeModule(normalizedId, "katex") ||
    isNodeModule(normalizedId, "@braintree/sanitize-url") ||
    isNodeModule(normalizedId, "@iconify/utils") ||
    isNodeModule(normalizedId, "@upsetjs/venn.js") ||
    isNodeModule(normalizedId, "khroma") ||
    isNodeModule(normalizedId, "roughjs") ||
    isNodeModule(normalizedId, "stylis") ||
    isNodeModule(normalizedId, "ts-dedent") ||
    isNodeModule(normalizedId, "dayjs") ||
    isNodeModule(normalizedId, "dompurify") ||
    isNodeModule(normalizedId, "lodash-es") ||
    isNodeModule(normalizedId, "uuid")
  ) {
    return "vendor-mermaid";
  }

  // Lazy-loaded D3 (dynamic `import("d3")` in graph components; shared hoisted dep for Mermaid)
  if (isNodeModule(normalizedId, "d3")) {
    return "vendor-d3";
  }
}
