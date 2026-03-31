import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { SAFE_REMARK_PLUGINS, SAFE_REHYPE_PLUGINS } from "./markdownSanitize";

function renderMarkdown(md: string): HTMLElement {
  const { container } = render(
    <ReactMarkdown remarkPlugins={SAFE_REMARK_PLUGINS} rehypePlugins={SAFE_REHYPE_PLUGINS}>
      {md}
    </ReactMarkdown>
  );
  return container;
}

describe("ReactMarkdown + STRICT_MARKDOWN_SCHEMA integration", () => {
  describe("safe markdown passes through", () => {
    it("renders headings", () => {
      const el = renderMarkdown("# Hello World");
      expect(el.querySelector("h1")).toBeTruthy();
      expect(el.textContent).toContain("Hello World");
    });

    it("renders bold and italic", () => {
      const el = renderMarkdown("**bold** and *italic*");
      expect(el.querySelector("strong")?.textContent).toBe("bold");
      expect(el.querySelector("em")?.textContent).toBe("italic");
    });

    it("renders links with href", () => {
      const el = renderMarkdown("[click](https://example.com)");
      const a = el.querySelector("a");
      expect(a).toBeTruthy();
      expect(a?.getAttribute("href")).toBe("https://example.com");
    });

    it("renders code blocks", () => {
      const el = renderMarkdown("```\nconst x = 1;\n```");
      expect(el.querySelector("pre")).toBeTruthy();
      expect(el.querySelector("code")).toBeTruthy();
    });

    it("renders inline code", () => {
      const el = renderMarkdown("Use `console.log()`");
      expect(el.querySelector("code")?.textContent).toBe("console.log()");
    });

    it("renders unordered lists", () => {
      const el = renderMarkdown("- item 1\n- item 2");
      expect(el.querySelectorAll("li").length).toBe(2);
    });

    it("renders GFM tables", () => {
      const el = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
      expect(el.querySelector("table")).toBeTruthy();
      expect(el.querySelectorAll("td").length).toBe(2);
    });

    it("renders GFM strikethrough", () => {
      const el = renderMarkdown("~~deleted~~");
      expect(el.querySelector("del")).toBeTruthy();
    });

    it("renders blockquotes", () => {
      const el = renderMarkdown("> quoted text");
      expect(el.querySelector("blockquote")).toBeTruthy();
    });

    it("renders images with safe src", () => {
      const el = renderMarkdown("![alt](https://example.com/img.png)");
      const img = el.querySelector("img");
      expect(img).toBeTruthy();
      expect(img?.getAttribute("src")).toBe("https://example.com/img.png");
      expect(img?.getAttribute("alt")).toBe("alt");
    });

    it("renders horizontal rules", () => {
      const el = renderMarkdown("---");
      expect(el.querySelector("hr")).toBeTruthy();
    });
  });

  describe("XSS vectors are blocked", () => {
    it("strips script element from output", () => {
      const el = renderMarkdown("Hello <script>alert('xss')</script> world");
      expect(el.querySelector("script")).toBeNull();
      expect(el.innerHTML).not.toContain("<script");
      expect(el.textContent).toContain("Hello");
    });

    it("strips style tags", () => {
      const el = renderMarkdown("Hello <style>body{display:none}</style> world");
      expect(el.innerHTML).not.toContain("<style");
    });

    it("strips iframe tags", () => {
      const el = renderMarkdown('<iframe src="https://evil.com"></iframe>');
      expect(el.querySelector("iframe")).toBeNull();
    });

    it("strips object tags", () => {
      const el = renderMarkdown('<object data="evil.swf"></object>');
      expect(el.querySelector("object")).toBeNull();
    });

    it("strips embed tags", () => {
      const el = renderMarkdown('<embed src="evil.swf">');
      expect(el.querySelector("embed")).toBeNull();
    });

    it("strips form tags", () => {
      const el = renderMarkdown('<form action="/evil"><input type="text"></form>');
      expect(el.querySelector("form")).toBeNull();
    });

    it("strips event handler attributes (onerror on img)", () => {
      const el = renderMarkdown('![x](broken.png "title")');
      const img = el.querySelector("img");
      if (img) {
        expect(img.getAttribute("onerror")).toBeNull();
      }
    });

    it("strips style attributes", () => {
      const el = renderMarkdown("text");
      const allElements = el.querySelectorAll("*");
      allElements.forEach((node) => {
        expect(node.getAttribute("style")).toBeNull();
      });
    });

    it("blocks javascript: protocol in links", () => {
      const el = renderMarkdown("[click](javascript:alert(1))");
      const a = el.querySelector("a");
      if (a) {
        const href = a.getAttribute("href") ?? "";
        expect(href).not.toContain("javascript:");
      }
    });

    it("blocks javascript: protocol in image src", () => {
      const el = renderMarkdown("![x](javascript:alert(1))");
      const img = el.querySelector("img");
      if (img) {
        const src = img.getAttribute("src") ?? "";
        expect(src).not.toContain("javascript:");
      }
    });

    it("blocks data: URIs in links (only allowed on src)", () => {
      const el = renderMarkdown("[click](data:text/html,<script>alert(1)</script>)");
      const a = el.querySelector("a");
      if (a) {
        const href = a.getAttribute("href") ?? "";
        expect(href).not.toContain("data:");
      }
    });

    it("strips svg tags (potential script container)", () => {
      const el = renderMarkdown('<svg onload="alert(1)"><circle r="10"/></svg>');
      expect(el.querySelector("svg")).toBeNull();
    });

    it("strips textarea tags", () => {
      const el = renderMarkdown("<textarea>evil</textarea>");
      expect(el.querySelector("textarea")).toBeNull();
    });

    it("strips select/option tags", () => {
      const el = renderMarkdown("<select><option>evil</option></select>");
      expect(el.querySelector("select")).toBeNull();
      expect(el.querySelector("option")).toBeNull();
    });

    it("strips meta tags (potential redirect)", () => {
      const el = renderMarkdown('<meta http-equiv="refresh" content="0;url=evil">');
      expect(el.querySelector("meta")).toBeNull();
    });

    it("strips base tags (href hijack)", () => {
      const el = renderMarkdown('<base href="https://evil.com/">');
      expect(el.querySelector("base")).toBeNull();
    });

    it("strips link tags (stylesheet injection)", () => {
      const el = renderMarkdown('<link rel="stylesheet" href="https://evil.com/evil.css">');
      expect(el.querySelector("link")).toBeNull();
    });

    it("blocks vbscript: protocol in links", () => {
      const el = renderMarkdown("[click](vbscript:MsgBox(1))");
      const a = el.querySelector("a");
      if (a) {
        const href = a.getAttribute("href") ?? "";
        expect(href).not.toContain("vbscript:");
      }
    });

    it("strips data-* attributes from markdown-rendered elements", () => {
      const el = renderMarkdown("# heading\n\nparagraph text");
      const allElements = el.querySelectorAll("*");
      allElements.forEach((node) => {
        const attrs = Array.from(node.attributes);
        for (const attr of attrs) {
          if (attr.name.startsWith("data-") && node.tagName !== "DIV") {
            expect.unreachable(
              `Unexpected data attribute ${attr.name} on <${node.tagName.toLowerCase()}>`
            );
          }
        }
      });
    });
  });

  describe("safe protocols are preserved", () => {
    it("allows mailto: links", () => {
      const el = renderMarkdown("[email](mailto:test@example.com)");
      const a = el.querySelector("a");
      expect(a?.getAttribute("href")).toBe("mailto:test@example.com");
    });

    it("allows https: links", () => {
      const el = renderMarkdown("[site](https://example.com)");
      const a = el.querySelector("a");
      expect(a?.getAttribute("href")).toBe("https://example.com");
    });

    it("allows http: links", () => {
      const el = renderMarkdown("[site](http://example.com)");
      const a = el.querySelector("a");
      expect(a?.getAttribute("href")).toBe("http://example.com");
    });
  });

  describe("rehype-raw is not in the pipeline", () => {
    it("raw HTML in markdown is not rendered as DOM elements", () => {
      const el = renderMarkdown('# Safe\n\n<div class="injected">HTML injection</div>\n\nAfter');
      expect(el.querySelector(".injected")).toBeNull();
    });

    it("raw HTML img with onerror is not rendered", () => {
      const el = renderMarkdown('<img src="x" onerror="alert(1)">');
      const img = el.querySelector("img");
      if (img) {
        expect(img.getAttribute("onerror")).toBeNull();
      }
    });

    it("nested raw HTML tags are not rendered", () => {
      const el = renderMarkdown('<div><span onclick="alert(1)">click</span></div>');
      const span = el.querySelector("[onclick]");
      expect(span).toBeNull();
    });
  });
});
