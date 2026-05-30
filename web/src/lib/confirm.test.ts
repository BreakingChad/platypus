import { describe, it, expect, vi, afterEach } from "vitest";
import { confirmDialog } from "./confirm";

/** With no <ConfirmRoot/> mounted, confirmDialog must fall back to the native
 *  window.confirm so callers (and tests) still get a boolean. */
describe("confirmDialog fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("falls back to window.confirm with the message", async () => {
    const spy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const ok = await confirmDialog({ message: "Proceed?" });
    expect(spy).toHaveBeenCalledWith("Proceed?");
    expect(ok).toBe(true);
  });

  it("resolves false when the native confirm is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(await confirmDialog({ message: "x" })).toBe(false);
  });
});
