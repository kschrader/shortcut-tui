import type { Clock } from "./clock.ts";

type Repeating = { ms: number; due: number; tick: () => void };

export type FakeClock = Clock & { advance: (ms: number) => void; timers: () => number };

export const createFakeClock = (start: Date): FakeClock => {
  let now = start.getTime();
  const repeating = new Set<Repeating>();
  return {
    now: () => new Date(now),
    every: (ms, tick) => {
      const timer = { ms, due: now + ms, tick };
      repeating.add(timer);
      return () => repeating.delete(timer);
    },
    advance: (ms) => {
      const end = now + ms;
      for (;;) {
        const next = [...repeating]
          .filter((timer) => timer.due <= end)
          .toSorted((a, b) => a.due - b.due)[0];
        if (next === undefined) break;
        now = next.due;
        next.due += next.ms;
        next.tick();
      }
      now = end;
    },
    timers: () => repeating.size,
  };
};
