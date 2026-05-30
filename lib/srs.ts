/**
 * Simplified SM-2 spaced-repetition algorithm.
 *
 * Ported from Lumina's services/srsService.ts (HashBrowns-fries/Lumina), with
 * field names aligned to our `words` Convex schema (`ease` / `repetitions`
 * instead of `easeFactor` / `reps`). Pure functions: no Convex / no React /
 * no I/O — so it is trivially unit-testable and reusable on both the client
 * (optimistic UI) and the server (Convex mutation).
 *
 * Mastery status is what we surface in the UI; intervals are what we use to
 * schedule the next review.
 */

export type ReviewRating = "again" | "hard" | "good" | "easy";

export enum WordStatus {
  New = 0,
  Learning1 = 1,
  Learning2 = 2,
  Learning3 = 3,
  Learning4 = 4,
  WellKnown = 5,
}

export interface SrsState {
  ease: number;
  interval: number;
  repetitions: number;
  lastReview?: number;
  nextReview: number;
}

export interface SrsUpdate extends SrsState {
  status: WordStatus;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

export function initialSrsState(now: number = Date.now()): SrsState {
  return {
    ease: DEFAULT_EASE,
    interval: 0,
    repetitions: 0,
    nextReview: now,
  };
}

export function calculateNextReview(
  state: SrsState,
  rating: ReviewRating,
  now: number = Date.now(),
): SrsUpdate {
  let { interval, ease, repetitions } = state;

  if (rating === "again") {
    repetitions = 0;
    interval = 1;
    ease = Math.max(MIN_EASE, ease - 0.2);
  } else {
    repetitions += 1;

    if (repetitions === 1) {
      interval = rating === "easy" ? 4 : 1;
    } else if (repetitions === 2) {
      interval = rating === "easy" ? 8 : 4;
    } else {
      const multiplier =
        rating === "hard" ? 1.2 : rating === "easy" ? ease * 1.3 : ease;
      interval = Math.ceil(interval * multiplier);
    }

    if (rating === "easy") {
      ease += 0.15;
    } else if (rating === "hard") {
      ease = Math.max(MIN_EASE, ease - 0.15);
    }
  }

  let status: WordStatus;
  if (rating === "again") {
    status = WordStatus.Learning1;
  } else if (repetitions >= 4) {
    status = WordStatus.WellKnown;
  } else {
    status = Math.min(WordStatus.Learning4, repetitions + 1) as WordStatus;
  }

  return {
    ease,
    interval,
    repetitions,
    lastReview: now,
    nextReview: now + interval * DAY_MS,
    status,
  };
}

export function intervalLabel(state: SrsState, rating: ReviewRating): string {
  const next = calculateNextReview(state, rating);
  const days = next.interval;
  if (days < 1) return "< 1d";
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

export function statusLabel(status: WordStatus): string {
  return (
    {
      [WordStatus.New]: "新词",
      [WordStatus.Learning1]: "学习 1",
      [WordStatus.Learning2]: "学习 2",
      [WordStatus.Learning3]: "学习 3",
      [WordStatus.Learning4]: "学习 4",
      [WordStatus.WellKnown]: "已掌握",
    }[status] ?? "未知"
  );
}
