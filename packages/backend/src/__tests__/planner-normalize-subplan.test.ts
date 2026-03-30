import { describe, it, expect } from "vitest";
import {
  normalizeSubPlan,
  findSubPlanArray,
  parseSubPlanDecompositionResponse,
} from "../services/plan/planner-normalize.js";

describe("normalizeSubPlan", () => {
  it("normalizes a valid sub-plan with all required fields", () => {
    const raw = {
      title: "Auth module",
      overview: "Handles authentication",
      content: "# Auth\n\nImplement login/logout.",
      depends_on_plans: ["setup-db"],
    };
    const result = normalizeSubPlan(raw);
    expect(result).toEqual({
      title: "Auth module",
      overview: "Handles authentication",
      content: "# Auth\n\nImplement login/logout.",
      dependsOnPlans: ["setup-db"],
    });
  });

  it("accepts camelCase dependsOnPlans", () => {
    const raw = {
      title: "UI layer",
      overview: "Frontend components",
      content: "# UI\n\nBuild components.",
      dependsOnPlans: ["api-layer"],
    };
    const result = normalizeSubPlan(raw);
    expect(result).not.toBeNull();
    expect(result!.dependsOnPlans).toEqual(["api-layer"]);
  });

  it("accepts snake_case alternative field names", () => {
    const raw = {
      plan_title: "DB setup",
      summary: "Database schema",
      body: "# DB\n\nCreate tables.",
    };
    const result = normalizeSubPlan(raw);
    expect(result).toEqual({
      title: "DB setup",
      overview: "Database schema",
      content: "# DB\n\nCreate tables.",
      dependsOnPlans: [],
    });
  });

  it("returns null when title is missing", () => {
    const raw = { overview: "No title", content: "some content" };
    expect(normalizeSubPlan(raw)).toBeNull();
  });

  it("returns null when overview is missing", () => {
    const raw = { title: "Has title", content: "some content" };
    expect(normalizeSubPlan(raw)).toBeNull();
  });

  it("returns null when content is missing", () => {
    const raw = { title: "Has title", overview: "Has overview" };
    expect(normalizeSubPlan(raw)).toBeNull();
  });

  it("returns null when title is empty string", () => {
    const raw = { title: "  ", overview: "Overview", content: "Content" };
    expect(normalizeSubPlan(raw)).toBeNull();
  });

  it("returns null when overview is not a string", () => {
    const raw = { title: "Title", overview: 42, content: "Content" };
    expect(normalizeSubPlan(raw)).toBeNull();
  });

  it("trims whitespace from fields", () => {
    const raw = {
      title: "  Padded Title  ",
      overview: "  Padded Overview  ",
      content: "  Padded Content  ",
    };
    const result = normalizeSubPlan(raw);
    expect(result).toEqual({
      title: "Padded Title",
      overview: "Padded Overview",
      content: "Padded Content",
      dependsOnPlans: [],
    });
  });

  it("filters non-string values from depends_on_plans", () => {
    const raw = {
      title: "Title",
      overview: "Overview",
      content: "Content",
      depends_on_plans: ["valid", 42, null, "also-valid"],
    };
    const result = normalizeSubPlan(raw);
    expect(result).not.toBeNull();
    expect(result!.dependsOnPlans).toEqual(["valid", "also-valid"]);
  });
});

describe("findSubPlanArray", () => {
  it("finds top-level sub_plans key", () => {
    const input = {
      sub_plans: [{ title: "A" }, { title: "B" }],
    };
    const result = findSubPlanArray(input);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sub_plans");
    expect(result!.count).toBe(2);
    expect(result!.path).toBe("$.sub_plans");
  });

  it("finds top-level subPlans key", () => {
    const input = {
      subPlans: [{ title: "A" }],
    };
    const result = findSubPlanArray(input);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("subPlans");
    expect(result!.count).toBe(1);
    expect(result!.path).toBe("$.subPlans");
  });

  it("finds nested sub_plans", () => {
    const input = {
      result: { sub_plans: [{ title: "Nested" }] },
    };
    const result = findSubPlanArray(input);
    expect(result).not.toBeNull();
    expect(result!.path).toBe("$.result.sub_plans");
    expect(result!.count).toBe(1);
  });

  it("returns null for empty object", () => {
    expect(findSubPlanArray({})).toBeNull();
  });

  it("returns null for non-object value", () => {
    expect(findSubPlanArray("hello")).toBeNull();
    expect(findSubPlanArray(42)).toBeNull();
    expect(findSubPlanArray(null)).toBeNull();
  });

  it("prefers sub_plans over subPlans at same level", () => {
    const input = {
      sub_plans: [{ title: "A" }],
      subPlans: [{ title: "B" }, { title: "C" }],
    };
    const result = findSubPlanArray(input);
    expect(result).not.toBeNull();
    expect(result!.key).toBe("sub_plans");
    expect(result!.count).toBe(1);
  });

  it("finds sub_plans inside array wrapper", () => {
    const input = [{ sub_plans: [{ title: "Inside array" }] }];
    const result = findSubPlanArray(input);
    expect(result).not.toBeNull();
    expect(result!.path).toBe("$[0].sub_plans");
  });
});

