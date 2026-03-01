import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrdDiffView } from "./PrdDiffView";

describe("PrdDiffView", () => {
  it("renders scope change summary when no proposed updates", () => {
    render(
      <PrdDiffView
        currentPrd={null}
        scopeChangeMetadata={{
          scopeChangeSummary: "Summary only",
          scopeChangeProposedUpdates: [],
        }}
      />
    );
    expect(screen.getByText("Summary only")).toBeInTheDocument();
  });

  it("renders section diffs for proposed updates", () => {
    const currentPrd = {
      version: 1,
      sections: {
        feature_list: {
          content: "1. Web dashboard",
          version: 1,
          updatedAt: "2025-01-01T00:00:00Z",
        },
      },
      changeLog: [],
    };
    render(
      <PrdDiffView
        currentPrd={currentPrd}
        scopeChangeMetadata={{
          scopeChangeSummary: "• feature_list: Add mobile app",
          scopeChangeProposedUpdates: [
            {
              section: "feature_list",
              changeLogEntry: "Add mobile app",
              content: "1. Web dashboard\n2. Mobile app",
            },
          ],
        }}
      />
    );
    expect(screen.getByText("Feature List")).toBeInTheDocument();
    expect(screen.getByText("— Add mobile app")).toBeInTheDocument();
    expect(screen.getByTestId("prd-diff-section-feature_list")).toBeInTheDocument();
  });
});
