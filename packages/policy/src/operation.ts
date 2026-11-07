import { canonicalSha256, HexShaSchema, PositiveIntSchema, RepoFullNameSchema, Sha256HexSchema } from "@shiplock/shared";
import { z } from "zod";

/**
 * The exact operation a maintainer approves. Hashed once when the authorization is created
 * and re-hashed from stored fields before execution; request bodies never supply it.
 */
export const MergeOperationSchema = z.strictObject({
  schema: z.literal("shiplock.merge-operation/v1"),
  action: z.literal("merge_pull_request"),
  authorizationId: z.string().min(1).max(100),
  repositoryId: PositiveIntSchema,
  repository: RepoFullNameSchema,
  pullNumber: PositiveIntSchema,
  headSha: HexShaSchema,
  baseRef: z.string().min(1).max(255),
  reportSha256: Sha256HexSchema,
  scannerVersion: z.string().min(1).max(100),
  mergeMethod: z.enum(["merge", "squash", "rebase"]),
  approverGithubLogin: z.string().min(1).max(39),
  worldIssuer: z.string().url(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,}$/),
  expiresAt: z.iso.datetime(),
});

export type MergeOperation = z.infer<typeof MergeOperationSchema>;

export function computeOperationHash(op: MergeOperation): string {
  return canonicalSha256(MergeOperationSchema.parse(op));
}
