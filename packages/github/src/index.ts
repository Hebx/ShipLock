import { HexShaSchema, RepoFullNameSchema } from "@shiplock/shared";
import { z } from "zod";

export class RepositoryNotAllowedError extends Error {
  constructor(readonly repository: string) {
    super(`repository is not allowlisted: ${repository}`);
    this.name = "RepositoryNotAllowedError";
  }
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export class DiffTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`diff exceeds ${limitBytes} bytes`);
    this.name = "DiffTooLargeError";
  }
}

const RepositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string(),
  default_branch: z.string(),
  private: z.boolean(),
});

const PullRequestSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
  draft: z.boolean().optional(),
  title: z.string(),
  html_url: z.string(),
  mergeable: z.boolean().nullable(),
  mergeable_state: z.string(),
  merge_commit_sha: z.string().nullable().optional(),
  user: z.object({ login: z.string() }).nullable(),
  head: z.object({
    sha: HexShaSchema,
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
  base: z.object({
    sha: HexShaSchema,
    ref: z.string(),
    repo: z.object({ id: z.number().int().positive(), full_name: z.string() }),
  }),
});

export interface RepositoryInfo {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/** Point-in-time view of a pull request. Untrusted text fields must never be interpreted. */
export interface PullRequestSnapshot {
  repositoryId: number;
  repository: string;
  number: number;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  title: string;
  htmlUrl: string;
  authorLogin: string | null;
  headSha: string;
  headRef: string;
  headRepository: string | null;
  baseSha: string;
  baseRef: string;
  mergeable: boolean | null;
  mergeableState: string;
  /** Only meaningful when `merged` is true; GitHub also fills it with test-merge commits. */
  mergeCommitSha: string | null;
}

export interface GitHubReader {
  getRepository(fullName: string): Promise<RepositoryInfo>;
  getPullRequest(fullName: string, pullNumber: number): Promise<PullRequestSnapshot>;
  /** Exact `git diff base...head` bytes for two immutable SHAs. */
  getCompareDiff(fullName: string, baseSha: string, headSha: string): Promise<Uint8Array>;
}

export interface CollaboratorPermission {
  /** null when GitHub reports the user is not a collaborator (404). */
  userId: number | null;
  /** Legacy coarse field: admin | write | read | none. */
  permission: string;
  /** Fine role: admin | maintain | write | triage | read, or a custom role name. */
  roleName: string;
}

export interface CheckRunSummary {
  name: string;
  status: string;
  conclusion: string | null;
  appSlug: string | null;
  /** GitHub App id that created the run; rulesets pin required checks to it as `integration_id`. */
  appId: number | null;
}

export interface CombinedStatus {
  state: "success" | "pending" | "failure" | "error";
  totalCount: number;
  statuses: Array<{ context: string; state: string }>;
}

export interface BranchRule {
  type: string;
  parameters?: unknown;
}

export type MergeOutcome =
  | { kind: "merged"; mergeCommitSha: string }
  | { kind: "head_changed"; httpStatus: 409 }
  | { kind: "rejected"; httpStatus: number };

/** The merge request may or may not have been applied; resolve by reading the PR, never by retrying. */
export class MergeOutcomeUnknownError extends Error {
  constructor(readonly detail: string) {
    super(`merge outcome unknown: ${detail}`);
    this.name = "MergeOutcomeUnknownError";
  }
}

export interface GitHubClient extends GitHubReader {
  getCollaboratorPermission(fullName: string, login: string): Promise<CollaboratorPermission>;
  /** Check runs for an exact commit. Throws when GitHub reports more runs than one page shows. */
  listCheckRuns(fullName: string, sha: string): Promise<CheckRunSummary[]>;
  getCombinedStatus(fullName: string, sha: string): Promise<CombinedStatus>;
  /** Active ruleset rules for a branch (`GET /rules/branches/{branch}`). */
  getBranchRules(fullName: string, branch: string): Promise<BranchRule[]>;
  /** `PUT /pulls/{n}/merge` with the `sha` precondition: GitHub refuses with 409 if the head moved. */
  mergePullRequest(fullName: string, pullNumber: number, sha: string, mergeMethod: "merge" | "squash" | "rebase"): Promise<MergeOutcome>;
}

const ROLE_RANK = new Map<string, number>([
  ["none", 0],
  ["read", 1],
  ["triage", 2],
  ["write", 3],
  ["maintain", 4],
  ["admin", 5],
]);

/** Ranks a collaborator permission; unknown custom roles fall back to the coarse legacy field. */
export function permissionRank(p: Pick<CollaboratorPermission, "permission" | "roleName">): number {
  return ROLE_RANK.get(p.roleName) ?? ROLE_RANK.get(p.permission) ?? 0;
}

const LoginSchema = z.string().regex(/^[A-Za-z0-9-]{1,39}$/);

const CollaboratorPermissionSchema = z.object({
  permission: z.string(),
  role_name: z.string().optional(),
  user: z.object({ id: z.number().int().positive(), login: z.string() }).nullable(),
});

const CheckRunsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  check_runs: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      app: z.object({ id: z.number().int(), slug: z.string() }).nullable().optional(),
    }),
  ),
});

