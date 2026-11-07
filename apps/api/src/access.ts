import { permissionRank } from "@shiplock/github";
import type { AppDeps } from "./app.ts";
import type { SessionRow } from "./auth.ts";
import type { WorldConfig } from "./config.ts";
import type { Db } from "./db/index.ts";
import { ApiError } from "./errors.ts";

export interface EnrollmentRow {
  id: string;
  github_user_id: number;
  github_login: string;
  environment: "production" | "staging";
  rp_id: string;
  enroll_action: string;
  nullifier: string;
  session_id: string;
  created_at: string;
  revoked_at: string | null;
}

export function requireWorld(deps: AppDeps): WorldConfig {
  if (!deps.config.world) throw new ApiError(503, "world_not_configured");
  return deps.config.world;
}

export function activeEnrollment(db: Db, githubUserId: number): EnrollmentRow | undefined {
  return db.prepare("SELECT * FROM world_enrollments WHERE github_user_id = ? AND revoked_at IS NULL").get(githubUserId) as
    | EnrollmentRow
    | undefined;
}

/** The maintainer's enrollment, only if it was made against the currently configured World app. */
export function requireEnrollment(deps: AppDeps, session: SessionRow, world: WorldConfig): EnrollmentRow {
  const e = activeEnrollment(deps.db, session.github_user_id);
  if (!e) throw new ApiError(409, "world_enrollment_required");
  if (e.environment !== world.environment || e.rp_id !== world.rpId || e.enroll_action !== world.enrollAction) {
    throw new ApiError(409, "world_enrollment_mismatch");
  }
  return e;
}

/**
 * Live GitHub check that the session's numeric user id holds at least the configured role on
 * the repository. A World proof never substitutes for this.
 */
export async function assertRepoPermission(deps: AppDeps, repository: string, user: { id: number; login: string }): Promise<void> {
  const p = await deps.github.getCollaboratorPermission(repository, user.login);
  if (p.userId !== user.id) throw new ApiError(403, "github_identity_mismatch");
  const min = deps.config.minGithubPermission;
  if (permissionRank(p) < permissionRank({ permission: min, roleName: min })) {
    throw new ApiError(403, "insufficient_repository_permission", { required: min });
  }
}
