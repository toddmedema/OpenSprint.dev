import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWebSocket } from "./useWebSocket";

describe("useWebSocket", () => {
  it("throws deprecation error when called", () => {
    expect(() => renderHook(() => useWebSocket())).toThrow();
    expect(() => renderHook(() => useWebSocket())).toThrow(/deprecated/);
    expect(() => renderHook(() => useWebSocket())).toThrow(/wsConnect|wsDisconnect|wsSend/);
  });
});
