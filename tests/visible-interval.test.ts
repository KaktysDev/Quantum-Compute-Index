import { afterEach, describe, expect, it, vi } from "vitest";
import { onVisibleInterval } from "@/lib/client/visible-interval";

describe("onVisibleInterval", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ticks only while the tab is visible and resumes on reveal", () => {
    vi.useFakeTimers();
    let hidden = false;
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal("document", {
      get hidden() {
        return hidden;
      },
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    });

    const callback = vi.fn();
    const stop = onVisibleInterval(callback, 1000);

    vi.advanceTimersByTime(3000);
    expect(callback).toHaveBeenCalledTimes(3);

    hidden = true;
    listeners.get("visibilitychange")?.(new Event("visibilitychange"));
    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(3);

    hidden = false;
    listeners.get("visibilitychange")?.(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(2000);
    expect(callback).toHaveBeenCalledTimes(6);

    stop();
    vi.advanceTimersByTime(2000);
    expect(callback).toHaveBeenCalledTimes(6);
  });

  it("does not start a timer when the document is already hidden", () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      hidden: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const callback = vi.fn();
    const stop = onVisibleInterval(callback, 1000);
    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
    stop();
  });
});
