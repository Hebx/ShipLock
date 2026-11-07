import {
  canonicalSha256,
  EvidenceKindSchema,
  HexShaSchema,
  PositiveIntSchema,
  RepoFullNameSchema,
  Sha256HexSchema,
} from "@shiplock/shared";
import { z } from "zod";

/**
 * The exact operation a maintainer approves. Built only from server state when the
 * authorization is created, hashed once, and re-hashed from the stored JSON before approval
 * and execution; request bodies never supply it. The hash is the World ID proof signal.
 */
export const MergeOperationSchema = z.strictObject({
  schema: z.literal("shiplock.merge-operation/v2"),
  action: z.literal("merge_pull_request"),
  authorizationId: z.string().min(1).max(100),
  repositoryId: PositiveIntSchema,
  repository: RepoFullNameSchema,
  pullNumber: PositiveIntSchema,
  headSha: HexShaSchema,
  baseRef: z.string().min(1).max(255),
  reportSha256: Sha256HexSchema,
  scannerVersion: z.string().min(1).max(100),
  paidReviewEvidenceKind: EvidenceKindSchema,
  mergeMethod: z.enum(["merge", "squash", "rebase"]),
  approverGithubLogin: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
  approverGithubUserId: PositiveIntSchema,
  worldEnvironment: z.enum(["production", "staging"]),
  worldRpId: z.string().regex(/^rp_[A-Za-z0-9_-]{1,100}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,}$/),
  expiresAt: z.iso.datetime(),
});

export type MergeOperation = z.infer<typeof MergeOperationSchema>;

export function computeOperationHash(op: MergeOperation): string {
  return canonicalSha256(MergeOperationSchema.parse(op));
}
