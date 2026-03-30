import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddPlanModal } from "./AddPlanModal";
import { planIdeaDraftStorageKey } from "../../lib/agentInputDraftStorage";
import { PLAN_ATTACHMENT_MAX_SIZE, PLAN_ATTACHMENT_MAX_COUNT } from "@opensprint/shared";

const defaultProjectId = "proj-test";

async function expectFeatureInputFocused() {
  await waitFor(() => {
    expect(screen.getByTestId("feature-description-input")).toHaveFocus();
  });
}

function makeFile(name: string, content: string, type: string): File {
  return new File([content], name, { type });
}

describe("AddPlanModal", () => {
  beforeEach(() => {
    localStorage.removeItem(planIdeaDraftStorageKey(defaultProjectId));
  });

  it("focuses the feature description field when opened", async () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    await expectFeatureInputFocused();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: /add plan/i });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when overlay (backdrop) is clicked", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const overlay = document.querySelector(".bg-theme-overlay");
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const closeButton = screen.getByRole("button", { name: /close add plan modal/i });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onGenerate with trimmed description and undefined attachments when none attached", async () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(true);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const input = screen.getByTestId("feature-description-input");
    fireEvent.change(input, { target: { value: "  Add dark mode  " } });

    const generateButton = screen.getByTestId("generate-plan-button");
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(onGenerate).toHaveBeenCalledWith("Add dark mode", undefined);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("closes immediately even when onGenerate resolves false", async () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(false);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const input = screen.getByTestId("feature-description-input");
    fireEvent.change(input, { target: { value: "Feature text" } });
    fireEvent.click(screen.getByTestId("generate-plan-button"));

    await waitFor(() => {
      expect(onGenerate).toHaveBeenCalledWith("Feature text", undefined);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onGenerate when Generate Plan is clicked with empty input", () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn().mockResolvedValue(true);
    render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

    const generateButton = screen.getByTestId("generate-plan-button");
    expect(generateButton).toBeDisabled();
    fireEvent.click(generateButton);

    expect(onGenerate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe("attachment controls", () => {
    it("renders the attach button between Cancel and Generate Plan", () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(false);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const attachBtn = screen.getByTestId("attach-files-button");
      expect(attachBtn).toBeInTheDocument();
      expect(attachBtn).toHaveAccessibleName("Attach files");

      const footer = attachBtn.parentElement!;
      const buttons = Array.from(footer.querySelectorAll("button"));
      const cancelIndex = buttons.findIndex((b) => b.textContent?.includes("Cancel"));
      const attachIndex = buttons.findIndex((b) => b.dataset.testid === "attach-files-button");
      const generateIndex = buttons.findIndex((b) => b.dataset.testid === "generate-plan-button");

      expect(cancelIndex).toBeLessThan(attachIndex);
      expect(attachIndex).toBeLessThan(generateIndex);
    });

    it("attach button is keyboard-accessible", () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(false);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const attachBtn = screen.getByTestId("attach-files-button");
      expect(attachBtn.tagName).toBe("BUTTON");
      expect(attachBtn).not.toBeDisabled();
    });

    it("shows no attachment list when no files are attached", () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(false);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      expect(screen.queryByTestId("attachment-list")).not.toBeInTheDocument();
    });

    it("accepts a .md file and shows it in the attachment list", async () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(true);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
      const mdFile = makeFile("spec.md", "# My Spec\n\nDetails here", "text/markdown");
      fireEvent.change(fileInput, { target: { files: [mdFile] } });

      await waitFor(() => {
        expect(screen.getByTestId("attachment-list")).toBeInTheDocument();
      });
      expect(screen.getByText("spec.md")).toBeInTheDocument();
    });

    it("accepts image files (PNG, JPEG, WebP)", async () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(true);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
      const pngFile = makeFile("screenshot.png", "fake-png-data", "image/png");
      fireEvent.change(fileInput, { target: { files: [pngFile] } });

      await waitFor(() => {
        expect(screen.getByText("screenshot.png")).toBeInTheDocument();
      });
    });

    it("rejects unsupported file types and shows error", async () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(true);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
      const txtFile = makeFile("notes.txt", "some text", "text/plain");
      fireEvent.change(fileInput, { target: { files: [txtFile] } });

      await waitFor(() => {
        const error = screen.getByTestId("attach-error");
        expect(error).toBeInTheDocument();
        expect(error.textContent).toContain("unsupported file type");
      });

      expect(screen.queryByTestId("attachment-list")).not.toBeInTheDocument();
    });

    it("removes an attachment when remove button is clicked", async () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(true);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
      const mdFile = makeFile("spec.md", "# Spec", "text/markdown");
      fireEvent.change(fileInput, { target: { files: [mdFile] } });

      await waitFor(() => {
        expect(screen.getByText("spec.md")).toBeInTheDocument();
      });

      const removeBtn = screen.getByTestId("remove-attachment-0");
      fireEvent.click(removeBtn);

      expect(screen.queryByText("spec.md")).not.toBeInTheDocument();
      expect(screen.queryByTestId("attachment-list")).not.toBeInTheDocument();
    });

    it("sends attachments to onGenerate when files are attached", async () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(true);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
      const mdFile = makeFile("design.md", "# Design\n\nContent", "text/markdown");
      fireEvent.change(fileInput, { target: { files: [mdFile] } });

      await waitFor(() => {
        expect(screen.getByText("design.md")).toBeInTheDocument();
      });

      const input = screen.getByTestId("feature-description-input");
      fireEvent.change(input, { target: { value: "Build a dashboard" } });
      fireEvent.click(screen.getByTestId("generate-plan-button"));

      await waitFor(() => {
        expect(onGenerate).toHaveBeenCalledTimes(1);
        const [desc, attachments] = onGenerate.mock.calls[0];
        expect(desc).toBe("Build a dashboard");
        expect(attachments).toHaveLength(1);
        expect(attachments[0].name).toBe("design.md");
        expect(attachments[0].textContent).toBe("# Design\n\nContent");
      });
    });

    it("shows error for oversized files", async () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(true);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
      const bigContent = "x".repeat(PLAN_ATTACHMENT_MAX_SIZE + 1);
      const bigFile = makeFile("big.md", bigContent, "text/markdown");
      fireEvent.change(fileInput, { target: { files: [bigFile] } });

      await waitFor(() => {
        const error = screen.getByTestId("attach-error");
        expect(error.textContent).toContain("limit");
      });
    });

    it("enforces max attachment count", async () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(true);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
      const files = Array.from({ length: PLAN_ATTACHMENT_MAX_COUNT + 2 }, (_, i) =>
        makeFile(`file${i}.md`, `# File ${i}`, "text/markdown")
      );
      fireEvent.change(fileInput, { target: { files } });

      await waitFor(() => {
        const items = screen.getByTestId("attachment-list").querySelectorAll("li");
        expect(items.length).toBeLessThanOrEqual(PLAN_ATTACHMENT_MAX_COUNT);
      });
    });

    it("shows drop zone indicator during drag over", () => {
      const onClose = vi.fn();
      const onGenerate = vi.fn().mockResolvedValue(false);
      render(<AddPlanModal projectId={defaultProjectId} onGenerate={onGenerate} onClose={onClose} />);

      const dialog = screen.getByTestId("add-plan-modal");
      fireEvent.dragOver(dialog, { dataTransfer: { files: [] } });

      expect(screen.getByTestId("drop-zone")).toBeInTheDocument();
    });
  });
});