const CombinedStatusSchema = z.object({
  state: z.enum(["success", "pending", "failure", "error"]),
  total_count: z.number().int().nonnegative(),
  statuses: z.array(z.object({ context: z.string(), state: z.string() })),
});

const BranchRulesSchema = z.array(z.object({ type: z.string(), parameters: z.unknown().optional() }));

const MergeResponseSchema = z.object({ merged: z.literal(true), sha: HexShaSchema });

export interface GitHubClientOptions {
  /** Least-privilege token scoped to the allowlisted demo repository only. Optional for public reads. */
  token?: string;
  allowlist: readonly string[];
  apiBase?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxDiffBytes?: number;
}

export function normalizeAllowlist(entries: readonly string[]): Set<string> {
  return new Set(entries.map((e) => RepoFullNameSchema.parse(e.trim()).toLowerCase()));
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const allow = normalizeAllowlist(options.allowlist);
  const apiBase = options.apiBase ?? "https://api.github.com";
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxDiffBytes = options.maxDiffBytes ?? 4 * 1024 * 1024;

  function repoPath(fullName: string): string {
    const parsed = RepoFullNameSchema.safeParse(fullName);
    if (!parsed.success || !allow.has(parsed.data.toLowerCase())) {
      throw new RepositoryNotAllowedError(fullName);
    }
    const [owner, repo] = parsed.data.split("/") as [string, string];
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  function send(path: string, accept: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "shiplock",
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    return doFetch(`${apiBase}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async function request(path: string, accept: string): Promise<Response> {
    const res = await send(path, accept);
    if (!res.ok) {
      // Response bodies are not echoed: they can contain repository content.
      throw new GitHubApiError(res.status, `GitHub ${res.status} for ${path}`);
    }
    return res;
  }

  async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const res = await request(path, "application/vnd.github+json");
    return schema.parse(await res.json());
  }

  return {
    async getRepository(fullName) {
      const r = await getJson(repoPath(fullName), RepositorySchema);
      if (r.full_name.toLowerCase() !== fullName.toLowerCase()) {
        throw new RepositoryNotAllowedError(r.full_name);
      }
      return { id: r.id, fullName: r.full_name, defaultBranch: r.default_branch, private: r.private };
    },

    async getPullRequest(fullName, pullNumber) {
      if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) throw new TypeError("invalid pull number");
      const pr = await getJson(`${repoPath(fullName)}/pulls/${pullNumber}`, PullRequestSchema);
      if (pr.base.repo.full_name.toLowerCase() !== fullName.toLowerCase()) {
        throw new RepositoryNotAllowedError(pr.base.repo.full_name);
      }
      return {
        repositoryId: pr.base.repo.id,
        repository: pr.base.repo.full_name,
        number: pr.number,
        state: pr.state,
        merged: pr.merged,
        draft: pr.draft ?? false,
        title: pr.title,
        htmlUrl: pr.html_url,
        authorLogin: pr.user?.login ?? null,
        headSha: pr.head.sha,
        headRef: pr.head.ref,
        headRepository: pr.head.repo?.full_name ?? null,
        baseSha: pr.base.sha,
        baseRef: pr.base.ref,
        mergeable: pr.mergeable,
        mergeableState: pr.mergeable_state,
        mergeCommitSha: pr.merge_commit_sha ?? null,
      };
    },

    async getCompareDiff(fullName, baseSha, headSha) {
      const base = HexShaSchema.parse(baseSha);
      const head = HexShaSchema.parse(headSha);
      const res = await request(`${repoPath(fullName)}/compare/${base}...${head}`, "application/vnd.github.diff");
      return readCapped(res, maxDiffBytes);
    },

    async getCollaboratorPermission(fullName, login) {
      const user = LoginSchema.parse(login);
      const path = `${repoPath(fullName)}/collaborators/${encodeURIComponent(user)}/permission`;
      const p = await getJson(path, CollaboratorPermissionSchema).catch((err: unknown) => {
        if (err instanceof GitHubApiError && err.status === 404) return null;
        throw err;
      });
      if (!p) return { userId: null, permission: "none", roleName: "none" };
      return { userId: p.user?.id ?? null, permission: p.permission, roleName: p.role_name ?? p.permission };
    },

    async listCheckRuns(fullName, sha) {
      const head = HexShaSchema.parse(sha);
      const r = await getJson(`${repoPath(fullName)}/commits/${head}/check-runs?per_page=100`, CheckRunsSchema);
      if (r.total_count > r.check_runs.length) throw new GitHubApiError(0, "too many check runs to evaluate on one page");
      return r.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, appSlug: c.app?.slug ?? null, appId: c.app?.id ?? null }));
    },

    async getCombinedStatus(fullName, sha) {
      const head = HexShaSchema.parse(sha);
      const s = await getJson(`${repoPath(fullName)}/commits/${head}/status?per_page=100`, CombinedStatusSchema);
      if (s.total_count > s.statuses.length) throw new GitHubApiError(0, "too many commit statuses to evaluate on one page");
      return { state: s.state, totalCount: s.total_count, statuses: s.statuses };
    },

    async getBranchRules(fullName, branch) {
      if (!/^[A-Za-z0-9._/-]{1,255}$/.test(branch) || branch.includes("..")) throw new TypeError("invalid branch name");
      return getJson(`${repoPath(fullName)}/rules/branches/${encodeURIComponent(branch)}?per_page=100`, BranchRulesSchema);
    },

    async mergePullRequest(fullName, pullNumber, sha, mergeMethod) {
      if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) throw new TypeError("invalid pull number");
      const expected = HexShaSchema.parse(sha);
      const path = `${repoPath(fullName)}/pulls/${pullNumber}/merge`;
      let res: Response;
      try {
        res = await send(path, "application/vnd.github+json", { method: "PUT", body: { sha: expected, merge_method: mergeMethod } });
      } catch (err) {
        throw new MergeOutcomeUnknownError(err instanceof Error ? err.name : "network error");
      }
      if (res.status === 200) {
        const body = MergeResponseSchema.safeParse(await res.json().catch(() => null));
        if (!body.success) throw new MergeOutcomeUnknownError("unparseable 200 response");
        return { kind: "merged", mergeCommitSha: body.data.sha };
      }
      if (res.status === 409) return { kind: "head_changed", httpStatus: 409 };
      if (res.status >= 500 || res.status === 429) throw new MergeOutcomeUnknownError(`GitHub ${res.status}`);
      return { kind: "rejected", httpStatus: res.status };
    },
  };
}

async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > limit) throw new DiffTooLargeError(limit);
  if (!res.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new DiffTooLargeError(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
