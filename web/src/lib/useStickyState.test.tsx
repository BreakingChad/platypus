// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStickyState } from "./useStickyState";

describe("useStickyState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the initial value when storage is empty", () => {
    const { result } = renderHook(() => useStickyState<string>("test/k", "default"));
    expect(result.current[0]).toBe("default");
  });

  it("persists writes to localStorage under the pp: namespace", () => {
    const { result } = renderHook(() => useStickyState<string>("test/k", "default"));
    act(() => result.current[1]("hello"));
    expect(window.localStorage.getItem("pp:test/k")).toBe(JSON.stringify("hello"));
  });

  it("hydrates from existing localStorage on mount", () => {
    window.localStorage.setItem("pp:test/k", JSON.stringify("from-storage"));
    const { result } = renderHook(() => useStickyState<string>("test/k", "default"));
    expect(result.current[0]).toBe("from-storage");
  });

  it("namespaces by key — different keys don't collide", () => {
    const a = renderHook(() => useStickyState<number>("test/a", 1));
    const b = renderHook(() => useStickyState<number>("test/b", 2));
    act(() => a.result.current[1](99));
    expect(a.result.current[0]).toBe(99);
    expect(b.result.current[0]).toBe(2);
    // Each key persists independently; updating one doesn't bleed into the other.
    expect(window.localStorage.getItem("pp:test/a")).toBe("99");
    expect(window.localStorage.getItem("pp:test/b")).toBe("2");
  });

  it("round-trips structured values (objects, arrays)", () => {
    const { result, rerender } = renderHook(() =>
      useStickyState<{ ids: string[]; flag: boolean }>("test/struct", {
        ids: [],
        flag: false,
      })
    );
    act(() => result.current[1]({ ids: ["a", "b"], flag: true }));
    rerender();
    expect(result.current[0]).toEqual({ ids: ["a", "b"], flag: true });
  });

  it("gracefully returns initial when localStorage is unparseable", () => {
    window.localStorage.setItem("pp:test/k", "{not-json}");
    const { result } = renderHook(() => useStickyState<string>("test/k", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });
});
