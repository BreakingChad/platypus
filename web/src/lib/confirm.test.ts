import { describe, it, expect, vi, afterEach } from "vitest";
import { confirmDialog } from "./confirm";

/** With no <ConfirmRoot/> mounted, confirmDialog falls back to the host's
 *  native confirm. (lib tests run in node, so we provide a window stub.) */
describe("confirmDialog fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses window.confirm and returns its result", async () => {
    const confirmFn = vi.fn(() => true);
    vi.stubGlobal("window", { confirm: confirmFn });
    const ok = await confirmDialog({ message: "Proceed?" });
    expect(confirmFn).toHaveBeenCalledWith("Proceed?");
    expect(ok).toBe(true);
  });

  it("resolves false when the native confirm is declined", async () => {
    vi.stubGlobal("window", { confirm: vi.fn(() => false) });
    expect(await confirmDialog({ message: "x" })).toBe(false);
  });
});
