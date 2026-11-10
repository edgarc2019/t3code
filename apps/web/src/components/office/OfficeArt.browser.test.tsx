import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../../test/render";
import { OfficeCatAvatar } from "./OfficeArt";

const hops = () => document.getAnimations().length;
const stopHops = () => document.getAnimations().forEach((animation) => animation.cancel());

describe("waiting cat", () => {
  it("hops on a timer only while the tab is visible", async () => {
    using visibility = vi.spyOn(Document.prototype, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    using _timers = fakeTimers();
    await using _screen = await render(<OfficeCatAvatar fur="tux" pose="waiting" />, {
      router: false, // a bare SVG avatar needs no routes
    });
    expect(hops()).toBeGreaterThan(0);

    stopHops();
    await act(() => vi.advanceTimersByTime(6_000));
    expect(hops()).toBeGreaterThan(0);

    stopHops();
    visibility.mockReturnValue("hidden");
    await act(() => vi.advanceTimersByTime(18_000));
    expect(hops()).toBe(0);
  });

  it("never hops when it is not waiting", async () => {
    using _timers = fakeTimers();
    await using _screen = await render(<OfficeCatAvatar fur="tux" pose="typing" />, {
      router: false, // a bare SVG avatar needs no routes
    });
    await act(() => vi.advanceTimersByTime(18_000));
    expect(hops()).toBe(0);
  });
});