describe("parseSubPlanDecompositionResponse", () => {
  it("parses a valid sub_plans response with explicit strategy", () => {
    const json = JSON.stringify({
      strategy: "sub_plans",
      sub_plans: [
        {
          title: "Auth module",
          overview: "Handle auth",
          content: "# Auth\nLogin/logout.",
          depends_on_plans: [],
        },
        {
          title: "API layer",
          overview: "REST endpoints",
          content: "# API\nBuild endpoints.",
          depends_on_plans: ["Auth module"],
        },
      ],
    });
    const result = parseSubPlanDecompositionResponse(json);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("sub_plans");
    if (result!.strategy === "sub_plans") {
      expect(result!.subPlans).toHaveLength(2);
      expect(result!.subPlans[0]!.title).toBe("Auth module");
      expect(result!.subPlans[1]!.dependsOnPlans).toEqual(["Auth module"]);
    }
  });

  it("parses a valid tasks response with explicit strategy", () => {
    const json = JSON.stringify({
      strategy: "tasks",
      tasks: [
        { title: "Create DB schema", description: "Add tables", priority: 1, depends_on: [] },
        {
          title: "Add API routes",
          description: "REST routes",
          priority: 2,
          depends_on: ["Create DB schema"],
        },
      ],
    });
    const result = parseSubPlanDecompositionResponse(json);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("tasks");
    if (result!.strategy === "tasks") {
      expect(result!.tasks).toHaveLength(2);
      expect(result!.tasks[0]!.title).toBe("Create DB schema");
      expect(result!.tasks[1]!.dependsOn).toEqual(["Create DB schema"]);
    }
  });

  it("infers sub_plans strategy when no explicit strategy field", () => {
    const json = JSON.stringify({
      sub_plans: [
        {
          title: "Plan A",
          overview: "First plan",
          content: "# A\nDo stuff.",
          depends_on_plans: [],
        },
      ],
    });
    const result = parseSubPlanDecompositionResponse(json);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("sub_plans");
  });

  it("infers tasks strategy when no explicit strategy field", () => {
    const json = JSON.stringify({
      tasks: [{ title: "Task 1", description: "Do it", priority: 1, depends_on: [] }],
    });
    const result = parseSubPlanDecompositionResponse(json);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("tasks");
  });

  it("extracts JSON from surrounding prose", () => {
    const content = `Here is my decomposition:\n${JSON.stringify({
      strategy: "sub_plans",
      sub_plans: [
        { title: "Core", overview: "Core logic", content: "# Core\nLogic.", depends_on_plans: [] },
      ],
    })}\nLet me know if you need changes.`;
    const result = parseSubPlanDecompositionResponse(content);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("sub_plans");
  });

  it("returns null for empty content", () => {
    expect(parseSubPlanDecompositionResponse("")).toBeNull();
  });

  it("returns null for non-JSON content", () => {
    expect(parseSubPlanDecompositionResponse("Just some text without JSON.")).toBeNull();
  });

  it("returns null when sub-plan is missing required fields", () => {
    const json = JSON.stringify({
      strategy: "sub_plans",
      sub_plans: [{ title: "Missing overview and content" }],
    });
    expect(parseSubPlanDecompositionResponse(json)).toBeNull();
  });

  it("returns null when task batch exceeds MAX_TASKS_PER_PLAN", () => {
    const tasks = Array.from({ length: 16 }, (_, i) => ({
      title: `Task ${i}`,
      description: `Desc ${i}`,
      priority: 1,
      depends_on: [],
    }));
    const json = JSON.stringify({ strategy: "tasks", tasks });
    expect(parseSubPlanDecompositionResponse(json)).toBeNull();
  });

  it("accepts exactly 15 tasks", () => {
    const tasks = Array.from({ length: 15 }, (_, i) => ({
      title: `Task ${i}`,
      description: `Desc ${i}`,
      priority: 1,
      depends_on: [],
    }));
    const json = JSON.stringify({ strategy: "tasks", tasks });
    const result = parseSubPlanDecompositionResponse(json);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("tasks");
    if (result!.strategy === "tasks") {
      expect(result!.tasks).toHaveLength(15);
    }
  });

  it("returns null when tasks array is empty", () => {
    const json = JSON.stringify({ strategy: "tasks", tasks: [] });
    expect(parseSubPlanDecompositionResponse(json)).toBeNull();
  });

  it("returns null when sub_plans array is empty", () => {
    const json = JSON.stringify({ strategy: "sub_plans", sub_plans: [] });
    expect(parseSubPlanDecompositionResponse(json)).toBeNull();
  });

  it("returns null for unknown strategy value", () => {
    const json = JSON.stringify({ strategy: "unknown", tasks: [{ title: "T" }] });
    expect(parseSubPlanDecompositionResponse(json)).toBeNull();
  });

  it("normalizes depends_on_plans in sub-plans response", () => {
    const json = JSON.stringify({
      strategy: "sub_plans",
      sub_plans: [
        { title: "Base", overview: "Base layer", content: "# Base\nSetup.", depends_on_plans: [] },
        {
          title: "App",
          overview: "Application layer",
          content: "# App\nBuild app.",
          depends_on_plans: ["Base"],
        },
      ],
    });
    const result = parseSubPlanDecompositionResponse(json);
    expect(result).not.toBeNull();
    if (result!.strategy === "sub_plans") {
      expect(result!.subPlans[0]!.dependsOnPlans).toEqual([]);
      expect(result!.subPlans[1]!.dependsOnPlans).toEqual(["Base"]);
    }
  });
});
