export type Clock = {
  now: () => Date;
  every: (ms: number, tick: () => void) => () => void;
};

export const systemClock: Clock = {
  now: () => new Date(),
  every: (ms, tick) => {
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
  },
};
