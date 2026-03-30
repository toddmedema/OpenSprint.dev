import { describe, expect, it } from "vitest";
import {
  STRICT_MARKDOWN_SCHEMA,
  SAFE_REMARK_PLUGINS,
  SAFE_REHYPE_PLUGINS,
} from "./markdownSanitize";

describe("STRICT_MARKDOWN_SCHEMA", () => {
  it("exports a non-null schema object", () => {
    expect(STRICT_MARKDOWN_SCHEMA).toBeDefined();
    expect(typeof STRICT_MARKDOWN_SCHEMA).toBe("object");
  });

  describe("tagNames allowlist", () => {
    const tags = STRICT_MARKDOWN_SCHEMA.tagNames!;

    it("allows standard markdown block elements", () => {
      for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "pre", "hr", "br"]) {
        expect(tags).toContain(tag);
      }
    });

    it("allows inline formatting elements", () => {
      for (const tag of ["strong", "em", "code", "a", "img", "del", "ins", "s"]) {
        expect(tags).toContain(tag);
      }
    });

    it("allows list elements", () => {
      for (const tag of ["ul", "ol", "li"]) {
        expect(tags).toContain(tag);
      }
    });

    it("allows GFM table elements", () => {
      for (const tag of ["table", "thead", "tbody", "tfoot", "tr", "th", "td"]) {
        expect(tags).toContain(tag);
      }
    });

    it("allows task-list checkbox input", () => {
      expect(tags).toContain("input");
    });

    it("does not allow dangerous elements", () => {
      for (const tag of [
        "script", "style", "iframe", "object", "embed", "form",
        "textarea", "select", "button", "meta", "link", "base",
        "applet", "svg", "math", "video", "audio", "source",
        "canvas", "noscript",
      ]) {
        expect(tags).not.toContain(tag);
      }
    });

    it("does not allow non-remark elements (section, nav, article, aside, header, footer)", () => {
      for (const tag of ["section", "nav", "article", "aside", "header", "footer", "main"]) {
        expect(tags).not.toContain(tag);
      }
    });
  });

  describe("strip list", () => {
    it("strips script, style, textarea, and select tags", () => {
      expect(STRICT_MARKDOWN_SCHEMA.strip).toContain("script");
      expect(STRICT_MARKDOWN_SCHEMA.strip).toContain("style");
      expect(STRICT_MARKDOWN_SCHEMA.strip).toContain("textarea");
      expect(STRICT_MARKDOWN_SCHEMA.strip).toContain("select");
    });
  });

  describe("attributes allowlist", () => {
    const attrs = STRICT_MARKDOWN_SCHEMA.attributes!;

    it("allows href and title on anchors", () => {
      expect(attrs.a).toContain("href");
      expect(attrs.a).toContain("title");
    });

    it("does not allow target or rel on anchors (prevents tab-nabbing surface)", () => {
      expect(attrs.a).not.toContain("target");
      expect(attrs.a).not.toContain("rel");
    });

    it("allows src, alt, title on images", () => {
      expect(attrs.img).toContain("src");
      expect(attrs.img).toContain("alt");
      expect(attrs.img).toContain("title");
    });

    it("does not allow style attribute globally", () => {
      const globalAttrs = attrs["*"] as unknown[];
      expect(globalAttrs).not.toContain("style");
    });

    it("does not allow data-* wildcard globally", () => {
      const globalAttrs = attrs["*"] as unknown[];
      expect(globalAttrs).not.toContain("data-*");
    });

    it("does not allow event handler attributes (onclick, onerror)", () => {
      for (const key of Object.keys(attrs)) {
        const values = attrs[key] as unknown[];
        for (const v of values) {
          const attrName = typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
          expect(String(attrName).toLowerCase()).not.toMatch(/^on/);
        }
      }
    });

    it("allows className on code, span, div, pre for syntax highlighting", () => {
      expect(attrs.code).toContain("className");
      expect(attrs.span).toContain("className");
      expect(attrs.div).toContain("className");
      expect(attrs.pre).toContain("className");
    });

    it("allows align on th and td for GFM tables", () => {
      expect(attrs.th).toContain("align");
      expect(attrs.td).toContain("align");
    });
  });

  describe("protocols", () => {
    const protocols = STRICT_MARKDOWN_SCHEMA.protocols!;

    it("restricts href to http, https, mailto", () => {
      expect(protocols.href).toEqual(["http", "https", "mailto"]);
    });

    it("restricts src to http, https, data", () => {
      expect(protocols.src).toEqual(["http", "https", "data"]);
    });

    it("does not allow javascript protocol for href", () => {
      expect(protocols.href).not.toContain("javascript");
    });

    it("does not allow javascript protocol for src", () => {
      expect(protocols.src).not.toContain("javascript");
    });

    it("does not allow vbscript protocol for href", () => {
      expect(protocols.href).not.toContain("vbscript");
    });
  });

  describe("ancestors", () => {
    const ancestors = STRICT_MARKDOWN_SCHEMA.ancestors!;

    it("requires li to be inside ol or ul", () => {
      expect(ancestors.li).toEqual(["ol", "ul"]);
    });

    it("requires tr to be inside table structure", () => {
      expect(ancestors.tr).toContain("table");
    });
  });

  describe("required attributes", () => {
    const required = STRICT_MARKDOWN_SCHEMA.required!;

    it("forces checkbox inputs to be disabled", () => {
      expect(required.input).toEqual({ type: "checkbox", disabled: true });
    });
  });

  describe("clobber protection", () => {
    it("has empty clobber list to prevent id clobbering", () => {
      expect(STRICT_MARKDOWN_SCHEMA.clobber).toEqual([]);
    });

    it("has empty clobber prefix", () => {
      expect(STRICT_MARKDOWN_SCHEMA.clobberPrefix).toBe("");
    });
  });
});

describe("SAFE_REMARK_PLUGINS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(SAFE_REMARK_PLUGINS)).toBe(true);
    expect(SAFE_REMARK_PLUGINS.length).toBeGreaterThan(0);
  });
});

describe("SAFE_REHYPE_PLUGINS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(SAFE_REHYPE_PLUGINS)).toBe(true);
    expect(SAFE_REHYPE_PLUGINS.length).toBeGreaterThan(0);
  });

  it("includes rehype-sanitize with the STRICT_MARKDOWN_SCHEMA", () => {
    const entry = SAFE_REHYPE_PLUGINS[0];
    expect(Array.isArray(entry)).toBe(true);
    const [, schema] = entry as [unknown, unknown];
    expect(schema).toBe(STRICT_MARKDOWN_SCHEMA);
  });
});
