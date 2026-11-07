import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv, AppDeps } from "./app.ts";
import { transaction, type Db } from "./db/index.ts";
import { ApiError } from "./errors.ts";
import { recordEvent } from "./store.ts";

const SESSION_COOKIE = "shiplock_session";
const OAUTH_COOKIE = "shiplock_oauth";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface SessionRow {
  id_hash: string;
  csrf_token_hash: string;
  github_user_id: number;
  github_login: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
/** Derived from the session cookie so it never needs to be stored in plaintext. */
const csrfFor = (sessionToken: string) => createHash("sha256").update(`shiplock-csrf:v1:${sessionToken}`).digest("base64url");

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function cookieOptions(appUrl: string, maxAgeSeconds: number, path = "/") {
  return { httpOnly: true, sameSite: "Lax" as const, secure: appUrl.startsWith("https://"), path, maxAge: maxAgeSeconds };
}

export function createSession(db: Db, user: { id: number; login: string }): { token: string; csrfToken: string } {
  const sessionToken = token();
  const csrfToken = csrfFor(sessionToken);
  const at = new Date();
  db.prepare(
    "INSERT INTO sessions (id_hash, csrf_token_hash, github_user_id, github_login, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(sha256(sessionToken), sha256(csrfToken), user.id, user.login, at.toISOString(), new Date(at.getTime() + SESSION_TTL_MS).toISOString());
  return { token: sessionToken, csrfToken };
}

function readSession(db: Db, c: Context): { row: SessionRow; token: string } | null {
  const value = getCookie(c, SESSION_COOKIE);
  if (!value || value.length > 128) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE id_hash = ?").get(sha256(value)) as SessionRow | undefined;
  if (!row || row.revoked_at || row.expires_at <= new Date().toISOString()) return null;
  return { row, token: value };
}

/**
 * Maintainer gate: a live GitHub-authenticated session, plus on every state-changing request
 * the CSRF header and (when the browser sends one) an Origin equal to APP_URL.
 */
export function requireMaintainer(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const s = readSession(deps.db, c);
    if (!s) throw new ApiError(401, "no_session");
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      if (origin && origin !== deps.config.appUrl) throw new ApiError(403, "origin_mismatch");
      const presented = c.req.header("x-csrf-token") ?? "";
      if (!presented || presented.length > 128 || !safeEqualHex(sha256(presented), s.row.csrf_token_hash)) {
        throw new ApiError(403, "csrf_failed");
      }
    }
    c.set("session", s.row);
    await next();
  };
}

const GitHubTokenSchema = z.object({ access_token: z.string().min(1), token_type: z.string() });
const GitHubUserSchema = z.object({ id: z.number().int().positive(), login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/) });
const CallbackQuerySchema = z.object({ code: z.string().min(1).max(200), state: z.string().min(1).max(200) });

/** GitHub OAuth App web flow. Identity only: no scopes requested, and the user token is discarded after one `/user` read. */
export function registerAuthRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  const doFetch = deps.fetch ?? fetch;
  const redirectUri = `${deps.config.appUrl}/api/auth/github/callback`;

  app.get("/api/auth/github/start", (c) => {
    const oauth = deps.config.githubOAuth;
    if (!oauth) throw new ApiError(503, "github_oauth_not_configured");
    const state = token();
    const browser = token();
    const at = new Date();
    deps.db
      .prepare("INSERT INTO github_oauth_states (state_hash, browser_hash, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(sha256(state), sha256(browser), at.toISOString(), new Date(at.getTime() + OAUTH_STATE_TTL_MS).toISOString());
    setCookie(c, OAUTH_COOKIE, browser, cookieOptions(deps.config.appUrl, OAUTH_STATE_TTL_MS / 1000, "/api/auth/github"));
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({ client_id: oauth.clientId, redirect_uri: redirectUri, state, scope: "", allow_signup: "false" }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get("/api/auth/github/callback", async (c) => {
    const oauth = deps.config.githubOAuth;
    if (!oauth) throw new ApiError(503, "github_oauth_not_configured");
    const done = (outcome: string) => c.redirect(`${deps.config.appUrl}/maintainer?login=${outcome}`, 302);
    if (c.req.query("error")) return done("cancelled");
    const q = CallbackQuerySchema.safeParse(c.req.query());
    const browser = getCookie(c, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: "/api/auth/github" });
    if (!q.success || !browser) return done("invalid_state");

    const consumed = deps.db
      .prepare(
        "UPDATE github_oauth_states SET consumed_at = ? WHERE state_hash = ? AND browser_hash = ? AND consumed_at IS NULL AND expires_at > ?",
      )
      .run(new Date().toISOString(), sha256(q.data.state), sha256(browser), new Date().toISOString());
    if (Number(consumed.changes) !== 1) return done("invalid_state");

    const user = await exchangeCodeForUser(doFetch, oauth, q.data.code, redirectUri).catch(() => null);
    if (!user) return done("github_error");
    const s = transaction(deps.db, () => {
      const created = createSession(deps.db, user);
      recordEvent(deps.db, "auth.github_login", null, { githubUserId: user.id });
      return created;
    });
    setCookie(c, SESSION_COOKIE, s.token, cookieOptions(deps.config.appUrl, SESSION_TTL_MS / 1000));
    return done("ok");
  });

  app.get("/api/session", (c) => {
    const s = readSession(deps.db, c);
    const world = deps.config.world;
    const base = {
      githubOAuthConfigured: Boolean(deps.config.githubOAuth),
      world: world ? { configured: true, environment: world.environment, appId: world.appId, requireUserPresence: world.requireUserPresence } : { configured: false },
    };
    if (!s) return c.json({ authenticated: false, ...base });
    const enrollment = deps.db
      .prepare("SELECT id, environment, created_at FROM world_enrollments WHERE github_user_id = ? AND revoked_at IS NULL")
      .get(s.row.github_user_id) as { id: string; environment: string; created_at: string } | undefined;
    return c.json({
      authenticated: true,
      ...base,
      github: { login: s.row.github_login, id: s.row.github_user_id },
      csrfToken: csrfFor(s.token),
      worldEnrollment: enrollment ? { id: enrollment.id, environment: enrollment.environment, enrolledAt: enrollment.created_at } : null,
    });
  });

  app.post("/api/auth/logout", requireMaintainer(deps), (c) => {
    deps.db.prepare("UPDATE sessions SET revoked_at = ? WHERE id_hash = ?").run(new Date().toISOString(), c.get("session").id_hash);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
}

async function exchangeCodeForUser(
  doFetch: typeof fetch,
  oauth: { clientId: string; clientSecret: string },
  code: string,
  redirectUri: string,
): Promise<{ id: number; login: string }> {
  const tokenRes = await doFetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "shiplock" },
    body: JSON.stringify({ client_id: oauth.clientId, client_secret: oauth.clientSecret, code, redirect_uri: redirectUri }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error("token exchange failed");
  const t = GitHubTokenSchema.parse(await tokenRes.json());
  const userRes = await doFetch("https://api.github.com/user", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${t.access_token}`, "User-Agent": "shiplock", "X-GitHub-Api-Version": "2022-11-28" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!userRes.ok) throw new Error("user lookup failed");
  return GitHubUserSchema.parse(await userRes.json());
}
