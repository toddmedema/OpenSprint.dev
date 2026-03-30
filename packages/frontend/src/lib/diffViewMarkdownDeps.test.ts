import * as Diff from "diff";
import { describe, expect, it } from "vitest";
import ReactMarkdown from "react-markdown";
import { remark } from "remark";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SAFE_REMARK_PLUGINS, SAFE_REHYPE_PLUGINS } from "./markdownSanitize";

describe("DiffView markdown and diff dependencies", () => {
  it("remark parses markdown to mdast", () => {
    const tree = remark().parse("# Title\n\nBody.");
    expect(tree.type).toBe("root");
    expect(tree.children.length).toBeGreaterThan(0);
  });

  it("unified + remark-parse produces a root mdast", () => {
    const tree = unified().use(remarkParse).parse("# x\n\ny");
    expect(tree.type).toBe("root");
  });

  it("diff supports word-level comparison", () => {
    const parts = Diff.diffWords("alpha beta", "alpha gamma");
    expect(parts.some((p) => p.added || p.removed)).toBe(true);
  });

  it("react-markdown default export is usable", () => {
    expect(typeof ReactMarkdown).toBe("function");
  });

  it("SAFE_REMARK_PLUGINS and SAFE_REHYPE_PLUGINS are exported arrays", () => {
    expect(Array.isArray(SAFE_REMARK_PLUGINS)).toBe(true);
    expect(Array.isArray(SAFE_REHYPE_PLUGINS)).toBe(true);
  });
});
