import { randomInt } from 'node:crypto';

/**
 * A 6-digit code from the CSPRNG, leading zeros allowed (D3). Guessing is
 * handled by rate limits and expiry, not by length.
 */
export function generateJoinCode(rand: (max: number) => number = (max) => randomInt(max)): string {
  for (;;) {
    const code = String(rand(1_000_000)).padStart(6, '0');
    if (code !== DEMO_JOIN_CODE) return code;
  }
}

/**
 * The fixed code of the seeded reviewer class. It is published in the README, so
 * it is never issued to a real classroom, even after the demo code expires.
 */
export const DEMO_JOIN_CODE = '246810';

/** Attempts before giving up on finding a free number. Collisions are ~1 in 1000 at 1000 live codes. */
export const MAX_CODE_ATTEMPTS = 5;
