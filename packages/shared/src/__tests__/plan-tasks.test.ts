import { describe, it, expect } from "vitest";
import { parsePlanTasks } from "../plan-tasks.js";

describe("parsePlanTasks", () => {
  it("returns empty array when content is empty", () => {
    expect(parsePlanTasks("")).toEqual([]);
    expect(parsePlanTasks("   ")).toEqual([]);
  });

  it("returns empty array when no Tasks or Instructions section", () => {
    const content = `# My Plan

## Overview

Some text.

## Acceptance Criteria

- Criterion 1
`;
    expect(parsePlanTasks(content)).toEqual([]);
  });

  it("parses ## Tasks section with ### Title blocks", () => {
    const content = `# Feature

## Overview

Brief description.

## Tasks

### Add login API endpoint
Implement the login API with email/password validation.
Run npm test to verify.

### Add logout endpoint
Add POST /logout that clears the session.
`;
    const result = parsePlanTasks(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      title: "Add login API endpoint",
      description:
        "Implement the login API with email/password validation.\nRun npm test to verify.",
    });
    expect(result[1]).toEqual({
      title: "Add logout endpoint",
      description: "Add POST /logout that clears the session.",
    });
  });

  it("parses numbered ### headings (e.g. ### 1. Title)", () => {
    const content = `# Feature

## Tasks

### 1. Add login API
Implement login.

### 2. Add logout
Implement logout.
`;
    const result = parsePlanTasks(content);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Add login API");
    expect(result[1].title).toBe("Add logout");
  });

  it("uses ## Instructions when ## Tasks is absent", () => {
    const content = `# Feature

## Instructions

### First task
Do the first thing.

### Second task
Do the second thing.
`;
    const result = parsePlanTasks(content);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("First task");
    expect(result[1].title).toBe("Second task");
  });

  it("prefers ## Tasks over ## Instructions", () => {
    const content = `# Feature

## Tasks

### From Tasks
Tasks section content.

## Instructions

### From Instructions
Instructions content.
`;
    const result = parsePlanTasks(content);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("From Tasks");
  });

  it("handles case-insensitive section names", () => {
    const content = `# Feature

## TASKS

### My Task
Description here.
`;
    const result = parsePlanTasks(content);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("My Task");
  });

  it("handles task with empty description", () => {
    const content = `# Feature

## Tasks

### Title only

### Next task
Has description.
`;
    const result = parsePlanTasks(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ title: "Title only", description: "" });
    expect(result[1].title).toBe("Next task");
  });

  it("returns empty array when the Tasks section is present but has no task headings", () => {
    const content = `# Feature

## Tasks

Only prose here.
Still no heading.
`;

    expect(parsePlanTasks(content)).toEqual([]);
  });
});
