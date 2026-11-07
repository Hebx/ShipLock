/** Typed failures so callers can tell "no money moved" from "money may have moved". */
export class PaymentPolicyError extends Error {
  readonly code = "payment_policy_rejected";
  constructor(message: string) {
    super(message);
    this.name = "PaymentPolicyError";
  }
}

export class CapabilityError extends Error {
  readonly code = "facilitator_capability_mismatch";
  constructor(message: string) {
    super(message);
    this.name = "CapabilityError";
  }
}

/** A signed payment exists and its on-chain outcome is not yet known. Do NOT re-pay. */
export class PaymentUncertainError extends Error {
  readonly code = "payment_uncertain";
  constructor(
    message: string,
    readonly transactionId: string | undefined,
  ) {
    super(message);
    this.name = "PaymentUncertainError";
  }
}

/** Settlement confirmed on-chain but no valid audit was delivered. Do NOT re-pay. */
export class PaidButNotFulfilledError extends Error {
  readonly code = "paid_not_fulfilled";
  constructor(
    message: string,
    readonly transactionId: string,
  ) {
    super(message);
    this.name = "PaidButNotFulfilledError";
  }
}

/** Audit delivered (and paid for) but it does not describe the expected commit. */
export class AuditShaMismatchError extends Error {
  readonly code = "audit_sha_mismatch";
  constructor(
    readonly expected: string,
    readonly received: string,
    readonly transactionId: string,
  ) {
    super(`audit references ${received}, expected ${expected}`);
    this.name = "AuditShaMismatchError";
  }
}

export class AuditIntegrityError extends Error {
  readonly code = "audit_integrity_failed";
  constructor(
    message: string,
    readonly transactionId: string,
  ) {
    super(message);
    this.name = "AuditIntegrityError";
  }
}
