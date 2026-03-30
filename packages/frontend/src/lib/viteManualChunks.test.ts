import { describe, it, expect } from "vitest";
import { getManualChunkForModuleId } from "../../vite.manualChunks";

describe("getManualChunkForModuleId", () => {
  it("returns undefined for application source files", () => {
    expect(getManualChunkForModuleId("/repo/packages/frontend/src/App.tsx")).toBeUndefined();
  });

  it("groups mermaid package into vendor-mermaid", () => {
    expect(getManualChunkForModuleId("/repo/node_modules/mermaid/dist/mermaid.core.mjs")).toBe(
      "vendor-mermaid"
    );
  });

  it("groups @mermaid-js/parser into vendor-mermaid", () => {
    expect(getManualChunkForModuleId("/repo/node_modules/@mermaid-js/parser/dist/index.js")).toBe(
      "vendor-mermaid"
    );
  });

  it("groups cytoscape and diagram helpers used by mermaid into vendor-mermaid", () => {
    expect(getManualChunkForModuleId("/repo/node_modules/cytoscape/dist/cytoscape.esm.mjs")).toBe(
      "vendor-mermaid"
    );
    expect(
      getManualChunkForModuleId("/repo/node_modules/dagre-d3-es/dist/dagre-d3-es.esm.js")
    ).toBe("vendor-mermaid");
    expect(getManualChunkForModuleId("/repo/node_modules/d3-sankey/dist/d3-sankey.js")).toBe(
      "vendor-mermaid"
    );
  });

  it("groups the d3 umbrella package into vendor-d3", () => {
    expect(getManualChunkForModuleId("/repo/node_modules/d3/src/index.js")).toBe("vendor-d3");
  });

  it("does not treat d3-sankey as vendor-d3 (it stays with vendor-mermaid)", () => {
    expect(getManualChunkForModuleId("/repo/node_modules/d3-sankey/src/index.js")).not.toBe(
      "vendor-d3"
    );
    expect(getManualChunkForModuleId("/repo/node_modules/d3-sankey/src/index.js")).toBe(
      "vendor-mermaid"
    );
  });

  it("normalizes Windows path separators", () => {
    expect(getManualChunkForModuleId(String.raw`C:\repo\node_modules\d3\src\index.js`)).toBe(
      "vendor-d3"
    );
  });

  it("still assigns vendor-react for react", () => {
    expect(getManualChunkForModuleId("/repo/node_modules/react/index.js")).toBe("vendor-react");
  });

  it("assigns marked to vendor-markdown before mermaid-specific rules", () => {
    expect(getManualChunkForModuleId("/repo/node_modules/marked/lib/marked.esm.js")).toBe(
      "vendor-markdown"
    );
  });
});
