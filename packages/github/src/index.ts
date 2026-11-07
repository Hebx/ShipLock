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
}

export interface GitHubReader {
  getRepository(fullName: string): Promise<RepositoryInfo>;
  getPullRequest(fullName: string, pullNumber: number): Promise<PullRequestSnapshot>;
  /** Exact `git diff base...head` bytes for two immutable SHAs. */
  getCompareDiff(fullName: string, baseSha: string, headSha: string): Promise<Uint8Array>;
}

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

export function createGitHubClient(options: GitHubClientOptions): GitHubReader {
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

  async function request(path: string, accept: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "shiplock",
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const res = await doFetch(`${apiBase}${path}`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
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
      };
    },

    async getCompareDiff(fullName, baseSha, headSha) {
      const base = HexShaSchema.parse(baseSha);
      const head = HexShaSchema.parse(headSha);
      const res = await request(`${repoPath(fullName)}/compare/${base}...${head}`, "application/vnd.github.diff");
      return readCapped(res, maxDiffBytes);
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
