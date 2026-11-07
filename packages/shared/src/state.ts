/**
 * Release state machine for one review job, i.e. one (repository, pull request, head SHA).
 * A new head SHA always means a new job; the old job can only become `stale`.
 */
export const RELEASE_STATES = [
  "discovered",
  "review_pending",
  "paid_review_confirmed",
  "approval_pending",
  "approved",
  "merge_in_progress",
  "merged",
  // blocked / terminal outcomes
  "review_blocked",
  "denied",
  "expired",
  "stale",
  "invalid",
  "failed",
  "reconcile_required",
] as const;

export type ReleaseState = (typeof RELEASE_STATES)[number];

const TRANSITIONS: Record<ReleaseState, readonly ReleaseState[]> = {
  discovered: ["review_pending", "stale", "invalid"],
  review_pending: ["paid_review_confirmed", "review_blocked", "stale", "invalid", "failed"],
  paid_review_confirmed: ["approval_pending", "stale", "invalid"],
  approval_pending: ["approved", "denied", "expired", "stale", "invalid"],
  approved: ["merge_in_progress", "expired", "stale", "invalid"],
  merge_in_progress: ["merged", "stale", "failed", "reconcile_required"],
  // A merge with an unknown outcome is resolved only by reading GitHub, never by retrying.
  reconcile_required: ["merged", "stale", "failed"],
  // Denied or expired authorizations may be replaced by a fresh authorization for the same SHA.
  denied: ["approval_pending", "stale", "invalid"],
  expired: ["approval_pending", "stale", "invalid"],
  review_blocked: [],
  stale: [],
  invalid: [],
  failed: [],
  merged: [],
};

export const TERMINAL_STATES: ReadonlySet<ReleaseState> = new Set(
  RELEASE_STATES.filter((s) => TRANSITIONS[s].length === 0),
);

export function canTransition(from: ReleaseState, to: ReleaseState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ReleaseState,
    readonly to: ReleaseState,
  ) {
    super(`invalid release state transition ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: ReleaseState, to: ReleaseState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isReleaseState(value: string): value is ReleaseState {
  return (RELEASE_STATES as readonly string[]).includes(value);
}
