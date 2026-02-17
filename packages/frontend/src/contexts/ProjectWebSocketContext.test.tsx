import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjectWebSocket } from "./ProjectWebSocketContext";

describe("useProjectWebSocket", () => {
  it("throws deprecation error when called", () => {
    expect(() => renderHook(() => useProjectWebSocket())).toThrow();
    expect(() => renderHook(() => useProjectWebSocket())).toThrow(/deprecated/);
    expect(() => renderHook(() => useProjectWebSocket())).toThrow(/websocketSlice|wsSend/);
  });
});
