/**
 * Interval that is armed only while the tab is visible.
 *
 * Console lists used to poll every 5s in background tabs (12 req/min per open
 * surface). Browsers throttle timers when hidden, but the requests still fire
 * and still force React state updates when the user is not looking.
 */
export function onVisibleInterval(callback: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer == null) return;
    clearInterval(timer);
    timer = null;
  };

  const start = () => {
    if (timer != null) return;
    timer = setInterval(callback, ms);
  };

  const onVisibility = () => {
    if (document.hidden) {
      stop();
      return;
    }
    callback();
    start();
  };

  if (!document.hidden) start();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
