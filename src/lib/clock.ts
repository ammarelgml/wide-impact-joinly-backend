/** Injected everywhere time matters, so tests can move time (code expiry, token expiry). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);
