// Main-thread responsiveness probes: the largest requestAnimationFrame gap while a job runs
// (all browsers) and Long Tasks API entries where supported (Chromium).

export interface ResponsivenessSample {
  maxFrameGapMs: number;
  frames: number;
  longTasks: number;
  longestTaskMs: number;
}

export function startProbe(): () => ResponsivenessSample {
  const sample: ResponsivenessSample = {
    maxFrameGapMs: 0,
    frames: 0,
    longTasks: 0,
    longestTaskMs: 0,
  };
  let last = performance.now();
  let raf = 0;
  const tick = (t: number) => {
    sample.maxFrameGapMs = Math.max(sample.maxFrameGapMs, t - last);
    sample.frames++;
    last = t;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  let observer: PerformanceObserver | null = null;
  if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        sample.longTasks++;
        sample.longestTaskMs = Math.max(sample.longestTaskMs, e.duration);
      }
    });
    observer.observe({ type: "longtask" });
  }
  return () => {
    cancelAnimationFrame(raf);
    observer?.disconnect();
    return { ...sample };
  };
}
