import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ImageAttachmentButton } from "./ImageAttachment";
import type { UseImageAttachmentReturn } from "../hooks/useImageAttachment";

function createMockAttachment(overrides: Partial<UseImageAttachmentReturn> = {}): UseImageAttachmentReturn {
  return {
    images: [],
    addImagesFromFiles: vi.fn(),
    removeImage: vi.fn(),
    reset: vi.fn(),
    handlePaste: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    handleFileInputChange: vi.fn(),
    ...overrides,
  };
}

describe("ImageAttachmentButton", () => {
  describe("icon variant tooltip", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not show tooltip before hover delay", () => {
      const attachment = createMockAttachment();
      render(
        <ImageAttachmentButton attachment={attachment} variant="icon" data-testid="attach" />
      );

      const button = screen.getByRole("button", { name: /Attach image/i });
      const wrapper = button.parentElement!;
      fireEvent.mouseEnter(wrapper);

      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("shows Attach image(s) tooltip after hover delay", () => {
      const attachment = createMockAttachment();
      render(
        <ImageAttachmentButton attachment={attachment} variant="icon" data-testid="attach" />
      );

      const button = screen.getByRole("button", { name: /Attach image/i });
      const wrapper = button.parentElement!;
      fireEvent.mouseEnter(wrapper);
      act(() => {
        vi.advanceTimersByTime(300);
      });

      const tooltip = screen.getByRole("tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveTextContent("Attach image(s)");
    });

    it("dismisses tooltip on mouse leave", () => {
      const attachment = createMockAttachment();
      render(
        <ImageAttachmentButton attachment={attachment} variant="icon" data-testid="attach" />
      );

      const button = screen.getByRole("button", { name: /Attach image/i });
      const wrapper = button.parentElement!;
      fireEvent.mouseEnter(wrapper);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByRole("tooltip")).toBeInTheDocument();

      fireEvent.mouseLeave(wrapper);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("shows aria-describedby on button when tooltip is visible", () => {
      const attachment = createMockAttachment();
      render(
        <ImageAttachmentButton attachment={attachment} variant="icon" data-testid="attach" />
      );

      const button = screen.getByRole("button", { name: /Attach image/i });
      const wrapper = button.parentElement!;
      fireEvent.mouseEnter(wrapper);
      act(() => {
        vi.advanceTimersByTime(300);
      });

      const tooltip = screen.getByRole("tooltip");
      const tooltipId = tooltip.id;
      expect(tooltipId).toBeTruthy();
      expect(button).toHaveAttribute("aria-describedby", tooltipId);
    });

    it("tooltip is styled consistently with other tooltips", () => {
      const attachment = createMockAttachment();
      render(
        <ImageAttachmentButton attachment={attachment} variant="icon" data-testid="attach" />
      );

      const button = screen.getByRole("button", { name: /Attach image/i });
      const wrapper = button.parentElement!;
      fireEvent.mouseEnter(wrapper);
      act(() => {
        vi.advanceTimersByTime(300);
      });

      const tooltip = screen.getByRole("tooltip");
      expect(tooltip).toHaveClass("bg-theme-bg-elevated");
      expect(tooltip).toHaveClass("text-theme-text");
      expect(tooltip).toHaveClass("ring-theme-border");
    });
  });

  describe("text variant", () => {
    it("does not show tooltip on hover", () => {
      const attachment = createMockAttachment();
      render(
        <ImageAttachmentButton attachment={attachment} variant="text" data-testid="attach" />
      );

      const button = screen.getByRole("button", { name: /Attach image\(s\)/i });
      fireEvent.mouseEnter(button);

      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });
});
